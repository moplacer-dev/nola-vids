# STATUS.md - CMS Sync Implementation

**Date:** 2026-03-19 (Updated)
**Feature:** Sync with CMS (Phase 0 of Push to CMS)
**Status:** In Progress - RCP import parsing issue (Question field contains full text instead of question-only)

---

## Overview

Added "Sync with CMS" functionality to NOLA.vids Carl Gen tab. This feature allows slides to be synchronized between NOLA.vids and the Directus CMS at nola.tools.

**Problem Solved:** After Carl v7 pushes content to both NOLA.vids and the CMS, editors may modify slides in the CMS (merge, split, add, remove). This creates misalignment that must be resolved before media can be pushed.

**Solution:** A comparison modal that shows:
- **Matched slides** (exact narration match) - green checkmarks
- **Narration mismatches** (fuzzy match, needs update) - yellow with "Update" buttons
- **CMS-only slides** (can be added) - blue with "Add" button
- **NOLA.vids-only slides** (can be deleted) - red with "Delete" button

---

## Session Progress (2026-03-18)

### Issues Encountered & Resolved

#### 1. Directus 403 Errors - Field Access Denied
**Problem:** Initial queries used `fields=*` wildcard which tried to access restricted fields.

**Solution:** Specify only needed fields explicitly:
```javascript
// BAD - tries to access all fields including restricted ones
fields=content_units_id.*

// GOOD - only request fields we need
fields=content_units_id.id,content_units_id.title
```

#### 2. Directus Schema Discovery
**Problem:** Unknown relationship field names caused 403 errors and empty results.

**Solution:** Created `scripts/explore-cms-schema.js` to discover the actual schema:

```
Course → Units:     child_units (M2M junction) → content_units_id
Unit → Lessons:     child_lessons (O2M direct)
Lesson → Pages:     child_pages (M2M junction) → content_pages_id
```

**Key Insight:** Directus M2M relationships go through junction tables. Must expand through junction:
```javascript
// M2M: go through junction table
child_units.content_units_id.title
child_pages.content_pages_id.title

// O2M: direct access
child_lessons.title
```

#### 3. Slide Matching by Position Failed
**Problem:** CMS page numbers in titles (e.g., "Page 31") don't reset when pages are deleted, causing position-based matching to fail.

**Solution:** Match by **narration text** instead:
- Create signature from first 30 words of normalized narration
- Normalize: lowercase, remove punctuation, convert "one" → "1", etc.
- Use 75% similarity threshold for fuzzy matching

#### 4. Narration Differences Between Systems
**Problem:** Minor text differences (e.g., "supplies equipment" vs "equipment") caused matches to fail.

**Solution:**
- Fuzzy matching with word-based similarity
- Separate "exact matches" from "narration mismatches"
- UI to update NOLA.vids narration from CMS (source of truth)
- Updating narration resets audio to `pending` for TTS regeneration

#### 5. Update Narration Not Moving Slides to Matched
**Problem:** After clicking "Update" on a narration mismatch, the slide stayed in "Narration Mismatch" section instead of moving to "Matched Slides".

**Root Cause:** The `/cms/sync/:id/update-narration` endpoint was using wrong key names for database updates:
- `assetListDb.update()` expects `{ slides: ... }` but code passed `{ slides_json: ... }`
- `generatedAudioDb.update()` expects camelCase keys but code used snake_case

**Solution:** Fixed key names in `server/api/routes.js`:
```javascript
// Before (broken - wrong keys ignored by update functions)
await assetListDb.update(id, { slides_json: JSON.stringify(slides) });
await generatedAudioDb.update(id, { narration_text: text, audio_path: null });

// After (working)
await assetListDb.update(id, { slides: slides });
await generatedAudioDb.update(id, { narrationText: text, audioPath: null });
```

#### 6. RCP Sessions Using Wrong Narration Type for Matching
**Problem:** RCP slides have multiple narration types (question, answers, correct response, etc.). The sync was using the first audio record found instead of specifically the "question" type, causing mismatches.

**Solution:** Updated `/cms/sync/:id/fetch` and `/cms/sync/:id/update-narration` to:
- For RCP sessions (`sessionType === 'rcp'`): Use audio record with `narrationType === 'question'`
- For regular sessions: Use `narrationType === 'slide_narration'` or first available

