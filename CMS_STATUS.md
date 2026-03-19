# CMS Integration Status

## Overview

NOLA.vids integrates with Directus CMS (nola.tools) for two-way synchronization:

1. **CMS Sync** (Pull) - Imports slide structure and narration from CMS to NOLA.vids
2. **Push to CMS** (Push) - Uploads generated assets back to CMS pages

---

## Environment Variables

```env
DIRECTUS_API_URL=https://your-directus-instance.com
DIRECTUS_API_TOKEN=your-api-token
DIRECTUS_CARL_COURSE_ID=uuid-of-carl-course
```

---

## Feature: CMS Sync (Pull)

**Status:** Complete

Fetches slides from CMS and matches them to NOLA.vids slides by narration text similarity.

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cms/status` | Check if CMS is configured |
| POST | `/api/cms/sync/:assetListId/fetch` | Fetch comparison data |
| POST | `/api/cms/sync/:assetListId/add-slide` | Add CMS slide to NOLA.vids |
| POST | `/api/cms/sync/:assetListId/delete-slide` | Remove slide from NOLA.vids |
| POST | `/api/cms/sync/:assetListId/update-narration` | Update narration from CMS |

### How It Works

1. User clicks "Sync with CMS" button in Carl Gen tab
2. System fetches pages from CMS for the matching module/session
3. Compares NOLA.vids slides with CMS pages using narration text similarity (75% threshold)
4. Shows matched, mismatched, CMS-only, and NOLA-only slides
5. User can add/delete slides or update narration text
6. CMS page IDs are stored in `asset_lists.cms_page_mapping` JSON column

---

## Feature: Push to CMS

**Status:** Complete (March 2026)

Uploads generated assets (images, audio, MG videos) to Directus CMS and links them to content pages.

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cms/schema` | Get available media fields on content_pages |
| POST | `/api/cms/push/image/:imageId` | Push image to CMS |
| POST | `/api/cms/push/audio/:audioId` | Push audio to CMS |
| POST | `/api/cms/push/mg-video/:videoId` | Push MG video to CMS |

### How It Works

1. Asset must be in `completed`, `uploaded`, `imported`, or `default` status
2. Slide must have CMS page mapping (from CMS Sync)
3. System downloads file from Supabase Storage
4. Uploads file to Directus `/files` endpoint
5. Links file to content page using PATCH `/items/content_pages/:pageId`
6. Updates local record with `cms_file_id`, `cms_push_status = 'pushed'`, `cms_pushed_at`

### Field Mapping

| NOLA.vids Asset Type | CMS Field |
|---------------------|-----------|
| image | `image` |
| audio | `narration` |
| mg-video | `video` |

### Push Status Values

| Status | Description |
|--------|-------------|
| `pending` | Not yet pushed (default) |
| `pushing` | Currently being pushed |
| `pushed` | Successfully pushed to CMS |
| `failed` | Push failed (can retry) |

### UI Behavior

- Push buttons only appear when:
  - CMS is available (configured)
  - Slide has CMS page mapping (from CMS Sync)
  - Asset is ready (completed/uploaded/imported/default)
- Button shows "Push CMS" (purple) when not pushed
- Button shows "✓ CMS" (green) after successful push
- Re-clicking will overwrite the file in CMS

---

## Database Schema

### CMS Push Tracking Columns

Added to `generated_images`, `generated_audio`, and `motion_graphics_videos`:

```sql
cms_file_id UUID           -- Directus file ID after upload
cms_push_status TEXT       -- 'pending', 'pushing', 'pushed', 'failed'
cms_pushed_at TIMESTAMPTZ  -- Timestamp of successful push
```

### Migration

File: `supabase/migrations/004_add_cms_push_tracking.sql`

```sql
-- Add to generated_images
ALTER TABLE generated_images ADD COLUMN IF NOT EXISTS cms_file_id UUID;
ALTER TABLE generated_images ADD COLUMN IF NOT EXISTS cms_push_status TEXT DEFAULT 'pending';
ALTER TABLE generated_images ADD COLUMN IF NOT EXISTS cms_pushed_at TIMESTAMPTZ;

-- Add to generated_audio
ALTER TABLE generated_audio ADD COLUMN IF NOT EXISTS cms_file_id UUID;
ALTER TABLE generated_audio ADD COLUMN IF NOT EXISTS cms_push_status TEXT DEFAULT 'pending';
ALTER TABLE generated_audio ADD COLUMN IF NOT EXISTS cms_pushed_at TIMESTAMPTZ;

-- Add to motion_graphics_videos
ALTER TABLE motion_graphics_videos ADD COLUMN IF NOT EXISTS cms_file_id UUID;
ALTER TABLE motion_graphics_videos ADD COLUMN IF NOT EXISTS cms_push_status TEXT DEFAULT 'pending';
ALTER TABLE motion_graphics_videos ADD COLUMN IF NOT EXISTS cms_pushed_at TIMESTAMPTZ;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_generated_images_cms_push_status ON generated_images(cms_push_status);
CREATE INDEX IF NOT EXISTS idx_generated_audio_cms_push_status ON generated_audio(cms_push_status);
CREATE INDEX IF NOT EXISTS idx_motion_graphics_videos_cms_push_status ON motion_graphics_videos(cms_push_status);
```

