# Assessment CMS Push Implementation Status

**Last Updated:** 2026-03-20
**Status:** Complete - Ready for Testing

## Overview

This document describes the Pre-Test and Post-Test CMS sync and push functionality added to NOLA.vids. This feature allows assessment content (question audio, answer audio, and question images) to be pushed to the Directus CMS at nola.tools.

## Architecture

### CMS Schema (Directus)

Assessment questions in the CMS use a different structure than regular session slides:

```
content_pages (question)
├── narration (uuid) → question audio file
├── image (uuid) → question image file
└── answers (O2M relation to content_answers)
    ├── content_answers[sort=0] → Answer A
    │   └── answer_narration (uuid) → answer A audio
    ├── content_answers[sort=1] → Answer B
    │   └── answer_narration (uuid) → answer B audio
    └── ... etc (up to answer F at sort=5)
```

**Key Differences from Regular Sessions (RCP):**
- Answer audio lives in `content_answers.answer_narration`, NOT on the page
- Pre/Post tests do NOT use `correct_audio`, `incorrect_audio1`, `incorrect_audio2`
- Answers are queried via the `answers` relationship and matched by `sort` order

### NOLA.vids → CMS Field Mapping

#### Audio Mapping

| NOLA.vids `narrationType` | CMS Collection | CMS Field | How to Find |
|---------------------------|----------------|-----------|-------------|
| `question` | `content_pages` | `narration` | Direct page field |
| `answer_a` | `content_answers` | `answer_narration` | `page.answers` where `sort=0` |
| `answer_b` | `content_answers` | `answer_narration` | `page.answers` where `sort=1` |
| `answer_c` | `content_answers` | `answer_narration` | `page.answers` where `sort=2` |
| `answer_d` | `content_answers` | `answer_narration` | `page.answers` where `sort=3` |
| `answer_e` | `content_answers` | `answer_narration` | `page.answers` where `sort=4` |
| `answer_f` | `content_answers` | `answer_narration` | `page.answers` where `sort=5` |
| `correct_response` | — | — | **NOT USED** for assessments |
| `incorrect_1` | — | — | **NOT USED** for assessments |
| `incorrect_2` | — | — | **NOT USED** for assessments |

#### Two-Part Question Mapping

Two-part questions are stored as **separate CMS pages**:
- "Question 9: Part A" (e.g., page with sort=8)
- "Question 9: Part B" (e.g., page with sort=9)

The `cmsPageMapping` stores both:
```json
{
  "9": "uuid-for-q9-part-a",
  "9b": "uuid-for-q9-part-b"
}
```

| NOLA.vids `narrationType` | CMS Page | CMS Field |
|---------------------------|----------|-----------|
| `part_a_question` | Part A page | `narration` |
| `part_a_answer_a` | Part A page | `answers[sort=0].answer_narration` |
| `part_b_question` | Part B page | `narration` |
| `part_b_answer_a` | Part B page | `answers[sort=0].answer_narration` |

#### Image Mapping

| NOLA.vids Asset | CMS Collection | CMS Field |
|-----------------|----------------|-----------|
| Question image (`pre_test_image`, `post_test_image`) | `content_pages` | `image` |

---

## Files Modified

### Database Migration

**File:** `supabase/migrations/005_assessment_cms_tracking.sql`

```sql
ALTER TABLE assessment_assets
  ADD COLUMN IF NOT EXISTS cms_page_mapping JSONB DEFAULT '{}';
```

Maps question number → CMS page ID:
```json
{"1": "uuid-q1", "2": "uuid-q2", "9": "uuid-q9-part-a", "9b": "uuid-q9-part-b"}
```

### Backend Files

| File | Changes |
|------|---------|
| `server/db/database.js` | Added `cmsPageMapping` to `parseAssessmentAssetRow()`, added `updateCmsPageMapping()` method |
| `server/services/cmsClient.js` | Added 5 new methods for assessment CMS operations |
| `server/api/routes.js` | Added 3 new endpoints for assessment sync/push |

### Frontend Files

| File | Changes |
|------|---------|
| `client/src/hooks/useApi.js` | Added 3 API functions for assessment CMS |
| `client/src/components/ImageGenerator/index.jsx` | Added sync button, handlers, modal |
| `client/src/components/ImageGenerator/AssessmentNarrationPanel.jsx` | Updated push button logic |
| `client/src/components/ImageGenerator/AssessmentCmsSyncModal.jsx` | **NEW** - Sync modal component |

---

## CMS Client Methods

### `getAssessmentPages(moduleName, assessmentType)`

Fetches Pre-Test or Post-Test pages from CMS.

**Parameters:**
- `moduleName` - e.g., "Chemistry of Food"
- `assessmentType` - `'pre_test'` or `'post_test'`

**Returns:** Array of page objects:
```javascript
[{
  pageId: 'uuid',
  questionNumber: 1,
  title: 'Question 1',
  narrationText: '...',
  textContent: '...',
  answers: [
    { id: 'uuid', sort: 0, text: 'Answer A text', hasNarration: false },
    { id: 'uuid', sort: 1, text: 'Answer B text', hasNarration: true },
    // ...
  ]
}]
```

### `compareAssessmentQuestions(cmsPages, nolaQuestions)`

Matches NOLA.vids questions to CMS pages by text similarity.

**Returns:**
```javascript
{
  matched: [...],           // Exact matches (100% similarity)
  narrationMismatches: [...], // Partial matches (<100% similarity)
  cmsOnly: [...],           // Pages only in CMS
  nolaOnly: [...]           // Questions only in NOLA.vids
}
```

### `getPageAnswers(pageId)`

Gets answer choices for a content page.

