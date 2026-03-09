const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { videos: videoDb, folders: folderDb, characters: characterDb, assetLists: assetListDb, generatedImages: generatedImageDb, generationHistory: generationHistoryDb, motionGraphicsVideos: mgVideoDb, generatedAudio: generatedAudioDb } = require('../db/database');

const router = express.Router();
const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const DEFAULTS_DIR = path.join(STORAGE_DIR, 'defaults');

// Default images for specific slide types
// Maps slide title patterns (lowercase) to default image filenames
const DEFAULT_SLIDE_IMAGES = {
  'clean up': 'cleanup.png',
  'cleanup': 'cleanup.png',
  'lab safety': 'lab_safety.png',
  'lab_safety': 'lab_safety.png'
};

// Check if a slide title matches a default image pattern
function getDefaultImageForSlide(slideTitle) {
  if (!slideTitle) return null;
  const titleLower = slideTitle.toLowerCase().trim();

  for (const [pattern, filename] of Object.entries(DEFAULT_SLIDE_IMAGES)) {
    if (titleLower.includes(pattern)) {
      const defaultPath = path.join(DEFAULTS_DIR, filename);
      if (fs.existsSync(defaultPath)) {
        return { filename, path: defaultPath };
      }
    }
  }
  return null;
}

// Apply default image to a generated image record
function applyDefaultImage(imageId, defaultImage, cmsFilename) {
  const ext = path.extname(defaultImage.filename);
  const outputFilename = cmsFilename.replace(/\.[^.]+$/, ext);
  const outputPath = path.join(STORAGE_DIR, 'images', outputFilename);

  // Ensure images directory exists
  const imagesDir = path.join(STORAGE_DIR, 'images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  // Copy default image to images folder with CMS filename
  fs.copyFileSync(defaultImage.path, outputPath);

  // Update the record
  generatedImageDb.update(imageId, {
    status: 'default',
    imagePath: outputPath,
    cmsFilename: outputFilename
  });

  return { outputPath, outputFilename };
}

// Configure multer for file uploads
const upload = multer({
  dest: path.join(__dirname, '..', 'storage', 'uploads'),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'];
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

      const job = jobManager.createJob('text-to-video', {
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

      const job = jobManager.createJob('image-to-video', {
        image: req.file.path,
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

      const job = jobManager.createJob('frame-interpolation', {
        firstFrame: req.files.firstFrame[0].path,
        lastFrame: req.files.lastFrame[0].path,
        prompt,
        negativePrompt,
        aspectRatio,
        resolution
      });

      await jobManager.startJob(job.id);

      res.json({ jobId: job.id, status: job.status });
    } catch (error) {
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

      const job = jobManager.createJob('reference-guided', {
        referenceImages: req.files.map(f => f.path),
        prompt,
        negativePrompt,
        aspectRatio,
        resolution
      });

      await jobManager.startJob(job.id);

      res.json({ jobId: job.id, status: job.status });
    } catch (error) {
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
      const video = videoDb.getByPath(videoPath);
      if (!video) {
        return res.status(400).json({ error: 'Video not found in library' });
      }

      if (!video.source_uri) {
        return res.status(400).json({
          error: 'This video cannot be extended. Video extension only works with Veo-generated videos that have a stored source URI. Note: Google only retains video URIs for 2 days after generation.'
        });
      }

      const job = jobManager.createJob('video-extension', {
        videoUri: video.source_uri,
        prompt
      });

      await jobManager.startJob(job.id);

      res.json({ jobId: job.id, status: job.status });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get job status
  router.get('/jobs/:jobId', (req, res) => {
    const job = jobManager.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  });

  // Get all jobs
  router.get('/jobs', (req, res) => {
    const jobs = jobManager.getAllJobs();
    res.json(jobs);
  });

  // Delete a job
  router.delete('/jobs/:jobId', (req, res) => {
    const deleted = jobManager.deleteJob(req.params.jobId);
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
  router.get('/library', (req, res) => {
    try {
      const { folder, search, limit, offset } = req.query;
      const videos = videoDb.getAll({
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
  router.get('/library/folders', (req, res) => {
    try {
      const folders = folderDb.getAll();
      res.json(folders);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a folder
  router.post('/library/folders', (req, res) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Folder name is required' });
      }

      const folder = folderDb.create(name.trim());
      if (!folder) {
        return res.status(409).json({ error: 'Folder already exists' });
      }

      res.json(folder);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a folder
  router.delete('/library/folders/:folderId', (req, res) => {
    try {
      const deleted = folderDb.delete(req.params.folderId);
      if (!deleted) {
        return res.status(404).json({ error: 'Folder not found' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update a video (title, folder)
  router.patch('/videos/:videoId', (req, res) => {
    try {
      const { title, folder } = req.body;
      const updated = videoDb.update(req.params.videoId, { title, folder });
      if (!updated) {
        return res.status(404).json({ error: 'Video not found' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a single video
  router.delete('/videos/:videoId', (req, res) => {
    try {
      const video = videoDb.delete(req.params.videoId);
      if (!video) {
        return res.status(404).json({ error: 'Video not found' });
      }

      // Delete the file from disk
      const filePath = path.join(STORAGE_DIR, video.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
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
  router.post('/asset-lists', (req, res) => {
    try {
      const { moduleName, sessionNumber, sessionTitle, assets, slides, careerCharacter } = req.body;

      if (!moduleName) {
        return res.status(400).json({ error: 'moduleName is required' });
      }
      if (!assets || !Array.isArray(assets)) {
        return res.status(400).json({ error: 'assets array is required' });
      }

      // Keep all assets - they can be fulfilled via Image Gen, Video Gen, or upload
      const filteredAssets = assets;

      // Use slides array if provided, otherwise extract unique slides from assets
      const allSlides = slides || extractSlidesFromAssets(assets);

      // Check if asset list already exists for this module+session
      let assetList = assetListDb.getByModuleAndSession(moduleName, sessionNumber);
      let isUpdate = false;
      let existingImages = [];

      if (assetList) {
        // Update existing asset list
        isUpdate = true;
        assetListDb.update(assetList.id, {
          sessionTitle,
          assets,
          slides: allSlides,
          careerCharacter
        });
        // Refresh to get updated data
        assetList = assetListDb.getById(assetList.id);
        existingImages = generatedImageDb.getByAssetList(assetList.id);
      } else {
        // Create new asset list
        assetList = assetListDb.create({
          moduleName,
          sessionNumber,
          sessionTitle,
          assets,
          slides: allSlides,
          careerCharacter
        });
      }

      // Handle career character (create or update)
      let characterId = null;
      let characterAppearsOn = [];
      if (careerCharacter && careerCharacter.name) {
        const existingChar = characterDb.getByModuleAndName(moduleName, careerCharacter.name);
        if (existingChar) {
          const currentSlides = existingChar.appearsOnSlides || [];
          const newSlides = careerCharacter.appearsOn || [];
          const allSlides = [...new Set([...currentSlides, ...newSlides])];
          characterDb.update(existingChar.id, {
            appearsOnSlides: allSlides,
            career: careerCharacter.career || existingChar.career,
            appearanceDescription: careerCharacter.appearance || existingChar.appearanceDescription
          });
          characterId = existingChar.id;
          characterAppearsOn = allSlides;
        } else {
          const newChar = characterDb.create({
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
      // Track duplicates (multiple records with same key - indicates corrupt data)
      const existingByKey = {};
      const duplicateIds = [];
      existingImages.forEach(img => {
        const key = `${img.slideNumber}-${img.assetType}-${img.assetNumber || 1}`;
        if (existingByKey[key]) {
          // Duplicate key - mark for deletion (keep the first one, delete extras)
          duplicateIds.push(img.id);
        } else {
          existingByKey[key] = img;
        }
      });

      // Delete any duplicates found (cleanup for corrupt data)
      if (duplicateIds.length > 0) {
        generatedImageDb.deleteByIds(duplicateIds);
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
        generatedImageDb.deleteByIds(imagesToDelete.map(img => img.id));
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

      // Process each asset: update existing or create new
      const generatedImages = [];
      let created = 0;
      let kept = 0;
      let defaultsApplied = 0;

      for (const asset of filteredAssets) {
        const assetNum = getAssetNumber(asset);
        const key = `${asset.slideNumber}-${asset.type}-${assetNum}`;
        const existing = existingByKey[key];

        const slideKey = `S${sessionNumber}-${asset.slideNumber}`;
        const hasCharacter = characterId && characterAppearsOn.some(s =>
          s === slideKey || s === asset.slideNumber || s === `${asset.slideNumber}`
        );

        if (existing) {
          // Update existing image record with new prompt (keep generated image if exists)
          generatedImageDb.update(existing.id, {
            originalPrompt: asset.prompt,
            characterId: hasCharacter ? characterId : existing.characterId
          });

          // If existing record is still pending, check if we should apply a default
          if (existing.status === 'pending') {
            const slideTitle = slideTitleMap[String(asset.slideNumber)] || asset.slideTitle || '';
            const defaultImage = getDefaultImageForSlide(slideTitle);
            if (defaultImage) {
              const cmsFilename = existing.cmsFilename || generateCmsFilename(moduleName, sessionNumber, asset);
              const result = applyDefaultImage(existing.id, defaultImage, cmsFilename);
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
          const image = generatedImageDb.create({
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
          const defaultImage = getDefaultImageForSlide(slideTitle);

          if (defaultImage) {
            // Apply the default image
            const result = applyDefaultImage(image.id, defaultImage, cmsFilename);
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
      let audioCreated = 0;
      let audioKept = 0;
      if (allSlides && allSlides.length > 0) {
        for (const slide of allSlides) {
          const slideNum = parseInt(slide.slideNumber ?? slide.slide_number ?? 0);
          const narration = slide.narration || slide.narrationText || '';

          if (narration && narration.trim().length > 0) {
            // Upsert audio record
            const existingAudio = generatedAudioDb.getByAssetListAndSlide(assetList.id, slideNum);
            if (existingAudio) {
              // Update narration text if changed
              if (existingAudio.narrationText !== narration) {
                generatedAudioDb.update(existingAudio.id, { narrationText: narration });
              }
              audioKept++;
            } else {
              // Create new audio record
              generatedAudioDb.create({
                assetListId: assetList.id,
                slideNumber: slideNum,
                narrationText: narration,
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

      res.json({
        assetList,
        generatedImages,
        message: `${action} ${moduleName} Session ${sessionNumber}: ${details}`
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // List all asset lists
  router.get('/asset-lists', (req, res) => {
    try {
      const { moduleName } = req.query;
      let assetLists;

      if (moduleName) {
        assetLists = assetListDb.getByModule(moduleName);
      } else {
        assetLists = assetListDb.getAll();
      }

      res.json(assetLists);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single asset list with its generated images, motion graphics videos, and audio
  router.get('/asset-lists/:id', (req, res) => {
    try {
      const assetList = assetListDb.getById(req.params.id);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      const generatedImages = generatedImageDb.getByAssetList(assetList.id);
      const motionGraphicsVideos = mgVideoDb.getByAssetList(assetList.id);
      const generatedAudio = generatedAudioDb.getByAssetList(assetList.id);

      // Backfill characterId for existing MG scenes that don't have one
      const character = characterDb.getByModule(assetList.moduleName);
      if (character) {
        const mgScenes = generatedImages.filter(img =>
          (img.assetType || '').toLowerCase().includes('motion_graphics') &&
          !img.characterId
        );
        for (const scene of mgScenes) {
          const slideKey = `S${assetList.sessionNumber}-${scene.slideNumber}`;
          const hasCharacter = character.appearsOnSlides?.some(s =>
            s === slideKey || s === String(scene.slideNumber)
          );
          if (hasCharacter) {
            generatedImageDb.update(scene.id, { characterId: character.id });
            scene.characterId = character.id; // Update in-memory for response
          }
        }
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
  router.delete('/asset-lists/:id', (req, res) => {
    try {
      // First delete all generated images for this asset list
      const images = generatedImageDb.getByAssetList(req.params.id);
      if (images.length > 0) {
        generatedImageDb.deleteByIds(images.map(img => img.id));
      }

      const deleted = assetListDb.delete(req.params.id);
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
  router.get('/characters/:moduleName', (req, res) => {
    try {
      const characters = characterDb.getByModule(req.params.moduleName);
      res.json(characters);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create or update character
  router.post('/characters', (req, res) => {
    try {
      const { moduleName, characterName, career, appearanceDescription, appearsOnSlides } = req.body;

      if (!moduleName || !characterName) {
        return res.status(400).json({ error: 'moduleName and characterName are required' });
      }

      // Check if character exists
      const existing = characterDb.getByModuleAndName(moduleName, characterName);
      if (existing) {
        characterDb.update(existing.id, {
          career,
          appearanceDescription,
          appearsOnSlides
        });
        const updated = characterDb.getById(existing.id);
        return res.json(updated);
      }

      const character = characterDb.create({
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

  // Set anchor image for character
  router.put('/characters/:id/anchor', upload.single('anchor'), (req, res) => {
    try {
      const character = characterDb.getById(req.params.id);
      if (!character) {
        return res.status(404).json({ error: 'Character not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Anchor image file is required' });
      }

      // Move the uploaded file to a permanent location
      const ext = path.extname(req.file.originalname) || '.png';
      const anchorFilename = `anchor_${character.moduleName}_${character.characterName.replace(/\s+/g, '_')}${ext}`;
      const anchorPath = path.join(STORAGE_DIR, 'anchors', anchorFilename);

      // Ensure anchors directory exists
      const anchorsDir = path.join(STORAGE_DIR, 'anchors');
      if (!fs.existsSync(anchorsDir)) {
        fs.mkdirSync(anchorsDir, { recursive: true });
      }

      // Move file
      fs.renameSync(req.file.path, anchorPath);

      // Update character
      characterDb.setAnchorImage(req.params.id, anchorPath);

      const updated = characterDb.getById(req.params.id);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // Image generation endpoints
  // ==========================================

  // Generate a standalone image (one-off, not from asset list)
  router.post('/images/generate-standalone', upload.single('referenceImage'), async (req, res) => {
    try {
      const { prompt, moduleName, sessionNumber, pageNumber } = req.body;

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

      const outputPath = path.join(STORAGE_DIR, 'images', filename);

      // Ensure images directory exists
      const imagesDir = path.join(STORAGE_DIR, 'images');
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }

      // Get reference image path if uploaded
      const anchorImagePath = req.file ? req.file.path : null;

      // Generate the image
      const result = await imageGenService.generateAndSave({
        prompt,
        outputPath,
        anchorImagePath
      });

      // Clean up uploaded reference image after use
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      // Save to database so it appears in Library
      const dbRecord = generatedImageDb.create({
        assetListId: null,
        slideNumber: pageNumber ? parseInt(pageNumber) : null,
        assetType: 'standalone',
        cmsFilename: filename,
        originalPrompt: prompt,
        characterId: null,
        imagePath: outputPath,
        status: 'completed'
      });

      res.json({
        success: true,
        id: dbRecord.id,
        filename,
        path: `/images/${filename}`,
        mimeType: result.mimeType
      });
    } catch (error) {
      // Clean up on error
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
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

      const genImage = generatedImageDb.getById(generatedImageId);
      if (!genImage) {
        return res.status(404).json({ error: 'Generated image record not found' });
      }

      // Get the asset list to find module/session info
      const assetList = assetListDb.getById(genImage.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      // Determine the prompt to use
      const finalPrompt = prompt || genImage.modifiedPrompt || genImage.originalPrompt;
      if (!finalPrompt) {
        return res.status(400).json({ error: 'No prompt available for generation' });
      }

      // Check if we should use character anchor
      // Server-side validation: only use anchor for character-related asset types
      let anchorImagePath = null;
      const assetTypeLower = (genImage.assetType || '').toLowerCase();
      const isCharacterAssetType = assetTypeLower.includes('career') ||
                                   assetTypeLower.includes('character') ||
                                   assetTypeLower.includes('intro') ||
                                   assetTypeLower.includes('motion_graphics');

      if (useCharacterAnchor && isCharacterAssetType && genImage.characterId) {
        const character = characterDb.getById(genImage.characterId);
        if (character && character.anchorImagePath) {
          anchorImagePath = character.anchorImagePath;
        }
      }

      // Update status to generating
      generatedImageDb.update(generatedImageId, { status: 'generating', modifiedPrompt: finalPrompt });

      // Generate the image (async - respond immediately)
      const imageGenService = req.app.get('imageGenService');
      if (!imageGenService) {
        return res.status(500).json({ error: 'Image generation service not initialized' });
      }

      // Generate filename and path
      const outputFilename = genImage.cmsFilename || `image_${generatedImageId}.png`;
      const outputPath = path.join(STORAGE_DIR, 'images', outputFilename);

      // Ensure images directory exists
      const imagesDir = path.join(STORAGE_DIR, 'images');
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }

      // Run generation
      imageGenService.generateAndSave({
        prompt: finalPrompt,
        outputPath,
        anchorImagePath
      }).then(result => {
        // Update record with success
        generatedImageDb.update(generatedImageId, {
          status: 'completed',
          imagePath: result.path
        });

        // Add to generation history
        generationHistoryDb.create({
          generatedImageId,
          prompt: finalPrompt,
          imagePath: result.path
        });

        console.log(`Image generated successfully: ${outputFilename}`);
      }).catch(error => {
        // Update record with failure
        generatedImageDb.update(generatedImageId, { status: 'failed' });
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
  router.get('/images', (req, res) => {
    try {
      const { moduleName, sessionNumber, status, limit, offset } = req.query;
      // Support comma-separated statuses (e.g., "completed,uploaded,imported,default")
      // Express may parse repeated params as array or comma-separated as string
      let statuses;
      if (Array.isArray(status)) {
        statuses = status.map(s => s.trim());
      } else if (status) {
        statuses = status.split(',').map(s => s.trim());
      }
      const images = generatedImageDb.getAll({
        moduleName,
        sessionNumber: sessionNumber ? parseInt(sessionNumber) : undefined,
        statuses,
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined
      });
      res.json(images);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single generated image
  router.get('/images/:id', (req, res) => {
    try {
      const image = generatedImageDb.getById(req.params.id);
      if (!image) {
        return res.status(404).json({ error: 'Image not found' });
      }

      // Include generation history
      const history = generationHistoryDb.getByImageId(image.id);
      res.json({ ...image, history });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update image prompt and/or asset type
  router.patch('/images/:id', (req, res) => {
    try {
      const { modifiedPrompt, characterId, assetType } = req.body;

      const updates = {};
      if (modifiedPrompt !== undefined) updates.modifiedPrompt = modifiedPrompt;
      if (characterId !== undefined) updates.characterId = characterId;
      if (assetType !== undefined) {
        updates.assetType = assetType;
        // Also update CMS filename to reflect new type
        const image = generatedImageDb.getById(req.params.id);
        if (image && image.assetListId) {
          const assetList = assetListDb.getById(image.assetListId);
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

      const updated = generatedImageDb.update(req.params.id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Image not found' });
      }

      // Return the updated image
      const updatedImage = generatedImageDb.getById(req.params.id);
      res.json({ success: true, image: updatedImage });
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

      const genImage = generatedImageDb.getById(req.params.id);
      if (!genImage) {
        return res.status(404).json({ error: 'Generated image record not found' });
      }

      const assetList = assetListDb.getById(genImage.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      let sourcePath, sourceFilename;

      if (sourceType === 'video') {
        const video = videoDb.getById(sourceId);
        if (!video) {
          return res.status(404).json({ error: 'Source video not found' });
        }
        sourcePath = path.join(STORAGE_DIR, video.filename);
        sourceFilename = video.filename;
        // Tag the video with the module it's being used for
        videoDb.update(sourceId, { moduleName: assetList.moduleName });
      } else {
        // Image from generated_images table
        const sourceImage = generatedImageDb.getById(sourceId);
        if (!sourceImage || !sourceImage.imagePath) {
          return res.status(404).json({ error: 'Source image not found' });
        }
        sourcePath = sourceImage.imagePath;
        sourceFilename = path.basename(sourceImage.imagePath);
      }

      if (!fs.existsSync(sourcePath)) {
        return res.status(404).json({ error: 'Source file not found on disk' });
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

      const outputPath = path.join(STORAGE_DIR, 'images', outputFilename);

      // Ensure images directory exists
      const imagesDir = path.join(STORAGE_DIR, 'images');
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }

      // Copy file to new location
      fs.copyFileSync(sourcePath, outputPath);

      // Update the generated image record
      generatedImageDb.update(req.params.id, {
        status: 'imported',
        imagePath: outputPath,
        cmsFilename: outputFilename
      });

      // Add to generation history
      generationHistoryDb.create({
        generatedImageId: req.params.id,
        prompt: `[Imported from ${sourceType}: ${sourceFilename}]`,
        imagePath: outputPath
      });

      const updatedImage = generatedImageDb.getById(req.params.id);

      res.json({
        success: true,
        image: updatedImage,
        filename: outputFilename,
        path: `/images/${outputFilename}`
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Upload an image to fulfill a generated image record
  router.post('/images/:id/upload', upload.single('image'), async (req, res) => {
    try {
      const genImage = generatedImageDb.getById(req.params.id);
      if (!genImage) {
        return res.status(404).json({ error: 'Generated image record not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Image file is required' });
      }

      // Get the asset list to find module/session info for filename
      const assetList = assetListDb.getById(genImage.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      // Determine output filename (use existing cmsFilename or generate one)
      const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
      let outputFilename = genImage.cmsFilename;
      if (outputFilename) {
        // Replace extension with uploaded file's extension
        outputFilename = outputFilename.replace(/\.[^.]+$/, ext);
      } else {
        outputFilename = generateCmsFilename(
          assetList.moduleName,
          assetList.sessionNumber,
          { slideNumber: genImage.slideNumber, type: genImage.assetType, assetNumber: genImage.assetNumber || 1 }
        ).replace(/\.png$/, ext);
      }

      const outputPath = path.join(STORAGE_DIR, 'images', outputFilename);

      // Ensure images directory exists
      const imagesDir = path.join(STORAGE_DIR, 'images');
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }

      // Move uploaded file to permanent location
      fs.renameSync(req.file.path, outputPath);

      // Update the generated image record
      generatedImageDb.update(req.params.id, {
        status: 'uploaded',
        imagePath: outputPath,
        cmsFilename: outputFilename
      });

      // Add to generation history for tracking
      generationHistoryDb.create({
        generatedImageId: req.params.id,
        prompt: '[Uploaded]',
        imagePath: outputPath
      });

      const updatedImage = generatedImageDb.getById(req.params.id);

      res.json({
        success: true,
        image: updatedImage,
        filename: outputFilename,
        path: `/images/${outputFilename}`
      });
    } catch (error) {
      // Clean up uploaded file on error
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Regenerate an image
  router.put('/images/:id/regenerate', async (req, res) => {
    try {
      const { prompt, useCharacterAnchor } = req.body;

      const genImage = generatedImageDb.getById(req.params.id);
      if (!genImage) {
        return res.status(404).json({ error: 'Image not found' });
      }

      // Forward to generate endpoint logic
      req.body.generatedImageId = req.params.id;
      req.body.prompt = prompt || genImage.modifiedPrompt || genImage.originalPrompt;

      // Delegate to generate handler (simulate internal call)
      const imageGenService = req.app.get('imageGenService');
      if (!imageGenService) {
        return res.status(500).json({ error: 'Image generation service not initialized' });
      }

      const finalPrompt = req.body.prompt;

      // Server-side validation: only use anchor for character-related asset types
      let anchorImagePath = null;
      const assetTypeLower = (genImage.assetType || '').toLowerCase();
      const isCharacterAssetType = assetTypeLower.includes('career') ||
                                   assetTypeLower.includes('character') ||
                                   assetTypeLower.includes('intro') ||
                                   assetTypeLower.includes('motion_graphics');

      if (useCharacterAnchor && isCharacterAssetType && genImage.characterId) {
        const character = characterDb.getById(genImage.characterId);
        if (character && character.anchorImagePath) {
          anchorImagePath = character.anchorImagePath;
        }
      }

      // Update status
      generatedImageDb.update(req.params.id, { status: 'generating', modifiedPrompt: finalPrompt });

      const outputFilename = genImage.cmsFilename || `image_${genImage.id}.png`;
      const outputPath = path.join(STORAGE_DIR, 'images', outputFilename);

      // Run regeneration
      imageGenService.generateAndSave({
        prompt: finalPrompt,
        outputPath,
        anchorImagePath
      }).then(result => {
        generatedImageDb.update(req.params.id, {
          status: 'completed',
          imagePath: result.path
        });
        generationHistoryDb.create({
          generatedImageId: req.params.id,
          prompt: finalPrompt,
          imagePath: result.path
        });
        console.log(`Image regenerated successfully: ${outputFilename}`);
      }).catch(error => {
        generatedImageDb.update(req.params.id, { status: 'failed' });
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

  // Get motion graphics video + scenes for a specific slide
  router.get('/motion-graphics/:assetListId/:slideNumber', (req, res) => {
    try {
      const { assetListId, slideNumber } = req.params;

      const assetList = assetListDb.getById(assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      // Get the MG video record for this slide
      const mgVideo = mgVideoDb.getByAssetListAndSlide(assetListId, parseInt(slideNumber));

      // Get all scene images for this slide (motion_graphics_scene type)
      const allImages = generatedImageDb.getByAssetList(assetListId);
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

  // Upload final video for a motion graphics slide
  router.post('/motion-graphics/:assetListId/:slideNumber/video', upload.single('video'), async (req, res) => {
    try {
      const { assetListId, slideNumber } = req.params;

      const assetList = assetListDb.getById(assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Video file is required' });
      }

      // Generate CMS filename for the video (VID pattern)
      const cmsFilename = generateMGVideoFilename(
        assetList.moduleName,
        assetList.sessionNumber,
        parseInt(slideNumber)
      );

      const outputPath = path.join(STORAGE_DIR, 'mg-videos', cmsFilename);

      // Ensure mg-videos directory exists
      const mgVideosDir = path.join(STORAGE_DIR, 'mg-videos');
      if (!fs.existsSync(mgVideosDir)) {
        fs.mkdirSync(mgVideosDir, { recursive: true });
      }

      // Move uploaded file to permanent location
      fs.renameSync(req.file.path, outputPath);

      // Count scenes for this slide
      const allImages = generatedImageDb.getByAssetList(assetListId);
      const sceneCount = allImages.filter(img =>
        img.slideNumber === parseInt(slideNumber) &&
        (img.assetType === 'motion_graphics_scene' || img.assetType === 'motion_graphics')
      ).length;

      // Check if record exists
      let mgVideo = mgVideoDb.getByAssetListAndSlide(assetListId, parseInt(slideNumber));

      if (mgVideo) {
        // Delete old video file if exists
        if (mgVideo.videoPath && fs.existsSync(mgVideo.videoPath)) {
          fs.unlinkSync(mgVideo.videoPath);
        }
        // Update existing record
        mgVideo = mgVideoDb.update(mgVideo.id, {
          cmsFilename,
          videoPath: outputPath,
          status: 'uploaded',
          sceneCount
        });
      } else {
        // Create new record
        mgVideo = mgVideoDb.create({
          assetListId,
          slideNumber: parseInt(slideNumber),
          cmsFilename,
          videoPath: outputPath,
          status: 'uploaded',
          sceneCount
        });
      }

      res.json({
        success: true,
        video: mgVideo,
        filename: cmsFilename,
        path: `/mg-videos/${cmsFilename}`
      });
    } catch (error) {
      // Clean up uploaded file on error
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Delete motion graphics video for a slide
  router.delete('/motion-graphics/:assetListId/:slideNumber/video', (req, res) => {
    try {
      const { assetListId, slideNumber } = req.params;

      const mgVideo = mgVideoDb.getByAssetListAndSlide(assetListId, parseInt(slideNumber));
      if (!mgVideo) {
        return res.status(404).json({ error: 'Motion graphics video not found' });
      }

      // Delete the video file
      if (mgVideo.videoPath && fs.existsSync(mgVideo.videoPath)) {
        fs.unlinkSync(mgVideo.videoPath);
      }

      // Update record to pending (keep the record for tracking)
      mgVideoDb.update(mgVideo.id, {
        videoPath: null,
        status: 'pending'
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Add a new scene to a motion graphics slide
  router.post('/motion-graphics/:assetListId/:slideNumber/scenes', (req, res) => {
    try {
      const { assetListId, slideNumber } = req.params;
      const { prompt, assetType = 'motion_graphics' } = req.body;

      const assetList = assetListDb.getById(assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      // Get existing scenes for this slide to determine next assetNumber
      const allImages = generatedImageDb.getByAssetList(assetListId);
      const slideScenes = allImages.filter(img =>
        img.slideNumber === parseInt(slideNumber) &&
        (img.assetType === 'motion_graphics_scene' || img.assetType === 'motion_graphics')
      );

      // Calculate next asset number
      const maxAssetNum = slideScenes.reduce((max, scene) => {
        return Math.max(max, scene.assetNumber || 1);
      }, 0);
      const newAssetNumber = maxAssetNum + 1;

      // Generate CMS filename following MG pattern
      const cmsFilename = generateMGSceneFilename(
        assetList.moduleName,
        assetList.sessionNumber,
        parseInt(slideNumber),
        newAssetNumber
      );

      // Check if character appears on this slide
      const character = characterDb.getByModule(assetList.moduleName);
      const slideKey = `S${assetList.sessionNumber}-${slideNumber}`;
      const hasCharacter = character && character.appearsOnSlides?.some(s =>
        s === slideKey || s === String(slideNumber)
      );

      // Create the new scene record
      const newScene = generatedImageDb.create({
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
        scene: newScene,
        message: `Added scene ${newAssetNumber} to slide ${slideNumber}`
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a motion graphics scene
  router.delete('/motion-graphics/scenes/:sceneId', (req, res) => {
    try {
      const { sceneId } = req.params;

      const scene = generatedImageDb.getById(sceneId);
      if (!scene) {
        return res.status(404).json({ error: 'Scene not found' });
      }

      // Delete the image file if it exists
      if (scene.imagePath && fs.existsSync(scene.imagePath)) {
        fs.unlinkSync(scene.imagePath);
      }

      // Delete the database record
      generatedImageDb.deleteByIds([sceneId]);

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

  // Get available voices
  router.get('/voices', async (req, res) => {
    try {
      const elevenLabsService = req.app.get('elevenLabsService');
      if (!elevenLabsService || !elevenLabsService.isConfigured()) {
        // Return hardcoded voices even if not configured
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

  // Generate audio for a slide
  router.post('/audio/generate', async (req, res) => {
    try {
      const { audioId, text, voiceId, voiceName } = req.body;

      if (!audioId) {
        return res.status(400).json({ error: 'audioId is required' });
      }

      const audioRecord = generatedAudioDb.getById(audioId);
      if (!audioRecord) {
        return res.status(404).json({ error: 'Audio record not found' });
      }

      const elevenLabsService = req.app.get('elevenLabsService');
      if (!elevenLabsService || !elevenLabsService.isConfigured()) {
        return res.status(503).json({ error: 'TTS service not configured. Add ELEVENLABS_API_KEY to .env file.' });
      }

      // Use provided text or existing narration
      const narrationText = text || audioRecord.narrationText;
      if (!narrationText || narrationText.trim().length === 0) {
        return res.status(400).json({ error: 'No narration text provided' });
      }

      // Get the asset list to generate filename
      const assetList = assetListDb.getById(audioRecord.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      // Generate CMS filename
      const cmsFilename = generateAudioFilename(
        assetList.moduleName,
        assetList.sessionNumber,
        audioRecord.slideNumber
      );

      const outputPath = path.join(STORAGE_DIR, 'audio', cmsFilename);

      // Update status to generating
      generatedAudioDb.update(audioId, {
        status: 'generating',
        narrationText,
        voiceId: voiceId || audioRecord.voiceId,
        voiceName: voiceName || audioRecord.voiceName
      });

      // Generate audio asynchronously
      elevenLabsService.generateAndSave({
        text: narrationText,
        outputPath,
        voiceId: voiceId || audioRecord.voiceId
      }).then(result => {
        // Verify file was actually created before marking complete
        if (fs.existsSync(result.path)) {
          generatedAudioDb.update(audioId, {
            status: 'completed',
            audioPath: result.path,
            cmsFilename,
            durationMs: result.durationMs
          });
          console.log(`Audio generated successfully: ${cmsFilename}`);
        } else {
          generatedAudioDb.update(audioId, { status: 'failed' });
          console.error(`Audio file not created at expected path: ${result.path}`);
        }
      }).catch(error => {
        generatedAudioDb.update(audioId, { status: 'failed' });
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

  // Upload audio file manually
  router.post('/audio/:id/upload', upload.single('audio'), async (req, res) => {
    try {
      const audioRecord = generatedAudioDb.getById(req.params.id);
      if (!audioRecord) {
        return res.status(404).json({ error: 'Audio record not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Audio file is required' });
      }

      const assetList = assetListDb.getById(audioRecord.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      // Generate CMS filename
      const ext = path.extname(req.file.originalname).toLowerCase() || '.mp3';
      const cmsFilename = generateAudioFilename(
        assetList.moduleName,
        assetList.sessionNumber,
        audioRecord.slideNumber
      ).replace(/\.mp3$/, ext);

      const outputPath = path.join(STORAGE_DIR, 'audio', cmsFilename);

      // Ensure audio directory exists
      const audioDir = path.join(STORAGE_DIR, 'audio');
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      // Move uploaded file
      fs.renameSync(req.file.path, outputPath);

      // Update record
      const updated = generatedAudioDb.update(req.params.id, {
        status: 'uploaded',
        audioPath: outputPath,
        cmsFilename
      });

      res.json({
        success: true,
        audio: updated,
        filename: cmsFilename,
        path: `/audio/${cmsFilename}`
      });
    } catch (error) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Update audio settings (narration text, voice)
  router.patch('/audio/:id', (req, res) => {
    try {
      const { narrationText, voiceId, voiceName } = req.body;

      const updates = {};
      if (narrationText !== undefined) updates.narrationText = narrationText;
      if (voiceId !== undefined) updates.voiceId = voiceId;
      if (voiceName !== undefined) updates.voiceName = voiceName;

      const updated = generatedAudioDb.update(req.params.id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Audio record not found' });
      }

      res.json({ success: true, audio: updated });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Regenerate audio
  router.put('/audio/:id/regenerate', async (req, res) => {
    try {
      const { text, voiceId, voiceName } = req.body;

      const audioRecord = generatedAudioDb.getById(req.params.id);
      if (!audioRecord) {
        return res.status(404).json({ error: 'Audio record not found' });
      }

      // Forward to generate endpoint
      req.body.audioId = req.params.id;
      req.body.text = text || audioRecord.narrationText;

      const elevenLabsService = req.app.get('elevenLabsService');
      if (!elevenLabsService || !elevenLabsService.isConfigured()) {
        return res.status(503).json({ error: 'TTS service not configured' });
      }

      const assetList = assetListDb.getById(audioRecord.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      const narrationText = text || audioRecord.narrationText;
      if (!narrationText || narrationText.trim().length === 0) {
        return res.status(400).json({ error: 'No narration text provided' });
      }

      const cmsFilename = generateAudioFilename(
        assetList.moduleName,
        assetList.sessionNumber,
        audioRecord.slideNumber
      );
      const outputPath = path.join(STORAGE_DIR, 'audio', cmsFilename);

      // Update status
      generatedAudioDb.update(req.params.id, {
        status: 'generating',
        narrationText,
        voiceId: voiceId || audioRecord.voiceId,
        voiceName: voiceName || audioRecord.voiceName
      });

      // Regenerate
      elevenLabsService.generateAndSave({
        text: narrationText,
        outputPath,
        voiceId: voiceId || audioRecord.voiceId
      }).then(result => {
        // Verify file was actually created before marking complete
        if (fs.existsSync(result.path)) {
          generatedAudioDb.update(req.params.id, {
            status: 'completed',
            audioPath: result.path,
            cmsFilename,
            durationMs: result.durationMs
          });
          console.log(`Audio regenerated successfully: ${cmsFilename}`);
        } else {
          generatedAudioDb.update(req.params.id, { status: 'failed' });
          console.error(`Audio file not created at expected path: ${result.path}`);
        }
      }).catch(error => {
        generatedAudioDb.update(req.params.id, { status: 'failed' });
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

  // Set default voice for an asset list (session)
  router.patch('/asset-lists/:id/voice', (req, res) => {
    try {
      const { voiceId, voiceName } = req.body;

      const assetList = assetListDb.getById(req.params.id);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      assetListDb.update(req.params.id, {
        defaultVoiceId: voiceId,
        defaultVoiceName: voiceName
      });

      const updated = assetListDb.getById(req.params.id);
      res.json({ success: true, assetList: updated });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get audio records for an asset list
  router.get('/asset-lists/:id/audio', (req, res) => {
    try {
      const assetList = assetListDb.getById(req.params.id);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      const audioRecords = generatedAudioDb.getByAssetList(req.params.id);
      res.json(audioRecords);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};

// Helper function to generate CMS filename for audio
// Pattern: MOD.{MODULE}.{SESSION}.{SLIDE}.NAR1.mp3
function generateAudioFilename(moduleName, sessionNumber, slideNumber) {
  const moduleCodeMap = {
    'Reactions': 'REAC',
    'Energy': 'ENER',
    'Waves': 'WAVE',
    'Forces': 'FORC',
    'Matter': 'MATT',
    'Ecosystems': 'ECOS'
  };

  const moduleCode = moduleCodeMap[moduleName] || moduleName.substring(0, 4).toUpperCase();
  return `MOD.${moduleCode}.${sessionNumber}.${slideNumber}.NAR1.mp3`;
}

// Helper function to generate CMS filename for motion graphics videos
// Pattern: MOD.{MODULE}.{SESSION}.{SLIDE}.VID1.mp4
function generateMGVideoFilename(moduleName, sessionNumber, slideNumber) {
  const moduleCodeMap = {
    'Reactions': 'REAC',
    'Energy': 'ENER',
    'Waves': 'WAVE',
    'Forces': 'FORC',
    'Matter': 'MATT',
    'Ecosystems': 'ECOS'
  };

  const moduleCode = moduleCodeMap[moduleName] || moduleName.substring(0, 4).toUpperCase();
  return `MOD.${moduleCode}.${sessionNumber}.${slideNumber}.VID1.mp4`;
}

// Helper function to generate CMS filename for motion graphics scene images
// Pattern: MOD.{MODULE}.{SESSION}.{SLIDE}.MG.{SCENE}.png
function generateMGSceneFilename(moduleName, sessionNumber, slideNumber, sceneNumber) {
  const moduleCodeMap = {
    'Reactions': 'REAC',
    'Energy': 'ENER',
    'Waves': 'WAVE',
    'Forces': 'FORC',
    'Matter': 'MATT',
    'Ecosystems': 'ECOS'
  };

  const moduleCode = moduleCodeMap[moduleName] || moduleName.substring(0, 4).toUpperCase();
  return `MOD.${moduleCode}.${sessionNumber}.${slideNumber}.MG.${sceneNumber}.png`;
}

// Helper function to extract unique slides from assets array
// Used when Carl doesn't send a separate slides array
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

// Helper function to generate CMS filename
// Pattern: MOD.{MODULE}.{SESSION}.{PAGE}.{TYPE}{NUM}.{EXT}
function generateCmsFilename(moduleName, sessionNumber, asset) {
  // Module code mapping
  const moduleCodeMap = {
    'Reactions': 'REAC',
    'Energy': 'ENER',
    'Waves': 'WAVE',
    'Forces': 'FORC',
    'Matter': 'MATT',
    'Ecosystems': 'ECOS'
  };

  const moduleCode = moduleCodeMap[moduleName] || moduleName.substring(0, 4).toUpperCase();
  const session = sessionNumber || 0;
  const slide = asset.slideNumber || 0;

  // Type code mapping
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

// Prompt templates for common use cases
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