---

## Files Modified

### Backend

| File | Changes |
|------|---------|
| `server/services/cmsClient.js` | Added `getContentPageFields()`, `uploadFile()`, `linkFileToPage()`, `getCmsFieldForAsset()` |
| `server/api/routes.js` | Added `/cms/schema`, `/cms/push/image/:id`, `/cms/push/audio/:id`, `/cms/push/mg-video/:id` |
| `server/db/database.js` | Added CMS fields to `parseGeneratedImageRow()`, `parseGeneratedAudioRow()`, `parseMGVideoRow()`, and their `update()` methods |

### Frontend

| File | Changes |
|------|---------|
| `client/src/hooks/useApi.js` | Added `getCmsSchema()`, `pushImageToCms()`, `pushAudioToCms()`, `pushMgVideoToCms()` |
| `client/src/App.jsx` | Pass push hooks to ImageGenerator |
| `client/src/components/ImageGenerator/index.jsx` | Added `handlePushToCms()` handler, pass props to AssetList |
| `client/src/components/ImageGenerator/AssetList.jsx` | Added push buttons for images, audio, MG videos |
| `client/src/components/ImageGenerator/AssessmentNarrationPanel.jsx` | Added push buttons for multi-part audio |
| `client/src/components/ImageGenerator/ImageGenerator.css` | Added `.btn-push-cms` styles |

### Database

| File | Description |
|------|-------------|
| `supabase/migrations/004_add_cms_push_tracking.sql` | New migration for tracking columns |

---

## CMS Client Methods

### `getContentPageFields()`
Queries Directus `/fields/content_pages` to discover available media fields.

### `uploadFile(fileBuffer, filename, mimeType, folder)`
Uploads a file to Directus using multipart form data.

**Returns:** `{ id, filename_disk, ... }` - The created file object

### `linkFileToPage(pageId, fieldName, fileId)`
Links an uploaded file to a content page by PATCHing the page.

### `getCmsFieldForAsset(assetType, narrationType)`
Maps NOLA.vids asset types to CMS field names.

---

## Error Handling

| Error | Behavior |
|-------|----------|
| CMS not configured | Returns 503, button not shown |
| Asset not ready | Returns 400, button not shown |
| No CMS page mapping | Returns 400 with message "Run CMS Sync first" |
| Upload failure | Sets `cms_push_status = 'failed'`, allows retry |
| Link failure | Sets `cms_push_status = 'failed'`, allows retry |

---

## Testing Checklist

- [ ] `GET /api/cms/schema` returns content_pages media fields
- [ ] Push button appears only for completed assets with CMS page mapping
- [ ] Image push uploads to Directus and links to correct page
- [ ] Audio push uploads and links to narration field
- [ ] MG video push uploads and links to video field
- [ ] Push status persists (shows "✓ CMS" after successful push)
- [ ] Error handling works for missing page mapping
- [ ] Re-push overwrites existing file in CMS

---

## Future Improvements

1. **Bulk Push** - Push all assets for a session at once
2. **Push Status Dashboard** - Overview of push status across sessions
3. **Schema Discovery UI** - Let users see/configure field mappings
4. **Webhook Integration** - Auto-push when assets complete
5. **Conflict Detection** - Warn if CMS file was modified since last push

---

## Troubleshooting

### Push button not appearing
1. Check CMS is configured (DIRECTUS_API_URL and DIRECTUS_API_TOKEN set)
2. Check asset is completed/uploaded (not pending or generating)
3. Check slide has CMS page mapping (run CMS Sync first)

### Push fails with 503
CMS client not configured. Add environment variables.

### Push fails with 400 "No CMS page mapping"
Run CMS Sync first to establish the mapping between NOLA.vids slides and CMS pages.

### Push fails with upload error
Check Directus API token has permission to upload files and modify content_pages.
