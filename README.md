# NOLA.vids

Internal media team video and image generation app powered by Google's Veo 3.1 and Imagen APIs.

## Features

### Video Generation

| Mode | Description |
|------|-------------|
| **Text to Video** | Generate 4-8 second videos from text prompts with native audio |
| **Image to Video** | Animate static images into video |
| **Frame Interpolation** | Generate smooth video between start and end frames |
| **Reference Guided** | Use up to 3 reference images for subject consistency |
| **Video Extension** | Extend Veo-generated videos by ~7 seconds |

### Image Generation

| Mode | Description |
|------|-------------|
| **Image Gen** | Standalone image generation with optional reference image |
| **Carl Gen** | Batch image generation from Carl v7 asset lists |

### Carl Gen Features

Carl Gen integrates with Carl v7 to manage and generate images for Star Academy educational content:

- **Asset List Import** - Receive asset lists pushed from Carl v7
- **Slide-based Organization** - Assets grouped by slide number with titles
- **Multi-Asset Support** - Multiple assets per slide with automatic numbering
- **Career Characters** - Anchor image support for consistent character generation
- **Character Toggle** - Control whether to include character in each generation
- **Three Fulfillment Methods:**
  - **Generate** - AI generation with 3:2 aspect ratio
  - **Upload** - Direct file upload (PNG, JPG, WebP)
  - **Import** - Select from existing Library items
- **Default Images** - Auto-apply standard images for "Clean Up" and "Lab Safety" slides
- **Prompt Editing** - Full prompt editing with pedagogical context
- **Asset Type Selector** - Change image/diagram/video types with auto-updated filenames
- **Status Tracking** - Real-time generation status (pending, generating, completed, failed, uploaded, imported, default)
- **CMS Naming** - Automatic filename convention for bulk CMS import

### Media Library

The unified Media Library provides a complete view of all generated content:

- **Combined View** - Videos and images displayed together or filtered separately
- **Module Filtering** - Filter content by module (Reactions, Energy, Matter, etc.)
  - Images get module association from their asset list
  - Videos get module association when imported into Carl Gen
- **Folder Organization** - Organize videos into custom folders
- **Search** - Search by title or prompt
- **Sort Options** - Newest or oldest first
- **Full-Screen Viewer** - Click any item to view in full-screen with keyboard navigation
- **Quick Actions** - Download, delete, re-use prompts, extend videos

### Media Viewer

Full-screen viewer for videos and images:

- **Keyboard Navigation** - Arrow keys to navigate, Escape to close
- **Video Playback** - Full controls with native audio
- **Quick Actions** - Download, delete, re-use prompt
- **Metadata Display** - View prompts, dates, and file information

### Additional Features

- **Persistent Storage** - Videos, images, and job history survive server restarts (SQLite)
- **Star Academy Templates** - Pre-built templates for STEM educational content
- **Negative Prompt Presets** - Quick filters for quality, style, and content control
- **Job Queue** - Track generation progress with real-time status updates
- **Native Audio** - Veo 3.1 generates synchronized audio (dialogue, SFX, ambient sounds)
- **Re-use Prompts** - Quickly re-use prompts from previous generations
- **Veo 3.1 Tips** - Collapsible prompting guidance built into the UI

## Setup

### 1. Get API Keys

