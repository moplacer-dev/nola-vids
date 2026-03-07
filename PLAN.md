# NOLA.vids - Carl Gen Enhancement Plan

**Feature:** Carl Gen Tab Improvements
**Status:** ✅ Complete
**Created:** March 7, 2026
**Last Updated:** March 7, 2026 (Phase 8: Video Module Association)

---

## Overview

The Carl Gen tab provides a complete asset management workflow for slide-based media. Users can:
- **Generate** AI images using Gemini 3.1 Flash with character consistency
- **Upload** their own image files directly
- **Import** existing media from the NOLA.vids Library

All assets are automatically renamed to CMS filename conventions for bulk import.

---

## Current Capabilities

- Carl Gen displays slides with asset requirements imported from Carl v7
- Multi-asset support (multiple images per slide with asset numbers)
- Full prompt editing with context (pedagogical rationale, production notes, media team notes)
- Asset type selector for changing image/diagram/video types
- Character anchor support with per-asset toggle (choose whether to include character)
- **Three ways to fulfill assets:**
  1. **Generate** - AI generation with 3:2 aspect ratio (matches CMS)
  2. **Upload** - Direct file upload (PNG, JPG, WebP)
  3. **Import** - Select from existing Library items
- Generated/uploaded/imported images saved with CMS filename pattern
- Preview panel for viewing and downloading assets
- Generation queue with status tracking

---

## Completed Phases

### Phase 1: UI Cleanup ✅

| Task | Status |
|------|--------|
| Hide "Generate All" button | ✅ Done |
| Full prompt editing with context | ✅ Done |
| Asset type selector in prompt editor | ✅ Done |
| Added media types: motion_graphics_scene, interactive_element | ✅ Done |

### Multi-Asset Support ✅