**Data Note:** Ensure the "Question" narration in NOLA.vids contains ONLY the question text, not the answer choices. If answers are concatenated, the signature won't match the CMS.

#### 7. Session Slide Numbers Starting at 4 Instead of 1
**Problem:** Sessions 2-6 had slides numbered 4-34 instead of 1-31. This happened because when Carl imports, it sends the full session (RCP + regular slides 1-34), and NOLA.vids splits them into separate sessions but didn't renumber the regular slides to start at 1.

**Solution:**
1. Created `scripts/renumber-session-slides.js` to fix existing data
2. Updated import logic in `server/api/routes.js` to auto-renumber slides when they don't start at 1

**Script usage:**
```bash
node scripts/renumber-session-slides.js
```

#### 8. CMS Sync Showing RCP Slides for Regular Sessions (RESOLVED)
**Problem:** When syncing a regular session (e.g., "Session 2"), the CMS fetch was matching wrong lesson.

**Solution:** Updated lesson matching in `cmsClient.getSessionPages()` to explicitly exclude "Session N RCP/RCA" when looking for regular "Session N" lessons.

#### 9. RCP Import - Question Contains Full Text Instead of Question-Only (RESOLVED)
**Problem:** When Carl v7 pushes RCP sessions, the Question narration field in NOLA.vids contained the full concatenated text (question + answers + correct answer) instead of just the question text.

**Root Cause:** The `structuredNarration.leadIn` field from Carl contained the full concatenated text (question + answers + correct answer), not a proper lead-in sentence. The code was doing:
```javascript
const questionParts = [sn.leadIn, sn.question].filter(Boolean);
await upsertSlideAudio(..., questionParts.join(' '));
```
This produced: `<leadIn (full junk)> <question>` = concatenated mess.

**Carl's Payload Structure:**
```javascript
{
  slides: [{
    slideNumber: 1,
    slideType: "rcp_recall",
    narration: "Which of the following...",  // Question-only text
    structuredNarration: {
      leadIn: "Which of the following...\n\nA) Oil...\n\nCorrect Answer: B",  // JUNK!
      question: "Which of the following mixtures is considered a solution?",  // CLEAN
      answerChoices: [
        {label: "A", text: "Oil and vinegar"},
        {label: "B", text: "Salt water"},
        // ...
      ],
      correctResponseText: "That's right! Salt water is...",
      firstIncorrectText: "Not quite...",
      secondIncorrectText: "Remember..."
    }
  }]
}
```

**Solution:** Use `sn.question` directly and ignore `leadIn`:
```javascript
// Before (buggy)
const questionParts = [sn.leadIn, sn.question].filter(Boolean);
await upsertSlideAudio(..., questionParts.join(' '));

// After (fixed)
if (sn.question) {
  await upsertSlideAudio(..., sn.question);
}
```

**Files Changed:**
- `server/api/routes.js`: Fixed in `processAssetList()` function (~line 3575)
- `server/db/database.js`: Added `upsertBulkRcp()` function for keying by slideNumber+narrationType

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                          │
├─────────────────────────────────────────────────────────────────┤
│  ImageGenerator/index.jsx                                        │
│    ├── "Sync with CMS" button (visible when CMS available)      │
│    └── CmsSyncModal.jsx (comparison UI)                         │
│                                                                  │
│  hooks/useApi.js                                                 │
│    ├── checkCmsStatus()         → GET /cms/status               │
│    ├── fetchCmsSync()           → POST /cms/sync/:id/fetch      │
│    ├── addSlideFromCms()        → POST /cms/sync/:id/add-slide  │
│    ├── deleteSlideFromNola()    → POST /cms/sync/:id/delete-slide│
│    └── updateNarrationFromCms() → POST /cms/sync/:id/update-narration│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend (Express)                           │
├─────────────────────────────────────────────────────────────────┤
│  server/api/routes.js                                            │
│    ├── GET  /cms/status              → Check if CMS configured  │
│    ├── POST /cms/sync/:id/fetch      → Compare slides           │
│    ├── POST /cms/sync/:id/add-slide  → Add from CMS             │
│    ├── POST /cms/sync/:id/delete-slide → Delete from NOLA.vids  │
│    └── POST /cms/sync/:id/update-narration → Update narration   │
│                                                                  │
│  server/services/cmsClient.js                                    │
│    ├── isAvailable()         → Check credentials                │
│    ├── getSessionPages()     → Fetch CMS pages (nested query)   │
│    ├── getPageDetails()      → Fetch single page                │
│    ├── normalizeText()       → Normalize for comparison         │
│    ├── getTextSignature()    → First 30 words normalized        │
│    ├── calculateSimilarity() → Word-based similarity (0-1)      │
│    └── compareSlides()       → Fuzzy match by narration         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Directus CMS (nola.tools)                     │
├─────────────────────────────────────────────────────────────────┤
│  Single nested query for all data:                               │
│    /items/content_courses/{CARL_COURSE_ID}?fields=               │
│      id,title,                                                   │
│      child_units.content_units_id.id,                           │
│      child_units.content_units_id.title,                        │
│      child_units.content_units_id.child_lessons.id,             │
│      child_units.content_units_id.child_lessons.title,          │
│      child_units.content_units_id.child_lessons.child_pages.    │
│        content_pages_id.id,                                     │
│      child_units.content_units_id.child_lessons.child_pages.    │
│        content_pages_id.title,                                  │
│      child_units.content_units_id.child_lessons.child_pages.    │
│        content_pages_id.narration_text,                         │
│      ... etc                                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directus Schema Reference

