const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const storage = require('./storage');

// Gemini 3.1 Flash with native image generation
const MODEL = 'gemini-3.1-flash-image-preview';

class ImageGenService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = new GoogleGenAI({ apiKey });
  }

  /**
   * Generate an image from a text prompt
   * @param {Object} options - Generation options
   * @param {string} options.prompt - The image generation prompt
   * @param {string|string[]} [options.anchorImagePath] - Path to anchor image(s) for character consistency (local paths)
   * @param {string[]} [options.anchorImagePaths] - Array of paths to reference images (local paths)
   * @param {string[]} [options.anchorImageUrls] - Array of URLs to reference images (Supabase URLs)
   * @param {string} [options.aspectRatio] - Aspect ratio (e.g., '16:9', '1:1', '3:2', '4:3')
   * @returns {Promise<{imageData: string, mimeType: string}>} - Base64 image data and mime type
   */
  async generate({ prompt, anchorImagePath, anchorImagePaths = [], anchorImageUrls = [], aspectRatio = '3:2' }) {
    let contents;

    // Include aspect ratio instruction in the prompt for better compliance
    const aspectInstruction = `Generate a ${aspectRatio} aspect ratio image`;

    // Normalize local paths: support both single path (backward compat) and array
    let localPaths = [...anchorImagePaths];
    if (anchorImagePath) {
      if (Array.isArray(anchorImagePath)) {
        localPaths = [...anchorImagePath, ...localPaths];
      } else {
        localPaths = [anchorImagePath, ...localPaths];
      }
    }
    // Filter to only existing local files and limit to 3
    localPaths = localPaths.filter(p => p && fs.existsSync(p)).slice(0, 3);

    // Download images from URLs if needed
    const imageContents = [];

    // First, process local files
    for (const imagePath of localPaths) {
      const img = await this._prepareImage(imagePath);
      imageContents.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.imageBytes
        }
      });
    }

    // Then, process URLs (download from Supabase Storage)
    for (const url of anchorImageUrls.slice(0, 3 - imageContents.length)) {
      try {
        const img = await this._prepareImageFromUrl(url);
        imageContents.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.imageBytes
          }
        });
      } catch (e) {
        console.error(`Failed to download reference image from ${url}:`, e.message);
      }
    }

    // If we have reference images for character consistency, include them
    if (imageContents.length > 0) {
      const refText = imageContents.length === 1
        ? 'Using the character from this reference image for consistency'
        : `Using the characters from these ${imageContents.length} reference images for consistency`;
      contents = [
        ...imageContents,
        {
          text: `${refText}, ${aspectInstruction}: ${prompt}`
        }
      ];
    } else {
      contents = `${aspectInstruction}: ${prompt}`;
    }

    const response = await this.client.models.generateContent({
      model: MODEL,
      contents,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        generationConfig: {
          aspectRatio: aspectRatio
        }
      }
    });

    // Debug log
    console.log('Image generation response:', JSON.stringify(response, null, 2));

    // Extract image from response
    const candidates = response.candidates || response.response?.candidates;

    if (!candidates || candidates.length === 0) {
      throw new Error('No image was generated. The content may have been filtered.');
    }

    const candidate = candidates[0];
    const parts = candidate.content?.parts || candidate.parts;

    if (!parts) {
      throw new Error('Invalid response structure from image generation API.');
    }

    // Find the image part in the response
    const imagePart = parts.find(
      part => part.inlineData && part.inlineData.mimeType?.startsWith('image/')
    );

    if (!imagePart) {
      console.log('Parts received:', JSON.stringify(parts, null, 2));
      throw new Error('No image data in response. The content may have been filtered or the model returned text only.');
    }

    return {
      imageData: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType
    };
  }

  /**
   * Generate an image and save it to disk (legacy method for local storage)
   * @param {Object} options - Generation options
   * @param {string} options.prompt - The image generation prompt
   * @param {string} options.outputPath - Where to save the generated image
   * @param {string|string[]} [options.anchorImagePath] - Path to anchor image(s) for character consistency
   * @param {string[]} [options.anchorImagePaths] - Array of paths to reference images
   * @param {string} [options.aspectRatio] - Aspect ratio
   * @returns {Promise<{path: string, mimeType: string}>} - Saved file info
   */
  async generateAndSave({ prompt, outputPath, anchorImagePath, anchorImagePaths, aspectRatio }) {
    const result = await this.generate({ prompt, anchorImagePath, anchorImagePaths, aspectRatio });

    // Decode base64 and write to file
    const imageBuffer = Buffer.from(result.imageData, 'base64');

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, imageBuffer);

    return {
      path: outputPath,
      mimeType: result.mimeType
    };
  }

  /**
   * Generate an image and upload it to Supabase Storage
   * Stores the original full-quality image. Use Supabase image transforms for optimized display.
   * @param {Object} options - Generation options
   * @param {string} options.prompt - The image generation prompt
   * @param {string} options.bucket - Supabase Storage bucket name
   * @param {string} options.filename - Filename to save in the bucket
   * @param {string[]} [options.anchorImageUrls] - Array of URLs to reference images
   * @param {string} [options.aspectRatio] - Aspect ratio
   * @returns {Promise<{publicUrl: string, mimeType: string, width: number, height: number}>} - Public URL and dimensions
   */
  async generateToStorage({ prompt, bucket, filename, anchorImageUrls = [], aspectRatio }) {
    const result = await this.generate({ prompt, anchorImageUrls, aspectRatio });

    // Decode base64 to buffer
    const imageBuffer = Buffer.from(result.imageData, 'base64');

    // Get image dimensions using sharp (without modifying the image)
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width;
    const height = metadata.height;

    console.log(`Image generated: ${width}x${height}, size: ${imageBuffer.length} bytes`);

    // Upload original full-quality image to Supabase Storage
    const uploaded = await storage.uploadFile(
      bucket,
      filename,
      imageBuffer,
      result.mimeType
    );

    return {
      publicUrl: uploaded.publicUrl,
      mimeType: result.mimeType,
      width,
      height
    };
  }

  /**
   * Prepare image for API from local file
   * @param {string} imagePath - Path to image file
   * @returns {Promise<{imageBytes: string, mimeType: string}>}
   */
  async _prepareImage(imagePath) {
    const imageBuffer = await fs.promises.readFile(imagePath);
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
      mimeType: mimeTypes[ext] || 'image/png'
    };
  }

  /**
   * Prepare image for API from URL (download from Supabase Storage)
   * @param {string} url - URL to download image from
   * @returns {Promise<{imageBytes: string, mimeType: string}>}
   */
  async _prepareImageFromUrl(url) {
    // Download the image
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    const base64 = imageBuffer.toString('base64');

    // Determine mime type from content-type header or URL
    let mimeType = response.headers.get('content-type') || 'image/png';

    // Fallback to extension if content-type is not specific
    if (mimeType === 'application/octet-stream') {
      const ext = path.extname(url.split('?')[0]).toLowerCase();
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp'
      };
      mimeType = mimeTypes[ext] || 'image/png';
    }

    return {
      imageBytes: base64,
      mimeType
    };
  }
}

module.exports = ImageGenService;
