# Session-Scoped Default Character + Primary-View Chaining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make character selection session-scoped (one default per asset list / assessment, mirroring Default Voice) and replace the legacy uploads-as-anchor flow with primary-view chaining where the Front view becomes the canonical reference for the other three views.

**Architecture:** Two cooperating changes that share a single deployment. (1) Add `default_character_id` to `asset_lists` and `assessment_assets`, surface it through the API, expose a Default Character selector in the UI, and consume it in slide-image generation as a fallback. (2) Inside the four-view feature, mark Front as primary, gate Three-Quarter / Side / Back generation behind a Front existing, anchor secondary views on the Front-view URL only (uploads are legacy and stop being threaded into reference URLs), and badge stale secondary views when Front has been regenerated more recently. A small CSS fix for the modal cut-off issue ships first as Phase 0.

**Tech Stack:** React 18 + Vite (client), Express.js (server), Supabase (Postgres), Google Gemini for image gen, Google Veo for video gen.

---

## Scope Note

This plan covers two related subsystems intentionally bundled because they share the same UI surface (the Career Character section) and because Phase 4 (downstream wiring) only makes sense once Phase 2/3 land. The phases are independently shippable except where noted.

## File Structure / Touch List

**New files**
- `supabase/migrations/008_session_default_character.sql` — adds `default_character_id` columns, FK, index.
- `supabase/migrations/009_backfill_default_character.sql` — backfills `default_character_id` on existing rows from `career_character_json`.

**Modified files**
- `supabase/schema.sql` — keep schema doc in sync with migration 008.
- `server/db/database.js` — character `getViews` returns `created_at`, asset-list and assessment-asset DAOs read/write `default_character_id`.
- `server/api/routes.js` — new PATCH endpoints, payload includes `defaultCharacterId`, slide image generation falls back to the session default character and threads its Front-view URL.
- `client/src/hooks/useApi.js` — `setSessionDefaultCharacter` and `setAssessmentDefaultCharacter` request helpers.
- `client/src/App.jsx` — wire the two new helpers into `ImageGenerator` props.
- `client/src/components/ImageGenerator/index.jsx` — new handlers, Default Character selector, pass `defaultCharacterId` into `CharacterPanel`.
- `client/src/components/ImageGenerator/CharacterPanel.jsx` — collapse to the session's default character once one is set.
- `client/src/components/ImageGenerator/CharacterViews.jsx` — slot config marks Front as primary, slot-aware reference builder, gate logic, stale badge.
- `client/src/components/ImageGenerator/ImageGenerator.css` — modal viewport cap, locked-slot hint, stale badge.
- `CLAUDE.md` — update Testing Checklist.

**Files NOT touched on purpose**
- `CharacterPanel.jsx`'s "Set Reference" button stays as a way to upload optional input for Front generation. The per-character reference list is no longer the anchor for secondary views, but the upload flow itself does not need to change.

---

## Phase 0: Modal cut-off fix

Smallest, highest-signal change. Ships first so the existing four-view flow stops being broken while the rest is in flight.

### Task 0.1: Cap modal height and scroll the body

**Files:**
- Modify: `client/src/components/ImageGenerator/ImageGenerator.css:1842-1851`

- [ ] **Step 1: Apply the CSS change**

Replace the existing `.character-modal` and `.character-modal-body` rules:

```css
.character-modal {
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.character-modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow-y: auto;
}
```

- [ ] **Step 2: Verify build**

Run from project root: `npm run build`
Expected: build completes, no CSS syntax errors.

- [ ] **Step 3: Smoke test the modal**

Run: `npm run dev`
1. Navigate to Carl Gen tab.
2. Pick any module that has at least one character with `appearanceDescription` populated.
3. Click View on a character.
4. Confirm: header is visible at top, footer/details visible at bottom, body scrolls when content exceeds viewport.

- [ ] **Step 4: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add client/src/components/ImageGenerator/ImageGenerator.css
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "fix: cap character modal height so header and footer stop clipping at small viewports"
```

---

## Phase 1: Primary-view chaining + stale hint

Self-contained inside `CharacterViews.jsx` plus one tiny server addition. Works regardless of Phase 2/3.

### Task 1.1: Surface `created_at` on view images

**Files:**
- Modify: `server/db/database.js:569-608` (the `getViews` method)

- [ ] **Step 1: Add `created_at` to the SELECT and the parsed payload**

Replace the SELECT in `getViews`:

```js
const { data: images, error: imgError } = await supabase
  .from('generated_images')
  .select('id, image_path, asset_type, created_at')
  .in('id', viewImageIds);