**Discovered via `scripts/explore-cms-schema.js`**

### Collections
- `content_courses` - Top level (CARL course)
- `content_courses_content_units` - Junction table
- `content_units` - Modules (e.g., "Reactions")
- `content_lessons` - Sessions (e.g., "Session 1", "Session 2 RCP")
- `content_lessons_content_pages` - Junction table
- `content_pages` - Individual slides

### Relationships
```
content_courses
  └── child_units (M2M via content_courses_content_units)
        └── content_units_id → content_units
              └── child_lessons (O2M direct IDs)
                    └── content_lessons
                          └── child_pages (M2M via content_lessons_content_pages)
                                └── content_pages_id → content_pages
```

### Page Fields (content_pages)
- `id` - UUID
- `title` - Page title (often empty, shows in TOC)
- `narration_text` - Full narration (best for matching)
- `slide_type` - "Text & Image", "Video only", etc.
- `text_content` - HTML slide content
- `sort` - Sort order within lesson
- `image` - Directus file reference
- `narration` - Directus file reference (audio)
- `video` - Directus file reference

---

## API Reference

### GET /api/cms/status
Check if CMS is configured.

### POST /api/cms/sync/:assetListId/fetch
Fetch comparison data. Returns:
```json
{
  "matched": [...],           // Exact narration matches
  "narrationMismatches": [...], // Fuzzy matches needing update
  "cmsOnly": [...],           // In CMS, not in NOLA.vids
  "nolaOnly": [...]           // In NOLA.vids, not in CMS
}
```

### POST /api/cms/sync/:assetListId/add-slide
Add slide from CMS to NOLA.vids.

### POST /api/cms/sync/:assetListId/delete-slide
Delete slide from NOLA.vids (cascade deletes assets).

### POST /api/cms/sync/:assetListId/update-narration
Update narration text from CMS. Resets audio status to `pending`.
```json
{
  "slideNumber": 12,
  "narrationText": "New narration from CMS...",
  "pageId": "cms-page-uuid"
}
```

---

## Environment Variables

```bash
DIRECTUS_API_URL=https://www.nola.tools
DIRECTUS_API_TOKEN=your_bearer_token_here
DIRECTUS_CARL_COURSE_ID=fe5f8544-a6df-4787-8302-5b7eb2406ac7  # REQUIRED
```

**Note:** `DIRECTUS_CARL_COURSE_ID` is now required (not optional) for the nested query approach.

---

## Things to Watch Out For

### 1. Directus Field Permissions
The API token may not have access to all fields. If you get 403 errors:
- Check which field is mentioned in the error
- Either request permissions for that field, or don't request it
- Never use `fields=*` - always specify exact fields needed

### 2. Junction Table Expansion
For M2M relationships, you must go through the junction:
```javascript
// WRONG - looks for 'title' on the junction table
child_pages.title

// CORRECT - goes through junction to actual table
child_pages.content_pages_id.title
```

