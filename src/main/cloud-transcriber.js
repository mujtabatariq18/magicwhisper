// ============================================
// MagicWhisper — OpenAI Cloud Transcription
// ============================================
// Optional cloud-based transcription using the
// OpenAI Whisper API. Falls back to local model
// if API key is not set, API fails, or no internet.
// ============================================

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('./logger');

const OPENAI_API_URL = 'api.openai.com';
const OPENAI_TRANSCRIPTION_PATH = '/v1/audio/transcriptions';

class CloudTranscriber {
  constructor() {
    this.apiKey = '';
    this.enabled = false;       // User toggle: use cloud when available
    this.priority = false;      // If true, try cloud first, fall back to local
    this.model = 'whisper-1';   // OpenAI model name
    this.connected = false;     // Last known connection state
    this._lastCheckTime = 0;
    this._checkInterval = 30000; // Re-check connectivity every 30s
  }

  /**
   * Configure the cloud transcriber.
   * @param {object} config 
   * @param {string} config.apiKey - OpenAI API key
   * @param {boolean} config.enabled - Enable cloud transcription
   * @param {boolean} config.priority - Give cloud priority over local
   * @param {string} [config.model] - OpenAI model name (default: whisper-1)
   */
  configure(config) {
    if (config.apiKey !== undefined) this.apiKey = config.apiKey;
    if (config.enabled !== undefined) this.enabled = config.enabled;
    if (config.priority !== undefined) this.priority = config.priority;
    if (config.model !== undefined) this.model = config.model;

    logger.info('cloud-transcriber', 'Configuration updated', {
      enabled: this.enabled,
      priority: this.priority,
      hasApiKey: !!this.apiKey,
      model: this.model
    });
  }

  /**
   * Check if cloud transcription is available (key set + enabled + internet).
   */
  isAvailable() {
    return this.enabled && !!this.apiKey;
  }

  /**
   * Check if cloud should be used as primary (priority mode + available).
   */
  shouldUsePrimary() {
    return this.priority && this.isAvailable();
  }

  /**
   * Verify API key by making a minimal request.
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  async verifyApiKey(apiKey) {
    const key = apiKey || this.apiKey;
    if (!key) return { valid: false, error: 'No API key provided' };

    try {
      const result = await this._httpRequest({
        hostname: OPENAI_API_URL,
        path: '/v1/models',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        }
      });

      if (result.statusCode === 200) {
        logger.info('cloud-transcriber', 'API key verified successfully');
        this.connected = true;
        return { valid: true };
      } else if (result.statusCode === 401) {
        return { valid: false, error: 'Invalid API key' };
      } else {
        return { valid: false, error: `API returned status ${result.statusCode}` };
      }
    } catch (err) {
      logger.warn('cloud-transcriber', 'API key verification failed', { error: err.message });
      return { valid: false, error: err.message };
    }
  }

  /**
   * Check internet connectivity to OpenAI.
   * @returns {Promise<boolean>}
   */
  async checkConnectivity() {
    const now = Date.now();
    if (now - this._lastCheckTime < this._checkInterval) {
      return this.connected;
    }

    try {
      await this._httpRequest({
        hostname: OPENAI_API_URL,
        path: '/',
        method: 'HEAD',
        timeout: 5000
      });
      this.connected = true;
    } catch (err) {
      this.connected = false;
      logger.debug('cloud-transcriber', 'No internet connectivity', { error: err.message });
    }

    this._lastCheckTime = now;
    return this.connected;
  }

  /**
   * Transcribe audio using OpenAI Whisper API.
   * @param {ArrayBuffer|Buffer} audioBuffer - WAV audio data
   * @param {object} options
   * @param {string} [options.language] - ISO language code
   * @param {string} [options.prompt] - Optional prompt to guide transcription
   * @returns {Promise<string>} Transcribed text
   * @throws {Error} If transcription fails
   */
  async transcribe(audioBuffer, options = {}) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const startTime = Date.now();
    logger.info('cloud-transcriber', 'Starting cloud transcription', {
      audioSize: audioBuffer.byteLength,
      language: options.language,
      model: this.model
    });