```

And in the mapping:

```js
viewImages = (images || []).map(img => ({
  id: img.id,
  imagePath: img.image_path,
  assetType: img.asset_type,
  createdAt: img.created_at
}));
```

- [ ] **Step 2: Restart the server and verify the response shape**

Run: `npm run server` (in a separate terminal)
Then in a browser DevTools console with the app open, hit the views endpoint for any character that has at least one view generated. Confirm each entry in `views` now has a `createdAt` ISO timestamp.

- [ ] **Step 3: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add server/db/database.js
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat: include createdAt on character view images for stale-detection on the client"
```

### Task 1.2: Slot-aware reference URL builder

**Files:**
- Modify: `client/src/components/ImageGenerator/CharacterViews.jsx:5-36`

- [ ] **Step 1: Mark Front as primary**

Replace the `SLOTS` array:

```js
const SLOTS = [
  { key: 'front', label: 'Front View', imageIdField: 'frontViewImageId', primary: true },
  { key: 'three_quarter', label: 'Three-Quarter View', imageIdField: 'threeQuarterViewImageId' },
  { key: 'side', label: 'Side View', imageIdField: 'sideViewImageId' },
  { key: 'back', label: 'Back View', imageIdField: 'backViewImageId' }
];
```

- [ ] **Step 2: Replace `getReferenceUrls` with `getReferenceUrlsForSlot`**

Remove the existing `getReferenceUrls` function. Add:

```js
function getReferenceUrlsForSlot(character, slot, primaryViewUrl) {
  if (!character) return [];
  if (slot?.primary) {
    const uploads = Array.isArray(character.referenceImages) ? character.referenceImages : [];
    return uploads.slice(0, MAX_REFERENCE_URLS);
  }
  return primaryViewUrl ? [primaryViewUrl] : [];
}
```

The Front slot still consumes any uploaded references the user has set as a hint. Secondary slots ignore uploads entirely and anchor only on the Front view image.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add client/src/components/ImageGenerator/CharacterViews.jsx
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "refactor: split character-view reference URLs by slot type so secondary views anchor on the front view only"
```

### Task 1.3: Compute primary view URL and pass it into the modal

**Files:**
- Modify: `client/src/components/ImageGenerator/CharacterViews.jsx:38-244`

- [ ] **Step 1: Compute `primaryView`, `primaryViewUrl`, `primaryGeneratedAt` after `views` is derived**

Inside the main `CharacterViews` component, after the `const views = ...` line near line 184, add:

```js
const primaryView = viewState.frontViewImageId
  ? views.find(v => v.id === viewState.frontViewImageId)
  : null;
const primaryViewUrl = primaryView?.imagePath
  ? (primaryView.imagePath.startsWith('http') ? primaryView.imagePath : `/anchors/${primaryView.imagePath}`)
  : null;
const primaryGeneratedAt = primaryView?.createdAt || null;
```

- [ ] **Step 2: Update `SlotGenerateModal` to accept `primaryViewUrl` and use the slot-aware builder**

Change the modal's prop signature to include `primaryViewUrl`. Inside the `useEffect` that pre-populates the form (around line 51), replace the call to the now-removed `getReferenceUrls` with:

```js
const refs = getReferenceUrlsForSlot(character, slot, primaryViewUrl);
for (const url of refs) {
  if (!url) continue;
  const fullUrl = url.startsWith('http') ? url : `/anchors/${url}`;
  formRef.current.addReferenceUrl(fullUrl);
}
```

- [ ] **Step 3: Pass `primaryViewUrl` into `SlotGenerateModal` from `CharacterViews`**

```jsx
<SlotGenerateModal
  slot={activeSlot}
  character={character}
  primaryViewUrl={activeSlot.primary ? null : primaryViewUrl}
  onClose={() => setActiveSlot(null)}
  generateStandaloneImage={generateStandaloneImage}
  assignCharacterView={assignCharacterView}
  onSuccess={handleSuccess}
/>
```

The `activeSlot.primary ? null : primaryViewUrl` means when the user opens the Front modal, the secondary anchor is irrelevant; when they open Three-Quarter / Side / Back, they get the Front URL.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add client/src/components/ImageGenerator/CharacterViews.jsx
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat: pass front-view URL into secondary-view generation modal as the sole reference"
```