### 3. CMS Pages Without Narration
Some CMS pages have no narration text (e.g., slides where editors removed it). These show as "NO SIG" in logs and won't match. Ensure narration text stays in CMS even for image-only slides to enable matching.

### 4. Slide Numbering Uses CMS Sort Order
Slide numbers displayed in the sync modal use the CMS `sort` field (+1 for 1-indexing) rather than calculated position. This matches what editors see in Directus. Note: if sort values have gaps or duplicates in CMS, they'll show that way in the sync view.

### 4. Narration Text Source of Truth
CMS is the source of truth. When updating narration:
- Updates `slides_json` in asset_lists
- Updates `generated_audio.narration_text`
- Resets audio status to `pending`
- Clears audio_path (old file)
- TTS will need to be regenerated

### 5. Schema Explorer Script
Run `node scripts/explore-cms-schema.js` to discover field names if schema changes.

### 6. Database Update Key Names
The `*Db.update()` functions in `database.js` expect **camelCase** keys that get mapped to snake_case columns:
```javascript
// Correct - use camelCase keys
assetListDb.update(id, { slides: data });           // maps to slides_json column
generatedAudioDb.update(id, { narrationText: text }); // maps to narration_text column

// Wrong - snake_case keys are silently ignored
assetListDb.update(id, { slides_json: data });      // ignored!
```

---

## Testing Checklist

### Regular Sessions (Completed)
- [x] `npm run build` succeeds
- [x] Server starts without errors
- [x] `/api/cms/status` returns `{ available: true }` when configured
- [x] "Sync with CMS" button appears for regular sessions
- [x] Clicking button opens modal with comparison data
- [x] Matched slides show with green checkmarks
- [x] Narration mismatches show with yellow "Update" buttons
- [x] "Show Diff" expands to show both narration versions
- [x] "Update" button updates narration and resets audio status
- [x] "Update" moves slide from Mismatch to Matched section
- [x] "Update All" button updates all mismatches at once
- [x] CMS-only slides show with "Add" button
- [x] NOLA.vids-only slides show with "Delete" button
- [ ] Add slide creates proper records
- [ ] Delete slide removes all associated assets

### RCP Sessions (Completed)
- [x] Sync button appears for RCP sessions
- [x] Uses "question" narration type for matching (not answers/responses)
- [x] Slides match correctly when Question narration text matches CMS

### Pre-Test / Post-Test (Pending)
- [ ] Sync button appears for assessment sessions (currently hidden)
- [ ] Assessment questions match with CMS pages
- [ ] Update narration works for assessment content

---

## Future Work (Push to CMS)

### Phase 1: Push Assets to CMS
After sync is working reliably, add ability to push generated media back to CMS:

1. **Database columns:**
   - `generated_images.cms_file_id` - Directus file ID after upload
   - `generated_images.cms_push_status` - 'pending' | 'pushed' | 'failed'
   - Same for `generated_audio`

2. **CMS client methods:**
   - `uploadFile(bucket, filePath)` - Upload to Directus
   - `linkFileToPage(pageId, fileId, fieldName)` - Set image/audio field

3. **API endpoints:**
   - `POST /cms/push/:assetListId/image/:imageId`
   - `POST /cms/push/:assetListId/audio/:audioId`
   - `POST /cms/push/:assetListId/all` - Bulk push

4. **UI:**
   - Push buttons on asset cards
   - Push status indicators
   - Bulk push option in session header

### Phase 2: Bi-directional Sync
- Detect when CMS has newer versions of assets
- Pull updated assets from CMS
- Conflict resolution UI

---

## Code Locations Quick Reference

| What | Where |
|------|-------|
| CMS client | `server/services/cmsClient.js` |
| API routes | `server/api/routes.js` (search for `/cms/`) |
| DB queries | `server/db/database.js` |
| Frontend hooks | `client/src/hooks/useApi.js` |
| Sync modal | `client/src/components/ImageGenerator/CmsSyncModal.jsx` |
| Modal styles | `client/src/components/ImageGenerator/CmsSyncModal.css` |
| Button + state | `client/src/components/ImageGenerator/index.jsx` |
| Schema explorer | `scripts/explore-cms-schema.js` |
| Slide renumber script | `scripts/renumber-session-slides.js` |
| Session data checker | `scripts/check-session-data.js` |
| Migration | `supabase/migrations/003_add_cms_sync_tracking.sql` |