    // Write audio to temp file (API requires file upload)
    const tempFile = path.join(os.tmpdir(), `magicwhisper-cloud-${Date.now()}.wav`);
    fs.writeFileSync(tempFile, Buffer.from(audioBuffer));

    try {
      const text = await this._sendToOpenAI(tempFile, options);
      const elapsed = Date.now() - startTime;

      logger.info('cloud-transcriber', 'Cloud transcription complete', {
        textLength: text.length,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        elapsedMs: elapsed,
        model: this.model
      });

      this.connected = true;
      return text;
    } catch (err) {
      const elapsed = Date.now() - startTime;
      logger.error('cloud-transcriber', 'Cloud transcription failed', {
        error: err.message,
        elapsedMs: elapsed
      });

      // Mark as disconnected if it's a network error
      if (err.message.includes('ENOTFOUND') ||
          err.message.includes('ECONNREFUSED') ||
          err.message.includes('ETIMEDOUT') ||
          err.message.includes('network')) {
        this.connected = false;
      }

      throw err;
    } finally {
      try { fs.unlinkSync(tempFile); } catch (e) {}
    }
  }

  /**
   * Send audio file to OpenAI Whisper API using multipart/form-data.
   * @private
   */
  _sendToOpenAI(filePath, options = {}) {
    return new Promise((resolve, reject) => {
      const boundary = `----MagicWhisper${Date.now()}`;
      const fileName = path.basename(filePath);
      const fileContent = fs.readFileSync(filePath);

      // Build multipart form body
      const parts = [];

      // File part
      parts.push(
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`,
        `Content-Type: audio/wav\r\n\r\n`
      );
      const headerBuf = Buffer.from(parts.join(''));

      const modelPart = Buffer.from(
        `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `${this.model}`
      );

      // Language part (optional)
      let langPart = Buffer.alloc(0);
      if (options.language && options.language !== 'auto') {
        langPart = Buffer.from(
          `\r\n--${boundary}\r\n` +
          `Content-Disposition: form-data; name="language"\r\n\r\n` +
          `${options.language}`
        );
      }

      // Prompt part (optional — helps with context/formatting)
      let promptPart = Buffer.alloc(0);
      if (options.prompt) {
        promptPart = Buffer.from(
          `\r\n--${boundary}\r\n` +
          `Content-Disposition: form-data; name="prompt"\r\n\r\n` +
          `${options.prompt}`
        );
      }

      // Response format
      const formatPart = Buffer.from(
        `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
        `text`
      );

      const endBuf = Buffer.from(`\r\n--${boundary}--\r\n`);

      const body = Buffer.concat([
        headerBuf,
        fileContent,
        modelPart,
        langPart,
        promptPart,
        formatPart,
        endBuf
      ]);

      const reqOptions = {
        hostname: OPENAI_API_URL,
        port: 443,
        path: OPENAI_TRANSCRIPTION_PATH,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
          'User-Agent': 'MagicWhisper/1.0'
        },
        timeout: 60000 // 60 second timeout
      };

      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            // response_format=text returns plain text
            resolve(data.trim());
          } else {
            let errorMsg;
            try {
              const errObj = JSON.parse(data);
              errorMsg = errObj.error?.message || `HTTP ${res.statusCode}`;
            } catch (e) {
              errorMsg = `HTTP ${res.statusCode}: ${data.slice(0, 200)}`;
            }
            reject(new Error(`OpenAI API error: ${errorMsg}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Network error: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Simple HTTP request helper.
   * @private
   */
  _httpRequest(options) {
    return new Promise((resolve, reject) => {
      const client = options.port === 80 ? http : https;
      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, data });
        });
      });

      if (options.timeout) {
        req.setTimeout(options.timeout, () => {
          req.destroy();
          reject(new Error('Request timed out'));
        });
      }

      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Get current status for UI display.
   */
  getStatus() {
    return {
      enabled: this.enabled,
      priority: this.priority,
      hasApiKey: !!this.apiKey,
      connected: this.connected,
      model: this.model,
      available: this.isAvailable(),
      usingCloud: this.shouldUsePrimary()
    };
  }
}

module.exports = { CloudTranscriber };