### Task 1.4: Gate secondary-view Generate buttons on Front existing

**Files:**
- Modify: `client/src/components/ImageGenerator/CharacterViews.jsx:204-228`

- [ ] **Step 1: Replace the Generate button block**

Inside the slot loop, replace the existing `{!src && canGenerate && (<button>...)}` block with:

```jsx
{!src && canGenerate && (slot.primary || primaryViewUrl) && (
  <button
    type="button"
    className="view-slot-generate-btn"
    onClick={() => setActiveSlot(slot)}
  >
    Generate
  </button>
)}
{!src && canGenerate && !slot.primary && !primaryViewUrl && (
  <div className="view-slot-locked-hint">Generate front view first</div>
)}
```

- [ ] **Step 2: Add CSS for the locked hint**

In `client/src/components/ImageGenerator/ImageGenerator.css`, add near the other `.view-slot-*` rules (look around line 1917):

```css
.view-slot-locked-hint {
  font-family: monospace;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #5a5a5a;
  text-align: center;
  padding: 6px 0;
}
```

- [ ] **Step 3: Smoke test**

Run: `npm run dev`
1. Open a character with no views generated.
2. Confirm Front shows a Generate button; Three-Quarter, Side, and Back show "Generate front view first" instead of a button.
3. Generate the Front view (use the same flow as today).
4. After it completes, confirm the other three slots now show a Generate button.

- [ ] **Step 4: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add client/src/components/ImageGenerator/CharacterViews.jsx client/src/components/ImageGenerator/ImageGenerator.css
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat: gate secondary view generation behind a generated front view"
```

### Task 1.5: Stale "may not match" badge

**Files:**
- Modify: `client/src/components/ImageGenerator/CharacterViews.jsx` (the slot loop)
- Modify: `client/src/components/ImageGenerator/ImageGenerator.css`

- [ ] **Step 1: Compute `isStale` per slot inside the loop**

Inside the `SLOTS.map(slot => { ... })` block, after `const view = ...` is computed (around line 201), add:

```js
const slotCreatedAt = view?.createdAt || null;
const isStale = !slot.primary
  && primaryGeneratedAt
  && slotCreatedAt
  && new Date(slotCreatedAt) < new Date(primaryGeneratedAt);
```

- [ ] **Step 2: Render the badge**

Inside the `.view-slot-frame` div, after the image but before closing the frame, add:

```jsx
{isStale && (
  <div
    className="view-slot-stale-badge"
    title="Front view was regenerated after this. Consider regenerating to keep the character consistent."
  >
    May not match
  </div>
)}
```

- [ ] **Step 3: Add CSS for the badge**

```css
.view-slot-frame {
  position: relative;
}

.view-slot-stale-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 3px 6px;
  background: rgba(80, 60, 20, 0.85);
  border: 1px solid #aa8a4a;
  border-radius: 2px;
  color: #f0c060;
  font-family: monospace;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  pointer-events: none;
}
```

If `.view-slot-frame` already has `position: relative`, leave that line out and just add the badge rule.

- [ ] **Step 4: Smoke test**

Run: `npm run dev`
1. Pick a character that has all four views generated.
2. Click the Front slot's image (or trigger regeneration through the existing flow). Generate a new Front view.
3. Confirm the Three-Quarter, Side, and Back slots now show a "May not match" amber badge in the top-right corner.
4. Regenerate one of those three. Confirm its badge disappears (the new view's `createdAt` is now greater than Front's).

- [ ] **Step 5: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add client/src/components/ImageGenerator/CharacterViews.jsx client/src/components/ImageGenerator/ImageGenerator.css
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat: badge secondary character views as stale when front has been regenerated more recently"
```

### Task 1.6: Phase 1 end-to-end smoke test

- [ ] **Step 1: Full walkthrough**

Run: `npm run dev`. Walk through:
1. Open a character with no views. Generate Front using a prompt only (no uploads). Confirm the secondary slots unlock.
2. Generate Three-Quarter. Open the form right before clicking Generate and confirm the reference-URL list contains exactly one URL pointing at the Front-view image.
3. Repeat for Side and Back.
4. Regenerate Front. Confirm the other three pick up the stale badge.
5. Regenerate Side. Confirm its badge clears but Three-Quarter and Back still show stale.