You'll need:
- **Google AI API key** with access to Veo 3.1 and Imagen - Get one from [Google AI Studio](https://aistudio.google.com/)

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your API key and access key:

```
GOOGLE_GENAI_API_KEY=your_api_key_here
PORT=3001
ACCESS_KEY=your_access_key_here
```

### 3. Install Dependencies

```bash
npm run install:all
```

### 4. Run the App

```bash
npm run dev
```

Open http://localhost:5173 in your browser and enter the access key to log in.

## Project Structure

```
nola.vids/
├── server/
│   ├── index.js              # Express server entry point
│   ├── api/
│   │   └── routes.js         # API endpoints & prompt templates
│   ├── db/
│   │   └── database.js       # SQLite database initialization & queries
│   ├── services/
│   │   ├── veo.js            # Veo 3.1 API integration
│   │   └── imageGen.js       # Imagen API integration
│   ├── jobs/
│   │   └── jobManager.js     # Async job queue & polling
│   └── storage/
│       ├── nola.db           # SQLite database (auto-created)
│       ├── uploads/          # Temporary upload directory
│       ├── images/           # Generated images
│       ├── anchors/          # Character anchor images
│       ├── defaults/         # Default slide images (cleanup.png, lab_safety.png)
│       └── *.mp4             # Generated videos
├── client/
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx           # Main application with tab routing
│       ├── App.css           # Global styles
│       ├── index.css         # CSS variables & theme
│       ├── components/
│       │   ├── GenerationForm.jsx/css   # Video generation UI
│       │   ├── JobList.jsx/css          # Job queue display
│       │   ├── VideoPlayer.jsx/css      # Video preview & download
│       │   ├── Library.jsx/css          # Media library (videos + images)
│       │   ├── VideoCard.jsx/css        # Video card component
│       │   ├── ImageCard.jsx/css        # Image card component
│       │   ├── MediaViewer.jsx/css      # Full-screen media viewer
│       │   ├── FolderSidebar.jsx/css    # Folder navigation
│       │   ├── Login.jsx/css            # Access key login screen
│       │   ├── Tips.jsx/css             # Veo 3.1 prompting tips
│       │   ├── ImageGenForm/            # Standalone image generation
│       │   │   ├── index.jsx            # Image gen form component
│       │   │   └── ImageGenForm.css     # Styles
│       │   └── ImageGenerator/          # Carl Gen components
│       │       ├── index.jsx            # Main Carl Gen page
│       │       ├── AssetList.jsx        # Slide/asset list display
│       │       ├── CharacterPanel.jsx   # Career character management
│       │       ├── PromptEditor.jsx     # Prompt editing modal
│       │       ├── ImagePreview.jsx     # Generated image preview
│       │       ├── LibraryPicker.jsx    # Import from Library modal
│       │       └── ImageGenerator.css   # Carl Gen styles
│       └── hooks/
│           └── useApi.js     # API client hooks
├── PLAN.md                   # Carl Gen feature documentation
├── .env                      # API key & access key (not committed)
├── .env.example              # Environment template
└── package.json
```

## API Endpoints

### Video Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/generate/text` | Text-to-video generation |
| POST | `/api/generate/image` | Image-to-video (multipart form) |
| POST | `/api/generate/frames` | Frame interpolation (multipart form) |
| POST | `/api/generate/reference` | Reference-guided generation (multipart form) |
| POST | `/api/generate/extend` | Video extension (JSON: videoPath, prompt) |

### Image Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/images/generate-standalone` | Generate standalone image (multipart form) |
| POST | `/api/images/generate` | Generate image from asset list |
| GET | `/api/images` | List generated images (supports `?moduleName=`, `?status=`) |
| GET | `/api/images/:id` | Get single image with history |
| PATCH | `/api/images/:id` | Update image prompt or asset type |
| PUT | `/api/images/:id/regenerate` | Regenerate an image |
| POST | `/api/images/:id/upload` | Upload file to fulfill asset |
| POST | `/api/images/:id/import` | Import from Library to fulfill asset |

### Asset Lists (Carl Gen)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/asset-lists` | Receive asset list from Carl v7 |
| GET | `/api/asset-lists` | List all asset lists (supports `?moduleName=`) |
| GET | `/api/asset-lists/:id` | Get asset list with generated images |
| DELETE | `/api/asset-lists/:id` | Delete an asset list |

### Characters

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/characters/:moduleName` | Get characters for a module |
| POST | `/api/characters` | Create or update character |
| PUT | `/api/characters/:id/anchor` | Set character anchor image |

### Jobs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs` | List all jobs |
| GET | `/api/jobs/:id` | Get job status |
| DELETE | `/api/jobs/:id` | Delete job and video files |

### Library

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/library` | List all videos with `moduleName` (supports `?folder=`, `?search=`) |
| GET | `/api/library/folders` | List all folders with video counts |
| POST | `/api/library/folders` | Create a new folder |
| DELETE | `/api/library/folders/:id` | Delete a folder |
| PATCH | `/api/videos/:id` | Update video title, folder, or moduleName |
| DELETE | `/api/videos/:id` | Delete a single video |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/templates` | Get prompt templates |
| POST | `/auth/verify` | Verify access key |

## Carl v7 Integration

### Sending Asset Lists to NOLA.vids

Carl v7 can push asset lists to NOLA.vids via POST to `/api/asset-lists`:

```json
{
  "moduleName": "Reactions",
  "sessionNumber": 1,
  "sessionTitle": "Session 1",
  "slides": [
    {
      "slideNumber": 1,
      "slideTitle": "Introduction",
      "slideType": "content"
    }
  ],
  "assets": [
    {
      "slideNumber": 1,
      "assetNumber": 1,
      "type": "ai_generated_image",
      "prompt": "A scientist in a lab coat explaining chemical reactions",
      "priority": "required",
      "productionNotes": "Notes for the production team",
      "mediaTeamNotes": "Guidance for media creators",
      "pedagogicalRationale": "Why this asset supports learning"
    }
  ],
  "careerCharacter": {
    "name": "Dr. Malik Carter",
    "career": "Food Scientist",
    "appearance": "African American male, 30s, friendly expression",
    "appearsOn": [1, 3, 5]
  }
}
```

### Asset Fields

| Field | Description |
|-------|-------------|
| `slideNumber` | Slide number the asset belongs to |
| `assetNumber` | Asset number within the slide (1, 2, 3...) |
| `type` | Asset type (ai_generated_image, real_world_photo, labeled_diagram, etc.) |
| `prompt` | Image generation prompt / description |
| `priority` | "required" or "optional" |
| `productionNotes` | General production guidance |
| `mediaTeamNotes` | Specific notes for the media team |
| `pedagogicalRationale` | Why this asset supports learning (displayed as "Why:") |

### CMS Filename Convention

Generated images follow the naming pattern:
```
MOD.{MODULE}.{SESSION}.{SLIDE}.{TYPE}{NUM}.png
```

Examples:
- `MOD.REAC.1.5.IMG1.png` - Reactions, Session 1, Slide 5, Image 1
- `MOD.REAC.1.5.IMG2.png` - Reactions, Session 1, Slide 5, Image 2
- `MOD.MATT.2.12.DIA1.png` - Matter, Session 2, Slide 12, Diagram 1

### Asset Statuses

| Status | Meaning | UI Color |
|--------|---------|----------|
| `pending` | No image yet | Gray |
| `generating` | AI generation in progress | Yellow |
| `completed` | AI generation finished | Green |
| `uploaded` | User uploaded file | Blue |
| `imported` | Imported from Library | Purple |
| `default` | Auto-applied default image | Gold |
| `failed` | Generation error | Red |

### Default Slide Images

Certain slide types automatically receive default images:

| Slide Title Contains | Default Image |
|---------------------|---------------|
| "Clean Up" | `server/storage/defaults/cleanup.png` |
| "Lab Safety" | `server/storage/defaults/lab_safety.png` |

Users can override defaults by uploading, importing, or generating a new image.

## Authentication

The app requires an access key to use. Set the `ACCESS_KEY` environment variable and users will be prompted to enter it on first visit. The key is stored in session storage (cleared when the browser tab closes).

## Data Persistence

NOLA.vids uses SQLite for persistent storage:

- **Jobs** - Generation history persists across server restarts
- **Videos** - Video metadata (title, folder, module) is stored in the database
- **Folders** - Custom folders for organizing videos
- **Asset Lists** - Imported asset lists from Carl v7
- **Generated Images** - Image metadata and generation history
- **Characters** - Career characters with anchor images
- **Auto-import** - Existing video files are automatically imported on startup
- **Module Tagging** - Videos imported into Carl Gen are tagged with the module

The database is stored at `server/storage/nola.db`.

## Prompt Tips

### Audio Cues (Video)
Veo 3.1 generates synchronized audio. Include audio cues in your prompts:

- **Dialogue**: Use quotes - `"Hello there!" she says`
- **Sound effects**: Describe sounds - `thunder rumbling in the distance`
- **Ambient audio**: Set the scene - `quiet forest with birds chirping`

### Negative Prompts
Describe what to avoid without negation words:

```
# Good
blurry, low quality, cartoon, distorted

# Avoid
no blur, not cartoon, don't make it low quality
```

### Best Practices

1. **Be specific** - Include subject, action, style, and camera details
2. **Set the mood** - Mention lighting, color palette, atmosphere
3. **Consider duration** - 8 seconds is the max; plan your scene accordingly
4. **Avoid real people** - The API filters content with celebrity references

## Veo 3.1 Specifications

| Spec | Value |
|------|-------|
| Max Duration | 8 seconds |
| Frame Rate | 24 fps |
| Resolution | 720p (default), 1080p (8s only) |
| Aspect Ratios | 16:9 (landscape), 9:16 (portrait) |
| Processing Time | 11 seconds to 6 minutes |
| Video Retention | 2 days on Google servers |
| Output | MP4 with native audio |

## Imagen Specifications

| Spec | Value |
|------|-------|
| Model | Gemini 3.1 Flash |
| Aspect Ratio | 3:2 (default for CMS compatibility) |
| Output | PNG |
| Reference Images | Optional anchor image for character consistency |

## Content Filtering

Veo 3.1 and Imagen include safety filters that may reject:
- Real people's names or likenesses
- Violent or inappropriate content
- Copyrighted characters

If a generation fails due to filtering, the error message will be displayed in the job queue.

## Development

### Tech Stack

- **Backend**: Node.js, Express, better-sqlite3
- **Frontend**: React 18, Vite
- **Database**: SQLite
- **API Client**: @google/genai SDK v1.31.0+
- **Styling**: CSS custom properties with cinematic noir theme

### Running in Development

The `npm run dev` command runs both server and client concurrently:
- Server: http://localhost:3001
- Client: http://localhost:5173 (proxies API requests to server)

### Production Build

```bash
npm run build   # Builds the React client
npm start       # Runs the Express server (serves client from dist/)
```

### Notes

- Database and videos persist in `server/storage/`
- Processing jobs resume automatically on server restart
- Videos are auto-downloaded since Google only retains them for 2 days

### SDK Notes (@google/genai v1.31.0+)

The Veo integration uses a hybrid approach:

- **Video generation**: Uses the SDK's `client.models.generateVideos()` method
- **Operation polling**: Uses the REST API directly for polling operation status, as the SDK's `getVideosOperation()` method requires the full operation object which can't be easily serialized/persisted

Key parameter requirements for v1.31.0+:
- `durationSeconds` must be a number (not a string)
- `resolution` is supported: `"720p"` (default) or `"1080p"` (8s duration only)
- Frame interpolation: `lastFrame` goes inside the `config` object
- Reference images: Each item needs an `image` wrapper with `referenceType: "asset"`

### Known Limitations

- **Video Extension**: Currently requires the original Veo-generated video URI. Extending arbitrary uploaded videos may not work as expected since the API expects a URI from a previous Veo generation.
