# NOLA.vids

Internal media team video generation app powered by Google's Veo 3.1 API.

## Features

| Mode | Description |
|------|-------------|
| **Text to Video** | Generate 4-8 second videos from text prompts with native audio |
| **Image to Video** | Animate static images into video |
| **Frame Interpolation** | Generate smooth video between start and end frames |
| **Reference Guided** | Use up to 3 reference images for subject consistency |
| **Video Extension** | Extend Veo-generated videos by ~7 seconds |

### Additional Features

- **Video Library** - Browse, search, and organize all generated videos
- **Folders** - Organize videos into custom folders
- **Persistent Storage** - Videos and job history survive server restarts (SQLite)
- **Star Academy Templates** - Pre-built templates for STEM educational content
- **Negative Prompt Presets** - Quick filters for quality, style, and content control
- **Job Queue** - Track generation progress with real-time status updates
- **Native Audio** - Veo 3.1 generates synchronized audio (dialogue, SFX, ambient sounds)
- **Re-use Prompts** - Quickly re-use prompts from previous generations
- **Veo 3.1 Tips** - Collapsible prompting guidance built into the UI

## Setup

### 1. Get a Veo API Key

You'll need a Google AI API key with access to Veo 3.1. Get one from [Google AI Studio](https://aistudio.google.com/).

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
│   │   └── veo.js            # Veo 3.1 API integration
│   ├── jobs/
│   │   └── jobManager.js     # Async job queue & polling
│   └── storage/
│       ├── nola.db           # SQLite database (auto-created)
│       ├── uploads/          # Temporary upload directory
│       └── *.mp4             # Generated videos
├── client/
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx           # Main application with routing
│       ├── components/
│       │   ├── GenerationForm.jsx/css   # Video generation UI
│       │   ├── JobList.jsx/css          # Job queue display
│       │   ├── VideoPlayer.jsx/css      # Video preview & download
│       │   ├── Library.jsx/css          # Video library page
│       │   ├── VideoCard.jsx/css        # Video card component
│       │   ├── FolderSidebar.jsx/css    # Folder navigation
│       │   ├── Login.jsx/css            # Access key login screen
│       │   └── Tips.jsx/css             # Veo 3.1 prompting tips
│       └── hooks/
│           └── useApi.js     # API client hooks
├── .env                      # API key & access key (not committed)
├── .env.example              # Environment template
└── package.json
```

## API Endpoints

### Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/generate/text` | Text-to-video generation |
| POST | `/api/generate/image` | Image-to-video (multipart form) |
| POST | `/api/generate/frames` | Frame interpolation (multipart form) |
| POST | `/api/generate/reference` | Reference-guided generation (multipart form) |
| POST | `/api/generate/extend` | Video extension (multipart form) |

### Jobs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs` | List all jobs |
| GET | `/api/jobs/:id` | Get job status |
| DELETE | `/api/jobs/:id` | Delete job and video files |

### Library

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/library` | List all videos (supports `?folder=`, `?search=`) |
| GET | `/api/library/folders` | List all folders with video counts |
| POST | `/api/library/folders` | Create a new folder |
| DELETE | `/api/library/folders/:id` | Delete a folder |
| PATCH | `/api/videos/:id` | Update video title or folder |
| DELETE | `/api/videos/:id` | Delete a single video |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/templates` | Get prompt templates |
| POST | `/auth/verify` | Verify access key |

## Authentication

The app requires an access key to use. Set the `ACCESS_KEY` environment variable and users will be prompted to enter it on first visit. The key is stored in session storage (cleared when the browser tab closes).

## Data Persistence

NOLA.vids uses SQLite for persistent storage:

- **Jobs** - Generation history persists across server restarts
- **Videos** - Video metadata (title, folder) is stored in the database
- **Folders** - Custom folders for organizing videos
- **Auto-import** - Existing video files are automatically imported on startup

The database is stored at `server/storage/nola.db`.

## Prompt Tips

### Audio Cues
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
| Aspect Ratios | 16:9 (landscape), 9:16 (portrait) |
| Processing Time | 11 seconds to 6 minutes |
| Video Retention | 2 days on Google servers |
| Output | MP4 with native audio |

## Content Filtering

Veo 3.1 includes safety filters that may reject:
- Real people's names or likenesses
- Violent or inappropriate content
- Copyrighted characters

If a generation fails due to filtering, the error message will be displayed in the job queue.

## Development

### Tech Stack

- **Backend**: Node.js, Express, better-sqlite3
- **Frontend**: React 18, Vite
- **Database**: SQLite
- **API Client**: @google/genai SDK
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
