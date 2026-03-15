# CLAUDE.md - Project Context for Claude Code

## Project Overview

**NOLA.vids** is an internal media team video/image generation application for NOLA Education. It generates educational content using:
- **Google Veo 3.1** - Video generation (text-to-video, image-to-video, frame interpolation, video extension)
- **Google Gemini** - Image generation
- **ElevenLabs** - Text-to-speech narration

## Tech Stack

- **Frontend**: React 18 + Vite
- **Backend**: Express.js
- **Database**: Supabase (PostgreSQL) - migrated from SQLite
- **Storage**: Supabase Storage (7 buckets: videos, images, anchors, mg-videos, audio, uploads, defaults)
- **Deployment**: Render (ephemeral filesystem - why we migrated to Supabase)

## Key Architecture

```
client/
  src/
    App.jsx              # Main app, auth, routing between tabs
    components/
      GenerationForm.jsx # Video generation form
      ImageGenerator/    # Carl Gen tab (curriculum-based generation)
      ImageGenForm.jsx   # Standalone image generation
      VideoCard.jsx      # Video thumbnail with hover preview
      ImageCard.jsx      # Image thumbnail card
      JobList.jsx        # Active/completed job queue
server/
  api/routes.js          # All API endpoints
  db/
    database.js          # Supabase database operations
    supabase.js          # Supabase client config
  services/
    storage.js           # Supabase Storage wrapper
    veo.js               # Google Veo API
    imageGen.js          # Google Gemini API
    elevenLabs.js        # ElevenLabs TTS API
  jobs/jobManager.js     # Job queue management
```

## Recent Development Timeline

### Supabase Migration (a88f228)
Migrated from SQLite to Supabase because Render's ephemeral filesystem wiped data on every deploy.

### Post-Migration Fixes
- `5777558` - Character reference images not displaying (URL handling)
- `8af878e`, `ebcdad1`, `1508e59` - Download buttons needed proxy for Supabase auth
- `9ab2d31` - Update/delete not returning count (Supabase behavior differs from SQLite)

### Feature Additions
- `5113133` - Session types (regular, RCP, RCA) to separate curriculum sessions
- `ec38416`, `7533862` - Pre-Test/Post-Test assessment support
- `b59d884` - Multi-part narration (scenario, questions, answers, RCP segments)
- `71f4aeb` - ElevenLabs TTS integration
- `c8c85d2`, `1e6a28f` - Motion graphics support with default images
- `65f6036` - Multiple reference images for character consistency
- `0867547` - Drop zone, aspect ratio selector, refine feature for Image Gen

### Performance Fixes
- `e752b6e` - N+1 query fixes, memory leaks
- `a00c4c5` - Lightweight polling for audio generation
- `d94b3b9` - Image loading optimization with compression
- `d4ad964`, `573b273` - Supabase image transforms with fallback
- `45ec0f4` - Batch DB operations, polling fixes, React.memo

## Common Issues & Fixes

### Supabase Migration Gotchas

1. **Update/Delete not returning count**
   - Supabase doesn't return `count` by default from update/delete
   - Fix: Add `.select().single()` and check for `data` truthiness instead of `count > 0`

2. **Image URLs not displaying**
   - After migration, full Supabase URLs need to be recognized
   - Check if path starts with 'http' before constructing URLs

3. **Downloads require proxy**
   - Supabase storage needs authenticated requests
   - Use `/download` proxy endpoint for browser downloads

4. **Black screen loading data**
   - Fixed in `9388907` - ensure async data loading completes before render

### Performance Patterns

1. **Use batch operations for loops**
   - `generatedImageDb.createBulk()` - batch insert images
   - `generatedImageDb.updateBulk()` - parallel updates
   - `generatedAudioDb.upsertBulk()` - batch upsert audio
   - Avoid N+1 queries in for loops

2. **Polling with refs, not state**
   - Don't include state arrays in useEffect deps for polling
   - Use refs to track "has active items" to prevent interval restart
   ```javascript
   const hasActiveRef = useRef(false);
   useEffect(() => { hasActiveRef.current = items.some(...); }, [items]);
   useEffect(() => {
     const interval = setInterval(() => {
       if (hasActiveRef.current) poll();
     }, 5000);
     return () => clearInterval(interval);
   }, [poll]); // stable deps only
   ```

3. **React.memo for list items**
   - Wrap VideoCard, ImageCard with `React.memo()` to prevent unnecessary re-renders

4. **Parallelize independent API calls**
   ```javascript
   await Promise.all([loadJobs(), loadTemplates(), loadVideos()]);
   ```

5. **Video preload**
   - Use `preload="metadata"` not `preload="auto"` to avoid loading all video content

### Supabase Image Transforms

Use transform URLs for optimized thumbnails:
```javascript
url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=400&quality=80'
```

Add fallback to original URL if transform fails (rate limits, etc.).

## Database Schema

Key tables:
- `jobs` - Video generation jobs
- `videos` - Generated video metadata
- `asset_lists` - Carl v7 curriculum imports (with session_type: regular/rcp/rca)
- `generated_images` - Image records (both standalone and curriculum)
- `generated_audio` - TTS narration records (supports multi-part: slide_narration, scenario, questions, answers)
- `characters` - Character definitions with reference images
- `assessment_assets` - Pre/Post test content
- `motion_graphics_videos` - MG video records per slide

See `supabase/schema.sql` for full schema with indexes.

## Environment Variables

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
GOOGLE_API_KEY=           # For Veo and Gemini
ELEVENLABS_API_KEY=       # Optional, for TTS
ACCESS_KEY=               # Simple auth key for the app
```

## Git Remotes

- `origin` - git@github.com:moplacer-dev/nola-vids.git
- `mo-placer` - https://github.com/mo-placer/nola-vids.git

Push to both: `git push origin main && git push mo-placer main`

## Build & Run

```bash
npm install          # Install all dependencies
npm run build        # Build client
npm run dev          # Run dev server with hot reload
npm start            # Run production server
```

## Testing Checklist

When making changes, verify:
- [ ] `npm run build` succeeds
- [ ] Video generation form works
- [ ] Image generation works (standalone + Carl Gen)
- [ ] Carl Gen imports and displays correctly
- [ ] Downloads work (uses proxy for Supabase URLs)
- [ ] Job polling updates status without restarting interval
- [ ] Character anchor/reference images display
- [ ] Motion graphics scenes can be added/deleted
- [ ] Audio generation and preview works
- [ ] Assessment (Pre/Post test) content displays

## Debugging Tips

1. **Check console for base64 dumps** - Removed in `65dc8f6`, but watch for verbose logging
2. **Image not loading?** - Check if URL is being constructed correctly (http prefix)
3. **Downloads failing?** - Verify proxy endpoint is being used for Supabase URLs
4. **Polling feels broken?** - Check useEffect dependencies, should use refs for state tracking
5. **Slow imports?** - Look for N+1 patterns, use batch operations