- [ ] **Step 2: No commit needed if everything passes; otherwise file follow-up tasks**

---

## Phase 2: Session default character — DB + API

After Phase 2, the data model supports a session-scoped default character. No UI yet (that's Phase 3) and no consumption (that's Phase 4).

### Task 2.1: Migration 008 — add `default_character_id` columns

**Files:**
- Create: `supabase/migrations/008_session_default_character.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 008_session_default_character.sql
-- Adds default_character_id to asset_lists and assessment_assets so each
-- session/assessment can designate one canonical character (mirrors the
-- existing default_voice_id pattern).

ALTER TABLE asset_lists
  ADD COLUMN IF NOT EXISTS default_character_id UUID REFERENCES characters(id) ON DELETE SET NULL;

ALTER TABLE assessment_assets
  ADD COLUMN IF NOT EXISTS default_character_id UUID REFERENCES characters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_asset_lists_default_character
  ON asset_lists(default_character_id);
CREATE INDEX IF NOT EXISTS idx_assessment_assets_default_character
  ON assessment_assets(default_character_id);
```

- [ ] **Step 2: Apply the migration to Supabase**

Apply via the same path used for prior migrations (Supabase SQL editor, or `supabase db push` if the CLI is configured). Confirm with:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'asset_lists' AND column_name = 'default_character_id';
```

Expected: one row returned.

- [ ] **Step 3: Update `supabase/schema.sql` to keep documentation in sync**

In `supabase/schema.sql`, in the `asset_lists` block (around line 80) and the `assessment_assets` block (around line 229), add:

```sql
default_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
```

Also add the two new indexes after each table block.

- [ ] **Step 4: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add supabase/migrations/008_session_default_character.sql supabase/schema.sql
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat(db): add default_character_id to asset_lists and assessment_assets"
```

### Task 2.2: Update `assetListDb` to read/write `default_character_id`

**Files:**
- Modify: `server/db/database.js` (around lines 720, 1932 — the asset list update + parse functions)

- [ ] **Step 1: Add the field to the update path**

In the function that handles `assetListDb` updates (the one that already handles `defaultVoiceId`), add the parallel branch:

```js
if (updates.defaultCharacterId !== undefined) updateData.default_character_id = updates.defaultCharacterId;
```

- [ ] **Step 2: Add the field to the parser**

In `parseAssetListRow` (around line 1932 — the row that returns `defaultVoiceId: row.default_voice_id`), add:

```js
defaultCharacterId: row.default_character_id ?? null,
```

- [ ] **Step 3: Add the field to the create payload**

If `assetListDb.create` (or the equivalent insert path) explicitly lists columns, add `default_character_id: payload.defaultCharacterId ?? null`. The voice-default lines around `database.js:1793` are the model.

- [ ] **Step 4: Verify**

Run: `npm run server` and hit `GET /api/asset-lists/:id` for any existing session. Confirm `defaultCharacterId: null` shows up in the response.

- [ ] **Step 5: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add server/db/database.js
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat(db): expose defaultCharacterId on asset list reads and writes"
```

### Task 2.3: Update `assessmentAssetDb` to read/write `default_character_id`

**Files:**
- Modify: `server/db/database.js` (around lines 1739, 1793, 1807, 1971 — assessment asset update/create/parse)

- [ ] **Step 1: Mirror the asset-list change in the assessment path**

Same three additions as Task 2.2 but in the assessment update/create/parse functions. The voice-default lines around `database.js:1739`, `database.js:1793`, and `database.js:1971` are the model.

- [ ] **Step 2: Verify**

`GET /api/assessment-assets/:id` for any existing assessment. Confirm `defaultCharacterId: null` shows up.

- [ ] **Step 3: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add server/db/database.js
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat(db): expose defaultCharacterId on assessment asset reads and writes"
```

### Task 2.4: New routes for setting the default character

**Files:**
- Modify: `server/api/routes.js` (around line 2671 for the asset-list voice route, line 3042 for the assessment voice route)

- [ ] **Step 1: Add `PATCH /api/asset-lists/:id/character`**

Right after the existing `PATCH /api/asset-lists/:id/voice` handler, add:

