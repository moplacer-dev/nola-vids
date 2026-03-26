const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsPromises = require('fs').promises;

// Async helper to clean up temp files without blocking the event loop
async function cleanupTempFile(filePath) {
  if (!filePath) return;
  try {
    await fsPromises.access(filePath);
    await fsPromises.unlink(filePath);
  } catch (err) {
    // File doesn't exist or already deleted - ignore
  }
}

// Async helper to clean up multiple temp files
async function cleanupTempFiles(files) {
  if (!files || !Array.isArray(files)) return;
  await Promise.all(files.map(file => cleanupTempFile(file.path)));
}

// Sanitize filenames for Supabase Storage (removes special characters like non-breaking spaces)
function sanitizeFilename(filename) {
  if (!filename) return 'file';
  // Replace non-ASCII characters (like narrow no-break spaces from macOS) and other problematic chars
  return filename
    .normalize('NFKD')  // Normalize unicode
    .replace(/[^\x00-\x7F]/g, '_')  // Replace non-ASCII with underscore
    .replace(/\s+/g, '_')  // Replace whitespace with underscore
    .replace(/[<>:"/\\|?*]/g, '_')  // Replace filesystem-unsafe chars
    .replace(/_+/g, '_');  // Collapse multiple underscores
}

const {
  videos: videoDb,
  folders: folderDb,
  characters: characterDb,
  assetLists: assetListDb,
  generatedImages: generatedImageDb,
  generationHistory: generationHistoryDb,
  motionGraphicsVideos: mgVideoDb,
  generatedAudio: generatedAudioDb,
  assessmentAssets: assessmentAssetDb
} = require('../db/database');

const storage = require('../services/storage');
const { BUCKETS } = storage;

const {
  parseNarrationText,
  isQuestionSlide,
  narrationTypeToCode
} = require('../utils/narrationParser');

const { getModuleCode } = require('../utils/moduleConfig');

const router = express.Router();

// Default images for specific slide types
// Maps slide title patterns (lowercase) to default image filenames
const DEFAULT_SLIDE_IMAGES = {
  'clean up': 'cleanup.png',
  'cleanup': 'cleanup.png',
  'lab safety': 'lab_safety.png',
  'lab_safety': 'lab_safety.png'
};

// Cache for default image existence checks (5-minute TTL)
const defaultImageCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Check if a slide title matches a default image pattern (with caching)
async function getDefaultImageForSlide(slideTitle) {
  if (!slideTitle) return null;
  const titleLower = slideTitle.toLowerCase().trim();

  for (const [pattern, filename] of Object.entries(DEFAULT_SLIDE_IMAGES)) {
    if (titleLower.includes(pattern)) {
      // Check cache first
      const cacheKey = filename;
      const cached = defaultImageCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.value;
      }

      // Check if default image exists in Supabase Storage
      const exists = await storage.fileExists(BUCKETS.DEFAULTS, filename);
      const result = exists ? {
        filename,
        publicUrl: storage.getPublicUrl(BUCKETS.DEFAULTS, filename)
      } : null;

      // Cache the result
      defaultImageCache.set(cacheKey, { value: result, timestamp: Date.now() });
      return result;
    }
  }
  return null;
}

// Apply default image to a generated image record
async function applyDefaultImage(imageId, defaultImage, cmsFilename) {
  const ext = path.extname(defaultImage.filename);
  const outputFilename = cmsFilename.replace(/\.[^.]+$/, ext);

  // Copy default image to images bucket with CMS filename
  await storage.copyFile(BUCKETS.DEFAULTS, defaultImage.filename, BUCKETS.IMAGES, outputFilename);
  const publicUrl = storage.getPublicUrl(BUCKETS.IMAGES, outputFilename);

  // Update the record
  await generatedImageDb.update(imageId, {
    status: 'default',
    imagePath: publicUrl,
    cmsFilename: outputFilename
  });

  return { outputPath: publicUrl, outputFilename };
}

// Configure multer for temporary file uploads
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit for video uploads
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/webm',
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

module.exports = (jobManager) => {
  // Text-to-video generation
  router.post('/generate/text', async (req, res) => {
    try {
      const { prompt, negativePrompt, aspectRatio, durationSeconds, resolution } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
      }

      const job = await jobManager.createJob('text-to-video', {
        prompt,
        negativePrompt,
        aspectRatio,
        durationSeconds,
        resolution
      });

      await jobManager.startJob(job.id);

      res.json({ jobId: job.id, status: job.status });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Image-to-video generation
  router.post('/generate/image', upload.single('image'), async (req, res) => {
    try {
      const { prompt, negativePrompt, aspectRatio, durationSeconds, resolution } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: 'Image file is required' });
      }
      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
      }

      // Upload image to Supabase Storage
      const filename = `${Date.now()}_${sanitizeFilename(req.file.originalname)}`;
      const uploaded = await storage.uploadFileFromPath(
        BUCKETS.UPLOADS,
        filename,
        req.file.path,
        req.file.mimetype
      );

      const job = await jobManager.createJob('image-to-video', {
        image: uploaded.publicUrl,
        prompt,
        negativePrompt,
        aspectRatio,
        durationSeconds,
        resolution
      });

      await jobManager.startJob(job.id);

      // Clean up temp file
      await cleanupTempFile(req.file.path);

      res.json({ jobId: job.id, status: job.status });
    } catch (error) {
      await cleanupTempFile(req.file?.path);
      res.status(500).json({ error: error.message });
    }
  });

  // Frame interpolation
  router.post('/generate/frames', upload.fields([
    { name: 'firstFrame', maxCount: 1 },
    { name: 'lastFrame', maxCount: 1 }
  ]), async (req, res) => {
    try {
      const { prompt, negativePrompt, aspectRatio, resolution } = req.body;

      if (!req.files?.firstFrame?.[0] || !req.files?.lastFrame?.[0]) {
        return res.status(400).json({ error: 'Both first and last frame images are required' });
      }
      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
      }

      // Upload both frames to Supabase
      const firstFile = req.files.firstFrame[0];
      const lastFile = req.files.lastFrame[0];

      const firstUploaded = await storage.uploadFileFromPath(
        BUCKETS.UPLOADS,
        `${Date.now()}_first_${firstFile.originalname}`,
        firstFile.path,
        firstFile.mimetype
      );

      const lastUploaded = await storage.uploadFileFromPath(
        BUCKETS.UPLOADS,
        `${Date.now()}_last_${lastFile.originalname}`,
        lastFile.path,
        lastFile.mimetype
      );

      const job = await jobManager.createJob('frame-interpolation', {
        firstFrame: firstUploaded.publicUrl,
        lastFrame: lastUploaded.publicUrl,
        prompt,
        negativePrompt,
        aspectRatio,
        resolution
      });

      await jobManager.startJob(job.id);

      // Clean up temp files
      await Promise.all([
        cleanupTempFile(firstFile.path),
        cleanupTempFile(lastFile.path)
      ]);

      res.json({ jobId: job.id, status: job.status });
    } catch (error) {
      // Clean up on error
      await Promise.all([
        cleanupTempFile(req.files?.firstFrame?.[0]?.path),
        cleanupTempFile(req.files?.lastFrame?.[0]?.path)
      ]);
      res.status(500).json({ error: error.message });
    }
  });

  // Reference-guided generation
  router.post('/generate/reference', upload.array('referenceImages', 3), async (req, res) => {
    try {
      const { prompt, negativePrompt, aspectRatio, resolution } = req.body;

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'At least one reference image is required' });
      }
      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
      }

      // Upload all reference images
      const uploadedUrls = [];
      for (const file of req.files) {
        const uploaded = await storage.uploadFileFromPath(
          BUCKETS.UPLOADS,
          `${Date.now()}_${sanitizeFilename(file.originalname)}`,
          file.path,
          file.mimetype
        );
        uploadedUrls.push(uploaded.publicUrl);
        await cleanupTempFile(file.path);
      }

      const job = await jobManager.createJob('reference-guided', {
        referenceImages: uploadedUrls,
        prompt,
        negativePrompt,
        aspectRatio,
        resolution
      });

      await jobManager.startJob(job.id);

      res.json({ jobId: job.id, status: job.status });
    } catch (error) {
      // Clean up on error
      await cleanupTempFiles(req.files);
      res.status(500).json({ error: error.message });
    }
  });

  // Video extension - requires a Veo-generated video with stored source URI
  router.post('/generate/extend', async (req, res) => {
    try {
      const { prompt, videoPath } = req.body;

      if (!videoPath) {
        return res.status(400).json({ error: 'Video path is required' });
      }

      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
      }

      // Look up the video in the database to get its source URI
      const video = await videoDb.getByPath(videoPath);
      if (!video) {
        return res.status(400).json({ error: 'Video not found in library' });
      }

      if (!video.sourceUri) {
        return res.status(400).json({
          error: 'This video cannot be extended. Video extension only works with Veo-generated videos that have a stored source URI. Note: Google only retains video URIs for 2 days after generation.'
        });
      }

      const job = await jobManager.createJob('video-extension', {
        videoUri: video.sourceUri,
        prompt
      });

      await jobManager.startJob(job.id);

      res.json({ jobId: job.id, status: job.status });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get job status
  router.get('/jobs/:jobId', async (req, res) => {
    const job = await jobManager.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  });

  // Get all jobs
  router.get('/jobs', async (req, res) => {
    const jobs = await jobManager.getAllJobs();
    res.json(jobs);
  });

  // Delete a job
  router.delete('/jobs/:jobId', async (req, res) => {
    const deleted = await jobManager.deleteJob(req.params.jobId);
    if (!deleted) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json({ success: true });
  });

  // Get prompt templates
  router.get('/templates', (req, res) => {
    res.json(promptTemplates);
  });

  // ==========================================
  // Library endpoints
  // ==========================================

  // Get all videos for library
  router.get('/library', async (req, res) => {
    try {
      const { folder, search, limit, offset } = req.query;
      const videos = await videoDb.getAll({
        folder,
        search,
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined
      });
      res.json(videos);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all folders
  router.get('/library/folders', async (req, res) => {
    try {
      const folders = await folderDb.getAll();
      res.json(folders);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a folder
  router.post('/library/folders', async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Folder name is required' });
      }

      const folder = await folderDb.create(name.trim());
      if (!folder) {
        return res.status(409).json({ error: 'Folder already exists' });
      }

      res.json(folder);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a folder
  router.delete('/library/folders/:folderId', async (req, res) => {
    try {
      const deleted = await folderDb.delete(req.params.folderId);
      if (!deleted) {
        return res.status(404).json({ error: 'Folder not found' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update a video (title, folder)
  router.patch('/videos/:videoId', async (req, res) => {
    try {
      const { title, folder } = req.body;
      const updated = await videoDb.update(req.params.videoId, { title, folder });
      if (!updated) {
        return res.status(404).json({ error: 'Video not found' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a single video
  router.delete('/videos/:videoId', async (req, res) => {
    try {
      const video = await videoDb.delete(req.params.videoId);
      if (!video) {
        return res.status(404).json({ error: 'Video not found' });
      }

      // Delete the file from Supabase Storage
      const filename = storage.getFilenameFromUrl(video.path);
      if (filename) {
        await storage.deleteFile(BUCKETS.VIDEOS, filename);
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // Image Generation endpoints
  // ==========================================

  // Receive asset list from Carl v7
  router.post('/asset-lists', async (req, res) => {
    try {
      const { moduleName, sessionNumber, sessionTitle, sessionType: providedSessionType, assets, slides, careerCharacter } = req.body;

      if (!moduleName) {
        return res.status(400).json({ error: 'moduleName is required' });
      }
      if (!assets || !Array.isArray(assets)) {
        return res.status(400).json({ error: 'assets array is required' });
      }

      // Use slides array if provided, otherwise extract unique slides from assets
      const allSlides = slides || extractSlidesFromAssets(assets);

      // Check if any slides/assets have RCP slideTypes
      const hasRcpSlides = allSlides.some(s => isRcpSlideType(s.slideType)) ||
                          assets.some(a => isRcpSlideType(a.slideType));

      console.log(`[import] Session ${sessionNumber}: ${allSlides.length} slides, hasRcpSlides=${hasRcpSlides}`);
      if (allSlides.length > 0) {
        const slideNums = allSlides.map(s => s.slideNumber ?? s.slide_number);
        console.log(`[import] Slide numbers: ${Math.min(...slideNums)} to ${Math.max(...slideNums)}`);
      }

      // If RCP slides detected, partition and process both lists
      if (hasRcpSlides) {
        // Partition slides by RCP vs non-RCP
        let regularSlides = allSlides.filter(s => !isRcpSlideType(s.slideType));
        let rcpSlides = allSlides.filter(s => isRcpSlideType(s.slideType));

        // Get slide numbers for each partition (before renumbering)
        const rcpSlideNumbers = new Set(rcpSlides.map(s => s.slideNumber ?? s.slide_number));

        // Partition assets by slide membership
        let regularAssets = assets.filter(a => !rcpSlideNumbers.has(a.slideNumber));
        let rcpAssets = assets.filter(a => rcpSlideNumbers.has(a.slideNumber));

        // Renumber regular slides and assets to start at 1
        if (regularSlides.length > 0) {
          // Sort by original slide number
          regularSlides.sort((a, b) => (a.slideNumber ?? a.slide_number) - (b.slideNumber ?? b.slide_number));

          // Build renumber map: oldNumber -> newNumber
          const regularRenumberMap = {};
          regularSlides.forEach((slide, index) => {
            const oldNum = slide.slideNumber ?? slide.slide_number;
            const newNum = index + 1;
            regularRenumberMap[oldNum] = newNum;
          });

          // Apply new numbers to slides
          regularSlides = regularSlides.map((slide, index) => ({
            ...slide,
            slideNumber: index + 1,
            slide_number: index + 1
          }));

          // Apply new numbers to assets
          regularAssets = regularAssets.map(asset => ({
            ...asset,
            slideNumber: regularRenumberMap[asset.slideNumber] ?? asset.slideNumber
          }));
        }

        // Renumber RCP slides and assets to start at 1
        if (rcpSlides.length > 0) {
          // Sort by original slide number
          rcpSlides.sort((a, b) => (a.slideNumber ?? a.slide_number) - (b.slideNumber ?? b.slide_number));

          // Build renumber map: oldNumber -> newNumber
          const rcpRenumberMap = {};
          rcpSlides.forEach((slide, index) => {
            const oldNum = slide.slideNumber ?? slide.slide_number;
            const newNum = index + 1;
            rcpRenumberMap[oldNum] = newNum;
          });

          // Apply new numbers to slides
          rcpSlides = rcpSlides.map((slide, index) => ({
            ...slide,
            slideNumber: index + 1,
            slide_number: index + 1
          }));

          // Apply new numbers to assets
          rcpAssets = rcpAssets.map(asset => ({
            ...asset,
            slideNumber: rcpRenumberMap[asset.slideNumber] ?? asset.slideNumber
          }));
        }

        // Process regular session if there are regular assets
        let regularResult = null;
        if (regularAssets.length > 0) {
          regularResult = await processAssetList({
            moduleName,
            sessionNumber,
            sessionTitle,
            sessionType: 'regular',
            assets: regularAssets,
            slides: regularSlides,
            careerCharacter,
            assetListDb,
            generatedImageDb,
            characterDb,
            generatedAudioDb
          });
        }

        // Process RCP session if there are RCP assets
        let rcpResult = null;
        if (rcpAssets.length > 0) {
          rcpResult = await processAssetList({
            moduleName,
            sessionNumber,
            sessionTitle: `${sessionTitle || `Session ${sessionNumber}`} RCP`,
            sessionType: 'rcp',
            assets: rcpAssets,
            slides: rcpSlides,
            careerCharacter,
            assetListDb,
            generatedImageDb,
            characterDb,
            generatedAudioDb
          });
        }

        // Build response message
        const messages = [];
        if (regularResult) messages.push(regularResult.message);
        if (rcpResult) messages.push(rcpResult.message);

        return res.json({
          assetList: regularResult?.assetList || rcpResult?.assetList,
          rcpAssetList: rcpResult?.assetList,
          generatedImages: [
            ...(regularResult?.generatedImages || []),
            ...(rcpResult?.generatedImages || [])
          ],
          message: messages.join(' | ')
        });
      }

      // No RCP slides - process normally
      // Determine session type from provided value or parse from sessionTitle
      let sessionType = providedSessionType;
      if (!sessionType && sessionTitle) {
        sessionType = parseSessionType(sessionTitle);
      }
      sessionType = sessionType || 'regular';

      // Check if slides need renumbering (e.g., slides start at 4 instead of 1)
      let processedSlides = allSlides;
      let processedAssets = assets;

      if (allSlides && allSlides.length > 0) {
        const slideNumbers = allSlides.map(s => s.slideNumber ?? s.slide_number).filter(n => n != null);
        const minSlideNum = Math.min(...slideNumbers);

        if (minSlideNum > 1) {
          console.log(`[import] Renumbering slides: starting at ${minSlideNum}, shifting to start at 1`);

          // Sort slides by original number
          const sortedSlides = [...allSlides].sort((a, b) =>
            (a.slideNumber ?? a.slide_number) - (b.slideNumber ?? b.slide_number)
          );

          // Build renumber map
          const renumberMap = {};
          sortedSlides.forEach((slide, index) => {
            const oldNum = slide.slideNumber ?? slide.slide_number;
            renumberMap[oldNum] = index + 1;
          });

          // Apply to slides
          processedSlides = sortedSlides.map((slide, index) => ({
            ...slide,
            slideNumber: index + 1,
            slide_number: index + 1
          }));

          // Apply to assets
          processedAssets = assets.map(asset => ({
            ...asset,
            slideNumber: renumberMap[asset.slideNumber] ?? asset.slideNumber
          }));
        }
      }

      // Keep all assets (now potentially renumbered)
      const filteredAssets = processedAssets;

      // Check if asset list already exists for this module+session+type
      let assetList = await assetListDb.getByModuleSessionAndType(moduleName, sessionNumber, sessionType);
      let isUpdate = false;
      let existingImages = [];

      if (assetList) {
        // Update existing asset list
        isUpdate = true;
        await assetListDb.update(assetList.id, {
          sessionTitle,
          assets: processedAssets,
          slides: processedSlides,
          careerCharacter
        });
        // Refresh to get updated data
        assetList = await assetListDb.getById(assetList.id);
        existingImages = await generatedImageDb.getByAssetList(assetList.id);
      } else {
        // Create new asset list
        assetList = await assetListDb.create({
          moduleName,
          sessionNumber,
          sessionType,
          sessionTitle,
          assets: processedAssets,
          slides: processedSlides,
          careerCharacter
        });
      }

      // Handle career character (create or update)
      let characterId = null;
      let characterAppearsOn = [];
      if (careerCharacter && careerCharacter.name) {
        const existingChar = await characterDb.getByModuleAndName(moduleName, careerCharacter.name);
        if (existingChar) {
          const currentSlides = existingChar.appearsOnSlides || [];
          const newSlides = careerCharacter.appearsOn || [];
          const allSlides = [...new Set([...currentSlides, ...newSlides])];
          await characterDb.update(existingChar.id, {
            appearsOnSlides: allSlides,
            career: careerCharacter.career || existingChar.career,
            appearanceDescription: careerCharacter.appearance || existingChar.appearanceDescription
          });
          characterId = existingChar.id;
          characterAppearsOn = allSlides;
        } else {
          const newChar = await characterDb.create({
            moduleName,
            characterName: careerCharacter.name,
            career: careerCharacter.career,
            appearanceDescription: careerCharacter.appearance,
            appearsOnSlides: careerCharacter.appearsOn || []
          });
          if (newChar) {
            characterId = newChar.id;
            characterAppearsOn = careerCharacter.appearsOn || [];
          }
        }
      }

      // Build map of existing images by slideNumber+assetType+assetNumber
      const existingByKey = {};
      const duplicateIds = [];
      existingImages.forEach(img => {
        const key = `${img.slideNumber}-${img.assetType}-${img.assetNumber || 1}`;
        if (existingByKey[key]) {
          duplicateIds.push(img.id);
        } else {
          existingByKey[key] = img;
        }
      });

      // Delete any duplicates found
      if (duplicateIds.length > 0) {
        await generatedImageDb.deleteByIds(duplicateIds);
      }

      // Helper to get assetNumber from either camelCase or snake_case field
      const getAssetNumber = (asset) => asset.assetNumber ?? asset.asset_number ?? 1;

      // Build set of new slide keys from filtered assets
      const newSlideKeys = new Set(
        filteredAssets.map(a => `${a.slideNumber}-${a.type}-${getAssetNumber(a)}`)
      );

      // Find images to delete (slides that were removed from asset list)
      const imagesToDelete = existingImages.filter(img => {
        const key = `${img.slideNumber}-${img.assetType}-${img.assetNumber || 1}`;
        return !newSlideKeys.has(key);
      });

      // Delete removed images
      if (imagesToDelete.length > 0) {
        await generatedImageDb.deleteByIds(imagesToDelete.map(img => img.id));
      }

      // Build a map of slide numbers to slide titles for default image lookup
      const slideTitleMap = {};
      if (allSlides) {
        allSlides.forEach(s => {
          const num = String(s.slideNumber ?? s.slide_number ?? '');
          const title = s.slideTitle || s.slide_title || s.title || '';
          if (num) slideTitleMap[num] = title;
        });
      }

      // Process each asset: separate into updates and creates for batch operations
      const toUpdate = [];
      const toCreate = [];
      const pendingDefaultChecks = []; // Track items that need default image checks

      for (const asset of filteredAssets) {
        const assetNum = getAssetNumber(asset);
        const key = `${asset.slideNumber}-${asset.type}-${assetNum}`;
        const existing = existingByKey[key];

        const slideKey = `S${sessionNumber}-${asset.slideNumber}`;
        const hasCharacter = characterId && characterAppearsOn.some(s =>
          s === slideKey || s === asset.slideNumber || s === `${asset.slideNumber}`
        );

        if (existing) {
          // Queue update for existing record
          toUpdate.push({
            id: existing.id,
            originalPrompt: asset.prompt,
            characterId: hasCharacter ? characterId : existing.characterId
          });

          // Track for potential default image application
          if (existing.status === 'pending') {
            const slideTitle = slideTitleMap[String(asset.slideNumber)] || asset.slideTitle || '';
            pendingDefaultChecks.push({
              type: 'existing',
              record: existing,
              slideTitle,
              cmsFilename: existing.cmsFilename || generateCmsFilename(moduleName, sessionNumber, asset),
              asset
            });
          }
        } else {
          // Queue creation for new record
          const cmsFilename = generateCmsFilename(moduleName, sessionNumber, asset);
          const slideTitle = slideTitleMap[String(asset.slideNumber)] || asset.slideTitle || '';
          toCreate.push({
            assetListId: assetList.id,
            slideNumber: asset.slideNumber,
            assetType: asset.type,
            assetNumber: assetNum,
            cmsFilename,
            originalPrompt: asset.prompt,
            characterId: hasCharacter ? characterId : null,
            status: 'pending',
            _slideTitle: slideTitle // Temporary field for default check
          });
        }
      }

      // Batch update existing records
      if (toUpdate.length > 0) {
        await generatedImageDb.updateBulk(toUpdate);
      }

      // Batch create new records
      let createdImages = [];
      if (toCreate.length > 0) {
        // Remove temporary fields before creating
        const createData = toCreate.map(({ _slideTitle, ...rest }) => rest);
        createdImages = await generatedImageDb.createBulk(createData);

        // Map created images back to their slide titles for default checks
        createdImages.forEach((img, idx) => {
          const slideTitle = toCreate[idx]._slideTitle;
          if (slideTitle) {
            pendingDefaultChecks.push({
              type: 'created',
              record: img,
              slideTitle,
              cmsFilename: img.cmsFilename
            });
          }
        });
      }

      // Apply default images in parallel (these require storage ops)
      let defaultsApplied = 0;
      const defaultImagePromises = pendingDefaultChecks.map(async (check) => {
        const defaultImage = await getDefaultImageForSlide(check.slideTitle);
        if (defaultImage) {
          const result = await applyDefaultImage(check.record.id, defaultImage, check.cmsFilename);
          check.record.status = 'default';
          check.record.imagePath = result.outputPath;
          check.record.cmsFilename = result.outputFilename;
          return true; // Indicates a default was applied
        }
        return false;
      });
      const defaultResults = await Promise.all(defaultImagePromises);
      defaultsApplied = defaultResults.filter(Boolean).length;

      // Build final generatedImages array
      const generatedImages = [];
      const kept = toUpdate.length;
      const created = createdImages.length;

      // Add updated existing records
      for (const update of toUpdate) {
        const existing = existingByKey[Object.keys(existingByKey).find(k => existingByKey[k].id === update.id)];
        if (existing) {
          generatedImages.push({ ...existing, originalPrompt: update.originalPrompt });
        }
      }

      // Add newly created records
      generatedImages.push(...createdImages);

      // Process slides with narration - batch operation
      let audioCreated = 0;
      let audioKept = 0;
      if (allSlides && allSlides.length > 0) {
        // Fetch all existing audio in one query
        const existingAudioList = await generatedAudioDb.getByAssetList(assetList.id);
        // Always key by slideNumber-narrationType to support both RCP and regular sessions with structuredNarration
        const existingAudioByKey = new Map(
          existingAudioList.map(a => {
            const key = `${a.slideNumber}-${a.narrationType}`;
            return [key, a];
          })
        );

        // Collect narration records to upsert
        const narrationRecords = [];

        for (const slide of allSlides) {
          const slideNum = parseInt(slide.slideNumber ?? slide.slide_number ?? 0);

          if (sessionType === 'rcp' && slide.structuredNarration) {
            // For RCP slides, create multiple audio records from structuredNarration
            const sn = slide.structuredNarration;

            // Question (use structuredNarration.question or fall back to slide.narration)
            const questionText = sn.question || slide.narration || '';
            if (questionText && questionText.trim().length > 0) {
              narrationRecords.push({
                slideNumber: slideNum,
                narrationType: 'question',
                narrationText: questionText.trim(),
                cmsFilename: generateRcpAudioFilename(moduleName, sessionNumber, slideNum, 'question')
              });
            }

            // Answer choices (answerChoices array with {label, text})
            if (sn.answerChoices && Array.isArray(sn.answerChoices)) {
              for (const choice of sn.answerChoices) {
                const label = (choice.label || '').toLowerCase();
                const narrationType = `answer_${label}`;
                if (choice.text && choice.text.trim().length > 0) {
                  narrationRecords.push({
                    slideNumber: slideNum,
                    narrationType,
                    narrationText: choice.text.trim(),
                    cmsFilename: generateRcpAudioFilename(moduleName, sessionNumber, slideNum, narrationType)
                  });
                }
              }
            }

            // Correct response
            if (sn.correctResponseText && sn.correctResponseText.trim().length > 0) {
              narrationRecords.push({
                slideNumber: slideNum,
                narrationType: 'correct_response',
                narrationText: sn.correctResponseText.trim(),
                cmsFilename: generateRcpAudioFilename(moduleName, sessionNumber, slideNum, 'correct_response')
              });
            }

            // First incorrect response
            if (sn.firstIncorrectText && sn.firstIncorrectText.trim().length > 0) {
              narrationRecords.push({
                slideNumber: slideNum,
                narrationType: 'incorrect_1',
                narrationText: sn.firstIncorrectText.trim(),
                cmsFilename: generateRcpAudioFilename(moduleName, sessionNumber, slideNum, 'incorrect_1')
              });
            }

            // Second incorrect response
            if (sn.secondIncorrectText && sn.secondIncorrectText.trim().length > 0) {
              narrationRecords.push({
                slideNumber: slideNum,
                narrationType: 'incorrect_2',
                narrationText: sn.secondIncorrectText.trim(),
                cmsFilename: generateRcpAudioFilename(moduleName, sessionNumber, slideNum, 'incorrect_2')
              });
            }
          } else if (sessionType === 'rcp') {
            // RCP slide without structuredNarration - use narration field as question
            const narration = slide.narration || slide.narrationText || '';
            if (narration && narration.trim().length > 0) {
              narrationRecords.push({
                slideNumber: slideNum,
                narrationType: 'question',
                narrationText: narration.trim(),
                cmsFilename: generateRcpAudioFilename(moduleName, sessionNumber, slideNum, 'question')
              });
            }
          } else if (slide.structuredNarration) {
            // Regular session slide with structuredNarration (e.g., "apply" slides)
            // Store all narration parts: question, answers, correct/incorrect responses
            const sn = slide.structuredNarration;

            // Question text
            const questionText = sn.question || slide.narration || '';
            if (questionText && questionText.trim().length > 0) {
              narrationRecords.push({
                slideNumber: slideNum,
                narrationType: 'question',
                narrationText: questionText.trim(),
                cmsFilename: generateAudioFilename(moduleName, sessionNumber, slideNum, 'question')
              });
            }

            // Answer choices
            if (sn.answerChoices && Array.isArray(sn.answerChoices)) {
              for (const choice of sn.answerChoices) {
                const label = (choice.label || '').toLowerCase();
                const narrationType = `answer_${label}`;
                if (choice.text && choice.text.trim().length > 0) {
                  narrationRecords.push({
                    slideNumber: slideNum,
                    narrationType,
                    narrationText: choice.text.trim(),
                    cmsFilename: generateAudioFilename(moduleName, sessionNumber, slideNum, narrationType)
                  });
                }
              }
            }

            // Correct response
            if (sn.correctResponseText && sn.correctResponseText.trim().length > 0) {
              narrationRecords.push({
                slideNumber: slideNum,
                narrationType: 'correct_response',
                narrationText: sn.correctResponseText.trim(),
                cmsFilename: generateAudioFilename(moduleName, sessionNumber, slideNum, 'correct_response')
              });
            }

            // First incorrect response
            if (sn.firstIncorrectText && sn.firstIncorrectText.trim().length > 0) {
              narrationRecords.push({
                slideNumber: slideNum,
                narrationType: 'incorrect_1',
                narrationText: sn.firstIncorrectText.trim(),
                cmsFilename: generateAudioFilename(moduleName, sessionNumber, slideNum, 'incorrect_1')
              });
            }

            // Second incorrect response
            if (sn.secondIncorrectText && sn.secondIncorrectText.trim().length > 0) {
              narrationRecords.push({
                slideNumber: slideNum,
                narrationType: 'incorrect_2',
                narrationText: sn.secondIncorrectText.trim(),
                cmsFilename: generateAudioFilename(moduleName, sessionNumber, slideNum, 'incorrect_2')
              });
            }
          } else {
            // For regular slides without structuredNarration, single narration record
            const narration = slide.narration || slide.narrationText || '';
            if (narration && narration.trim().length > 0) {
              narrationRecords.push({
                slideNumber: slideNum,
                narrationType: 'slide_narration',
                narrationText: narration,
                cmsFilename: generateAudioFilename(moduleName, sessionNumber, slideNum)
              });
            }
          }
        }

        // Batch upsert with RCP support
        if (narrationRecords.length > 0) {
          const result = await generatedAudioDb.upsertBulkRcp(assetList.id, existingAudioByKey, narrationRecords, sessionType === 'rcp');
          audioCreated = result.created;
          audioKept = narrationRecords.length - result.created;
        }
      }

      const action = isUpdate ? 'Updated' : 'Imported';
      const defaultsNote = defaultsApplied > 0 ? `, ${defaultsApplied} defaults applied` : '';
      const audioNote = (audioCreated + audioKept) > 0 ? `, ${audioCreated + audioKept} narrations` : '';
      const details = isUpdate
        ? `${kept} kept, ${created} added, ${imagesToDelete.length} removed${defaultsNote}${audioNote}`
        : `${created} assets${defaultsNote}${audioNote}`;
      const typeLabel = sessionType !== 'regular' ? ` ${sessionType.toUpperCase()}` : '';

      res.json({
        assetList,
        generatedImages,
        message: `${action} ${moduleName} Session ${sessionNumber}${typeLabel}: ${details}`
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // List all asset lists
  router.get('/asset-lists', async (req, res) => {
    try {
      const { moduleName } = req.query;
      let assetLists;

      if (moduleName) {
        assetLists = await assetListDb.getByModule(moduleName);
      } else {
        assetLists = await assetListDb.getAll();
      }

      res.json(assetLists);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single asset list with its generated images, motion graphics videos, and audio
  router.get('/asset-lists/:id', async (req, res) => {
    try {
      const assetList = await assetListDb.getById(req.params.id);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      // Run all queries in parallel for better performance
      const [generatedImages, motionGraphicsVideos, generatedAudio, characters] =
        await Promise.all([
          generatedImageDb.getByAssetList(assetList.id),
          mgVideoDb.getByAssetList(assetList.id),
          generatedAudioDb.getByAssetList(assetList.id),
          characterDb.getByModule(assetList.moduleName)
        ]);

      // Backfill characterId for existing MG scenes that don't have one (batch update)
      try {
        const character = characters[0]; // Get first character for module
        if (character) {
          const mgScenes = generatedImages.filter(img =>
            (img.assetType || '').toLowerCase().includes('motion_graphics') &&
            !img.characterId
          );

          // Collect all scenes that need character backfill
          const scenesToUpdate = mgScenes.filter(scene => {
            const slideKey = `S${assetList.sessionNumber}-${scene.slideNumber}`;
            return character.appearsOnSlides?.some(s =>
              s === slideKey || s === String(scene.slideNumber)
            );
          });

          // Batch update all at once instead of N individual updates
          if (scenesToUpdate.length > 0) {
            await generatedImageDb.updateBulk(
              scenesToUpdate.map(scene => ({ id: scene.id, characterId: character.id }))
            );
            // Update local objects for response
            scenesToUpdate.forEach(scene => { scene.characterId = character.id; });
          }
        }
      } catch (backfillErr) {
        console.warn('Character backfill failed (non-critical):', backfillErr.message);
      }

      res.json({
        ...assetList,
        generatedImages,
        motionGraphicsVideos,
        generatedAudio
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete asset list
  router.delete('/asset-lists/:id', async (req, res) => {
    try {
      const images = await generatedImageDb.getByAssetList(req.params.id);
      if (images.length > 0) {
        await generatedImageDb.deleteByIds(images.map(img => img.id));
      }

      const deleted = await assetListDb.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Asset list not found' });
      }
      res.json({ success: true, deletedImages: images.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // Character endpoints
  // ==========================================

  // Get characters for a module
  router.get('/characters/:moduleName', async (req, res) => {
    try {
      const characters = await characterDb.getByModule(req.params.moduleName);
      const enrichedCharacters = characters.map(char => {
        if ((!char.referenceImages || char.referenceImages.length === 0) && char.anchorImagePath) {
          char.referenceImages = [char.anchorImagePath];
        }
        return char;
      });
      res.json(enrichedCharacters);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create or update character
  router.post('/characters', async (req, res) => {
    try {
      const { moduleName, characterName, career, appearanceDescription, appearsOnSlides } = req.body;

      if (!moduleName || !characterName) {
        return res.status(400).json({ error: 'moduleName and characterName are required' });
      }

      const existing = await characterDb.getByModuleAndName(moduleName, characterName);
      if (existing) {
        await characterDb.update(existing.id, {
          career,
          appearanceDescription,
          appearsOnSlides
        });
        const updated = await characterDb.getById(existing.id);
        return res.json(updated);
      }

      const character = await characterDb.create({
        moduleName,
        characterName,
        career,
        appearanceDescription,
        appearsOnSlides
      });

      res.json(character);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Set/add reference images for character (supports multiple files)
  router.put('/characters/:id/anchor', upload.array('anchor', 3), async (req, res) => {
    try {
      const character = await characterDb.getById(req.params.id);
      if (!character) {
        return res.status(404).json({ error: 'Character not found' });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'At least one reference image file is required' });
      }

      // Get existing reference images or initialize empty array
      let referenceImages = Array.isArray(character.referenceImages) ? character.referenceImages : [];

      // Process each uploaded file
      const newPaths = [];
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const ext = path.extname(file.originalname) || '.png';
        const timestamp = Date.now();
        const anchorFilename = `anchor_${character.moduleName}_${character.characterName.replace(/\s+/g, '_')}_${timestamp}_${i}${ext}`;

        // Upload to Supabase Storage
        const uploaded = await storage.uploadFileFromPath(
          BUCKETS.ANCHORS,
          anchorFilename,
          file.path,
          file.mimetype
        );

        newPaths.push(uploaded.publicUrl);

        // Clean up temp file
        await cleanupTempFile(file.path);
      }

      // Add new paths to existing ones (max 3 total)
      referenceImages = [...referenceImages, ...newPaths].slice(-3);

      // Update character with both legacy anchorImagePath (first image) and new referenceImages array
      await characterDb.update(req.params.id, {
        anchorImagePath: referenceImages[0] || null,
        referenceImages: referenceImages
      });

      const updated = await characterDb.getById(req.params.id);
      res.json(updated);
    } catch (error) {
      // Clean up temp files on error
      await cleanupTempFiles(req.files);
      res.status(500).json({ error: error.message });
    }
  });

  // Remove a specific reference image from character
  router.delete('/characters/:id/reference-image', async (req, res) => {
    try {
      const { imagePath } = req.body;
      const character = await characterDb.getById(req.params.id);

      if (!character) {
        return res.status(404).json({ error: 'Character not found' });
      }

      if (!imagePath) {
        return res.status(400).json({ error: 'imagePath is required' });
      }

      // Get existing reference images
      let referenceImages = Array.isArray(character.referenceImages) ? [...character.referenceImages] : [];

      // Remove the specified image
      const index = referenceImages.indexOf(imagePath);
      if (index > -1) {
        referenceImages.splice(index, 1);

        // Delete from Supabase Storage
        const filename = storage.getFilenameFromUrl(imagePath);
        if (filename) {
          await storage.deleteFile(BUCKETS.ANCHORS, filename);
        }
      }

      // Update character
      await characterDb.update(req.params.id, {
        anchorImagePath: referenceImages[0] || null,
        referenceImages: referenceImages
      });

      const updated = await characterDb.getById(req.params.id);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // Image generation endpoints
  // ==========================================

  // Generate a standalone image (one-off, not from asset list)
  router.post('/images/generate-standalone', upload.array('referenceImage', 3), async (req, res) => {
    try {
      const { prompt, moduleName, sessionNumber, pageNumber, aspectRatio, referenceUrls } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: 'prompt is required' });
      }

      const imageGenService = req.app.get('imageGenService');
      if (!imageGenService) {
        return res.status(500).json({ error: 'Image generation service not initialized' });
      }

      // Generate filename
      let filename;
      if (moduleName && sessionNumber && pageNumber) {
        const moduleCode = moduleName.substring(0, 4).toUpperCase();
        filename = `MOD.${moduleCode}.${sessionNumber}.${pageNumber}.IMG1.png`;
      } else {
        const timestamp = Date.now();
        filename = `standalone_${timestamp}.png`;
      }

      // Get reference image URLs - start with any URL references (for refine feature)
      const anchorImageUrls = [];
      if (referenceUrls) {
        try {
          const urls = JSON.parse(referenceUrls);
          anchorImageUrls.push(...urls);
        } catch (e) {
          console.warn('Failed to parse referenceUrls:', e);
        }
      }

      // Add uploaded file references
      if (req.files) {
        for (const file of req.files) {
          const uploaded = await storage.uploadFileFromPath(
            BUCKETS.UPLOADS,
            `ref_${Date.now()}_${sanitizeFilename(file.originalname)}`,
            file.path,
            file.mimetype
          );
          anchorImageUrls.push(uploaded.publicUrl);
          await cleanupTempFile(file.path);
        }
      }

      // Generate the image
      const result = await imageGenService.generateToStorage({
        prompt,
        bucket: BUCKETS.IMAGES,
        filename,
        anchorImageUrls,
        aspectRatio: aspectRatio || '4:3'
      });

      // Save to database so it appears in Library
      const dbRecord = await generatedImageDb.create({
        assetListId: null,
        slideNumber: pageNumber ? parseInt(pageNumber) : null,
        assetType: 'standalone',
        cmsFilename: filename,
        originalPrompt: prompt,
        characterId: null,
        imagePath: result.publicUrl,
        status: 'completed'
      });

      res.json({
        success: true,
        id: dbRecord.id,
        filename,
        path: result.publicUrl,
        mimeType: result.mimeType,
        width: result.width,
        height: result.height
      });
    } catch (error) {
      // Clean up on error
      await cleanupTempFiles(req.files);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate a single image (from asset list)
  router.post('/images/generate', async (req, res) => {
    try {
      const { generatedImageId, prompt, useCharacterAnchor } = req.body;

      if (!generatedImageId) {
        return res.status(400).json({ error: 'generatedImageId is required' });
      }

      const genImage = await generatedImageDb.getById(generatedImageId);
      if (!genImage) {
        return res.status(404).json({ error: 'Generated image record not found' });
      }

      // Verify the image has a valid parent (either asset list or assessment)
      if (genImage.assetListId) {
        const assetList = await assetListDb.getById(genImage.assetListId);
        if (!assetList) {
          return res.status(404).json({ error: 'Asset list not found' });
        }
      } else if (genImage.assessmentAssetId) {
        const assessment = await assessmentAssetDb.getById(genImage.assessmentAssetId);
        if (!assessment) {
          return res.status(404).json({ error: 'Assessment not found' });
        }
      } else {
        return res.status(400).json({ error: 'Image has no associated asset list or assessment' });
      }

      const finalPrompt = prompt || genImage.modifiedPrompt || genImage.originalPrompt;
      if (!finalPrompt) {
        return res.status(400).json({ error: 'No prompt available for generation' });
      }

      // Check if we should use character anchor
      let anchorImageUrls = [];
      const assetTypeLower = (genImage.assetType || '').toLowerCase();
      const isCharacterAssetType = assetTypeLower.includes('career') ||
                                   assetTypeLower.includes('character') ||
                                   assetTypeLower.includes('intro') ||
                                   assetTypeLower.includes('motion_graphics');

      if (useCharacterAnchor && isCharacterAssetType && genImage.characterId) {
        const character = await characterDb.getById(genImage.characterId);
        if (character) {
          if (character.referenceImages && Array.isArray(character.referenceImages) && character.referenceImages.length > 0) {
            anchorImageUrls = character.referenceImages;
          } else if (character.anchorImagePath) {
            anchorImageUrls = [character.anchorImagePath];
          }
        }
      }

      // Update status to generating
      await generatedImageDb.update(generatedImageId, { status: 'generating', modifiedPrompt: finalPrompt });

      const imageGenService = req.app.get('imageGenService');
      if (!imageGenService) {
        return res.status(500).json({ error: 'Image generation service not initialized' });
      }

      const outputFilename = genImage.cmsFilename || `image_${generatedImageId}.png`;

      // Run generation asynchronously
      imageGenService.generateToStorage({
        prompt: finalPrompt,
        bucket: BUCKETS.IMAGES,
        filename: outputFilename,
        anchorImageUrls
      }).then(async result => {
        await generatedImageDb.update(generatedImageId, {
          status: 'completed',
          imagePath: result.publicUrl
        });

        await generationHistoryDb.create({
          generatedImageId,
          prompt: finalPrompt,
          imagePath: result.publicUrl
        });

        console.log(`Image generated successfully: ${outputFilename}`);
      }).catch(async error => {
        await generatedImageDb.update(generatedImageId, { status: 'failed' });
        console.error(`Image generation failed for ${generatedImageId}:`, error.message);
      });

      res.json({
        generatedImageId,
        status: 'generating',
        message: 'Image generation started'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all generated images with filtering
  router.get('/images', async (req, res) => {
    try {
      const { moduleName, sessionNumber, status, limit, offset, source } = req.query;
      let statuses;
      if (Array.isArray(status)) {
        statuses = status.map(s => s.trim());
      } else if (status) {
        statuses = status.split(',').map(s => s.trim());
      }
      const images = await generatedImageDb.getAll({
        moduleName,
        sessionNumber: sessionNumber ? parseInt(sessionNumber) : undefined,
        statuses,
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined,
        source // 'standalone' filters for images with no assetListId
      });
      res.json(images);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single generated image
  router.get('/images/:id', async (req, res) => {
    try {
      const image = await generatedImageDb.getById(req.params.id);
      if (!image) {
        return res.status(404).json({ error: 'Image not found' });
      }

      const history = await generationHistoryDb.getByImageId(image.id);
      res.json({ ...image, history });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update image prompt and/or asset type
  router.patch('/images/:id', async (req, res) => {
    try {
      const { modifiedPrompt, characterId, assetType } = req.body;

      const updates = {};
      if (modifiedPrompt !== undefined) updates.modifiedPrompt = modifiedPrompt;
      if (characterId !== undefined) updates.characterId = characterId;
      if (assetType !== undefined) {
        updates.assetType = assetType;
        const image = await generatedImageDb.getById(req.params.id);
        if (image && image.assetListId) {
          const assetList = await assetListDb.getById(image.assetListId);
          if (assetList) {
            const newCmsFilename = generateCmsFilename(
              assetList.moduleName,
              assetList.sessionNumber,
              { slideNumber: image.slideNumber, type: assetType, assetNumber: 1 }
            );
            updates.cmsFilename = newCmsFilename;
          }
        }
      }

      const updated = await generatedImageDb.update(req.params.id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Image not found' });
      }

      const updatedImage = await generatedImageDb.getById(req.params.id);
      res.json({ success: true, image: updatedImage });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a generated image
  router.delete('/images/:id', async (req, res) => {
    try {
      const image = await generatedImageDb.getById(req.params.id);
      if (!image) {
        return res.status(404).json({ error: 'Image not found' });
      }

      // Delete from storage if path exists
      if (image.imagePath) {
        try {
          const bucket = storage.getBucketFromUrl(image.imagePath);
          const filename = storage.getFilenameFromUrl(image.imagePath);
          if (bucket && filename) {
            await storage.deleteFile(bucket, filename);
          }
        } catch (storageErr) {
          console.error('Failed to delete image from storage:', storageErr);
        }
      }

      await generatedImageDb.delete(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Import from library to fulfill a generated image record
  router.post('/images/:id/import', async (req, res) => {
    try {
      const { sourceId, sourceType } = req.body;

      if (!sourceId || !sourceType) {
        return res.status(400).json({ error: 'sourceId and sourceType are required' });
      }

      const genImage = await generatedImageDb.getById(req.params.id);
      if (!genImage) {
        return res.status(404).json({ error: 'Generated image record not found' });
      }

      const assetList = await assetListDb.getById(genImage.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      let sourceUrl, sourceFilename;

      if (sourceType === 'video') {
        const video = await videoDb.getById(sourceId);
        if (!video) {
          return res.status(404).json({ error: 'Source video not found' });
        }
        sourceUrl = video.path;
        sourceFilename = video.filename;
        await videoDb.update(sourceId, { moduleName: assetList.moduleName });
      } else {
        const sourceImage = await generatedImageDb.getById(sourceId);
        if (!sourceImage || !sourceImage.imagePath) {
          return res.status(404).json({ error: 'Source image not found' });
        }
        sourceUrl = sourceImage.imagePath;
        sourceFilename = path.basename(sourceImage.imagePath);
      }

      // Determine output filename with CMS pattern
      const ext = path.extname(sourceFilename).toLowerCase() || '.png';
      let outputFilename = genImage.cmsFilename;
      if (outputFilename) {
        outputFilename = outputFilename.replace(/\.[^.]+$/, ext);
      } else {
        outputFilename = generateCmsFilename(
          assetList.moduleName,
          assetList.sessionNumber,
          { slideNumber: genImage.slideNumber, type: genImage.assetType, assetNumber: genImage.assetNumber || 1 }
        ).replace(/\.png$/, ext);
      }

      // Copy file in Supabase Storage
      const sourceBucket = storage.getBucketFromUrl(sourceUrl);
      const sourceFile = storage.getFilenameFromUrl(sourceUrl);

      if (sourceBucket && sourceFile) {
        await storage.copyFile(sourceBucket, sourceFile, BUCKETS.IMAGES, outputFilename);
      }

      const publicUrl = storage.getPublicUrl(BUCKETS.IMAGES, outputFilename);

      // Update the generated image record
      await generatedImageDb.update(req.params.id, {
        status: 'imported',
        imagePath: publicUrl,
        cmsFilename: outputFilename
      });

      await generationHistoryDb.create({
        generatedImageId: req.params.id,
        prompt: `[Imported from ${sourceType}: ${sourceFilename}]`,
        imagePath: publicUrl
      });

      const updatedImage = await generatedImageDb.getById(req.params.id);

      res.json({
        success: true,
        image: updatedImage,
        filename: outputFilename,
        path: publicUrl
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Upload an image to fulfill a generated image record
  router.post('/images/:id/upload', upload.single('image'), async (req, res) => {
    try {
      const genImage = await generatedImageDb.getById(req.params.id);
      if (!genImage) {
        return res.status(404).json({ error: 'Generated image record not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Image file is required' });
      }

      const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
      let outputFilename = genImage.cmsFilename;

      // Handle both assessment images and asset list images
      if (genImage.assessmentAssetId) {
        // Assessment image
        const assessment = await assessmentAssetDb.getById(genImage.assessmentAssetId);
        if (!assessment) {
          return res.status(404).json({ error: 'Assessment not found' });
        }

        if (outputFilename) {
          outputFilename = outputFilename.replace(/\.[^.]+$/, ext);
        } else {
          // Extract visual type from assetType (e.g., "pre_test_table" -> "table")
          const visualType = genImage.assetType?.split('_').pop() || 'image';
          outputFilename = generateAssessmentCmsFilename(
            assessment.moduleName,
            assessment.assessmentType,
            genImage.slideNumber,
            visualType
          ).replace(/\.png$/, ext);
        }
      } else if (genImage.assetListId) {
        // Asset list image
        const assetList = await assetListDb.getById(genImage.assetListId);
        if (!assetList) {
          return res.status(404).json({ error: 'Asset list not found' });
        }

        if (outputFilename) {
          outputFilename = outputFilename.replace(/\.[^.]+$/, ext);
        } else {
          outputFilename = generateCmsFilename(
            assetList.moduleName,
            assetList.sessionNumber,
            { slideNumber: genImage.slideNumber, type: genImage.assetType, assetNumber: genImage.assetNumber || 1 }
          ).replace(/\.png$/, ext);
        }
      } else {
        return res.status(400).json({ error: 'Image has no associated asset list or assessment' });
      }

      // Determine correct bucket based on file type (videos vs images)
      const isVideoFile = req.file.mimetype.startsWith('video/');
      const uploadBucket = isVideoFile ? BUCKETS.VIDEOS : BUCKETS.IMAGES;

      // Upload to Supabase Storage
      const uploaded = await storage.uploadFileFromPath(
        uploadBucket,
        outputFilename,
        req.file.path,
        req.file.mimetype
      );

      // Clean up temp file
      await cleanupTempFile(req.file.path);

      // Update the generated image record
      await generatedImageDb.update(req.params.id, {
        status: 'uploaded',
        imagePath: uploaded.publicUrl,
        cmsFilename: outputFilename
      });

      await generationHistoryDb.create({
        generatedImageId: req.params.id,
        prompt: '[Uploaded]',
        imagePath: uploaded.publicUrl
      });

      const updatedImage = await generatedImageDb.getById(req.params.id);

      res.json({
        success: true,
        image: updatedImage,
        filename: outputFilename,
        path: uploaded.publicUrl
      });
    } catch (error) {
      await cleanupTempFile(req.file?.path);
      res.status(500).json({ error: error.message });
    }
  });

  // Regenerate an image
  router.put('/images/:id/regenerate', async (req, res) => {
    try {
      const { prompt, useCharacterAnchor } = req.body;

      const genImage = await generatedImageDb.getById(req.params.id);
      if (!genImage) {
        return res.status(404).json({ error: 'Image not found' });
      }

      const imageGenService = req.app.get('imageGenService');
      if (!imageGenService) {
        return res.status(500).json({ error: 'Image generation service not initialized' });
      }

      const finalPrompt = prompt || genImage.modifiedPrompt || genImage.originalPrompt;

      let anchorImageUrls = [];
      const assetTypeLower = (genImage.assetType || '').toLowerCase();
      const isCharacterAssetType = assetTypeLower.includes('career') ||
                                   assetTypeLower.includes('character') ||
                                   assetTypeLower.includes('intro') ||
                                   assetTypeLower.includes('motion_graphics');

      if (useCharacterAnchor && isCharacterAssetType && genImage.characterId) {
        const character = await characterDb.getById(genImage.characterId);
        if (character) {
          if (character.referenceImages && Array.isArray(character.referenceImages) && character.referenceImages.length > 0) {
            anchorImageUrls = character.referenceImages;
          } else if (character.anchorImagePath) {
            anchorImageUrls = [character.anchorImagePath];
          }
        }
      }

      await generatedImageDb.update(req.params.id, { status: 'generating', modifiedPrompt: finalPrompt });

      const outputFilename = genImage.cmsFilename || `image_${genImage.id}.png`;

      imageGenService.generateToStorage({
        prompt: finalPrompt,
        bucket: BUCKETS.IMAGES,
        filename: outputFilename,
        anchorImageUrls
      }).then(async result => {
        await generatedImageDb.update(req.params.id, {
          status: 'completed',
          imagePath: result.publicUrl
        });
        await generationHistoryDb.create({
          generatedImageId: req.params.id,
          prompt: finalPrompt,
          imagePath: result.publicUrl
        });
        console.log(`Image regenerated successfully: ${outputFilename}`);
      }).catch(async error => {
        await generatedImageDb.update(req.params.id, { status: 'failed' });
        console.error(`Image regeneration failed for ${req.params.id}:`, error.message);
      });

      res.json({
        generatedImageId: req.params.id,
        status: 'generating',
        message: 'Image regeneration started'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // Motion Graphics Video endpoints
  // ==========================================

  router.get('/motion-graphics/:assetListId/:slideNumber', async (req, res) => {
    try {
      const { assetListId, slideNumber } = req.params;

      const assetList = await assetListDb.getById(assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      const mgVideo = await mgVideoDb.getByAssetListAndSlide(assetListId, parseInt(slideNumber));

      const allImages = await generatedImageDb.getByAssetList(assetListId);
      const scenes = allImages.filter(img =>
        img.slideNumber === parseInt(slideNumber) &&
        (img.assetType === 'motion_graphics_scene' || img.assetType === 'motion_graphics')
      );

      res.json({
        slideNumber: parseInt(slideNumber),
        video: mgVideo,
        scenes,
        sceneCount: scenes.length,
        scenesReady: scenes.filter(s => ['completed', 'uploaded', 'imported', 'default'].includes(s.status)).length
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/motion-graphics/:assetListId/:slideNumber/video', upload.single('video'), async (req, res) => {
    try {
      const { assetListId, slideNumber } = req.params;

      const assetList = await assetListDb.getById(assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Video file is required' });
      }

      const cmsFilename = generateMGVideoFilename(
        assetList.moduleName,
        assetList.sessionNumber,
        parseInt(slideNumber)
      );

      // Upload to Supabase Storage
      const uploaded = await storage.uploadFileFromPath(
        BUCKETS.MG_VIDEOS,
        cmsFilename,
        req.file.path,
        req.file.mimetype
      );

      // Clean up temp file
      await cleanupTempFile(req.file.path);

      const allImages = await generatedImageDb.getByAssetList(assetListId);
      const sceneCount = allImages.filter(img =>
        img.slideNumber === parseInt(slideNumber) &&
        (img.assetType === 'motion_graphics_scene' || img.assetType === 'motion_graphics')
      ).length;

      let mgVideo = await mgVideoDb.getByAssetListAndSlide(assetListId, parseInt(slideNumber));

      if (mgVideo) {
        // Delete old video file if exists
        if (mgVideo.videoPath) {
          const oldFilename = storage.getFilenameFromUrl(mgVideo.videoPath);
          if (oldFilename) {
            await storage.deleteFile(BUCKETS.MG_VIDEOS, oldFilename);
          }
        }
        mgVideo = await mgVideoDb.update(mgVideo.id, {
          cmsFilename,
          videoPath: uploaded.publicUrl,
          status: 'uploaded',
          sceneCount
        });
      } else {
        mgVideo = await mgVideoDb.create({
          assetListId,
          slideNumber: parseInt(slideNumber),
          cmsFilename,
          videoPath: uploaded.publicUrl,
          status: 'uploaded',
          sceneCount
        });
      }

      res.json({
        success: true,
        video: mgVideo,
        filename: cmsFilename,
        path: uploaded.publicUrl
      });
    } catch (error) {
      await cleanupTempFile(req.file?.path);
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/motion-graphics/:assetListId/:slideNumber/video', async (req, res) => {
    try {
      const { assetListId, slideNumber } = req.params;

      const mgVideo = await mgVideoDb.getByAssetListAndSlide(assetListId, parseInt(slideNumber));
      if (!mgVideo) {
        return res.status(404).json({ error: 'Motion graphics video not found' });
      }

      if (mgVideo.videoPath) {
        const filename = storage.getFilenameFromUrl(mgVideo.videoPath);
        if (filename) {
          await storage.deleteFile(BUCKETS.MG_VIDEOS, filename);
        }
      }

      await mgVideoDb.update(mgVideo.id, {
        videoPath: null,
        status: 'pending'
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Add asset to slide (supports both MG scenes and generic assets)
  router.post('/motion-graphics/:assetListId/:slideNumber/scenes', async (req, res) => {
    try {
      const { assetListId, slideNumber } = req.params;
      const { prompt, assetType = 'motion_graphics' } = req.body;

      const assetList = await assetListDb.getById(assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      // Get all assets on this slide to calculate next asset number
      const allImages = await generatedImageDb.getByAssetList(assetListId);
      const slideAssets = allImages.filter(img =>
        img.slideNumber === parseInt(slideNumber)
      );

      const maxAssetNum = slideAssets.reduce((max, asset) => {
        return Math.max(max, asset.assetNumber || 1);
      }, 0);
      const newAssetNumber = maxAssetNum + 1;

      // Use appropriate filename generator based on asset type
      const isMGAsset = assetType.toLowerCase().includes('motion_graphics');
      const cmsFilename = isMGAsset
        ? generateMGSceneFilename(
            assetList.moduleName,
            assetList.sessionNumber,
            parseInt(slideNumber),
            newAssetNumber
          )
        : generateCmsFilename(
            assetList.moduleName,
            assetList.sessionNumber,
            { slideNumber: parseInt(slideNumber), type: assetType, assetNumber: newAssetNumber }
          );

      const characters = await characterDb.getByModule(assetList.moduleName);
      const character = characters[0];
      const slideKey = `S${assetList.sessionNumber}-${slideNumber}`;
      const hasCharacter = character && character.appearsOnSlides?.some(s =>
        s === slideKey || s === String(slideNumber)
      );

      const newAsset = await generatedImageDb.create({
        assetListId,
        slideNumber: parseInt(slideNumber),
        assetType,
        assetNumber: newAssetNumber,
        cmsFilename,
        originalPrompt: prompt || '',
        characterId: hasCharacter ? character.id : null,
        status: 'pending'
      });

      res.json({
        success: true,
        asset: newAsset,
        scene: newAsset, // Keep backward compatibility
        message: `Added ${assetType.replace(/_/g, ' ')} to slide ${slideNumber}`
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/motion-graphics/scenes/:sceneId', async (req, res) => {
    try {
      const { sceneId } = req.params;

      const scene = await generatedImageDb.getById(sceneId);
      if (!scene) {
        return res.status(404).json({ error: 'Scene not found' });
      }

      if (scene.imagePath) {
        const filename = storage.getFilenameFromUrl(scene.imagePath);
        if (filename) {
          await storage.deleteFile(BUCKETS.IMAGES, filename);
        }
      }

      await generatedImageDb.deleteByIds([sceneId]);

      res.json({
        success: true,
        deletedScene: scene,
        message: `Deleted scene from slide ${scene.slideNumber}`
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // Audio/TTS endpoints
  // ==========================================

  router.get('/voices', async (req, res) => {
    try {
      const elevenLabsService = req.app.get('elevenLabsService');
      if (!elevenLabsService || !elevenLabsService.isConfigured()) {
        return res.json([
          { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Rachel', description: 'Female, clear and articulate' },
          { voice_id: '29vD33N1CtxCmqQRPOHJ', name: 'Drew', description: 'Male, articulate and professional' },
          { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', description: 'Female, warm and engaging' },
          { voice_id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', description: 'Male, professional and clear' }
        ]);
      }

      const voices = await elevenLabsService.getVoices();
      res.json(voices);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Lightweight endpoint to check status of multiple audio records
  // Used for polling without fetching full asset list data
  router.post('/audio/status', async (req, res) => {
    try {
      const { audioIds } = req.body;
      if (!audioIds || !Array.isArray(audioIds) || audioIds.length === 0) {
        return res.json({ records: [] });
      }

      // Fetch only the requested audio records
      const records = await Promise.all(
        audioIds.map(id => generatedAudioDb.getById(id))
      );

      // Return only essential fields for status update
      const statusRecords = records
        .filter(r => r !== null)
        .map(r => ({
          id: r.id,
          status: r.status,
          audioPath: r.audioPath,
          durationMs: r.durationMs,
          updatedAt: r.updatedAt
        }));

      res.json({ records: statusRecords });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/audio/generate', async (req, res) => {
    try {
      const { audioId, text, voiceId, voiceName } = req.body;

      if (!audioId) {
        return res.status(400).json({ error: 'audioId is required' });
      }

      const audioRecord = await generatedAudioDb.getById(audioId);
      if (!audioRecord) {
        return res.status(404).json({ error: 'Audio record not found' });
      }

      const elevenLabsService = req.app.get('elevenLabsService');
      if (!elevenLabsService || !elevenLabsService.isConfigured()) {
        return res.status(503).json({ error: 'TTS service not configured. Add ELEVENLABS_API_KEY to .env file.' });
      }

      const narrationText = text || audioRecord.narrationText;
      if (!narrationText || narrationText.trim().length === 0) {
        return res.status(400).json({ error: 'No narration text provided' });
      }

      const assetList = await assetListDb.getById(audioRecord.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      const cmsFilename = generateAudioFilename(
        assetList.moduleName,
        assetList.sessionNumber,
        audioRecord.slideNumber,
        audioRecord.narrationType
      );

      await generatedAudioDb.update(audioId, {
        status: 'generating',
        narrationText,
        voiceId: voiceId || audioRecord.voiceId,
        voiceName: voiceName || audioRecord.voiceName
      });

      elevenLabsService.generateToStorage({
        text: narrationText,
        bucket: BUCKETS.AUDIO,
        filename: cmsFilename,
        voiceId: voiceId || audioRecord.voiceId
      }).then(async result => {
        await generatedAudioDb.update(audioId, {
          status: 'completed',
          audioPath: result.publicUrl,
          cmsFilename,
          durationMs: result.durationMs
        });
        console.log(`Audio generated successfully: ${cmsFilename}`);
      }).catch(async error => {
        await generatedAudioDb.update(audioId, { status: 'failed' });
        console.error(`Audio generation failed for ${audioId}:`, error.message);
      });

      res.json({
        audioId,
        status: 'generating',
        message: 'Audio generation started'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/audio/:id/upload', upload.single('audio'), async (req, res) => {
    try {
      const audioRecord = await generatedAudioDb.getById(req.params.id);
      if (!audioRecord) {
        return res.status(404).json({ error: 'Audio record not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Audio file is required' });
      }

      const assetList = await assetListDb.getById(audioRecord.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      const ext = path.extname(req.file.originalname).toLowerCase() || '.mp3';
      const cmsFilename = generateAudioFilename(
        assetList.moduleName,
        assetList.sessionNumber,
        audioRecord.slideNumber,
        audioRecord.narrationType
      ).replace(/\.mp3$/, ext);

      const uploaded = await storage.uploadFileFromPath(
        BUCKETS.AUDIO,
        cmsFilename,
        req.file.path,
        req.file.mimetype
      );

      await cleanupTempFile(req.file.path);

      const updated = await generatedAudioDb.update(req.params.id, {
        status: 'uploaded',
        audioPath: uploaded.publicUrl,
        cmsFilename
      });

      res.json({
        success: true,
        audio: updated,
        filename: cmsFilename,
        path: uploaded.publicUrl
      });
    } catch (error) {
      await cleanupTempFile(req.file?.path);
      res.status(500).json({ error: error.message });
    }
  });

  router.patch('/audio/:id', async (req, res) => {
    try {
      const { narrationText, voiceId, voiceName, narrationType } = req.body;

      const updates = {};
      if (narrationText !== undefined) updates.narrationText = narrationText;
      if (voiceId !== undefined) updates.voiceId = voiceId;
      if (voiceName !== undefined) updates.voiceName = voiceName;
      if (narrationType !== undefined) updates.narrationType = narrationType;

      const updated = await generatedAudioDb.update(req.params.id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Audio record not found' });
      }

      res.json({ success: true, audio: updated });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new audio record
  router.post('/audio/create', async (req, res) => {
    try {
      let { assetListId, assessmentAssetId, slideNumber, questionNumber, narrationType, narrationText } = req.body;

      // Validate: need either assetListId OR assessmentAssetId
      if (!assetListId && !assessmentAssetId) {
        return res.status(400).json({ error: 'Either assetListId or assessmentAssetId is required' });
      }

      // If narrationType not specified and this is an asset list, find first available type for this slide
      if (!narrationType && assetListId) {
        const existingAudio = await generatedAudioDb.getByAssetList(assetListId);
        const slideNum = parseInt(slideNumber, 10);
        const existingTypes = existingAudio
          .filter(a => parseInt(a.slideNumber, 10) === slideNum)
          .map(a => a.narrationType);

        const availableTypes = ['slide_narration', 'popup_1', 'popup_2', 'popup_3', 'popup_4', 'popup_5', 'popup_6', 'scenario', 'questions', 'answers'];
        narrationType = availableTypes.find(t => !existingTypes.includes(t)) || 'slide_narration';
      }

      // If narrationType not specified and this is an assessment, find first available type for this question
      if (!narrationType && assessmentAssetId) {
        const existingAudio = await generatedAudioDb.getByAssessmentAsset(assessmentAssetId);
        const qNum = parseInt(questionNumber, 10);
        const existingTypes = existingAudio
          .filter(a => parseInt(a.questionNumber, 10) === qNum)
          .map(a => a.narrationType);

        const availableTypes = [
          'slide_narration', 'question',
          'answer_a', 'answer_b', 'answer_c', 'answer_d', 'answer_e', 'answer_f',
          'correct_response', 'incorrect_1', 'incorrect_2'
        ];
        narrationType = availableTypes.find(t => !existingTypes.includes(t)) || 'slide_narration';
      }

      // Generate CMS filename based on parent type
      let cmsFilename = null;
      let parentRecord = null;

      if (assessmentAssetId) {
        parentRecord = await assessmentAssetDb.getById(assessmentAssetId);
        if (!parentRecord) {
          return res.status(404).json({ error: 'Assessment not found' });
        }
        cmsFilename = generateAssessmentAudioFilename(
          parentRecord.moduleName,
          parentRecord.assessmentType,
          questionNumber,
          narrationType
        );
      } else if (assetListId) {
        parentRecord = await assetListDb.getById(assetListId);
        if (!parentRecord) {
          return res.status(404).json({ error: 'Asset list not found' });
        }
        // Use RCP filename for multi-part, regular for single
        if (narrationType && narrationType !== 'slide_narration') {
          cmsFilename = generateRcpAudioFilename(
            parentRecord.moduleName,
            parentRecord.sessionNumber,
            slideNumber,
            narrationType
          );
        } else {
          cmsFilename = generateAudioFilename(
            parentRecord.moduleName,
            parentRecord.sessionNumber,
            slideNumber
          );
        }
      }

      const audioRecord = await generatedAudioDb.create({
        assetListId,
        assessmentAssetId,
        slideNumber,
        questionNumber,
        narrationType: narrationType || 'slide_narration',
        narrationText: narrationText || '',
        status: 'pending',
        voiceId: parentRecord?.defaultVoiceId || null,
        voiceName: parentRecord?.defaultVoiceName || null,
        cmsFilename
      });

      res.json({ success: true, audio: audioRecord });
    } catch (error) {
      console.error('[audio/create] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete an audio record
  router.delete('/audio/:id', async (req, res) => {
    try {
      const audioRecord = await generatedAudioDb.getById(req.params.id);
      if (!audioRecord) {
        return res.status(404).json({ error: 'Audio record not found' });
      }

      // Delete audio file from Supabase storage if exists
      if (audioRecord.audioPath) {
        try {
          // Extract the path from the full URL
          const url = audioRecord.audioPath;
          if (url.includes(BUCKETS.AUDIO)) {
            const pathMatch = url.match(new RegExp(`${BUCKETS.AUDIO}/(.+)$`));
            if (pathMatch) {
              const filePath = pathMatch[1];
              await storage.deleteFile(BUCKETS.AUDIO, filePath);
            }
          }
        } catch (storageError) {
          console.error('Failed to delete audio file from storage:', storageError.message);
          // Continue with database deletion even if storage deletion fails
        }
      }

      // Delete database record
      const deleted = await generatedAudioDb.delete(req.params.id);
      res.json({ success: true, deleted: !!deleted });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/audio/:id/regenerate', async (req, res) => {
    try {
      const { text, voiceId, voiceName } = req.body;

      const audioRecord = await generatedAudioDb.getById(req.params.id);
      if (!audioRecord) {
        return res.status(404).json({ error: 'Audio record not found' });
      }

      const elevenLabsService = req.app.get('elevenLabsService');
      if (!elevenLabsService || !elevenLabsService.isConfigured()) {
        return res.status(503).json({ error: 'TTS service not configured' });
      }

      const narrationText = text || audioRecord.narrationText;
      if (!narrationText || narrationText.trim().length === 0) {
        return res.status(400).json({ error: 'No narration text provided' });
      }

      // Get filename based on whether it's assessment or asset list audio
      let cmsFilename = audioRecord.cmsFilename;
      let parentRecord = null;

      if (audioRecord.assessmentAssetId) {
        parentRecord = await assessmentAssetDb.getById(audioRecord.assessmentAssetId);
        if (!parentRecord) {
          return res.status(404).json({ error: 'Assessment not found' });
        }
        cmsFilename = cmsFilename || generateAssessmentAudioFilename(
          parentRecord.moduleName,
          parentRecord.assessmentType,
          audioRecord.questionNumber,
          audioRecord.narrationType
        );
      } else if (audioRecord.assetListId) {
        parentRecord = await assetListDb.getById(audioRecord.assetListId);
        if (!parentRecord) {
          return res.status(404).json({ error: 'Asset list not found' });
        }
        // Use RCP filename for multi-part, regular for single
        if (audioRecord.narrationType && audioRecord.narrationType !== 'slide_narration') {
          cmsFilename = cmsFilename || generateRcpAudioFilename(
            parentRecord.moduleName,
            parentRecord.sessionNumber,
            audioRecord.slideNumber,
            audioRecord.narrationType
          );
        } else {
          cmsFilename = cmsFilename || generateAudioFilename(
            parentRecord.moduleName,
            parentRecord.sessionNumber,
            audioRecord.slideNumber
          );
        }
      } else {
        return res.status(400).json({ error: 'Audio record has no parent (assessment or asset list)' });
      }

      await generatedAudioDb.update(req.params.id, {
        status: 'generating',
        narrationText,
        voiceId: voiceId || audioRecord.voiceId,
        voiceName: voiceName || audioRecord.voiceName
      });

      elevenLabsService.generateToStorage({
        text: narrationText,
        bucket: BUCKETS.AUDIO,
        filename: cmsFilename,
        voiceId: voiceId || audioRecord.voiceId
      }).then(async result => {
        await generatedAudioDb.update(req.params.id, {
          status: 'completed',
          audioPath: result.publicUrl,
          cmsFilename,
          durationMs: result.durationMs
        });
        console.log(`Audio regenerated successfully: ${cmsFilename}`);
      }).catch(async error => {
        await generatedAudioDb.update(req.params.id, { status: 'failed' });
        console.error(`Audio regeneration failed for ${req.params.id}:`, error.message);
      });

      res.json({
        audioId: req.params.id,
        status: 'generating',
        message: 'Audio regeneration started'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch('/asset-lists/:id/voice', async (req, res) => {
    try {
      const { voiceId, voiceName } = req.body;

      const assetList = await assetListDb.getById(req.params.id);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      await assetListDb.update(req.params.id, {
        defaultVoiceId: voiceId,
        defaultVoiceName: voiceName
      });

      const updated = await assetListDb.getById(req.params.id);
      res.json({ success: true, assetList: updated });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/asset-lists/:id/audio', async (req, res) => {
    try {
      const assetList = await assetListDb.getById(req.params.id);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      const audioRecords = await generatedAudioDb.getByAssetList(req.params.id);
      res.json(audioRecords);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // Assessment Assets endpoints (Pre-Test/Post-Test)
  // ==========================================

  // Receive assessment data from Carl v7
  router.post('/assessment-assets', async (req, res) => {
    try {
      const { moduleName, assessmentType, subject, gradeLevel, questions, assetSummary } = req.body;

      // Validate required fields
      if (!moduleName) {
        return res.status(400).json({ error: 'moduleName is required' });
      }
      if (!assessmentType || !['pre_test', 'post_test'].includes(assessmentType)) {
        return res.status(400).json({ error: 'assessmentType must be "pre_test" or "post_test"' });
      }
      if (!questions || !Array.isArray(questions)) {
        return res.status(400).json({ error: 'questions array is required' });
      }

      // Check for existing assessment (upsert logic)
      let assessment = await assessmentAssetDb.getByModuleAndType(moduleName, assessmentType);
      let isUpdate = false;
      let existingImages = [];

      if (assessment) {
        // Update existing assessment
        isUpdate = true;
        existingImages = await generatedImageDb.getByAssessmentAsset(assessment.id);
        assessment = await assessmentAssetDb.update(assessment.id, {
          subject: subject || assessment.subject,
          gradeLevel: gradeLevel || assessment.gradeLevel,
          questions,
          assetSummary: assetSummary || {}
        });
      } else {
        // Create new assessment
        assessment = await assessmentAssetDb.create({
          moduleName,
          assessmentType,
          subject: subject || 'science',
          gradeLevel: gradeLevel || '7',
          questions,
          assetSummary: assetSummary || {}
        });
      }

      // Build map of existing images by question number + visual type
      const existingByKey = {};
      existingImages.forEach(img => {
        const key = `${img.slideNumber}-${img.assetType}`;
        existingByKey[key] = img;
      });

      // Build set of new question keys (questions with visuals)
      const questionsWithVisuals = questions.filter(q => q.visual);
      const newKeys = new Set(
        questionsWithVisuals.map(q => `${q.questionNumber}-${getAssessmentAssetType(assessmentType, q.visual.type)}`)
      );

      // Find images to delete (questions that were removed or no longer have visuals)
      const imagesToDelete = existingImages.filter(img => {
        const key = `${img.slideNumber}-${img.assetType}`;
        return !newKeys.has(key);
      });

      // Delete orphaned images
      if (imagesToDelete.length > 0) {
        await generatedImageDb.deleteByIds(imagesToDelete.map(img => img.id));
      }

      // Process each question with a visual
      const generatedImages = [];
      let created = 0;
      let kept = 0;

      for (const question of questionsWithVisuals) {
        const assetType = getAssessmentAssetType(assessmentType, question.visual.type);
        const key = `${question.questionNumber}-${assetType}`;
        const existing = existingByKey[key];

        const cmsFilename = generateAssessmentCmsFilename(
          moduleName,
          assessmentType,
          question.questionNumber,
          question.visual.type
        );

        // Build prompt from visual description
        const prompt = buildAssessmentVisualPrompt(question);

        if (existing) {
          // Update existing image record
          await generatedImageDb.update(existing.id, {
            originalPrompt: prompt,
            cmsFilename
          });
          generatedImages.push({ ...existing, originalPrompt: prompt, cmsFilename });
          kept++;
        } else {
          // Create new pending record
          const image = await generatedImageDb.create({
            assessmentAssetId: assessment.id,
            slideNumber: question.questionNumber,
            assetType,
            assetNumber: 1,
            cmsFilename,
            originalPrompt: prompt,
            status: 'pending'
          });
          generatedImages.push(image);
          created++;
        }
      }

      // Process audio for each question
      // Create multi-part audio records (question, answers, correct/incorrect responses)
      let audioCreated = 0;
      let audioKept = 0;

      // Helper to upsert assessment audio record
      const upsertAssessmentAudio = async (assessmentId, qNum, narrationType, text) => {
        if (!text || !text.trim()) return false;
        const existingRecords = await generatedAudioDb.getByAssessmentQuestion(assessmentId, qNum);
        const existing = existingRecords.find(r => r.narrationType === narrationType);
        if (existing) {
          if (existing.narrationText !== text) {
            await generatedAudioDb.update(existing.id, { narrationText: text });
          }
          audioKept++;
        } else {
          await generatedAudioDb.create({
            assessmentAssetId: assessmentId,
            questionNumber: qNum,
            narrationType,
            narrationText: text,
            cmsFilename: generateAssessmentAudioFilename(moduleName, assessmentType, qNum, narrationType),
            status: 'pending'
          });
          audioCreated++;
        }
        return true;
      };

      for (const question of questions) {
        const qNum = question.questionNumber || (questions.indexOf(question) + 1);

        if (question.questionType === 'two_part') {
          // Handle two-part questions with partA and partB
          const partA = question.partA || {};
          const partB = question.partB || {};

          // Part A question: use structuredNarration.question (preferred) or fall back to stem
          const partAQuestion = partA.structuredNarration?.question || partA.stem;
          if (partAQuestion) {
            await upsertAssessmentAudio(assessment.id, qNum, 'part_a_question', partAQuestion);
          }

          // Part A answer choices: use structuredNarration.answerChoices (preferred) or fall back to choices
          const partAChoices = partA.structuredNarration?.answerChoices || partA.choices || [];
          for (const choice of partAChoices) {
            if (choice.label && choice.text) {
              const narrationType = `part_a_answer_${choice.label.toLowerCase()}`;
              await upsertAssessmentAudio(assessment.id, qNum, narrationType, choice.text);
            }
          }

          // Part B question: use structuredNarration.question (preferred) or fall back to stem
          const partBQuestion = partB.structuredNarration?.question || partB.stem;
          if (partBQuestion) {
            await upsertAssessmentAudio(assessment.id, qNum, 'part_b_question', partBQuestion);
          }

          // Part B answer choices: use structuredNarration.answerChoices (preferred) or fall back to choices
          const partBChoices = partB.structuredNarration?.answerChoices || partB.choices || [];
          for (const choice of partBChoices) {
            if (choice.label && choice.text) {
              const narrationType = `part_b_answer_${choice.label.toLowerCase()}`;
              await upsertAssessmentAudio(assessment.id, qNum, narrationType, choice.text);
            }
          }

          // Feedback text from narration field (still parse for backward compatibility)
          const narration = question.narration || '';
          const feedbackParts = parseNarrationText(narration, '');
          await upsertAssessmentAudio(assessment.id, qNum, 'correct_response', feedbackParts.correctResponse);
          await upsertAssessmentAudio(assessment.id, qNum, 'incorrect_1', feedbackParts.incorrect1);
          await upsertAssessmentAudio(assessment.id, qNum, 'incorrect_2', feedbackParts.incorrect2);

        } else if (question.structuredNarration) {
          // Carl v7 format: use structuredNarration.question and structuredNarration.answerChoices
          // NOTE: Do NOT use leadIn - it contains junk data
          const questionText = question.structuredNarration.question;
          if (questionText) {
            await upsertAssessmentAudio(assessment.id, qNum, 'question', questionText);
          }

          // Answer choices from structuredNarration.answerChoices
          const answerChoices = question.structuredNarration.answerChoices || [];
          for (const choice of answerChoices) {
            if (choice.label && choice.text) {
              const narrationType = `answer_${choice.label.toLowerCase()}`;
              await upsertAssessmentAudio(assessment.id, qNum, narrationType, choice.text);
            }
          }

          // Feedback text from narration field (still parse for backward compatibility)
          const narration = question.narration || '';
          const feedbackParts = parseNarrationText(narration, '');
          await upsertAssessmentAudio(assessment.id, qNum, 'correct_response', feedbackParts.correctResponse);
          await upsertAssessmentAudio(assessment.id, qNum, 'incorrect_1', feedbackParts.incorrect1);
          await upsertAssessmentAudio(assessment.id, qNum, 'incorrect_2', feedbackParts.incorrect2);

        } else if (question.choices && question.choices.length > 0) {
          // Legacy format: Use pre-structured data for stem/choices (single_select format)
          // Combine scenario + stem for question narration
          const questionParts = [question.scenario, question.stem].filter(Boolean);
          if (questionParts.length > 0) {
            await upsertAssessmentAudio(assessment.id, qNum, 'question', questionParts.join(' '));
          }

          // Answer choices from structured array
          for (const choice of question.choices) {
            if (choice.label && choice.text) {
              const narrationType = `answer_${choice.label.toLowerCase()}`;
              await upsertAssessmentAudio(assessment.id, qNum, narrationType, choice.text);
            }
          }

          // Feedback text from narration field (still parse for backward compatibility)
          const narration = question.narration || '';
          const feedbackParts = parseNarrationText(narration, '');
          await upsertAssessmentAudio(assessment.id, qNum, 'correct_response', feedbackParts.correctResponse);
          await upsertAssessmentAudio(assessment.id, qNum, 'incorrect_1', feedbackParts.incorrect1);
          await upsertAssessmentAudio(assessment.id, qNum, 'incorrect_2', feedbackParts.incorrect2);

        } else {
          // FALLBACK: Legacy parsing for backward compatibility
          const narration = question.narration || '';
          const onscreenText = question.onscreen_text || question.scenario || '';
          const parts = parseNarrationText(narration, onscreenText);

          // Create audio record for question
          await upsertAssessmentAudio(assessment.id, qNum, 'question', parts.question);

          // Create audio records for each answer choice
          for (const answer of parts.answers) {
            const narrationType = `answer_${answer.letter.toLowerCase()}`;
            await upsertAssessmentAudio(assessment.id, qNum, narrationType, answer.text);
          }

          // Create audio records for feedback responses
          await upsertAssessmentAudio(assessment.id, qNum, 'correct_response', parts.correctResponse);
          await upsertAssessmentAudio(assessment.id, qNum, 'incorrect_1', parts.incorrect1);
          await upsertAssessmentAudio(assessment.id, qNum, 'incorrect_2', parts.incorrect2);
        }
      }

      const assessmentLabel = assessmentType === 'pre_test' ? 'Pre-Test' : 'Post-Test';
      const action = isUpdate ? 'Updated' : 'Created';
      const audioNote = (audioCreated + audioKept) > 0 ? `, ${audioCreated + audioKept} audio parts` : '';
      const details = isUpdate
        ? `${kept} kept, ${created} added, ${imagesToDelete.length} removed${audioNote}`
        : `${created} image records${audioNote}`;

      res.json({
        assessmentAsset: {
          id: assessment.id,
          moduleName: assessment.moduleName,
          assessmentType: assessment.assessmentType,
          subject: assessment.subject,
          gradeLevel: assessment.gradeLevel
        },
        generatedImages,
        message: `${action} ${moduleName} ${assessmentLabel}: ${details}`
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // List all assessment assets
  router.get('/assessment-assets', async (req, res) => {
    try {
      const { moduleName } = req.query;
      let assessments;

      if (moduleName) {
        assessments = await assessmentAssetDb.getByModule(moduleName);
      } else {
        assessments = await assessmentAssetDb.getAll();
      }

      res.json(assessments);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single assessment asset with its generated images and audio
  router.get('/assessment-assets/:id', async (req, res) => {
    try {
      const assessment = await assessmentAssetDb.getById(req.params.id);
      if (!assessment) {
        return res.status(404).json({ error: 'Assessment asset not found' });
      }

      const generatedImages = await generatedImageDb.getByAssessmentAsset(assessment.id);
      const generatedAudio = await generatedAudioDb.getByAssessmentAsset(assessment.id);

      res.json({
        ...assessment,
        generatedImages,
        generatedAudio
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete assessment asset
  router.delete('/assessment-assets/:id', async (req, res) => {
    try {
      const images = await generatedImageDb.getByAssessmentAsset(req.params.id);
      if (images.length > 0) {
        await generatedImageDb.deleteByIds(images.map(img => img.id));
      }

      // Also delete associated audio records
      await generatedAudioDb.deleteByAssessmentAsset(req.params.id);

      const deleted = await assessmentAssetDb.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Assessment asset not found' });
      }
      res.json({ success: true, deletedImages: images.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Set default voice for assessment
  router.patch('/assessment-assets/:id/voice', async (req, res) => {
    try {
      const { voiceId, voiceName } = req.body;
      await assessmentAssetDb.update(req.params.id, {
        defaultVoiceId: voiceId,
        defaultVoiceName: voiceName
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Error setting assessment default voice:', error);
      res.status(500).json({ error: 'Failed to set default voice' });
    }
  });

  // Get all audio for an assessment
  router.get('/assessment-assets/:id/audio', async (req, res) => {
    try {
      const assessment = await assessmentAssetDb.getById(req.params.id);
      if (!assessment) {
        return res.status(404).json({ error: 'Assessment asset not found' });
      }

      const audioRecords = await generatedAudioDb.getByAssessmentAsset(req.params.id);
      res.json(audioRecords);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate audio for a specific assessment question part
  router.post('/audio/generate-assessment', async (req, res) => {
    try {
      const { audioId, text, voiceId, voiceName } = req.body;

      if (!audioId) {
        return res.status(400).json({ error: 'audioId is required' });
      }

      const audioRecord = await generatedAudioDb.getById(audioId);
      if (!audioRecord) {
        return res.status(404).json({ error: 'Audio record not found' });
      }

      const elevenLabsService = req.app.get('elevenLabsService');
      if (!elevenLabsService || !elevenLabsService.isConfigured()) {
        return res.status(503).json({ error: 'TTS service not configured. Add ELEVENLABS_API_KEY to .env file.' });
      }

      const narrationText = text || audioRecord.narrationText;
      if (!narrationText || narrationText.trim().length === 0) {
        return res.status(400).json({ error: 'No narration text provided' });
      }

      // Get filename based on whether it's assessment or asset list audio
      let cmsFilename = audioRecord.cmsFilename;
      if (!cmsFilename) {
        if (audioRecord.assessmentAssetId) {
          const assessment = await assessmentAssetDb.getById(audioRecord.assessmentAssetId);
          if (assessment) {
            cmsFilename = generateAssessmentAudioFilename(
              assessment.moduleName,
              assessment.assessmentType,
              audioRecord.questionNumber,
              audioRecord.narrationType
            );
          }
        } else if (audioRecord.assetListId) {
          const assetList = await assetListDb.getById(audioRecord.assetListId);
          if (assetList) {
            cmsFilename = generateRcpAudioFilename(
              assetList.moduleName,
              assetList.sessionNumber,
              audioRecord.slideNumber,
              audioRecord.narrationType
            );
          }
        }
      }

      await generatedAudioDb.update(audioId, {
        status: 'generating',
        narrationText,
        voiceId: voiceId || audioRecord.voiceId,
        voiceName: voiceName || audioRecord.voiceName,
        cmsFilename
      });

      elevenLabsService.generateToStorage({
        text: narrationText,
        bucket: BUCKETS.AUDIO,
        filename: cmsFilename,
        voiceId: voiceId || audioRecord.voiceId
      }).then(async result => {
        await generatedAudioDb.update(audioId, {
          status: 'completed',
          audioPath: result.publicUrl,
          cmsFilename,
          durationMs: result.durationMs
        });
        console.log(`Audio generated successfully: ${cmsFilename}`);
      }).catch(async error => {
        await generatedAudioDb.update(audioId, { status: 'failed' });
        console.error(`Audio generation failed for ${audioId}:`, error.message);
      });

      res.json({
        audioId,
        status: 'generating',
        message: 'Audio generation started'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Bulk generate all pending audio for a question
  router.post('/audio/generate-bulk', async (req, res) => {
    try {
      const { assessmentAssetId, assetListId, questionNumber, slideNumber, voiceId } = req.body;

      const elevenLabsService = req.app.get('elevenLabsService');
      if (!elevenLabsService || !elevenLabsService.isConfigured()) {
        return res.status(503).json({ error: 'TTS service not configured. Add ELEVENLABS_API_KEY to .env file.' });
      }

      let audioRecords = [];
      let moduleName, sessionNumber, assessmentType;

      if (assessmentAssetId && questionNumber !== undefined) {
        // Assessment audio
        const assessment = await assessmentAssetDb.getById(assessmentAssetId);
        if (!assessment) {
          return res.status(404).json({ error: 'Assessment not found' });
        }
        moduleName = assessment.moduleName;
        assessmentType = assessment.assessmentType;
        audioRecords = await generatedAudioDb.getByAssessmentQuestion(assessmentAssetId, questionNumber);
      } else if (assetListId && slideNumber !== undefined) {
        // RCP slide audio
        const assetList = await assetListDb.getById(assetListId);
        if (!assetList) {
          return res.status(404).json({ error: 'Asset list not found' });
        }
        moduleName = assetList.moduleName;
        sessionNumber = assetList.sessionNumber;
        audioRecords = await generatedAudioDb.getAllByAssetListAndSlide(assetListId, slideNumber);
      } else {
        return res.status(400).json({ error: 'Either (assessmentAssetId, questionNumber) or (assetListId, slideNumber) required' });
      }

      // Filter to pending records only
      const pendingRecords = audioRecords.filter(r => r.status === 'pending');

      if (pendingRecords.length === 0) {
        return res.json({
          message: 'No pending audio to generate',
          generated: 0
        });
      }

      // Start generation for all pending records
      let startedCount = 0;
      for (const record of pendingRecords) {
        if (!record.narrationText || record.narrationText.trim().length === 0) {
          continue;
        }

        // Generate CMS filename
        let cmsFilename = record.cmsFilename;
        if (!cmsFilename) {
          if (assessmentAssetId) {
            cmsFilename = generateAssessmentAudioFilename(moduleName, assessmentType, questionNumber, record.narrationType);
          } else {
            cmsFilename = generateRcpAudioFilename(moduleName, sessionNumber, slideNumber, record.narrationType);
          }
        }

        await generatedAudioDb.update(record.id, {
          status: 'generating',
          voiceId: voiceId || record.voiceId,
          cmsFilename
        });

        // Start async generation
        elevenLabsService.generateToStorage({
          text: record.narrationText,
          bucket: BUCKETS.AUDIO,
          filename: cmsFilename,
          voiceId: voiceId || record.voiceId
        }).then(async result => {
          await generatedAudioDb.update(record.id, {
            status: 'completed',
            audioPath: result.publicUrl,
            durationMs: result.durationMs
          });
          console.log(`Bulk audio generated: ${cmsFilename}`);
        }).catch(async error => {
          await generatedAudioDb.update(record.id, { status: 'failed' });
          console.error(`Bulk audio generation failed for ${record.id}:`, error.message);
        });

        startedCount++;
      }

      res.json({
        message: `Started generation for ${startedCount} audio files`,
        generated: startedCount,
        audioIds: pendingRecords.map(r => r.id)
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // CMS Sync endpoints
  // ==========================================

  const { cmsClient } = require('../services/cmsClient');

  // Check if CMS is available
  router.get('/cms/status', async (req, res) => {
    try {
      res.json({ available: cmsClient.isAvailable() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Fetch sync comparison data for an asset list
  router.post('/cms/sync/:assetListId/fetch', async (req, res) => {
    try {
      const assetList = await assetListDb.getById(req.params.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      if (!cmsClient.isAvailable()) {
        return res.status(503).json({ error: 'CMS not configured. Add DIRECTUS_API_URL and DIRECTUS_API_TOKEN to .env file.' });
      }

      // Fetch pages from CMS
      const cmsPages = await cmsClient.getSessionPages(
        assetList.moduleName,
        assetList.sessionNumber,
        assetList.sessionType
      );

      // Get current NOLA.vids slides with their asset status
      const slides = assetList.slides || [];
      const generatedImages = await generatedImageDb.getByAssetList(assetList.id);
      const generatedAudio = await generatedAudioDb.getByAssetList(assetList.id);

      // Build NOLA.vids slides data with narration text for matching
      // For RCP sessions, use the 'question' narration type for comparison
      // For regular sessions, use 'slide_narration' or the first available
      const isRcp = assetList.sessionType === 'rcp';

      const nolaSlides = slides.map(slide => {
        const slideNum = slide.slideNumber ?? slide.slide_number;
        const hasImage = generatedImages.some(img => img.slideNumber === slideNum);
        const slideAudioRecords = generatedAudio.filter(a => a.slideNumber === slideNum);
        const hasAudio = slideAudioRecords.length > 0;

        // Find the appropriate audio record for comparison
        let audioRecord;
        if (isRcp) {
          // For RCP: use 'question' or 'questions' narration type
          audioRecord = slideAudioRecords.find(a =>
            a.narrationType === 'question' || a.narrationType === 'questions'
          );
        } else {
          // For regular sessions: use 'slide_narration', or 'question' for structured slides, or first available
          audioRecord = slideAudioRecords.find(a => a.narrationType === 'slide_narration')
                       || slideAudioRecords.find(a => a.narrationType === 'question')
                       || slideAudioRecords[0];
        }

        // Get narration text from the slide data or the audio record
        const narrationText = slide.narrationText || slide.narration_text ||
                             (audioRecord ? audioRecord.narrationText : '') || '';
        return {
          slideNumber: slideNum,
          title: slide.slideTitle || slide.slide_title || slide.title || '',
          narrationText,
          hasImage,
          hasAudio
        };
      });

      // Compare slides
      const comparison = cmsClient.compareSlides(cmsPages, nolaSlides);

      // Auto-save pageIds for matched slides to cmsPageMapping
      // This enables Push buttons for slides that matched
      const cmsPageMapping = assetList.cmsPageMapping || {};
      let mappingUpdated = false;

      // Save exact matches
      for (const match of comparison.matched) {
        const slideKey = String(match.nolaSlideNumber);
        if (match.pageId && !cmsPageMapping[slideKey]) {
          cmsPageMapping[slideKey] = match.pageId;
          mappingUpdated = true;
        }
      }

      // Save narration mismatches (still matched by similarity, just have text differences)
      for (const match of comparison.narrationMismatches) {
        const slideKey = String(match.nolaSlideNumber);
        if (match.pageId && !cmsPageMapping[slideKey]) {
          cmsPageMapping[slideKey] = match.pageId;
          mappingUpdated = true;
        }
      }

      // Persist the updated mapping
      if (mappingUpdated) {
        await assetListDb.updateCmsPageMapping(assetList.id, cmsPageMapping);
        console.log(`[cms/sync/fetch] Auto-saved ${Object.keys(cmsPageMapping).length} page mappings`);
      }

      res.json({
        cmsPages,
        nolaSlides,
        matched: comparison.matched,
        narrationMismatches: comparison.narrationMismatches,
        cmsOnly: comparison.cmsOnly,
        nolaOnly: comparison.nolaOnly,
        mappingSaved: mappingUpdated
      });
    } catch (error) {
      console.error('[cms/sync/fetch] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Add a slide from CMS to NOLA.vids
  router.post('/cms/sync/:assetListId/add-slide', async (req, res) => {
    try {
      const { slideNumber, cmsPageId } = req.body;

      if (!slideNumber || !cmsPageId) {
        return res.status(400).json({ error: 'slideNumber and cmsPageId are required' });
      }

      const assetList = await assetListDb.getById(req.params.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      if (!cmsClient.isAvailable()) {
        return res.status(503).json({ error: 'CMS not configured' });
      }

      // Fetch page details from CMS
      const pageDetails = await cmsClient.getPageDetails(cmsPageId);

      // Add slide to asset list
      const updatedAssetList = await assetListDb.addSlide(req.params.assetListId, {
        slideNumber,
        title: pageDetails.title,
        slideType: pageDetails.slideType,
        narrationText: pageDetails.narrationText,
        cmsPageId
      });

      // Create or update generated_audio record with narration text
      const moduleCode = getModuleCode(assetList.moduleName);
      const audioCmsFilename = `MOD.${moduleCode}.${assetList.sessionNumber}.${slideNumber}.NAR1.mp3`;

      // Check if audio record already exists for this slide
      const existingAudio = await generatedAudioDb.getByAssetListSlideAndType(assetList.id, slideNumber, 'slide_narration');
      if (existingAudio) {
        // Update existing record
        await generatedAudioDb.update(existingAudio.id, {
          narrationText: pageDetails.narrationText || '',
          cmsFilename: audioCmsFilename,
          voiceId: assetList.defaultVoiceId,
          voiceName: assetList.defaultVoiceName
        });
      } else {
        // Create new record
        await generatedAudioDb.create({
          assetListId: assetList.id,
          slideNumber,
          narrationType: 'slide_narration',
          narrationText: pageDetails.narrationText || '',
          cmsFilename: audioCmsFilename,
          voiceId: assetList.defaultVoiceId,
          voiceName: assetList.defaultVoiceName,
          status: 'pending'
        });
      }

      // Create generated_image placeholder if slide type indicates media needed
      const slideType = (pageDetails.slideType || '').toLowerCase();
      if (slideType.includes('image') || slideType.includes('video') || slideType.includes('media')) {
        const imageCmsFilename = generateCmsFilename(assetList.moduleName, assetList.sessionNumber, {
          slideNumber,
          type: 'image'
        });

        await generatedImageDb.create({
          assetListId: assetList.id,
          slideNumber,
          assetType: 'image',
          assetNumber: 1,
          cmsFilename: imageCmsFilename,
          originalPrompt: '',
          status: 'pending'
        });
      }

      res.json({
        success: true,
        message: `Added slide ${slideNumber} from CMS`,
        assetList: updatedAssetList
      });
    } catch (error) {
      console.error('[cms/sync/add-slide] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a slide from NOLA.vids (and its associated assets)
  router.post('/cms/sync/:assetListId/delete-slide', async (req, res) => {
    try {
      const { slideNumber } = req.body;

      if (slideNumber === undefined) {
        return res.status(400).json({ error: 'slideNumber is required' });
      }

      const assetList = await assetListDb.getById(req.params.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      // Delete associated generated_images
      const deletedImages = await generatedImageDb.deleteByAssetListAndSlide(assetList.id, slideNumber);

      // Delete image files from storage
      for (const img of deletedImages) {
        if (img.imagePath) {
          try {
            const filename = storage.getFilenameFromUrl(img.imagePath);
            if (filename) {
              await storage.deleteFile(BUCKETS.IMAGES, filename);
            }
          } catch (err) {
            console.error('Failed to delete image file:', err.message);
          }
        }
      }

      // Delete associated generated_audio
      const deletedAudio = await generatedAudioDb.deleteByAssetListAndSlide(assetList.id, slideNumber);

      // Delete audio files from storage
      for (const audio of deletedAudio) {
        if (audio.audioPath) {
          try {
            const filename = storage.getFilenameFromUrl(audio.audioPath);
            if (filename) {
              await storage.deleteFile(BUCKETS.AUDIO, filename);
            }
          } catch (err) {
            console.error('Failed to delete audio file:', err.message);
          }
        }
      }

      // Delete associated motion_graphics_videos
      const deletedMgVideo = await mgVideoDb.deleteByAssetListAndSlide(assetList.id, slideNumber);

      // Delete MG video file from storage
      if (deletedMgVideo?.videoPath) {
        try {
          const filename = storage.getFilenameFromUrl(deletedMgVideo.videoPath);
          if (filename) {
            await storage.deleteFile(BUCKETS.MG_VIDEOS, filename);
          }
        } catch (err) {
          console.error('Failed to delete MG video file:', err.message);
        }
      }

      // Remove slide from slides_json
      const updatedAssetList = await assetListDb.removeSlide(req.params.assetListId, slideNumber);

      res.json({
        success: true,
        message: `Deleted slide ${slideNumber}`,
        deletedImages: deletedImages.length,
        deletedAudio: deletedAudio.length,
        deletedMgVideo: deletedMgVideo ? 1 : 0,
        assetList: updatedAssetList
      });
    } catch (error) {
      console.error('[cms/sync/delete-slide] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Update narration text from CMS (for mismatched slides)
  router.post('/cms/sync/:assetListId/update-narration', async (req, res) => {
    try {
      const { slideNumber, narrationText, pageId } = req.body;

      if (slideNumber === undefined || !narrationText) {
        return res.status(400).json({ error: 'slideNumber and narrationText are required' });
      }

      const assetList = await assetListDb.getById(req.params.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      // Update narration text in slides_json
      const slides = assetList.slides || [];
      const slideIndex = slides.findIndex(s => (s.slideNumber ?? s.slide_number) === slideNumber);

      if (slideIndex !== -1) {
        slides[slideIndex].narrationText = narrationText;
        slides[slideIndex].narration_text = narrationText;

        // Update the slides_json in the database
        // Note: assetListDb.update expects 'slides' key, not 'slides_json'
        await assetListDb.update(assetList.id, { slides: slides });
      }

      // Update narration text in generated_audio record
      // For RCP sessions, update the 'question' type; for regular sessions, use 'slide_narration'
      const isRcp = assetList.sessionType === 'rcp';
      const audioRecords = await generatedAudioDb.getByAssetList(assetList.id);
      const slideAudioRecords = audioRecords.filter(a => a.slideNumber === slideNumber);

      let audioRecord;
      if (isRcp) {
        audioRecord = slideAudioRecords.find(a =>
          a.narrationType === 'question' || a.narrationType === 'questions'
        );
      } else {
        audioRecord = slideAudioRecords.find(a => a.narrationType === 'slide_narration')
                     || slideAudioRecords[0];
      }

      if (audioRecord) {
        // Update the audio record - set status back to pending since narration changed
        // Note: generatedAudioDb.update expects camelCase keys
        await generatedAudioDb.update(audioRecord.id, {
          narrationText: narrationText,
          status: 'pending', // Reset to pending so TTS gets regenerated
          audioPath: null    // Clear old audio
        });
      }

      // Update CMS page mapping if pageId provided
      if (pageId) {
        const cmsPageMapping = assetList.cmsPageMapping || {};
        cmsPageMapping[String(slideNumber)] = pageId;
        await assetListDb.updateCmsPageMapping(assetList.id, cmsPageMapping);
      }

      console.log(`[cms/sync/update-narration] Updated slide ${slideNumber} narration`);

      res.json({
        success: true,
        message: `Updated narration for slide ${slideNumber}`,
        slideNumber
      });
    } catch (error) {
      console.error('[cms/sync/update-narration] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Renumber slides with an offset (e.g., offset=-5 shifts slide 28→23, 29→24, etc.)
  // Optional: minSlide/maxSlide to only affect slides in a range
  router.post('/cms/sync/:assetListId/renumber-slides', async (req, res) => {
    try {
      const { offset, minSlide, maxSlide } = req.body;

      if (offset === undefined || typeof offset !== 'number') {
        return res.status(400).json({ error: 'offset is required and must be a number' });
      }

      const assetList = await assetListDb.getById(req.params.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      // Helper to check if a slide number is in range
      const inRange = (num) => {
        if (minSlide !== undefined && num < minSlide) return false;
        if (maxSlide !== undefined && num > maxSlide) return false;
        return true;
      };

      console.log(`[cms/sync/renumber-slides] Renumbering slides for ${assetList.sessionName} with offset ${offset}${minSlide !== undefined ? ` (min: ${minSlide})` : ''}${maxSlide !== undefined ? ` (max: ${maxSlide})` : ''}`);

      // 1. Update slides_json
      const slides = assetList.slides || [];
      let slidesUpdatedCount = 0;
      const updatedSlides = slides.map(s => {
        const currentNum = s.slideNumber ?? s.slide_number;
        if (inRange(currentNum)) {
          slidesUpdatedCount++;
          return {
            ...s,
            slideNumber: currentNum + offset,
            slide_number: currentNum + offset
          };
        }
        return s;
      });

      // 2. Update cms_page_mapping keys
      const oldMapping = assetList.cmsPageMapping || {};
      const newMapping = {};
      for (const [oldSlideNum, pageId] of Object.entries(oldMapping)) {
        const num = parseInt(oldSlideNum, 10);
        if (inRange(num)) {
          newMapping[String(num + offset)] = pageId;
        } else {
          newMapping[oldSlideNum] = pageId;
        }
      }

      // Update asset list with new slides and mapping
      await assetListDb.update(assetList.id, { slides: updatedSlides });
      await assetListDb.updateCmsPageMapping(assetList.id, newMapping);

      // 3. Update generated_images slide numbers
      const images = await generatedImageDb.getByAssetList(assetList.id);
      let imagesUpdatedCount = 0;
      for (const img of images) {
        if (img.slideNumber !== null && img.slideNumber !== undefined && inRange(img.slideNumber)) {
          await generatedImageDb.update(img.id, { slideNumber: img.slideNumber + offset });
          imagesUpdatedCount++;
        }
      }

      // 4. Update motion_graphics_videos slide numbers
      const mgVideos = await mgVideoDb.getByAssetList(assetList.id);
      let mgUpdatedCount = 0;
      for (const video of mgVideos) {
        if (video.slideNumber !== null && video.slideNumber !== undefined && inRange(video.slideNumber)) {
          await mgVideoDb.update(video.id, { slideNumber: video.slideNumber + offset });
          mgUpdatedCount++;
        }
      }

      // 5. Update generated_audio slide numbers
      const audioRecords = await generatedAudioDb.getByAssetList(assetList.id);
      let audioUpdatedCount = 0;
      for (const audio of audioRecords) {
        if (audio.slideNumber !== null && audio.slideNumber !== undefined && inRange(audio.slideNumber)) {
          await generatedAudioDb.update(audio.id, { slideNumber: audio.slideNumber + offset });
          audioUpdatedCount++;
        }
      }

      console.log(`[cms/sync/renumber-slides] Updated ${slidesUpdatedCount} slides, ${imagesUpdatedCount} images, ${mgUpdatedCount} MG videos, ${audioUpdatedCount} audio records`);

      res.json({
        success: true,
        message: `Renumbered slides with offset ${offset}`,
        slidesUpdated: slidesUpdatedCount,
        imagesUpdated: imagesUpdatedCount,
        mgVideosUpdated: mgUpdatedCount,
        audioUpdated: audioUpdatedCount
      });
    } catch (error) {
      console.error('[cms/sync/renumber-slides] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // CMS Push endpoints
  // ==========================================

  // Get CMS schema (available media fields on content_pages)
  router.get('/cms/schema', async (req, res) => {
    try {
      if (!cmsClient.isAvailable()) {
        return res.status(503).json({ error: 'CMS not configured' });
      }

      const fields = await cmsClient.getContentPageFields();
      res.json({ fields });
    } catch (error) {
      console.error('[cms/schema] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Push image to CMS
  router.post('/cms/push/image/:imageId', async (req, res) => {
    try {
      if (!cmsClient.isAvailable()) {
        return res.status(503).json({ error: 'CMS not configured' });
      }

      const image = await generatedImageDb.getById(req.params.imageId);
      if (!image) {
        return res.status(404).json({ error: 'Image not found' });
      }

      // Verify image is ready
      const readyStatuses = ['completed', 'uploaded', 'imported', 'default'];
      if (!readyStatuses.includes(image.status)) {
        return res.status(400).json({ error: `Image not ready (status: ${image.status})` });
      }

      if (!image.imagePath) {
        return res.status(400).json({ error: 'Image has no file path' });
      }

      // Get asset list to find CMS page mapping
      if (!image.assetListId) {
        return res.status(400).json({ error: 'Image is not associated with a session' });
      }

      const assetList = await assetListDb.getById(image.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      const cmsPageMapping = assetList.cmsPageMapping || {};
      const pageId = cmsPageMapping[String(image.slideNumber)];
      if (!pageId) {
        return res.status(400).json({
          error: 'No CMS page mapping for this slide. Run CMS Sync first.',
          slideNumber: image.slideNumber
        });
      }

      // Download file from Supabase
      const filename = image.imagePath.split('/').pop();
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif'
      };
      const mimeType = mimeTypes[ext] || 'image/png';

      // Extract bucket and path from imagePath (could be full URL or just path)
      let bucket = BUCKETS.IMAGES;
      let filePath = filename;
      if (image.imagePath.includes('/storage/v1/object/public/')) {
        // Full Supabase URL - extract bucket and path
        const match = image.imagePath.match(/\/storage\/v1\/object\/public\/([^\/]+)\/(.+)$/);
        if (match) {
          bucket = match[1];
          filePath = match[2];
        }
      }

      console.log(`[cms/push/image] Downloading from ${bucket}/${filePath}`);
      const fileBuffer = await storage.downloadFile(bucket, filePath);

      // Upload to Directus
      console.log(`[cms/push/image] Uploading to CMS: ${image.cmsFilename || filename}`);
      const cmsFile = await cmsClient.uploadFile(
        fileBuffer,
        image.cmsFilename || filename,
        mimeType
      );

      // Link to page
      const fieldName = cmsClient.getCmsFieldForAsset('image');
      console.log(`[cms/push/image] Linking to page ${pageId} field ${fieldName}`);
      await cmsClient.linkFileToPage(pageId, fieldName, cmsFile.id);

      // Update local record with CMS file ID and push status
      await generatedImageDb.update(image.id, {
        cmsFileId: cmsFile.id,
        cmsPushStatus: 'pushed',
        cmsPushedAt: new Date().toISOString()
      });

      console.log(`[cms/push/image] Successfully pushed image ${image.id} to CMS`);
      res.json({
        success: true,
        cmsFileId: cmsFile.id,
        pageId,
        fieldName
      });
    } catch (error) {
      console.error('[cms/push/image] Error:', error.message);
      // Update status to failed
      try {
        await generatedImageDb.update(req.params.imageId, {
          cmsPushStatus: 'failed'
        });
      } catch (e) { /* ignore */ }
      res.status(500).json({ error: error.message });
    }
  });

  // Push audio to CMS
  router.post('/cms/push/audio/:audioId', async (req, res) => {
    try {
      if (!cmsClient.isAvailable()) {
        return res.status(503).json({ error: 'CMS not configured' });
      }

      const audio = await generatedAudioDb.getById(req.params.audioId);
      if (!audio) {
        return res.status(404).json({ error: 'Audio not found' });
      }

      // Verify audio is ready
      const readyStatuses = ['completed', 'uploaded'];
      if (!readyStatuses.includes(audio.status)) {
        return res.status(400).json({ error: `Audio not ready (status: ${audio.status})` });
      }

      if (!audio.audioPath) {
        return res.status(400).json({ error: 'Audio has no file path' });
      }

      // Get asset list to find CMS page mapping
      if (!audio.assetListId) {
        return res.status(400).json({ error: 'Audio is not associated with a session' });
      }

      const assetList = await assetListDb.getById(audio.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      const cmsPageMapping = assetList.cmsPageMapping || {};
      const pageId = cmsPageMapping[String(audio.slideNumber)];
      if (!pageId) {
        return res.status(400).json({
          error: 'No CMS page mapping for this slide. Run CMS Sync first.',
          slideNumber: audio.slideNumber
        });
      }

      // Download file from Supabase
      const filename = audio.audioPath.split('/').pop();
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/m4a'
      };
      const mimeType = mimeTypes[ext] || 'audio/mpeg';

      // Extract bucket and path from audioPath
      let bucket = BUCKETS.AUDIO;
      let filePath = filename;
      if (audio.audioPath.includes('/storage/v1/object/public/')) {
        const match = audio.audioPath.match(/\/storage\/v1\/object\/public\/([^\/]+)\/(.+)$/);
        if (match) {
          bucket = match[1];
          filePath = match[2];
        }
      }

      console.log(`[cms/push/audio] Downloading from ${bucket}/${filePath}`);
      const fileBuffer = await storage.downloadFile(bucket, filePath);

      // Upload to Directus
      console.log(`[cms/push/audio] Uploading to CMS: ${audio.cmsFilename || filename}`);
      const cmsFile = await cmsClient.uploadFile(
        fileBuffer,
        audio.cmsFilename || filename,
        mimeType
      );

      // Check if this is a popup narration
      const popupNumber = cmsClient.getPopupNumber(audio.narrationType);
      let linkedTo = null;

      if (popupNumber) {
        // Get the page's popups and link to the correct one
        console.log(`[cms/push/audio] This is popup_${popupNumber}, fetching page popups...`);
        const popups = await cmsClient.getPagePopups(pageId);
        console.log(`[cms/push/audio] Found ${popups.length} popups:`, popups.map(p => p.title));

        if (popups.length < popupNumber) {
          throw new Error(`Page has only ${popups.length} popups, but trying to push to popup_${popupNumber}`);
        }

        const targetPopup = popups[popupNumber - 1]; // popup_1 = index 0
        console.log(`[cms/push/audio] Linking to popup "${targetPopup.title}" (ID: ${targetPopup.id})`);
        await cmsClient.linkFileToPopup(targetPopup.id, cmsFile.id);
        linkedTo = { type: 'popup', popupId: targetPopup.id, popupTitle: targetPopup.title };
      } else {
        // Check if this is an answer narration type (answer_a, answer_b, etc.)
        const answerSort = cmsClient.getAnswerSortFromNarrationType(audio.narrationType);

        if (answerSort !== null) {
          // Answer narration types → content_answers.answer_narration
          const answers = await cmsClient.getPageAnswers(pageId);
          const targetAnswer = answers.find(a => a.sort === answerSort);

          if (!targetAnswer) {
            throw new Error(`No answer found at sort position ${answerSort} for page ${pageId}`);
          }

          console.log(`[cms/push/audio] Linking to answer ${targetAnswer.id} (sort=${answerSort})`);
          await cmsClient.linkFileToAnswer(targetAnswer.id, cmsFile.id);
          linkedTo = { type: 'answer', answerId: targetAnswer.id, answerSort };
        } else {
          // Non-answer types (question, scenario, correct_response, etc.) → page fields
          const fieldName = cmsClient.getCmsFieldForAsset('audio', audio.narrationType);
          console.log(`[cms/push/audio] Linking to page ${pageId} field ${fieldName}`);
          await cmsClient.linkFileToPage(pageId, fieldName, cmsFile.id);
          linkedTo = { type: 'page', pageId, fieldName };
        }
      }

      // Update local record with CMS file ID and push status
      await generatedAudioDb.update(audio.id, {
        cmsFileId: cmsFile.id,
        cmsPushStatus: 'pushed',
        cmsPushedAt: new Date().toISOString()
      });

      console.log(`[cms/push/audio] Successfully pushed audio ${audio.id} to CMS`);
      res.json({
        success: true,
        cmsFileId: cmsFile.id,
        pageId,
        linkedTo
      });
    } catch (error) {
      console.error('[cms/push/audio] Error:', error.message);
      // Update status to failed
      try {
        await generatedAudioDb.update(req.params.audioId, {
          cmsPushStatus: 'failed'
        });
      } catch (e) { /* ignore */ }
      res.status(500).json({ error: error.message });
    }
  });

  // Push video asset to CMS (stored in generated_images with type 'video')
  router.post('/cms/push/video/:videoId', async (req, res) => {
    try {
      if (!cmsClient.isAvailable()) {
        return res.status(503).json({ error: 'CMS not configured' });
      }

      const video = await generatedImageDb.getById(req.params.videoId);
      if (!video) {
        return res.status(404).json({ error: 'Video asset not found' });
      }

      // Verify video is ready
      const readyStatuses = ['completed', 'uploaded', 'imported'];
      if (!readyStatuses.includes(video.status)) {
        return res.status(400).json({ error: `Video not ready (status: ${video.status})` });
      }

      if (!video.imagePath) {
        return res.status(400).json({ error: 'Video has no file path' });
      }

      // Get asset list to find CMS page mapping
      if (!video.assetListId) {
        return res.status(400).json({ error: 'Video is not associated with a session' });
      }

      const assetList = await assetListDb.getById(video.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      const cmsPageMapping = assetList.cmsPageMapping || {};
      const pageId = cmsPageMapping[String(video.slideNumber)];
      if (!pageId) {
        return res.status(400).json({
          error: 'No CMS page mapping for this slide. Run CMS Sync first.',
          slideNumber: video.slideNumber
        });
      }

      // Download file from Supabase
      const filename = video.imagePath.split('/').pop();
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.webm': 'video/webm',
        '.m4v': 'video/x-m4v'
      };
      const mimeType = mimeTypes[ext] || 'video/mp4';

      // Extract bucket and path from imagePath
      let bucket = BUCKETS.VIDEOS;
      let filePath = filename;
      if (video.imagePath.includes('/storage/v1/object/public/')) {
        const match = video.imagePath.match(/\/storage\/v1\/object\/public\/([^\/]+)\/(.+)$/);
        if (match) {
          bucket = match[1];
          filePath = match[2];
        }
      }

      console.log(`[cms/push/video] Downloading from ${bucket}/${filePath}`);
      const fileBuffer = await storage.downloadFile(bucket, filePath);

      // Upload to Directus
      console.log(`[cms/push/video] Uploading to CMS: ${video.cmsFilename || filename}`);
      const cmsFile = await cmsClient.uploadFile(
        fileBuffer,
        video.cmsFilename || filename,
        mimeType
      );

      // Link to page
      const fieldName = cmsClient.getCmsFieldForAsset('video');
      console.log(`[cms/push/video] Linking to page ${pageId} field ${fieldName}`);
      await cmsClient.linkFileToPage(pageId, fieldName, cmsFile.id);

      // Update local record with CMS file ID and push status
      await generatedImageDb.update(video.id, {
        cmsFileId: cmsFile.id,
        cmsPushStatus: 'pushed',
        cmsPushedAt: new Date().toISOString()
      });

      console.log(`[cms/push/video] Successfully pushed video ${video.id} to CMS`);
      res.json({
        success: true,
        cmsFileId: cmsFile.id,
        pageId,
        fieldName
      });
    } catch (error) {
      console.error('[cms/push/video] Error:', error.message);
      try {
        await generatedImageDb.update(req.params.videoId, {
          cmsPushStatus: 'failed'
        });
      } catch (e) { /* ignore */ }
      res.status(500).json({ error: error.message });
    }
  });

  // Push MG video to CMS
  router.post('/cms/push/mg-video/:videoId', async (req, res) => {
    try {
      if (!cmsClient.isAvailable()) {
        return res.status(503).json({ error: 'CMS not configured' });
      }

      const video = await mgVideoDb.getById(req.params.videoId);
      if (!video) {
        return res.status(404).json({ error: 'MG video not found' });
      }

      // Verify video is ready
      const readyStatuses = ['completed', 'uploaded'];
      if (!readyStatuses.includes(video.status)) {
        return res.status(400).json({ error: `Video not ready (status: ${video.status})` });
      }

      if (!video.videoPath) {
        return res.status(400).json({ error: 'Video has no file path' });
      }

      // Get asset list to find CMS page mapping
      const assetList = await assetListDb.getById(video.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      const cmsPageMapping = assetList.cmsPageMapping || {};
      const pageId = cmsPageMapping[String(video.slideNumber)];
      if (!pageId) {
        return res.status(400).json({
          error: 'No CMS page mapping for this slide. Run CMS Sync first.',
          slideNumber: video.slideNumber
        });
      }

      // Download file from Supabase
      const filename = video.videoPath.split('/').pop();
      const mimeType = 'video/mp4';

      // Extract bucket and path from videoPath
      let bucket = BUCKETS.MG_VIDEOS;
      let filePath = filename;
      if (video.videoPath.includes('/storage/v1/object/public/')) {
        const match = video.videoPath.match(/\/storage\/v1\/object\/public\/([^\/]+)\/(.+)$/);
        if (match) {
          bucket = match[1];
          filePath = match[2];
        }
      }

      console.log(`[cms/push/mg-video] Downloading from ${bucket}/${filePath}`);
      const fileBuffer = await storage.downloadFile(bucket, filePath);

      // Upload to Directus
      console.log(`[cms/push/mg-video] Uploading to CMS: ${video.cmsFilename || filename}`);
      const cmsFile = await cmsClient.uploadFile(
        fileBuffer,
        video.cmsFilename || filename,
        mimeType
      );

      // Link to page
      const fieldName = cmsClient.getCmsFieldForAsset('mg-video');
      console.log(`[cms/push/mg-video] Linking to page ${pageId} field ${fieldName}`);
      await cmsClient.linkFileToPage(pageId, fieldName, cmsFile.id);

      // Update local record with CMS file ID and push status
      await mgVideoDb.update(video.id, {
        cmsFileId: cmsFile.id,
        cmsPushStatus: 'pushed',
        cmsPushedAt: new Date().toISOString()
      });

      console.log(`[cms/push/mg-video] Successfully pushed MG video ${video.id} to CMS`);
      res.json({
        success: true,
        cmsFileId: cmsFile.id,
        pageId,
        fieldName
      });
    } catch (error) {
      console.error('[cms/push/mg-video] Error:', error.message);
      // Update status to failed
      try {
        await mgVideoDb.update(req.params.videoId, {
          cmsPushStatus: 'failed'
        });
      } catch (e) { /* ignore */ }
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // Assessment CMS Sync endpoints
  // ==========================================

  // Fetch and compare assessment questions from CMS
  router.post('/cms/sync/assessment/:assessmentId/fetch', async (req, res) => {
    try {
      if (!cmsClient.isAvailable()) {
        return res.status(503).json({ error: 'CMS not configured' });
      }

      const assessment = await assessmentAssetDb.getById(req.params.assessmentId);
      if (!assessment) {
        return res.status(404).json({ error: 'Assessment not found' });
      }

      // Fetch CMS pages for this assessment type
      console.log(`[cms/sync/assessment] Fetching ${assessment.assessmentType} pages for module: ${assessment.moduleName}`);
      const cmsPages = await cmsClient.getAssessmentPages(assessment.moduleName, assessment.assessmentType);

      if (cmsPages.length === 0) {
        return res.json({
          matched: [],
          narrationMismatches: [],
          cmsOnly: [],
          nolaOnly: assessment.questions || [],
          warning: 'No assessment pages found in CMS'
        });
      }

      // Compare with NOLA questions
      const comparison = cmsClient.compareAssessmentQuestions(cmsPages, assessment.questions || []);

      // Auto-save matched page IDs to cmsPageMapping
      const cmsPageMapping = assessment.cmsPageMapping || {};
      let mappingsUpdated = 0;

      for (const match of [...comparison.matched, ...comparison.narrationMismatches]) {
        // Use nolaQuestionKey which handles Part B ("9b") or fall back to question number
        const questionKey = match.nolaQuestionKey || String(match.nolaQuestionNumber);
        if (!cmsPageMapping[questionKey] || cmsPageMapping[questionKey] !== match.pageId) {
          cmsPageMapping[questionKey] = match.pageId;
          mappingsUpdated++;
        }
      }

      if (mappingsUpdated > 0) {
        await assessmentAssetDb.updateCmsPageMapping(assessment.id, cmsPageMapping);
        console.log(`[cms/sync/assessment] Updated ${mappingsUpdated} page mappings`);
      }

      res.json({
        ...comparison,
        cmsPageMapping,
        totalCmsPages: cmsPages.length,
        totalNolaQuestions: (assessment.questions || []).length
      });
    } catch (error) {
      console.error('[cms/sync/assessment] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Update assessment question narration from CMS
  router.post('/cms/sync/assessment/:assessmentId/update-narration', async (req, res) => {
    try {
      const { assessmentId } = req.params;
      const { questionKey, narrationText, pageId } = req.body;

      if (!questionKey || !narrationText) {
        return res.status(400).json({ error: 'questionKey and narrationText are required' });
      }

      const assessment = await assessmentAssetDb.getById(assessmentId);
      if (!assessment) {
        return res.status(404).json({ error: 'Assessment not found' });
      }

      // Parse questions_json
      let questions = assessment.questions || [];

      // Find and update the matching question
      let updated = false;
      for (const q of questions) {
        // Match by question number or key (handles "9b" for Part B)
        const qKey = q.questionKey || String(q.questionNumber);
        if (qKey === questionKey || String(q.questionNumber) === questionKey) {
          q.narrationText = narrationText;
          updated = true;
          break;
        }
      }

      if (!updated) {
        return res.status(404).json({ error: `Question ${questionKey} not found` });
      }

      // Update assessment with new questions
      await assessmentAssetDb.update(assessmentId, {
        questionsJson: JSON.stringify(questions)
      });

      // Update CMS page mapping if pageId provided
      if (pageId) {
        const cmsPageMapping = assessment.cmsPageMapping || {};
        cmsPageMapping[String(questionKey)] = pageId;
        await assessmentAssetDb.updateCmsPageMapping(assessmentId, cmsPageMapping);
      }

      // Reset any existing audio for this question to pending
      const audioRecords = await generatedAudioDb.getByAssessmentId(assessmentId);
      const questionAudio = audioRecords.find(a =>
        a.questionNumber === questionKey || String(a.questionNumber) === questionKey
      );
      if (questionAudio) {
        await generatedAudioDb.update(questionAudio.id, {
          narrationText: narrationText,
          status: 'pending',
          audioPath: null
        });
      }

      console.log(`[cms/sync/assessment/update-narration] Updated question ${questionKey} narration`);

      res.json({
        success: true,
        message: `Updated narration for question ${questionKey}`,
        questionKey
      });
    } catch (error) {
      console.error('[cms/sync/assessment/update-narration] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Push assessment audio to CMS
  router.post('/cms/push/assessment-audio/:audioId', async (req, res) => {
    try {
      if (!cmsClient.isAvailable()) {
        return res.status(503).json({ error: 'CMS not configured' });
      }

      const audio = await generatedAudioDb.getById(req.params.audioId);
      if (!audio) {
        return res.status(404).json({ error: 'Audio not found' });
      }

      // Verify audio is for an assessment
      if (!audio.assessmentAssetId) {
        return res.status(400).json({ error: 'Audio is not associated with an assessment' });
      }

      // Verify audio is ready
      const readyStatuses = ['completed', 'uploaded'];
      if (!readyStatuses.includes(audio.status)) {
        return res.status(400).json({ error: `Audio not ready (status: ${audio.status})` });
      }

      if (!audio.audioPath) {
        return res.status(400).json({ error: 'Audio has no file path' });
      }

      // Get assessment to find CMS page mapping
      const assessment = await assessmentAssetDb.getById(audio.assessmentAssetId);
      if (!assessment) {
        return res.status(404).json({ error: 'Assessment not found' });
      }

      const cmsPageMapping = assessment.cmsPageMapping || {};
      const questionNumber = audio.questionNumber || audio.slideNumber;
      const narrationType = audio.narrationType;

      // Determine which page to use
      // For two-part questions: part_b_* types use the Part B page (questionNumber + 'b')
      const isPartB = narrationType?.startsWith('part_b_');
      const pageKey = isPartB ? `${questionNumber}b` : String(questionNumber);
      let pageId = req.body.pageId || cmsPageMapping[pageKey];

      // Fallback to base question number if Part B page not found
      if (!pageId && isPartB) {
        pageId = cmsPageMapping[String(questionNumber)];
      }

      // pageId is optional - file will be uploaded but not linked to a page if missing
      if (!pageId) {
        console.log(`[cms/push/assessment-audio] No page mapping for Q${questionNumber}, will upload without linking`);
      }

      // Skip feedback narration types (not used for assessments)
      const skipTypes = ['correct_response', 'incorrect_1', 'incorrect_2'];
      if (skipTypes.includes(narrationType)) {
        return res.status(400).json({
          error: `Narration type "${narrationType}" is not used for Pre/Post Tests`,
          narrationType
        });
      }

      // Download file from Supabase
      const filename = audio.audioPath.split('/').pop();
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/m4a'
      };
      const mimeType = mimeTypes[ext] || 'audio/mpeg';

      let bucket = BUCKETS.AUDIO;
      let filePath = filename;
      if (audio.audioPath.includes('/storage/v1/object/public/')) {
        const match = audio.audioPath.match(/\/storage\/v1\/object\/public\/([^\/]+)\/(.+)$/);
        if (match) {
          bucket = match[1];
          filePath = match[2];
        }
      }

      console.log(`[cms/push/assessment-audio] Downloading from ${bucket}/${filePath}`);
      const fileBuffer = await storage.downloadFile(bucket, filePath);

      // Upload to Directus
      console.log(`[cms/push/assessment-audio] Uploading to CMS: ${audio.cmsFilename || filename}`);
      const cmsFile = await cmsClient.uploadFile(
        fileBuffer,
        audio.cmsFilename || filename,
        mimeType
      );

      // Determine where to link the file based on narration type
      let linkedTo = null;

      // Only link if we have a pageId
      if (pageId) {
        // Question narration types → content_pages.narration
        const questionTypes = ['question', 'part_a_question', 'part_b_question'];
        if (questionTypes.includes(narrationType)) {
          console.log(`[cms/push/assessment-audio] Linking to page ${pageId} field narration`);
          await cmsClient.linkFileToPage(pageId, 'narration', cmsFile.id);
          linkedTo = { type: 'page', pageId, fieldName: 'narration' };
        } else {
          // Answer narration types → content_answers.answer_narration
          const answerSort = cmsClient.getAnswerSortFromNarrationType(narrationType);
          if (answerSort !== null) {
            // Get the page's answers
            const answers = await cmsClient.getPageAnswers(pageId);
            const targetAnswer = answers.find(a => a.sort === answerSort);

            if (!targetAnswer) {
              throw new Error(`No answer found at sort position ${answerSort} for page ${pageId}`);
            }

            console.log(`[cms/push/assessment-audio] Linking to answer ${targetAnswer.id} (sort=${answerSort})`);
            await cmsClient.linkFileToAnswer(targetAnswer.id, cmsFile.id);
            linkedTo = { type: 'answer', answerId: targetAnswer.id, answerSort };
          } else {
            // Fallback: link to page narration field
            console.log(`[cms/push/assessment-audio] Unknown type "${narrationType}", linking to page narration`);
            await cmsClient.linkFileToPage(pageId, 'narration', cmsFile.id);
            linkedTo = { type: 'page', pageId, fieldName: 'narration' };
          }
        }
      } else {
        console.log(`[cms/push/assessment-audio] No pageId - file uploaded but not linked`);
      }

      // Update local record with CMS file ID and push status
      await generatedAudioDb.update(audio.id, {
        cmsFileId: cmsFile.id,
        cmsPushStatus: 'pushed',
        cmsPushedAt: new Date().toISOString()
      });

      console.log(`[cms/push/assessment-audio] Successfully pushed audio ${audio.id} to CMS`);
      res.json({
        success: true,
        cmsFileId: cmsFile.id,
        pageId,
        linkedTo
      });
    } catch (error) {
      console.error('[cms/push/assessment-audio] Error:', error.message);
      try {
        await generatedAudioDb.update(req.params.audioId, {
          cmsPushStatus: 'failed'
        });
      } catch (e) { /* ignore */ }
      res.status(500).json({ error: error.message });
    }
  });

  // Push assessment image to CMS
  router.post('/cms/push/assessment-image/:imageId', async (req, res) => {
    try {
      if (!cmsClient.isAvailable()) {
        return res.status(503).json({ error: 'CMS not configured' });
      }

      const image = await generatedImageDb.getById(req.params.imageId);
      if (!image) {
        return res.status(404).json({ error: 'Image not found' });
      }

      // Verify image is for an assessment
      if (!image.assessmentAssetId) {
        return res.status(400).json({ error: 'Image is not associated with an assessment' });
      }

      // Verify image is ready
      const readyStatuses = ['completed', 'uploaded', 'imported', 'default'];
      if (!readyStatuses.includes(image.status)) {
        return res.status(400).json({ error: `Image not ready (status: ${image.status})` });
      }

      if (!image.imagePath) {
        return res.status(400).json({ error: 'Image has no file path' });
      }

      // Get assessment to find CMS page mapping
      const assessment = await assessmentAssetDb.getById(image.assessmentAssetId);
      if (!assessment) {
        return res.status(404).json({ error: 'Assessment not found' });
      }

      const cmsPageMapping = assessment.cmsPageMapping || {};
      const questionNumber = image.slideNumber; // slideNumber = questionNumber for assessments
      const pageId = req.body.pageId || cmsPageMapping[String(questionNumber)];

      // pageId is optional - file will be uploaded but not linked to a page if missing
      if (!pageId) {
        console.log(`[cms/push/assessment-image] No page mapping for Q${questionNumber}, will upload without linking`);
      }

      // Download file from Supabase
      const filename = image.imagePath.split('/').pop();
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif'
      };
      const mimeType = mimeTypes[ext] || 'image/png';

      let bucket = BUCKETS.IMAGES;
      let filePath = filename;
      if (image.imagePath.includes('/storage/v1/object/public/')) {
        const match = image.imagePath.match(/\/storage\/v1\/object\/public\/([^\/]+)\/(.+)$/);
        if (match) {
          bucket = match[1];
          filePath = match[2];
        }
      }

      console.log(`[cms/push/assessment-image] Downloading from ${bucket}/${filePath}`);
      const fileBuffer = await storage.downloadFile(bucket, filePath);

      // Upload to Directus
      console.log(`[cms/push/assessment-image] Uploading to CMS: ${image.cmsFilename || filename}`);
      const cmsFile = await cmsClient.uploadFile(
        fileBuffer,
        image.cmsFilename || filename,
        mimeType
      );

      // Link to page's image field (only if we have a pageId)
      let linkedTo = null;
      if (pageId) {
        console.log(`[cms/push/assessment-image] Linking to page ${pageId} field image`);
        await cmsClient.linkFileToPage(pageId, 'image', cmsFile.id);
        linkedTo = { pageId, fieldName: 'image' };
      } else {
        console.log(`[cms/push/assessment-image] No pageId - file uploaded but not linked`);
      }

      // Update local record with CMS file ID and push status
      await generatedImageDb.update(image.id, {
        cmsFileId: cmsFile.id,
        cmsPushStatus: 'pushed',
        cmsPushedAt: new Date().toISOString()
      });

      console.log(`[cms/push/assessment-image] Successfully pushed image ${image.id} to CMS`);
      res.json({
        success: true,
        cmsFileId: cmsFile.id,
        linkedTo
      });
    } catch (error) {
      console.error('[cms/push/assessment-image] Error:', error.message);
      try {
        await generatedImageDb.update(req.params.imageId, {
          cmsPushStatus: 'failed'
        });
      } catch (e) { /* ignore */ }
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};

// Helper functions
function generateAudioFilename(moduleName, sessionNumber, slideNumber, narrationType) {
  const moduleCode = getModuleCode(moduleName);
  // If narrationType is provided (for structured narration slides), use type code
  if (narrationType) {
    const typeCode = narrationTypeToCode(narrationType);
    return `MOD.${moduleCode}.${sessionNumber}.${slideNumber}.${typeCode}.mp3`;
  }
  // Default: single narration file
  return `MOD.${moduleCode}.${sessionNumber}.${slideNumber}.NAR1.mp3`;
}

function generateMGVideoFilename(moduleName, sessionNumber, slideNumber) {
  const moduleCode = getModuleCode(moduleName);
  return `MOD.${moduleCode}.${sessionNumber}.${slideNumber}.VID1.mp4`;
}

function generateMGSceneFilename(moduleName, sessionNumber, slideNumber, sceneNumber) {
  const moduleCode = getModuleCode(moduleName);
  return `MOD.${moduleCode}.${sessionNumber}.${slideNumber}.MG.${sceneNumber}.png`;
}

function extractSlidesFromAssets(assets) {
  const slideMap = {};
  for (const asset of assets) {
    if (!slideMap[asset.slideNumber]) {
      slideMap[asset.slideNumber] = {
        slideNumber: asset.slideNumber,
        slideTitle: asset.slideTitle || '',
        slideType: asset.slideType || ''
      };
    }
  }
  return Object.values(slideMap).sort((a, b) => a.slideNumber - b.slideNumber);
}

// Parse session type from session title
// Detects RCP, RCA, Review patterns in titles like "Session 2 RCP" or "Session 2: RCA"
function parseSessionType(sessionTitle) {
  if (!sessionTitle) return 'regular';

  const titleUpper = sessionTitle.toUpperCase();

  // Check for RCP pattern
  if (titleUpper.includes('RCP') || titleUpper.includes('REVIEW CHECKPOINT')) {
    return 'rcp';
  }

  // Check for RCA pattern
  if (titleUpper.includes('RCA') || titleUpper.includes('REVIEW CRITICAL ASSESSMENT')) {
    return 'rca';
  }

  // Check for generic Review pattern (if not RCP/RCA)
  if (titleUpper.includes('REVIEW')) {
    return 'review';
  }

  return 'regular';
}

// Check if a slideType indicates an RCP slide
function isRcpSlideType(slideType) {
  if (!slideType) return false;
  const t = slideType.toLowerCase();
  return t.startsWith('rcp_') || t === 'rcp' ||
         t === 'rcp_recall' || t === 'rcp_connect' ||
         t === 'rcp_practice' || t === 'rcp_apply';
}

// Helper function to process a single asset list (used for splitting RCP sessions)
async function processAssetList({
  moduleName,
  sessionNumber,
  sessionTitle,
  sessionType,
  assets,
  slides,
  careerCharacter,
  assetListDb,
  generatedImageDb,
  characterDb,
  generatedAudioDb
}) {
  // Check if asset list already exists for this module+session+type
  let assetList = await assetListDb.getByModuleSessionAndType(moduleName, sessionNumber, sessionType);
  let isUpdate = false;
  let existingImages = [];

  if (assetList) {
    // Update existing asset list
    isUpdate = true;
    await assetListDb.update(assetList.id, {
      sessionTitle,
      assets,
      slides,
      careerCharacter
    });
    // Refresh to get updated data
    assetList = await assetListDb.getById(assetList.id);
    existingImages = await generatedImageDb.getByAssetList(assetList.id);
  } else {
    // Create new asset list
    assetList = await assetListDb.create({
      moduleName,
      sessionNumber,
      sessionType,
      sessionTitle,
      assets,
      slides,
      careerCharacter
    });
  }

  // Handle career character (create or update)
  let characterId = null;
  let characterAppearsOn = [];
  if (careerCharacter && careerCharacter.name) {
    const existingChar = await characterDb.getByModuleAndName(moduleName, careerCharacter.name);
    if (existingChar) {
      const currentSlides = existingChar.appearsOnSlides || [];
      const newSlides = careerCharacter.appearsOn || [];
      const allCharSlides = [...new Set([...currentSlides, ...newSlides])];
      await characterDb.update(existingChar.id, {
        appearsOnSlides: allCharSlides,
        career: careerCharacter.career || existingChar.career,
        appearanceDescription: careerCharacter.appearance || existingChar.appearanceDescription
      });
      characterId = existingChar.id;
      characterAppearsOn = allCharSlides;
    } else {
      const newChar = await characterDb.create({
        moduleName,
        characterName: careerCharacter.name,
        career: careerCharacter.career,
        appearanceDescription: careerCharacter.appearance,
        appearsOnSlides: careerCharacter.appearsOn || []
      });
      if (newChar) {
        characterId = newChar.id;
        characterAppearsOn = careerCharacter.appearsOn || [];
      }
    }
  }

  // Build map of existing images by slideNumber+assetType+assetNumber
  const existingByKey = {};
  const duplicateIds = [];
  existingImages.forEach(img => {
    const key = `${img.slideNumber}-${img.assetType}-${img.assetNumber || 1}`;
    if (existingByKey[key]) {
      duplicateIds.push(img.id);
    } else {
      existingByKey[key] = img;
    }
  });

  // Delete any duplicates found
  if (duplicateIds.length > 0) {
    await generatedImageDb.deleteByIds(duplicateIds);
  }

  // Helper to get assetNumber from either camelCase or snake_case field
  const getAssetNumber = (asset) => asset.assetNumber ?? asset.asset_number ?? 1;

  // Build set of new slide keys from assets
  const newSlideKeys = new Set(
    assets.map(a => `${a.slideNumber}-${a.type}-${getAssetNumber(a)}`)
  );

  // Find images to delete (slides that were removed from asset list)
  const imagesToDelete = existingImages.filter(img => {
    const key = `${img.slideNumber}-${img.assetType}-${img.assetNumber || 1}`;
    return !newSlideKeys.has(key);
  });

  // Delete removed images
  if (imagesToDelete.length > 0) {
    await generatedImageDb.deleteByIds(imagesToDelete.map(img => img.id));
  }

  // Build a map of slide numbers to slide titles for default image lookup
  const slideTitleMap = {};
  if (slides) {
    slides.forEach(s => {
      const num = String(s.slideNumber ?? s.slide_number ?? '');
      const title = s.slideTitle || s.slide_title || s.title || '';
      if (num) slideTitleMap[num] = title;
    });
  }

  // Process each asset: update existing or create new
  const generatedImages = [];
  let created = 0;
  let kept = 0;
  let defaultsApplied = 0;

  for (const asset of assets) {
    const assetNum = getAssetNumber(asset);
    const key = `${asset.slideNumber}-${asset.type}-${assetNum}`;
    const existing = existingByKey[key];

    const slideKey = `S${sessionNumber}-${asset.slideNumber}`;
    const hasCharacter = characterId && characterAppearsOn.some(s =>
      s === slideKey || s === asset.slideNumber || s === `${asset.slideNumber}`
    );

    if (existing) {
      // Update existing image record with new prompt
      await generatedImageDb.update(existing.id, {
        originalPrompt: asset.prompt,
        characterId: hasCharacter ? characterId : existing.characterId
      });

      // If existing record is still pending, check if we should apply a default
      if (existing.status === 'pending') {
        const slideTitle = slideTitleMap[String(asset.slideNumber)] || asset.slideTitle || '';
        const defaultImage = await getDefaultImageForSlide(slideTitle);
        if (defaultImage) {
          const cmsFilename = existing.cmsFilename || generateCmsFilename(moduleName, sessionNumber, asset);
          const result = await applyDefaultImage(existing.id, defaultImage, cmsFilename);
          existing.status = 'default';
          existing.imagePath = result.outputPath;
          existing.cmsFilename = result.outputFilename;
          defaultsApplied++;
        }
      }

      generatedImages.push({ ...existing, originalPrompt: asset.prompt });
      kept++;
    } else {
      // Create new pending record
      const cmsFilename = generateCmsFilename(moduleName, sessionNumber, asset);
      const image = await generatedImageDb.create({
        assetListId: assetList.id,
        slideNumber: asset.slideNumber,
        assetType: asset.type,
        assetNumber: assetNum,
        cmsFilename,
        originalPrompt: asset.prompt,
        characterId: hasCharacter ? characterId : null,
        status: 'pending'
      });

      // Check if this slide has a default image
      const slideTitle = slideTitleMap[String(asset.slideNumber)] || asset.slideTitle || '';
      const defaultImage = await getDefaultImageForSlide(slideTitle);

      if (defaultImage) {
        const result = await applyDefaultImage(image.id, defaultImage, cmsFilename);
        image.status = 'default';
        image.imagePath = result.outputPath;
        image.cmsFilename = result.outputFilename;
        defaultsApplied++;
      }

      generatedImages.push(image);
      created++;
    }
  }

  // Process slides with narration - create/update generated_audio records
  // For question slides (RCP), create multi-part audio records
  let audioCreated = 0;
  let audioKept = 0;
  // Helper to upsert slide audio record
  const upsertSlideAudio = async (assetListId, slideNum, narrationType, text) => {
    if (!text || !text.trim()) return false;
    const existing = await generatedAudioDb.getByAssetListSlideAndType(assetListId, slideNum, narrationType);
    if (existing) {
      if (existing.narrationText !== text) {
        await generatedAudioDb.update(existing.id, { narrationText: text });
      }
      audioKept++;
    } else {
      await generatedAudioDb.create({
        assetListId,
        slideNumber: slideNum,
        narrationType,
        narrationText: text,
        cmsFilename: generateRcpAudioFilename(moduleName, sessionNumber, slideNum, narrationType),
        status: 'pending'
      });
      audioCreated++;
    }
    return true;
  };

  if (slides && slides.length > 0) {
    for (const slide of slides) {
      const slideNum = parseInt(slide.slideNumber ?? slide.slide_number ?? 0);
      const narration = slide.narration || slide.narrationText || '';
      const onscreenText = slide.onscreen_text || slide.onscreenText || '';
      const slideType = slide.slideType || slide.slide_type || '';

      // Check for structuredNarration first (pre-parsed by Carl)
      if (slide.structuredNarration) {
        const sn = slide.structuredNarration;

        // Use question directly (leadIn may contain concatenated junk data)
        if (sn.question) {
          await upsertSlideAudio(assetList.id, slideNum, 'question', sn.question);
        }

        // Answer choices from structured array
        if (sn.answerChoices && Array.isArray(sn.answerChoices)) {
          for (const choice of sn.answerChoices) {
            if (choice.label && choice.text) {
              const narrationType = `answer_${choice.label.toLowerCase()}`;
              await upsertSlideAudio(assetList.id, slideNum, narrationType, choice.text);
            }
          }
        }

        // Response texts
        if (sn.correctResponseText) {
          await upsertSlideAudio(assetList.id, slideNum, 'correct_response', sn.correctResponseText);
        }
        if (sn.firstIncorrectText) {
          await upsertSlideAudio(assetList.id, slideNum, 'incorrect_1', sn.firstIncorrectText);
        }
        if (sn.secondIncorrectText) {
          await upsertSlideAudio(assetList.id, slideNum, 'incorrect_2', sn.secondIncorrectText);
        }

      } else if (isQuestionSlide(onscreenText, slideType)) {
        // FALLBACK: Legacy regex parsing for question slides
        const parts = parseNarrationText(narration, onscreenText);

        // Create audio record for question (scenario + question text)
        await upsertSlideAudio(assetList.id, slideNum, 'question', parts.question);

        // Create audio records for each answer choice
        for (const answer of parts.answers) {
          const narrationType = `answer_${answer.letter.toLowerCase()}`;
          await upsertSlideAudio(assetList.id, slideNum, narrationType, answer.text);
        }

        // Create audio records for feedback responses
        await upsertSlideAudio(assetList.id, slideNum, 'correct_response', parts.correctResponse);
        await upsertSlideAudio(assetList.id, slideNum, 'incorrect_1', parts.incorrect1);
        await upsertSlideAudio(assetList.id, slideNum, 'incorrect_2', parts.incorrect2);

      } else if (narration && narration.trim().length > 0) {
        // Regular slide - single narration
        const existingAudio = await generatedAudioDb.getByAssetListSlideAndType(assetList.id, slideNum, 'slide_narration');
        if (existingAudio) {
          if (existingAudio.narrationText !== narration) {
            await generatedAudioDb.update(existingAudio.id, { narrationText: narration });
          }
          audioKept++;
        } else {
          await generatedAudioDb.create({
            assetListId: assetList.id,
            slideNumber: slideNum,
            narrationType: 'slide_narration',
            narrationText: narration,
            cmsFilename: generateAudioFilename(moduleName, sessionNumber, slideNum),
            status: 'pending'
          });
          audioCreated++;
        }
      }
    }
  }

  const action = isUpdate ? 'Updated' : 'Imported';
  const defaultsNote = defaultsApplied > 0 ? `, ${defaultsApplied} defaults applied` : '';
  const audioNote = (audioCreated + audioKept) > 0 ? `, ${audioCreated + audioKept} narrations` : '';
  const details = isUpdate
    ? `${kept} kept, ${created} added, ${imagesToDelete.length} removed${defaultsNote}${audioNote}`
    : `${created} assets${defaultsNote}${audioNote}`;
  const typeLabel = sessionType !== 'regular' ? ` ${sessionType.toUpperCase()}` : '';

  return {
    assetList,
    generatedImages,
    message: `${action} ${moduleName} Session ${sessionNumber}${typeLabel}: ${details}`
  };
}

function generateCmsFilename(moduleName, sessionNumber, asset) {
  const moduleCode = getModuleCode(moduleName);
  const session = sessionNumber || 0;
  const slide = asset.slideNumber || 0;

  const typeCodeMap = {
    'ai_generated_image': 'IMG',
    'labeled_diagram': 'DIA',
    'photo': 'IMG',
    'diagram': 'DIA',
    'icon': 'ICO',
    'video': 'VID',
    'motion_graphics': 'IMG'
  };

  const typeCode = typeCodeMap[asset.type] || 'IMG';
  const assetNum = asset.assetNumber ?? asset.asset_number ?? 1;

  return `MOD.${moduleCode}.${session}.${slide}.${typeCode}${assetNum}.png`;
}

// Generate CMS filename for assessment visuals
// Format: MOD.<CODE>.<PRE|POST>.Q<NUM>.<TYPE>1.png
function generateAssessmentCmsFilename(moduleName, assessmentType, questionNumber, visualType) {
  const moduleCode = getModuleCode(moduleName);
  const testType = assessmentType === 'pre_test' ? 'PRE' : 'POST';
  const qNum = String(questionNumber).padStart(2, '0');

  const typeCodeMap = {
    'table': 'TBL',
    'graph': 'GRA',
    'diagram': 'DIA',
    'image': 'IMG',
    'chart': 'CHA'
  };

  const typeCode = typeCodeMap[visualType?.toLowerCase()] || 'IMG';

  return `MOD.${moduleCode}.${testType}.Q${qNum}.${typeCode}1.png`;
}

// Get asset type for assessment visuals
function getAssessmentAssetType(assessmentType, visualType) {
  const prefix = assessmentType === 'pre_test' ? 'pre_test' : 'post_test';
  const type = visualType?.toLowerCase() || 'image';
  return `${prefix}_${type}`;
}

// Generate CMS filename for assessment audio
// Format: MOD.<CODE>.<PRE|POST>.Q<NUM>.<TYPE>.mp3
function generateAssessmentAudioFilename(moduleName, assessmentType, questionNumber, narrationType) {
  const moduleCode = getModuleCode(moduleName);
  const testType = assessmentType === 'pre_test' ? 'PRE' : 'POST';
  const qNum = String(questionNumber).padStart(2, '0');
  const typeCode = narrationTypeToCode(narrationType);

  return `MOD.${moduleCode}.${testType}.Q${qNum}.${typeCode}.mp3`;
}

// Generate CMS filename for RCP audio
// Format: MOD.<CODE>.<SESSION>R.<SLIDE>.<TYPE>.mp3
function generateRcpAudioFilename(moduleName, sessionNumber, slideNumber, narrationType) {
  const moduleCode = getModuleCode(moduleName);
  const typeCode = narrationTypeToCode(narrationType);

  return `MOD.${moduleCode}.${sessionNumber}R.${slideNumber}.${typeCode}.mp3`;
}

// Build prompt from assessment visual description
function buildAssessmentVisualPrompt(question) {
  const visual = question.visual;
  if (!visual) return '';

  const parts = [];

  if (visual.title) {
    parts.push(`Title: ${visual.title}`);
  }

  if (visual.description) {
    parts.push(visual.description);
  }

  if (question.scenario) {
    parts.push(`Context: ${question.scenario}`);
  }

  // Add type-specific instructions
  const type = visual.type?.toLowerCase();
  if (type === 'table') {
    parts.push('Create a clean, educational data table with clear headers and readable values.');
  } else if (type === 'graph') {
    parts.push('Create a clear, labeled graph suitable for educational assessment.');
  } else if (type === 'diagram') {
    parts.push('Create a clear, labeled diagram for educational purposes.');
  }

  return parts.join('\n\n');
}

const promptTemplates = {
  categories: [
    {
      name: 'Star Academy - Characters',
      templates: [
        {
          name: 'Scientist',
          prompt: '3D animated scientist character in white lab coat, modern laboratory background with glowing screens and equipment, confident welcoming expression, professional yet approachable, speaking to camera, "Let me show you how this works," Pixar-style animation, warm lighting',
          negativePrompt: 'realistic human, cartoonish, low quality, stiff, robotic'
        },
        {
          name: 'Engineer',
          prompt: '3D animated engineer character with safety glasses and clipboard, high-tech facility background with blueprints and machinery, gesturing while explaining concept, diverse professional appearance, clean modern animation style',
          negativePrompt: 'realistic, amateur, static pose, cluttered'
        },
        {
          name: 'Professional',
          prompt: '3D animated career professional character in authentic work attire, relevant workplace environment, enthusiastic expression, pointing toward floating holographic display, educational animation style',
          negativePrompt: 'generic, boring, unrealistic proportions, dark'
        }
      ]
    },
    {
      name: 'Star Academy - Visualizations',
      templates: [
        {
          name: 'Hologram',
          prompt: 'Glowing holographic wireframe rotating slowly, transparent blue-green technical visualization, floating labels and data points, dark modern lab environment, futuristic educational display',
          negativePrompt: 'solid opaque, flat, outdated, pixelated'
        },
        {
          name: 'Cutaway',
          prompt: '3D cross-section view revealing inner workings, layers peeling away smoothly, detailed internal components visible, soft studio lighting, technical illustration style',
          negativePrompt: 'messy, confusing, blurry interior, rushed'
        },
        {
          name: 'Process',
          prompt: 'Step-by-step 3D animation showing scientific process, clean minimal background, smooth transitions between stages, educational motion graphics, glowing highlights on key elements',
          negativePrompt: 'cluttered, jarring, too fast, unclear sequence'
        }
      ]
    },
    {
      name: 'Star Academy - STEM Concepts',
      templates: [
        {
          name: 'Math',
          prompt: '3D geometric shapes transforming and connecting, satisfying mathematical relationships visualized, clean white environment with soft shadows, floating equations that animate into place, educational yet mesmerizing',
          negativePrompt: 'static, flat 2D, confusing, chaotic'
        },
        {
          name: 'Science',
          prompt: 'Dramatic visualization of scientific phenomenon, macro or microscopic perspective, vivid accurate colors, documentary-quality rendering, sense of wonder and discovery',
          negativePrompt: 'inaccurate, cartoonish, dull, amateur'
        },
        {
          name: 'Data Viz',
          prompt: 'Animated 3D chart emerging and populating with data, clean modern aesthetic, smooth bar and line growth animations, professional infographic style, subtle particle effects',
          negativePrompt: 'flat, boring, cluttered labels, static'
        }
      ]
    },
    {
      name: 'Star Academy - Environments',
      templates: [
        {
          name: 'Lab',
          prompt: 'Sleek modern laboratory with holographic displays and glowing equipment, camera slowly panning across workspace, blue-tinted ambient lighting, high-tech research facility aesthetic, inspiring STEM environment',
          negativePrompt: 'outdated, dirty, dark, cramped, boring'
        },
        {
          name: 'Workspace',
          prompt: 'Professional STEM workspace environment, authentic equipment and tools, warm inviting lighting, camera revealing space, aspirational career setting',
          negativePrompt: 'generic, empty, unrealistic, dull'
        }
      ]
    }
  ],
  negativePromptPresets: [
    { name: 'Quality Guard', value: 'blurry, low quality, pixelated, artifact, distorted' },
    { name: 'Style Clean', value: 'cartoon, anime, illustration, drawing, sketch' },
    { name: 'Content Safe', value: 'violent, disturbing, inappropriate, offensive' },
    { name: 'Professional', value: 'amateur, shaky, poor lighting, unfocused, noisy' }
  ]
};
