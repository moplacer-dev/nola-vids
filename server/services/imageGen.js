const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

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
   * @param {string|string[]} [options.anchorImagePath] - Path to anchor image(s) for character consistency (single path or array)
   * @param {string[]} [options.anchorImagePaths] - Array of paths to reference images (preferred over anchorImagePath)
   * @param {string} [options.aspectRatio] - Aspect ratio (e.g., '16:9', '1:1', '3:2', '4:3')
   * @returns {Promise<{imageData: string, mimeType: string}>} - Base64 image data and mime type
   */
  async generate({ prompt, anchorImagePath, anchorImagePaths = [], aspectRatio = '3:2' }) {
    let contents;

    // Include aspect ratio instruction in the prompt for better compliance
    const aspectInstruction = `Generate a ${aspectRatio} aspect ratio image`;

    // Normalize paths: support both single path (backward compat) and array
    let imagePaths = [...anchorImagePaths];
    if (anchorImagePath) {
      if (Array.isArray(anchorImagePath)) {
        imagePaths = [...anchorImagePath, ...imagePaths];
      } else {
        imagePaths = [anchorImagePath, ...imagePaths];
      }
    }
    // Filter to only existing files and limit to 3
    imagePaths = imagePaths.filter(p => p && fs.existsSync(p)).slice(0, 3);

    // If we have reference images for character consistency, include them
    if (imagePaths.length > 0) {
      const imageContents = [];
      for (const imagePath of imagePaths) {
        const img = await this._prepareImage(imagePath);
        imageContents.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.imageBytes
          }
        });
      }
      const refText = imagePaths.length === 1
        ? 'Using the character from this reference image for consistency'
        : `Using the characters from these ${imagePaths.length} reference images for consistency`;
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
        // Request specific aspect ratio if the API supports it
        generationConfig: {
          aspectRatio: aspectRatio
        }
      }
    });

    // Debug log
    console.log('Image generation response:', JSON.stringify(response, null, 2));

    // Extract image from response - the structure varies by SDK version
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
      // Log what we got for debugging
      console.log('Parts received:', JSON.stringify(parts, null, 2));
      throw new Error('No image data in response. The content may have been filtered or the model returned text only.');
    }

    return {
      imageData: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType
    };
  }

  /**
   * Generate an image and save it to disk
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
   * Prepare image for API
   * @param {string} imagePath - Path to image file
   * @returns {Promise<{imageBytes: string, mimeType: string}>}
   */
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
      mimeType: mimeTypes[ext] || 'image/png'
    };
  }
}

module.exports = ImageGenService;