```js
router.patch('/asset-lists/:id/character', async (req, res) => {
  try {
    const { id } = req.params;
    const { characterId } = req.body;
    if (characterId !== null && typeof characterId !== 'string') {
      return res.status(400).json({ error: 'characterId must be a string or null' });
    }
    const ok = await assetListDb.update(id, { defaultCharacterId: characterId });
    if (!ok) return res.status(404).json({ error: 'Asset list not found' });
    res.json({ success: true, defaultCharacterId: characterId });
  } catch (err) {
    console.error('Set default character failed:', err);
    res.status(500).json({ error: 'Failed to set default character' });
  }
});
```

- [ ] **Step 2: Add `PATCH /api/assessment-assets/:id/character`**

Right after the existing `PATCH /api/assessment-assets/:id/voice` handler, add the parallel route. Use `assessmentAssetDb.update(id, { defaultCharacterId: characterId })`.

- [ ] **Step 3: Test with curl**

```bash
curl -X PATCH http://localhost:3000/api/asset-lists/<some-id>/character \
  -H "Content-Type: application/json" \
  -d '{"characterId":null}'
```

Expected: `{"success":true,"defaultCharacterId":null}`

Then test with a real character UUID. Then `GET /api/asset-lists/<id>` and confirm `defaultCharacterId` reflects the update.

- [ ] **Step 4: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add server/api/routes.js
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat(api): add PATCH endpoints to set the session/assessment default character"
```

### Task 2.5: Migration 009 — backfill from `career_character_json`

**Files:**
- Create: `supabase/migrations/009_backfill_default_character.sql`

- [ ] **Step 1: Write the backfill**

```sql
-- 009_backfill_default_character.sql
-- For sessions imported from Carl that already have a career_character_json blob,
-- set default_character_id to the matching character record by (module_name, character_name).

UPDATE asset_lists al
SET default_character_id = c.id
FROM characters c
WHERE al.career_character_json IS NOT NULL
  AND c.module_name = al.module_name
  AND c.character_name = al.career_character_json->>'name'
  AND al.default_character_id IS NULL;
```

Note: `assessment_assets` is intentionally not backfilled. Carl pre/post test imports do not carry a `career_character_json` blob, so there is nothing to backfill from. Pre/post tests will surface the new selector empty and let the user pick one.

- [ ] **Step 2: Apply the migration**

Apply via the same path as 008. Spot-check by selecting a session you know was imported from Carl:

```sql
SELECT al.id, al.session_number, al.default_character_id, c.character_name
FROM asset_lists al
LEFT JOIN characters c ON c.id = al.default_character_id
WHERE al.module_name = 'Heat and Energy';
```

Expected: each row that previously had a `career_character_json` now has a non-null `default_character_id` and a matching character_name.

- [ ] **Step 3: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add supabase/migrations/009_backfill_default_character.sql
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat(db): backfill default_character_id from career_character_json on existing sessions"
```

---

## Phase 3: Session default character — UI

After Phase 3, users can pick a default character from the selector and the panel collapses to show only that one.

### Task 3.1: Add API helpers in `useApi.js`

**Files:**
- Modify: `client/src/hooks/useApi.js:451-465` (next to `setSessionDefaultVoice`)

- [ ] **Step 1: Add the two helpers**

Right after `setAssessmentDefaultVoice`:

```js
const setSessionDefaultCharacter = useCallback(async (assetListId, characterId) => {
  return request(`/asset-lists/${encodeURIComponent(assetListId)}/character`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId })
  });
}, [request]);

const setAssessmentDefaultCharacter = useCallback(async (assessmentId, characterId) => {
  return request(`/assessment-assets/${encodeURIComponent(assessmentId)}/character`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId })
  });
}, [request]);
```

- [ ] **Step 2: Export them**

Add `setSessionDefaultCharacter` and `setAssessmentDefaultCharacter` to the returned object near line 672.

