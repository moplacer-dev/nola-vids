const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');

const { initDatabase } = require('./db/database');
const VeoService = require('./services/veo');
const JobManager = require('./jobs/jobManager');
const createRoutes = require('./api/routes');

// Initialize database before anything else
initDatabase();

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure storage directories exist
const storageDir = path.join(__dirname, 'storage');
const uploadsDir = path.join(storageDir, 'uploads');
if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Middleware
app.use(cors());
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

// Serve generated videos
app.use('/videos', express.static(storageDir));

// Initialize services
const apiKey = process.env.GOOGLE_GENAI_API_KEY;
if (!apiKey) {
  console.error('GOOGLE_GENAI_API_KEY is required. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const veoService = new VeoService(apiKey);
const jobManager = new JobManager(veoService);

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

app.listen(PORT, () => {
  console.log(`NOLA.vids server running on http://localhost:${PORT}`);
  console.log('API endpoints:');
  console.log('  POST /api/generate/text     - Text-to-video');
  console.log('  POST /api/generate/image    - Image-to-video');
  console.log('  POST /api/generate/frames   - Frame interpolation');
  console.log('  POST /api/generate/reference - Reference-guided');
  console.log('  POST /api/generate/extend   - Video extension');
  console.log('  GET  /api/jobs              - List all jobs');
  console.log('  GET  /api/jobs/:id          - Get job status');
  console.log('  GET  /api/templates         - Get prompt templates');
});
