const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const MODEL = 'veo-3.1-generate-preview';
const POLL_INTERVAL = 10000; // 10 seconds

class VeoService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = new GoogleGenAI({ apiKey });
  }

  // Text-to-video generation
  async generateFromText({ prompt, negativePrompt, aspectRatio = '16:9', durationSeconds = '8', resolution = '720p' }) {
    const config = {
      aspectRatio,
      numberOfVideos: 1,
      durationSeconds: String(durationSeconds),
      resolution
    };

    if (negativePrompt) {
      config.negativePrompt = negativePrompt;
    }

    return this._startOperation({ prompt, config });
  }

  // Image-to-video generation
  async generateFromImage({ image, prompt, negativePrompt, aspectRatio = '16:9', durationSeconds = '8', resolution = '720p' }) {
    const imageData = await this._prepareImage(image);

    const config = {
      aspectRatio,
      numberOfVideos: 1,
      durationSeconds: String(durationSeconds),
      resolution
    };

    if (negativePrompt) {
      config.negativePrompt = negativePrompt;
    }

    return this._startOperation({ prompt, image: imageData, config });
  }

  // Frame interpolation (first + last frame)
  async generateFromFrames({ firstFrame, lastFrame, prompt, negativePrompt, aspectRatio = '16:9', resolution = '720p' }) {
    const firstFrameData = await this._prepareImage(firstFrame);
    const lastFrameData = await this._prepareImage(lastFrame);

    const config = {
      aspectRatio,
      numberOfVideos: 1,
      durationSeconds: '8',
      resolution
    };

    if (negativePrompt) {
      config.negativePrompt = negativePrompt;
    }

    return this._startOperation({ prompt, image: firstFrameData, lastFrame: lastFrameData, config });
  }

  // Reference-guided generation (up to 3 reference images)
  async generateWithReferences({ referenceImages, prompt, negativePrompt, aspectRatio = '16:9', resolution = '720p' }) {
    const refs = await Promise.all(
      referenceImages.slice(0, 3).map(async (img) => {
        const imageData = await this._prepareImage(img);
        return {
          ...imageData,
          referenceType: 'asset'
        };
      })
    );

    const config = {
      aspectRatio,
      numberOfVideos: 1,
      durationSeconds: '8',
      resolution,
      referenceImages: refs
    };

    if (negativePrompt) {
      config.negativePrompt = negativePrompt;
    }

    return this._startOperation({ prompt, config });
  }

  // Video extension
  async extendVideo({ videoFile, prompt }) {
    const videoData = await this._prepareVideo(videoFile);

    const config = {
      numberOfVideos: 1
    };

    return this._startOperation({ prompt, video: videoData, config });
  }

  // Start a generation operation and return operation object (serialized)
  async _startOperation(params) {
    const operation = await this.client.models.generateVideos({
      model: MODEL,
      ...params
    });

    // Debug: log the operation structure
    console.log('Operation response:', JSON.stringify(operation, null, 2));

    // Store the entire operation object as JSON string for later polling
    return {
      operationData: JSON.stringify(operation),
      operationName: operation.name,
      status: 'pending'
    };
  }

  // Poll operation status - takes the serialized operation data
  async checkOperation(operationData) {
    // Parse the stored operation object
    const operationObj = JSON.parse(operationData);

    // The SDK expects: ai.operations.get({operation: operationObject})
    const operation = await this.client.operations.get({ operation: operationObj });

    // Debug: log polling response
    console.log('Poll response:', JSON.stringify(operation, null, 2));

    if (operation.done) {
      if (operation.error) {
        return {
          status: 'failed',
          error: operation.error.message || JSON.stringify(operation.error)
        };
      }

      // Check for content filtered responses
      const result = operation.result || operation.response?.generateVideoResponse;
      if (result?.raiMediaFilteredReasons?.length > 0) {
        return {
          status: 'failed',
          error: result.raiMediaFilteredReasons.join('; ')
        };
      }

      // Check various possible locations for generated videos
      const videos = operation.result?.generatedVideos ||
                     operation.response?.generatedVideos ||
                     operation.generatedVideos ||
                     [];

      if (videos.length === 0) {
        return {
          status: 'failed',
          error: 'No videos were generated. The content may have been filtered.'
        };
      }

      return {
        status: 'completed',
        videos: videos.map(v => ({
          uri: v.video?.uri || v.uri,
          mimeType: v.video?.mimeType || v.mimeType || 'video/mp4'
        }))
      };
    }

    return {
      status: 'processing',
      // Return updated operation data for next poll
      operationData: JSON.stringify(operation)
    };
  }

  // Download video to local storage
  async downloadVideo(videoUri, outputPath) {
    // The URI is a direct download URL - fetch it with the API key
    const url = new URL(videoUri);
    url.searchParams.set('key', this.apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  }

  // Prepare image for API
  async _prepareImage(imagePath) {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();

    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp'
    };

    return {
      imageBytes: base64,
      mimeType: mimeTypes[ext] || 'image/jpeg'
    };
  }

  // Prepare video for API (extension)
  async _prepareVideo(videoPath) {
    const videoBuffer = fs.readFileSync(videoPath);
    const base64 = videoBuffer.toString('base64');

    return {
      videoBytes: base64,
      mimeType: 'video/mp4'
    };
  }
}

module.exports = VeoService;