- [ ] **Step 3: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add client/src/hooks/useApi.js
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat(client): add useApi helpers for setting the default character"
```

### Task 3.2: Wire the helpers through `App.jsx` to `ImageGenerator`

**Files:**
- Modify: `client/src/App.jsx` (lines 101-102 destructure, lines 501-502 props)

- [ ] **Step 1: Destructure and pass through**

Add `setSessionDefaultCharacter` and `setAssessmentDefaultCharacter` to the `useApi()` destructure (line 101) and pass them as props to `ImageGenerator` (line 501).

- [ ] **Step 2: Add them to `ImageGenerator`'s prop list**

In `client/src/components/ImageGenerator/index.jsx` around line 41:

```js
setSessionDefaultVoice,
setAssessmentDefaultVoice,
setSessionDefaultCharacter,
setAssessmentDefaultCharacter,
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add client/src/App.jsx client/src/components/ImageGenerator/index.jsx
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "chore(client): thread default-character setters through App into ImageGenerator"
```

### Task 3.3: Add `handleSetDefaultCharacter` and `handleSetAssessmentDefaultCharacter`

**Files:**
- Modify: `client/src/components/ImageGenerator/index.jsx` (around line 617, next to `handleSetDefaultVoice`)

- [ ] **Step 1: Add the two handlers**

```js
const handleSetDefaultCharacter = async (characterId) => {
  if (!setSessionDefaultCharacter || !selectedAssetList?.id) return;
  try {
    await setSessionDefaultCharacter(selectedAssetList.id, characterId || null);
    setSelectedAssetList(prev => prev ? { ...prev, defaultCharacterId: characterId || null } : prev);
  } catch (err) {
    console.error('Failed to set default character:', err);
  }
};

const handleSetAssessmentDefaultCharacter = async (characterId) => {
  if (!setAssessmentDefaultCharacter || !selectedAssessment?.id) return;
  try {
    await setAssessmentDefaultCharacter(selectedAssessment.id, characterId || null);
    setSelectedAssessment(prev => prev ? { ...prev, defaultCharacterId: characterId || null } : prev);
  } catch (err) {
    console.error('Failed to set assessment default character:', err);
  }
};
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add client/src/components/ImageGenerator/index.jsx
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat(client): add session/assessment default-character handlers"
```

### Task 3.4: Add the Default Character selector to the selector row

**Files:**
- Modify: `client/src/components/ImageGenerator/index.jsx:1075-1096` (right after the Default Voice selector)

- [ ] **Step 1: Add the selector**

After the closing `</div>` of the Default Voice `selector-group`:

```jsx
<div className="selector-group">
  <label>Default Character</label>
  <select
    value={selectedAssessment?.defaultCharacterId || selectedAssetList?.defaultCharacterId || ''}
    onChange={(e) => {
      const value = e.target.value || null;
      if (selectedAssessment) {
        handleSetAssessmentDefaultCharacter(value);
      } else {
        handleSetDefaultCharacter(value);
      }
    }}
    disabled={(!selectedAssetList && !selectedAssessment) || characters.length === 0}
  >
    <option value="">Select Character...</option>
    {characters.map(c => (
      <option key={c.id} value={c.id}>{c.characterName}</option>
    ))}
  </select>
</div>
```

- [ ] **Step 2: Smoke test**

Run: `npm run dev`
1. Open Heat and Energy module, Session 1.
2. Confirm the Default Character dropdown is populated with the module's characters.
3. Pick one. Refresh the page. Confirm the selection persisted (the dropdown should re-show that character on load).

- [ ] **Step 3: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add client/src/components/ImageGenerator/index.jsx
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat(ui): add Default Character selector mirroring Default Voice"
```

### Task 3.5: Collapse `CharacterPanel` to show only the default character

**Files:**
- Modify: `client/src/components/ImageGenerator/index.jsx:1112-1122` (where `<CharacterPanel ... />` is rendered)
- Modify: `client/src/components/ImageGenerator/CharacterPanel.jsx`

- [ ] **Step 1: Pass `defaultCharacterId` through to the panel**

```jsx
<CharacterPanel
  characters={characters}
  defaultCharacterId={selectedAssetList?.defaultCharacterId || null}
  onSetAnchor={handleSetAnchor}
  onRemoveReferenceImage={handleRemoveReferenceImage}
  getCharacterViews={getCharacterViews}
  assignCharacterView={assignCharacterView}
  generateStandaloneImage={generateStandaloneImage}
/>
```

- [ ] **Step 2: Update `CharacterPanel.jsx` to filter when `defaultCharacterId` is set**

In `CharacterPanel.jsx`, accept the new prop and filter the rendered list:

```js
export default function CharacterPanel({
  characters,
  defaultCharacterId,
  onSetAnchor,
  onRemoveReferenceImage,
  getCharacterViews,
  assignCharacterView,
  generateStandaloneImage
}) {
  const visibleCharacters = defaultCharacterId
    ? characters.filter(c => c.id === defaultCharacterId)
    : characters;
  // ... rest unchanged, just iterate over visibleCharacters instead of characters
```