**Returns:**
```javascript
[
  { id: 'uuid', sort: 0, text: 'Answer A', answerNarration: null },
  { id: 'uuid', sort: 1, text: 'Answer B', answerNarration: 'file-uuid' },
  // ...
]
```

### `linkFileToAnswer(answerId, fileId)`

Links an uploaded audio file to `content_answers.answer_narration`.

### `getAnswerSortFromNarrationType(narrationType)`

Helper to convert narration type to answer sort index:
- `'answer_a'` → `0`
- `'answer_b'` → `1`
- `'part_a_answer_c'` → `2`
- etc.

---

## API Endpoints

### `POST /cms/sync/assessment/:assessmentId/fetch`

Fetches CMS pages and compares with NOLA.vids questions.

**Response:**
```json
{
  "matched": [...],
  "narrationMismatches": [...],
  "cmsOnly": [...],
  "nolaOnly": [...],
  "cmsPageMapping": {"1": "uuid", "2": "uuid"},
  "totalCmsPages": 10,
  "totalNolaQuestions": 10
}
```

**Side Effect:** Automatically saves matched page IDs to `assessment_assets.cms_page_mapping`.

### `POST /cms/push/assessment-audio/:audioId`

Pushes assessment audio to CMS.

**Logic:**
1. Determine target page from `cmsPageMapping`
2. For `question`/`part_a_question`/`part_b_question` → link to `content_pages.narration`
3. For `answer_*` types → get page's answers, find by sort, link to `content_answers.answer_narration`
4. For `correct_response`/`incorrect_*` → returns error (not used for assessments)

**Response:**
```json
{
  "success": true,
  "cmsFileId": "directus-file-uuid",
  "pageId": "content-page-uuid",
  "linkedTo": {
    "type": "answer",
    "answerId": "content-answer-uuid",
    "answerSort": 0
  }
}
```

### `POST /cms/push/assessment-image/:imageId`

Pushes assessment question image to CMS.

**Response:**
```json
{
  "success": true,
  "cmsFileId": "directus-file-uuid",
  "pageId": "content-page-uuid",
  "fieldName": "image"
}
```

---

## Frontend Components

### AssessmentCmsSyncModal

Displays sync results between NOLA.vids and CMS:
- **Matched Questions** - Exact matches with green checkmark
- **Partial Matches** - Questions that matched but with text differences (expandable diff view)
- **CMS-Only** - Questions in CMS but not in NOLA.vids
- **NOLA.vids-Only** - Questions in NOLA.vids but not in CMS

Page mappings are automatically saved when the sync is performed.

### AssessmentNarrationPanel Updates

- Push to CMS button now:
  - Only shows for supported narration types (hides for `correct_response`, `incorrect_1`, `incorrect_2`)
  - Disabled when no CMS page mapping exists (shows "Run CMS Sync first" tooltip)
  - Disabled when audio is not ready (not `completed` or `uploaded`)
  - Shows "Pushed" badge when already pushed

### index.jsx Updates

- Added "Sync with CMS" button in assessment header (visible when CMS is available)
- Added Push button for question images
- Wired up `handleOpenAssessmentSyncModal` and `handleAssessmentPushToCms` handlers

---

## Testing Checklist

### Database Migration
- [ ] Run migration in Supabase dashboard or CLI
- [ ] Verify `cms_page_mapping` column exists on `assessment_assets`

### CMS Sync
- [ ] Open a Pre-Test in NOLA.vids
- [ ] Click "Sync with CMS"
- [ ] Verify questions match CMS pages correctly
- [ ] Check that `cmsPageMapping` is saved (visible in sync modal results)

### Push Question Audio
- [ ] Generate question narration audio
- [ ] Click "Push" button
- [ ] Verify audio appears in CMS at `content_pages.narration`

### Push Answer Audio
- [ ] Generate answer_a audio
- [ ] Click "Push" button
- [ ] Verify audio appears in CMS at `content_answers.answer_narration` for sort=0

### Push Question Image
- [ ] Upload or generate question image
- [ ] Click "Push" button
- [ ] Verify image appears in CMS at `content_pages.image`

### Two-Part Questions
- [ ] Find a two-part question in assessment
- [ ] Sync with CMS - verify both Part A and Part B pages are mapped
- [ ] Generate part_a_question and part_b_question audio
- [ ] Push both - verify they go to correct Part A and Part B pages

### Error Cases
- [ ] Try pushing without running sync first - should show helpful error
- [ ] Try pushing feedback types (correct_response, etc.) - button should be hidden
- [ ] Try pushing audio that's not ready - button should be disabled

### Build Verification
- [ ] `npm run build` succeeds without errors

---

## Known Limitations

1. **No auto-create for CMS-only questions** - Unlike regular sessions, assessment CMS sync does not create new questions in NOLA.vids. Questions must exist in both systems to be matched.

2. **Two-part question detection** - Currently relies on Carl v7 import to properly set up two-part questions. Manual addition of Part B pages not fully supported.

3. **Feedback audio not supported** - `correct_response`, `incorrect_1`, `incorrect_2` are intentionally excluded as Pre/Post Tests don't use these fields in the CMS.

4. **Text matching threshold** - Questions are matched at 75% text similarity. Very different question text may not match automatically.

---

## Future Improvements

1. **Manual page mapping** - Allow users to manually map unmatched questions to CMS pages

2. **Bulk push** - Add "Push All" button to push all ready assets at once

3. **Push status indicators** - Show aggregate push status (e.g., "5/10 pushed") in assessment header

4. **Two-part question auto-detection** - Detect Part A/B pages in CMS and create proper mappings automatically

---

## Related Documentation

- `CLAUDE.md` - Main project documentation
- `supabase/schema.sql` - Full database schema
- `supabase/migrations/` - All database migrations