| Task | Status |
|------|--------|
| Database: Added `asset_number` column | ✅ Done |
| Server: Key matching with slideNumber-assetType-assetNumber | ✅ Done |
| Client: Key lookup includes assetNumber | ✅ Done |
| UI: Asset number badges (#1, #2, etc.) | ✅ Done |
| Bug fix: snake_case/camelCase field handling | ✅ Done |

### Phase 2: Upload Support ✅

| Task | Status |
|------|--------|
| Upload button per asset | ✅ Done |
| Direct file upload (PNG, JPG, WebP) | ✅ Done |
| CMS filename convention | ✅ Done |
| Status: "uploaded" | ✅ Done |
| Preview uploaded images | ✅ Done |
| Default 3:2 aspect ratio for generation | ✅ Done |

### Phase 3: Import from Library ✅

| Task | Status |
|------|--------|
| Import button per asset | ✅ Done |
| Library picker modal | ✅ Done |
| Filter by media type (images/videos) | ✅ Done |
| Search functionality | ✅ Done |
| Copy with CMS filename | ✅ Done |
| Status: "imported" | ✅ Done |
| Source tracking in generation history | ✅ Done |

### Phase 4: Character Toggle ✅

| Task | Status |
|------|--------|
| "Character" checkbox for assets with character | ✅ Done |
| Default ON for career/character/intro types | ✅ Done |
| Default OFF for motion_graphics and others | ✅ Done |
| User can toggle before generating | ✅ Done |

### Phase 5: Default Slide Images ✅

| Task | Status |
|------|--------|
| `storage/defaults/` folder for default images | ✅ Done |
| Auto-detect "Clean Up" and "Lab Safety" slides | ✅ Done |
| Copy default image with CMS filename on import | ✅ Done |
| Status: "default" (gold border in queue) | ✅ Done |
| Apply to both new and existing pending records | ✅ Done |
| Users can still override with upload/import/generate | ✅ Done |

**Default Images Location:**
```
server/storage/defaults/cleanup.png      → "Clean Up" slides
server/storage/defaults/lab_safety.png   → "Lab Safety" slides
```

### Phase 6: Library Module Filtering ✅

| Task | Status |
|------|--------|
| Module filter dropdown in Library header | ✅ Done |
| Filter images by module name | ✅ Done |
| "All Modules" option (default) | ✅ Done |
| Dynamic counts showing filtered/total | ✅ Done |
| Video filtering ready (when module data added) | ✅ Done |
| Folder sidebar always visible | ✅ Done |

### Phase 7: Media Viewer ✅

| Task | Status |
|------|--------|
| Full-screen viewer for videos and images | ✅ Done |
| Keyboard navigation (arrows, escape) | ✅ Done |
| Video playback with native audio | ✅ Done |
| Quick actions (download, delete, re-use prompt) | ✅ Done |
| Metadata display (prompt, date, filename) | ✅ Done |

### Phase 8: Video Module Association ✅

| Task | Status |
|------|--------|
| Database: Added `module_name` column to videos table | ✅ Done |
| Server: Videos API returns `moduleName` field | ✅ Done |
| Server: Import endpoint tags videos with module | ✅ Done |
| Migration: Auto-adds column on server start | ✅ Done |
| Retroactive tagging of existing imported videos | ✅ Done |
| Library: Module filtering works for videos | ✅ Done |

**How it works:**
- When you import a video from Library into Carl Gen to fulfill an asset, the video is automatically tagged with that module
- Videos tagged with a module appear in the Library when filtering by that module
- Existing imported videos were retroactively tagged based on generation history

---

## Key Files

### Client Components
| File | Purpose |
|------|---------|
| `ImageGenerator/index.jsx` | Main Carl Gen component, state management, handlers |
| `ImageGenerator/AssetList.jsx` | Renders slides and asset items with action buttons |
| `ImageGenerator/PromptEditor.jsx` | Modal for editing prompts with context |
| `ImageGenerator/ImagePreview.jsx` | Preview panel for selected images |
| `ImageGenerator/LibraryPicker.jsx` | Modal for selecting items from Library |
| `ImageGenerator/CharacterPanel.jsx` | Character anchor management |
| `ImageGenerator/ImageGenerator.css` | All styles for Carl Gen |
| `ImageGenForm/index.jsx` | Standalone image generation form |
| `Library.jsx` | Combined media library with module filtering |
| `ImageCard.jsx` | Image card component for library grid |
| `MediaViewer.jsx` | Full-screen media viewer with navigation |
| `hooks/useApi.js` | API functions including upload/import |

### Server
| File | Purpose |
|------|---------|
| `api/routes.js` | All endpoints (generate, upload, import, asset-lists) |
| `db/database.js` | Database schema and queries |
| `services/imageGen.js` | Gemini 3.1 Flash image generation |

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/asset-lists` | POST | Import asset list from Carl |
| `/api/asset-lists` | GET | List all asset lists |
| `/api/asset-lists/:id` | GET | Get asset list with generated images |
| `/api/images/generate` | POST | Generate image for asset |
| `/api/images/:id/upload` | POST | Upload image file for asset |
| `/api/images/:id/import` | POST | Import from Library for asset |
| `/api/images/:id` | PATCH | Update prompt or asset type |
| `/api/images/:id/regenerate` | PUT | Regenerate image |

---

## CMS Filename Convention

All media uses standardized naming for CMS bulk import:

```
MOD.{MODULE}.{SESSION}.{SLIDE}.{TYPE}{NUM}.{ext}

Examples:
- MOD.REAC.1.5.IMG1.png   (Reactions, Session 1, Slide 5, Image 1)
- MOD.REAC.1.5.IMG2.png   (Reactions, Session 1, Slide 5, Image 2)
- MOD.MATT.2.12.DIA1.png  (Matter, Session 2, Slide 12, Diagram)
- MOD.ENER.3.8.VID1.mp4   (Energy, Session 3, Slide 8, Video)
```

---

## Asset Statuses

| Status | Meaning | Color |
|--------|---------|-------|
| `pending` | No image yet | Gray |
| `generating` | AI generation in progress | Yellow |
| `completed` | AI generation finished | Green |
| `uploaded` | User uploaded file | Blue |
| `imported` | Imported from Library | Purple |
| `default` | Auto-applied default image | Gold |
| `failed` | Generation error | Red |

---

## Future Enhancements

Potential improvements for future iterations:

1. **Batch Operations**
   - Generate all pending assets at once
   - Bulk download as ZIP

2. **Export to CMS**
   - Direct integration with CMS API
   - Automated upload with metadata

3. **Version History**
   - View all previous generations for an asset
   - Restore previous versions

4. **Video Generation for Carl Gen**
   - Use Veo for motion_graphics assets
   - Frame interpolation for animations

5. **Collaboration**
   - Comments on assets
   - Approval workflow

---

## Testing Checklist

### Carl Gen
- [x] Multi-asset slides create records for all assets
- [x] Multi-asset slides show all assets with correct numbers
- [x] All assets are clickable and can be generated
- [x] Generate image - verify CMS filename pattern
- [x] Edit full prompt with context inclusion
- [x] Change asset type - verify CMS filename updates
- [x] Upload image - verify file renamed to CMS pattern
- [x] Import from Library - verify file copied with CMS filename
- [x] Preview works for generated/uploaded/imported images
- [x] Default images applied to Clean Up / Lab Safety slides

### Library
- [x] Combined view shows videos and images
- [x] Module filter dropdown appears when modules exist
- [x] Module filtering works for images
- [x] Module filtering works for videos (imported via Carl Gen)
- [x] Counts update when module filter applied
- [x] Folder sidebar stays visible in all views
- [x] MediaViewer opens on click
- [x] Keyboard navigation in MediaViewer

### Video Module Association
- [x] Importing video into Carl Gen tags it with module
- [x] Tagged videos appear in Library module filter
- [x] Videos show correct count in filter (e.g., "2/4")