When `defaultCharacterId` is null (no default chosen yet), all module characters render so the user can pick one. When set, only the chosen one renders.

- [ ] **Step 3: Smoke test**

Run: `npm run dev`
1. Open Heat and Energy Session 1 with no default set.
2. Confirm all module characters render in the panel.
3. Pick one in the new dropdown.
4. Confirm the panel collapses to just that character.
5. Clear the selection (pick the empty option).
6. Confirm all characters return.

- [ ] **Step 4: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add client/src/components/ImageGenerator/index.jsx client/src/components/ImageGenerator/CharacterPanel.jsx
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat(ui): collapse character panel to the session default once one is selected"
```

### Task 3.6: Phase 3 end-to-end smoke test

- [ ] **Step 1: Walk through both regular sessions and assessments**

Run: `npm run dev`. Verify:
1. Regular session: pick module, pick session, pick voice, pick character. Reload. All four selections persist.
2. Switch to a Pre-Test assessment under the same module. Set its default character. Confirm independent of the regular session's selection.
3. Use a session with no characters in its module. Confirm the dropdown is disabled and shows "Select Character..." with no options.

---

## Phase 4: Wire `defaultCharacterId` into image generation

This is where the session-default-character starts paying off. When a slide image is generated and no character is explicitly attached, the session default takes over and its Front-view URL is threaded as a reference URL.

### Task 4.1: Server fallback — use session default when slide gen has no character

**Files:**
- Modify: `server/api/routes.js` (the slide image generate handler — find the route that takes `assetListId` and creates a `generated_images` row)

- [ ] **Step 1: Locate the slide image generate handler**

Run: `grep -n "generated_images\|generateImage\|generate-image" server/api/routes.js | head` and identify the route. It's the one called by the client when the user clicks Generate on a slide asset. If the route is a thin wrapper that delegates to `server/services/imageGen.js`, apply both this fallback and the reference-URL prepend in Task 4.2 inside `imageGen.js` instead, so the logic lives where the reference URL list is actually built.

- [ ] **Step 2: Add the fallback**

When the request has an `assetListId` but no `characterId`:

```js
let effectiveCharacterId = req.body.characterId || null;
if (!effectiveCharacterId && req.body.assetListId) {
  const assetList = await assetListDb.getById(req.body.assetListId);
  effectiveCharacterId = assetList?.defaultCharacterId || null;
}
```

Use `effectiveCharacterId` everywhere the handler currently uses the explicit `characterId`.

- [ ] **Step 3: Smoke test (manual)**

Run: `npm run dev`
1. Open a session with a default character set.
2. Pick a slide that does not have a character explicitly attached.
3. Generate an image. Inspect the resulting `generated_images` row in Supabase. Confirm `character_id` is the session default.

- [ ] **Step 4: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add server/api/routes.js
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat(api): fall back to session default character when slide image generation has none"
```

### Task 4.2: Server reference URL — prepend the character's Front-view URL

**Files:**
- Modify: `server/api/routes.js` (same handler)
- Modify: `server/services/imageGen.js` (if reference URLs are passed through here)

- [ ] **Step 1: When the effective character has a Front view, prepend its URL to the reference URL list**

Before calling the underlying image generator:

```js
let referenceUrls = Array.isArray(req.body.referenceUrls) ? [...req.body.referenceUrls] : [];
if (effectiveCharacterId) {
  const character = await characterDb.getById(effectiveCharacterId);
  const views = await characterDb.getViews(effectiveCharacterId);
  if (views?.frontViewImageId) {
    const frontImage = views.views.find(v => v.id === views.frontViewImageId);
    if (frontImage?.imagePath) {
      const url = frontImage.imagePath.startsWith('http')
        ? frontImage.imagePath
        : `${process.env.PUBLIC_BASE_URL || ''}/anchors/${frontImage.imagePath}`;
      referenceUrls = [url, ...referenceUrls].slice(0, 3);
    }
  }
}
```

The exact resolution to a public URL depends on how `imagePath` is stored in this codebase. **Before writing the snippet, grep the existing slide image generation path for how it constructs reference URLs today and match that shape exactly.** If existing code uses Supabase storage URLs, mirror that. If it uses relative `/anchors/...` paths the way the client does, mirror that. Do not introduce a new URL shape here.

