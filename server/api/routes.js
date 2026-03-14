const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');

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

const router = express.Router();

// Default images for specific slide types
// Maps slide title patterns (lowercase) to default image filenames
const DEFAULT_SLIDE_IMAGES = {
  'clean up': 'cleanup.png',
  'cleanup': 'cleanup.png',
  'lab safety': 'lab_safety.png',
  'lab_safety': 'lab_safety.png'
};

// Check if a slide title matches a default image pattern
async function getDefaultImageForSlide(slideTitle) {
  if (!slideTitle) return null;
  const titleLower = slideTitle.toLowerCase().trim();

  for (const [pattern, filename] of Object.entries(DEFAULT_SLIDE_IMAGES)) {
    if (titleLower.includes(pattern)) {
      // Check if default image exists in Supabase Storage
      const exists = await storage.fileExists(BUCKETS.DEFAULTS, filename);
      if (exists) {
        return {
          filename,
          publicUrl: storage.getPublicUrl(BUCKETS.DEFAULTS, filename)
        };
      }
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
      const filename = `${Date.now()}_${req.file.originalname}`;
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
      require('fs').unlinkSync(req.file.path);

      res.json({ jobId: job.id, status: job.status });
    } catch (error) {
      if (req.file && require('fs').existsSync(req.file.path)) {
        require('fs').unlinkSync(req.file.path);
      }
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
      require('fs').unlinkSync(firstFile.path);
      require('fs').unlinkSync(lastFile.path);

      res.json({ jobId: job.id, status: job.status });
    } catch (error) {
      // Clean up on error
      if (req.files?.firstFrame?.[0]?.path && require('fs').existsSync(req.files.firstFrame[0].path)) {
        require('fs').unlinkSync(req.files.firstFrame[0].path);
      }
      if (req.files?.lastFrame?.[0]?.path && require('fs').existsSync(req.files.lastFrame[0].path)) {
        require('fs').unlinkSync(req.files.lastFrame[0].path);
      }
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
          `${Date.now()}_${file.originalname}`,
          file.path,
          file.mimetype
        );
        uploadedUrls.push(uploaded.publicUrl);
        require('fs').unlinkSync(file.path);
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
      if (req.files) {
        for (const file of req.files) {
          if (require('fs').existsSync(file.path)) {
            require('fs').unlinkSync(file.path);
          }
        }
      }
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

      // If RCP slides detected, partition and process both lists
      if (hasRcpSlides) {
        // Partition slides by RCP vs non-RCP
        const regularSlides = allSlides.filter(s => !isRcpSlideType(s.slideType));
        const rcpSlides = allSlides.filter(s => isRcpSlideType(s.slideType));

        // Get slide numbers for each partition
        const rcpSlideNumbers = new Set(rcpSlides.map(s => s.slideNumber ?? s.slide_number));

        // Partition assets by slide membership
        const regularAssets = assets.filter(a => !rcpSlideNumbers.has(a.slideNumber));
        const rcpAssets = assets.filter(a => rcpSlideNumbers.has(a.slideNumber));

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

      // Keep all assets
      const filteredAssets = assets;

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
          slides: allSlides,
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
          slides: allSlides,
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
      let audioCreated = 0;
      let audioKept = 0;
      if (allSlides && allSlides.length > 0) {
        for (const slide of allSlides) {
          const slideNum = parseInt(slide.slideNumber ?? slide.slide_number ?? 0);
          const narration = slide.narration || slide.narrationText || '';

          if (narration && narration.trim().length > 0) {
            const existingAudio = await generatedAudioDb.getByAssetListAndSlide(assetList.id, slideNum);
            if (existingAudio) {
              if (existingAudio.narrationText !== narration) {
                await generatedAudioDb.update(existingAudio.id, { narrationText: narration });
              }
              audioKept++;
            } else {
              await generatedAudioDb.create({
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

      const generatedImages = await generatedImageDb.getByAssetList(assetList.id);
      const motionGraphicsVideos = await mgVideoDb.getByAssetList(assetList.id);
      const generatedAudio = await generatedAudioDb.getByAssetList(assetList.id);

      // Backfill characterId for existing MG scenes that don't have one
      const characters = await characterDb.getByModule(assetList.moduleName);
      const character = characters[0]; // Get first character for module
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
            await generatedImageDb.update(scene.id, { characterId: character.id });
            scene.characterId = character.id;
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
        require('fs').unlinkSync(file.path);
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
      if (req.files) {
        for (const file of req.files) {
          if (require('fs').existsSync(file.path)) {
            require('fs').unlinkSync(file.path);
          }
        }
      }
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

      // Get reference image URLs if uploaded
      const anchorImageUrls = [];
      if (req.files) {
        for (const file of req.files) {
          const uploaded = await storage.uploadFileFromPath(
            BUCKETS.UPLOADS,
            `ref_${Date.now()}_${file.originalname}`,
            file.path,
            file.mimetype
          );
          anchorImageUrls.push(uploaded.publicUrl);
          require('fs').unlinkSync(file.path);
        }
      }

      // Generate the image
      const result = await imageGenService.generateToStorage({
        prompt,
        bucket: BUCKETS.IMAGES,
        filename,
        anchorImageUrls
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
        mimeType: result.mimeType
      });
    } catch (error) {
      // Clean up on error
      if (req.files) {
        for (const file of req.files) {
          if (require('fs').existsSync(file.path)) {
            require('fs').unlinkSync(file.path);
          }
        }
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

      const genImage = await generatedImageDb.getById(generatedImageId);
      if (!genImage) {
        return res.status(404).json({ error: 'Generated image record not found' });
      }

      const assetList = await assetListDb.getById(genImage.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
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
      const { moduleName, sessionNumber, status, limit, offset } = req.query;
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
        offset: offset ? parseInt(offset) : undefined
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

      const assetList = await assetListDb.getById(genImage.assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
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

      // Upload to Supabase Storage
      const uploaded = await storage.uploadFileFromPath(
        BUCKETS.IMAGES,
        outputFilename,
        req.file.path,
        req.file.mimetype
      );

      // Clean up temp file
      require('fs').unlinkSync(req.file.path);

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
      if (req.file && require('fs').existsSync(req.file.path)) {
        require('fs').unlinkSync(req.file.path);
      }
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
      require('fs').unlinkSync(req.file.path);

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
      if (req.file && require('fs').existsSync(req.file.path)) {
        require('fs').unlinkSync(req.file.path);
      }
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

  router.post('/motion-graphics/:assetListId/:slideNumber/scenes', async (req, res) => {
    try {
      const { assetListId, slideNumber } = req.params;
      const { prompt, assetType = 'motion_graphics' } = req.body;

      const assetList = await assetListDb.getById(assetListId);
      if (!assetList) {
        return res.status(404).json({ error: 'Asset list not found' });
      }

      const allImages = await generatedImageDb.getByAssetList(assetListId);
      const slideScenes = allImages.filter(img =>
        img.slideNumber === parseInt(slideNumber) &&
        (img.assetType === 'motion_graphics_scene' || img.assetType === 'motion_graphics')
      );

      const maxAssetNum = slideScenes.reduce((max, scene) => {
        return Math.max(max, scene.assetNumber || 1);
      }, 0);
      const newAssetNumber = maxAssetNum + 1;

      const cmsFilename = generateMGSceneFilename(
        assetList.moduleName,
        assetList.sessionNumber,
        parseInt(slideNumber),
        newAssetNumber
      );

      const characters = await characterDb.getByModule(assetList.moduleName);
      const character = characters[0];
      const slideKey = `S${assetList.sessionNumber}-${slideNumber}`;
      const hasCharacter = character && character.appearsOnSlides?.some(s =>
        s === slideKey || s === String(slideNumber)
      );

      const newScene = await generatedImageDb.create({
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
        audioRecord.slideNumber
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
        audioRecord.slideNumber
      ).replace(/\.mp3$/, ext);

      const uploaded = await storage.uploadFileFromPath(
        BUCKETS.AUDIO,
        cmsFilename,
        req.file.path,
        req.file.mimetype
      );

      require('fs').unlinkSync(req.file.path);

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
      if (req.file && require('fs').existsSync(req.file.path)) {
        require('fs').unlinkSync(req.file.path);
      }
      res.status(500).json({ error: error.message });
    }
  });

  router.patch('/audio/:id', async (req, res) => {
    try {
      const { narrationText, voiceId, voiceName } = req.body;

      const updates = {};
      if (narrationText !== undefined) updates.narrationText = narrationText;
      if (voiceId !== undefined) updates.voiceId = voiceId;
      if (voiceName !== undefined) updates.voiceName = voiceName;

      const updated = await generatedAudioDb.update(req.params.id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Audio record not found' });
      }

      res.json({ success: true, audio: updated });
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

      const assetList = await assetListDb.getById(audioRecord.assetListId);
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

      const assessmentLabel = assessmentType === 'pre_test' ? 'Pre-Test' : 'Post-Test';
      const action = isUpdate ? 'Updated' : 'Created';
      const details = isUpdate
        ? `${kept} kept, ${created} added, ${imagesToDelete.length} removed`
        : `${created} image records`;

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

  // Get single assessment asset with its generated images
  router.get('/assessment-assets/:id', async (req, res) => {
    try {
      const assessment = await assessmentAssetDb.getById(req.params.id);
      if (!assessment) {
        return res.status(404).json({ error: 'Assessment asset not found' });
      }

      const generatedImages = await generatedImageDb.getByAssessmentAsset(assessment.id);

      res.json({
        ...assessment,
        generatedImages
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

      const deleted = await assessmentAssetDb.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Assessment asset not found' });
      }
      res.json({ success: true, deletedImages: images.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};

// Helper functions
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
  let audioCreated = 0;
  let audioKept = 0;
  if (slides && slides.length > 0) {
    for (const slide of slides) {
      const slideNum = parseInt(slide.slideNumber ?? slide.slide_number ?? 0);
      const narration = slide.narration || slide.narrationText || '';

      if (narration && narration.trim().length > 0) {
        const existingAudio = await generatedAudioDb.getByAssetListAndSlide(assetList.id, slideNum);
        if (existingAudio) {
          if (existingAudio.narrationText !== narration) {
            await generatedAudioDb.update(existingAudio.id, { narrationText: narration });
          }
          audioKept++;
        } else {
          await generatedAudioDb.create({
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
  const typeLabel = sessionType !== 'regular' ? ` ${sessionType.toUpperCase()}` : '';

  return {
    assetList,
    generatedImages,
    message: `${action} ${moduleName} Session ${sessionNumber}${typeLabel}: ${details}`
  };
}

function generateCmsFilename(moduleName, sessionNumber, asset) {
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
  const moduleCodeMap = {
    'Reactions': 'REAC',
    'Energy': 'ENER',
    'Waves': 'WAVE',
    'Forces': 'FORC',
    'Matter': 'MATT',
    'Ecosystems': 'ECOS',
    'Heat and Energy': 'ENER'
  };

  const moduleCode = moduleCodeMap[moduleName] || moduleName.substring(0, 4).toUpperCase();
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
