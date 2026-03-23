const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');

const { initDatabase } = require('./db/database');
const VeoService = require('./services/veo');
const ImageGenService = require('./services/imageGen');
const ElevenLabsService = require('./services/elevenLabs');
const JobManager = require('./jobs/jobManager');
const createRoutes = require('./api/routes');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration - defaults to permissive, can be restricted via CORS_ORIGINS env var
const corsOrigins = process.env.CORS_ORIGINS;
app.use(cors(corsOrigins && corsOrigins !== '*'
  ? { origin: corsOrigins.split(',').map(o => o.trim()) }
  : {}
));
app.use(express.json());

// Access key authentication
const ACCESS_KEY = process.env.ACCESS_KEY;
if (!ACCESS_KEY) {
  console.error('ACCESS_KEY is required. Add it to your .env file.');
  process.exit(1);
}

// Auth middleware - protects all /api routes
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['x-access-key'];
  if (!authHeader || authHeader !== ACCESS_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Auth verification endpoint (doesn't require auth)
app.post('/auth/verify', (req, res) => {
  const { accessKey } = req.body;
  if (accessKey === ACCESS_KEY) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid access key' });
  }
});

// Initialize services
const apiKey = process.env.GOOGLE_GENAI_API_KEY;
if (!apiKey) {
  console.error('GOOGLE_GENAI_API_KEY is required. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const veoService = new VeoService(apiKey);
const imageGenService = new ImageGenService(apiKey);
const jobManager = new JobManager(veoService);

// Initialize ElevenLabs TTS service (optional - app works without it)
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const elevenLabsService = new ElevenLabsService(elevenLabsApiKey, {
  modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
  defaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'
});

if (!elevenLabsService.isConfigured()) {
  console.log('Note: ELEVENLABS_API_KEY not configured. TTS features will be disabled.');
}

// Make services available to routes
app.set('imageGenService', imageGenService);
app.set('elevenLabsService', elevenLabsService);

// Download route - MUST be before auth middleware since browser redirects can't send headers
const storage = require('./services/storage');
app.get('/download', async (req, res) => {
  try {
    const { url, filename } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Only allow Supabase URLs for security
    if (!url.includes('supabase.co')) {
      return res.status(403).json({ error: 'Only Supabase URLs are allowed' });
    }

    // Extract bucket and file path from Supabase URL
    const bucket = storage.getBucketFromUrl(url);
    const filePath = storage.getFilenameFromUrl(url);

    if (!bucket || !filePath) {
      return res.status(400).json({ error: 'Invalid Supabase storage URL' });
    }

    // Download using authenticated Supabase SDK
    const buffer = await storage.downloadFile(bucket, filePath);

    // Determine content type from extension
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav'
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    // Set headers for download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'download'}"`);

    // Send the buffer
    res.send(buffer);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API routes (protected by auth middleware)
app.use('/api', authMiddleware, createRoutes(jobManager));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files from React app in production
const clientDistPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  // Handle React routing - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message });
});

// Initialize database and start server
async function startServer() {
  try {
    // Initialize Supabase database connection
    await initDatabase();

    const server = app.listen(PORT, () => {
      console.log(`NOLA.vids server running on http://localhost:${PORT}`);
      console.log('Powered by VEO 3.1 + Nano Banana 2');
      console.log('Using Supabase for database and file storage');

    // Set longer timeout for large file uploads (10 minutes)
    server.timeout = 600000;
    server.keepAliveTimeout = 620000; // Slightly longer than timeout
      console.log('');
      console.log('Video Generation:');
      console.log('  POST /api/generate/text     - Text-to-video');
      console.log('  POST /api/generate/image    - Image-to-video');
      console.log('  POST /api/generate/frames   - Frame interpolation');
      console.log('  POST /api/generate/reference - Reference-guided');
      console.log('  POST /api/generate/extend   - Video extension');
      console.log('  GET  /api/jobs              - List all jobs');
      console.log('  GET  /api/jobs/:id          - Get job status');
      console.log('');
      console.log('Image Generation:');
      console.log('  POST /api/asset-lists       - Import asset list from Carl v7');
      console.log('  GET  /api/asset-lists       - List asset lists');
      console.log('  GET  /api/asset-lists/:id   - Get asset list with images');
      console.log('  POST /api/images/generate   - Generate single image');
      console.log('  GET  /api/images            - List generated images');
      console.log('  PUT  /api/images/:id/regenerate - Regenerate image');
      console.log('');
      console.log('Characters:');
      console.log('  GET  /api/characters/:module - Get characters for module');
      console.log('  POST /api/characters         - Create/update character');
      console.log('  PUT  /api/characters/:id/anchor - Set anchor image');
      console.log('');
      console.log('Audio/TTS:');
      console.log('  GET  /api/voices            - Get available TTS voices');
      console.log('  POST /api/audio/generate    - Generate audio from text');
      console.log('  PATCH /api/audio/:id        - Update audio settings');
      console.log('  PUT  /api/audio/:id/regenerate - Regenerate audio');
      console.log('');
      console.log('  GET  /api/templates         - Get prompt templates');
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