Also confirm the return shape of `characterDb.getViews()` before relying on `views.views.find(...)`. Per `server/db/database.js:599-607`, `getViews` returns `{ frontViewImageId, ..., views: [...] }`, so the snippet above is correct, but verify in case that signature has drifted.

- [ ] **Step 2: Smoke test**

Run: `npm run dev`
1. Make sure the session's default character has a Front view generated.
2. Generate a slide image with no explicit character attached.
3. Inspect the request payload going to Gemini (server logs). Confirm the Front-view URL is in the reference URL list.

- [ ] **Step 3: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add server/api/routes.js server/services/imageGen.js
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "feat(api): use session character's front view as the primary reference for slide image generation"
```

### Task 4.3: Phase 4 end-to-end smoke test

- [ ] **Step 1: Walk through a fresh session**

Run: `npm run dev`. Walk through:
1. Open a session in any module. Set a default character. Confirm the character has all four views.
2. Generate three different slide images that previously rendered random faces. Confirm visual consistency: same face, hair, clothing.
3. Now switch the default character to a different one. Generate another slide image. Confirm the face changes to the new character.

- [ ] **Step 2: Spot-check Heat and Energy specifically**

Heat and Energy is the canonical "different character per session" module. Open Session 1, confirm Mya. Open Session 2, confirm a different default character. Open Session 3, confirm a third. Confirm the per-session generation pulls each session's correct character.

---

## Phase 5: Cleanup + docs

### Task 5.1: Update CLAUDE.md Testing Checklist

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add three new checklist items under "Testing Checklist"**

```
- [ ] Default Character selector persists across reload
- [ ] Secondary character views (3/4, side, back) are gated until Front exists
- [ ] Slide image generation picks up the session's default character when none is attached
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add CLAUDE.md
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "docs: extend testing checklist with default character + primary view items"
```

### Task 5.2: Update "Set Reference" wording to reflect new optionality

**Files:**
- Modify: `client/src/components/ImageGenerator/CharacterPanel.jsx:87`

- [ ] **Step 1: Soften the button label**

Change the current `'Set Reference'` label to `'Add Reference (optional)'`. The behavior stays the same; the wording stops implying it's required for character generation.

- [ ] **Step 2: Commit**

```bash
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids add client/src/components/ImageGenerator/CharacterPanel.jsx
git -C /Users/moriahplacer/Desktop/mo.vault.2/nola.vids commit -m "ui: clarify that uploaded reference images are optional input for front-view generation"
```

### Task 5.3: Final regression sweep

- [ ] **Step 1: Run the full project Testing Checklist**

Walk every line in CLAUDE.md `Testing Checklist` (including the three new items from 5.1). Anything that breaks gets a follow-up issue.

- [ ] **Step 2: Build + start in production mode**

```bash
npm run build && npm start
```

Hit the app at the production port. Confirm Carl Gen tab still loads, character panel still works, slide generation still works.

---

## Risk + rollback notes

- **Migration 009 backfill is non-destructive.** It only sets `default_character_id` where it is currently `NULL` and a name match exists. Re-running it is safe.
- **Phase 1 changes are pure UI/server-additive.** Reverting just the front-end commits is safe; nothing on the server depends on the new `createdAt` field except the client-side stale badge.
- **Phase 4 changes the behavior of existing slide-image generation paths.** If a user has been deliberately leaving `character_id` null and getting the random-character behavior, they'll now get the session default. Mitigation: setting Default Character to "Select Character..." (empty) restores the old behavior.
- **The four legacy `referenceImages` uploads are not deleted by this plan.** They stay on the character record; they just stop being threaded into secondary-view generation. If a user wants to roll back, the data is still there.

## Open decisions punted to execution time

1. **PUBLIC_BASE_URL resolution in Task 4.2.** I assumed there's an env var or equivalent. If not, the executor should match whatever pattern existing slide generation uses (likely the Supabase storage URL prefix is already being passed to Gemini elsewhere — match it).
2. **Whether to delete the legacy "Set Reference" upload UI later.** Out of scope for this plan. Revisit after watching three weeks of user behavior with the new flow.

---

## Execution handoff

This plan is structured to be picked up by the **subagent-driven-development** flow (recommended) where one task = one subagent dispatch. Phase 0 is a single-commit warm-up; Phase 1 is self-contained and shippable independently; Phase 2 + 3 are the architectural shift and must ship together; Phase 4 unlocks the value; Phase 5 is cleanup.
