const fs = require('fs');
const path = require('path');

// Hardcoded default voices for MVP
const DEFAULT_VOICES = [
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Rachel', description: 'Female, clear and articulate' },
  { voice_id: '29vD33N1CtxCmqQRPOHJ', name: 'Drew', description: 'Male, articulate and professional' },
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', description: 'Female, warm and engaging' },
  { voice_id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', description: 'Male, professional and clear' }
];

class ElevenLabsService {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.modelId = options.modelId || 'eleven_multilingual_v2';
    this.defaultVoiceId = options.defaultVoiceId || 'EXAVITQu4vr4xnSDxMaL';
    this.baseUrl = 'https://api.elevenlabs.io/v1';
  }

  /**
   * Get available voices from ElevenLabs API
   * Falls back to hardcoded voices if API is not configured or fails
   * @returns {Promise<Array>} - List of available voices
   */
  async getVoices() {
    // Return fallback if not configured
    if (!this.isConfigured()) {
      console.log('[ElevenLabs] API not configured, returning default voices');
      return DEFAULT_VOICES;
    }

    try {
      console.log('[ElevenLabs] Fetching voices from API...');
      const response = await fetch(`${this.baseUrl}/voices`, {
        headers: {
          'xi-api-key': this.apiKey
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ElevenLabs] Failed to fetch voices: ${response.status} - ${errorText}`);
        return DEFAULT_VOICES;
      }

      const data = await response.json();

      if (!data.voices || !Array.isArray(data.voices)) {
        console.error('[ElevenLabs] Invalid voices response format');
        return DEFAULT_VOICES;
      }

      // Map to our format, sorted by name
      const voices = data.voices
        .map(v => ({
          voice_id: v.voice_id,
          name: v.name,
          description: v.labels?.description || v.labels?.accent || v.category || ''
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      console.log(`[ElevenLabs] Fetched ${voices.length} voices from API`);
      return voices;
    } catch (error) {
      console.error('[ElevenLabs] Failed to fetch voices:', error.message);
      return DEFAULT_VOICES;
    }
  }

  /**
   * Generate TTS audio from text
   * @param {Object} options - Generation options
   * @param {string} options.text - Text to convert to speech
   * @param {string} [options.voiceId] - Voice ID to use (defaults to Rachel)
   * @param {string} [options.modelId] - Model ID to use
   * @returns {Promise<Buffer>} - Audio data as buffer
   */
  async generate({ text, voiceId, modelId }) {
    if (!text || text.trim().length === 0) {
      throw new Error('Text is required for audio generation');
    }

    const voice = voiceId || this.defaultVoiceId;
    const model = modelId || this.modelId;

    const response = await fetch(`${this.baseUrl}/text-to-speech/${voice}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: model,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ElevenLabs] API error ${response.status}: ${errorText}`);
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      console.error('[ElevenLabs] API returned empty response');
      throw new Error('ElevenLabs API returned empty audio data');
    }

    return Buffer.from(arrayBuffer);
  }

  /**
   * Generate TTS audio and save to disk
   * @param {Object} options - Generation options
   * @param {string} options.text - Text to convert to speech
   * @param {string} options.outputPath - Where to save the generated audio
   * @param {string} [options.voiceId] - Voice ID to use
   * @param {string} [options.modelId] - Model ID to use
   * @returns {Promise<{path: string, mimeType: string, durationMs: number}>} - Saved file info
   */
  async generateAndSave({ text, outputPath, voiceId, modelId }) {
    console.log(`[ElevenLabs] Starting audio generation for: ${outputPath}`);
    console.log(`[ElevenLabs] Text length: ${text.length} chars, Voice: ${voiceId || this.defaultVoiceId}`);

    const audioBuffer = await this.generate({ text, voiceId, modelId });

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('ElevenLabs returned empty audio buffer');
    }

    console.log(`[ElevenLabs] Received audio buffer: ${audioBuffer.length} bytes`);

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[ElevenLabs] Created directory: ${dir}`);
    }

    fs.writeFileSync(outputPath, audioBuffer);
    console.log(`[ElevenLabs] Audio file written to: ${outputPath}`);

    // Estimate duration based on text length (rough approximation)
    // Average speaking rate is about 150 words per minute
    const wordCount = text.trim().split(/\s+/).length;
    const estimatedDurationMs = Math.round((wordCount / 150) * 60 * 1000);

    return {
      path: outputPath,
      mimeType: 'audio/mpeg',
      durationMs: estimatedDurationMs
    };
  }

  /**
   * Check if the service is configured and ready
   * @returns {boolean}
   */
  isConfigured() {
    return !!this.apiKey && this.apiKey !== 'your_elevenlabs_api_key_here';
  }
}

module.exports = ElevenLabsService;
