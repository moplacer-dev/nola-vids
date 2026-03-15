const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const { fetchWithTimeout, TIMEOUTS } = require('../utils/fetchWithTimeout');

const MODEL = 'veo-3.1-generate-preview';
const POLL_INTERVAL = 10000; // 10 seconds

class VeoService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = new GoogleGenAI({ apiKey });
  }

  // Text-to-video generation
  async generateFromText({ prompt, negativePrompt, aspectRatio = '16:9', durationSeconds = 8, resolution = '720p' }) {
    const config = {
      aspectRatio,
      numberOfVideos: 1,
      durationSeconds: Number(durationSeconds),
      resolution
    };

    if (negativePrompt) {
      config.negativePrompt = negativePrompt;
    }

    return this._startOperation({ prompt, config });
  }

  // Image-to-video generation
  async generateFromImage({ image, prompt, negativePrompt, aspectRatio = '16:9', durationSeconds = 8, resolution = '720p' }) {
    const imageData = await this._prepareImage(image);

    const config = {
      aspectRatio,
      numberOfVideos: 1,
      durationSeconds: Number(durationSeconds),
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
      durationSeconds: 8,
      resolution,
      lastFrame: lastFrameData
    };

    if (negativePrompt) {
      config.negativePrompt = negativePrompt;
    }

    return this._startOperation({ prompt, image: firstFrameData, config });
  }

  // Reference-guided generation (up to 3 reference images)
  async generateWithReferences({ referenceImages, prompt, negativePrompt, aspectRatio = '16:9', resolution = '720p' }) {
    const refs = await Promise.all(
      referenceImages.slice(0, 3).map(async (img) => {
        const imageData = await this._prepareImage(img);
        return {
          image: imageData,
          referenceType: 'asset'
        };
      })
    );

    const config = {
      aspectRatio,
      numberOfVideos: 1,
      durationSeconds: 8,
      resolution,
      referenceImages: refs
    };

    if (negativePrompt) {
      config.negativePrompt = negativePrompt;
    }

    return this._startOperation({ prompt, config });
  }

  // Video extension - requires URI from a previous Veo generation
  async extendVideo({ videoUri, prompt }) {
    if (!videoUri) {
      throw new Error('Video extension requires a source URI from a previous Veo generation');
    }

    const config = {
      numberOfVideos: 1,
      resolution: '720p'  // Video extension only supports 720p
    };

    // Pass the video as a URI reference
    return this._startOperation({
      prompt,
      video: { uri: videoUri },
      config
    });
  }

  // Start a generation operation and return operation name for polling
  async _startOperation(params) {
    const operation = await this.client.models.generateVideos({
      model: MODEL,
      ...params
    });

    // Debug: log the operation structure
    console.log('Operation response:', JSON.stringify(operation, null, 2));

    // Return operation name for polling
    return {
      operationName: operation.name,
      status: 'pending'
    };
  }

  // Poll operation status - takes the operation name string
  async checkOperation(operationName) {
    console.log('checkOperation called with:', operationName);

    // Use REST API directly since SDK's getVideosOperation requires the full operation object
    // API key in header instead of URL for security
    const url = `https://generativelanguage.googleapis.com/v1beta/${operationName}`;
    const response = await fetchWithTimeout(url, {
      headers: { 'x-goog-api-key': this.apiKey }
    }, TIMEOUTS.API);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to poll operation: ${response.status} ${errorText}`);
    }

    const operation = await response.json();

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
      const generateVideoResponse = operation.response?.generateVideoResponse;
      if (generateVideoResponse?.raiMediaFilteredReasons?.length > 0) {
        return {
          status: 'failed',
          error: generateVideoResponse.raiMediaFilteredReasons.join('; ')
        };
      }

      // Check various possible locations for generated videos
      // REST API returns: response.generateVideoResponse.generatedSamples
      // SDK might return: response.generatedVideos or result.generatedVideos
      const videos = generateVideoResponse?.generatedSamples ||
                     operation.response?.generatedVideos ||
                     operation.result?.generatedVideos ||
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
      // Return operation name for next poll
      operationName: operation.name
    };
  }

  // Download video to local storage (legacy method)
  async downloadVideo(videoUri, outputPath) {
    // The URI is a direct download URL - fetch it with the API key in header
    const response = await fetchWithTimeout(videoUri, {
      headers: { 'x-goog-api-key': this.apiKey }
    }, TIMEOUTS.DOWNLOAD);
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  }

  // Download video to buffer (for Supabase Storage upload) - legacy, prefer downloadVideoToFile
  async downloadVideoToBuffer(videoUri) {
    // The URI is a direct download URL - fetch it with the API key in header
    const response = await fetchWithTimeout(videoUri, {
      headers: { 'x-goog-api-key': this.apiKey }
    }, TIMEOUTS.DOWNLOAD);
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  // Download video to file using streams (memory-efficient for large videos)
  async downloadVideoToFile(videoUri, destPath) {
    const { Readable } = require('stream');
    const { pipeline } = require('stream/promises');

    const response = await fetchWithTimeout(videoUri, {
      headers: { 'x-goog-api-key': this.apiKey }
    }, TIMEOUTS.DOWNLOAD);

    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
    }

    // Stream response body directly to file
    const writeStream = fs.createWriteStream(destPath);
    await pipeline(Readable.fromWeb(response.body), writeStream);

    return destPath;
  }

  // Prepare image for API (supports both local paths and URLs)
  async _prepareImage(imageSource) {
    // Check if it's a URL (Supabase Storage URL)
    if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
      return this._prepareImageFromUrl(imageSource);
    }

    // Local file path
    const imageBuffer = await fs.promises.readFile(imageSource);
    const base64 = imageBuffer.toString('base64');
    const ext = path.extname(imageSource).toLowerCase();

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

  // Prepare image from URL
  async _prepareImageFromUrl(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    const base64 = imageBuffer.toString('base64');

    // Determine mime type from content-type header or URL
    let mimeType = response.headers.get('content-type') || 'image/jpeg';

    // Fallback to extension if content-type is not specific
    if (mimeType === 'application/octet-stream') {
      const ext = path.extname(url.split('?')[0]).toLowerCase();
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp'
      };
      mimeType = mimeTypes[ext] || 'image/jpeg';
    }

    return {
      imageBytes: base64,
      mimeType
    };
  }

}

module.exports = VeoService;
