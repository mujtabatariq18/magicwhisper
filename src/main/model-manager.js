// ============================================
// MagicWhisper — AI Model Manager
// ============================================
// Manages whisper.cpp model downloads, installations,
// and metadata for the available model catalog.
// ============================================

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { logger } = require('./logger');

const MODEL_CATALOG = [
  {
    name: 'ggml-tiny.en.bin',
    label: 'Tiny (English)',
    description: 'Fastest, lower accuracy',
    size: '75 MB',
    sizeBytes: 75 * 1024 * 1024,
    quality: 1,
    english: true,
    default: false
  },
  {
    name: 'ggml-tiny.bin',
    label: 'Tiny (Multilingual)',
    description: 'Fastest multilingual',
    size: '75 MB',
    sizeBytes: 75 * 1024 * 1024,
    quality: 1,
    english: false,
    default: false
  },
  {
    name: 'ggml-base.en.bin',
    label: 'Base (English)',
    description: 'Good balance of speed and accuracy',
    size: '142 MB',
    sizeBytes: 142 * 1024 * 1024,
    quality: 2,
    english: true,
    default: true
  },
  {
    name: 'ggml-base.bin',
    label: 'Base (Multilingual)',
    description: 'Good multilingual balance',
    size: '142 MB',
    sizeBytes: 142 * 1024 * 1024,
    quality: 2,
    english: false,
    default: false
  },
  {
    name: 'ggml-small.en.bin',
    label: 'Small (English)',
    description: 'Higher accuracy, moderate speed',
    size: '466 MB',
    sizeBytes: 466 * 1024 * 1024,
    quality: 3,
    english: true,
    default: false
  },
  {
    name: 'ggml-small.bin',
    label: 'Small (Multilingual)',
    description: 'Higher accuracy multilingual',
    size: '466 MB',
    sizeBytes: 466 * 1024 * 1024,
    quality: 3,
    english: false,
    default: false
  },
  {
    name: 'ggml-medium.en.bin',
    label: 'Medium (English)',
    description: 'High accuracy, slower',
    size: '1.5 GB',
    sizeBytes: 1500 * 1024 * 1024,
    quality: 4,
    english: true,
    default: false
  },
  {
    name: 'ggml-medium.bin',
    label: 'Medium (Multilingual)',
    description: 'High accuracy multilingual',
    size: '1.5 GB',
    sizeBytes: 1500 * 1024 * 1024,
    quality: 4,
    english: false,
    default: false
  },
  {
    name: 'ggml-large-v3-turbo.bin',
    label: 'Large V3 Turbo',
    description: 'Best accuracy, requires more RAM',
    size: '1.6 GB',
    sizeBytes: 1600 * 1024 * 1024,
    quality: 5,
    english: false,
    default: false
  }
];

const BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

class ModelManager {
  constructor(modelsDir) {
    this.modelsDir = modelsDir;
    fs.mkdirSync(this.modelsDir, { recursive: true });
    logger.info('model-manager', 'ModelManager initialized', { modelsDir: this.modelsDir });
  }

  /**
   * Get list of installed model filenames.
   */
  getInstalledModels() {
    try {
      return fs.readdirSync(this.modelsDir)
        .filter(f => f.endsWith('.bin'));
    } catch (e) {
      logger.error('model-manager', 'Failed to read models directory', { error: e.message });
      return [];
    }
  }

  /**
   * Get full catalog with installation status.
   */
  getAvailableModels() {
    const installed = this.getInstalledModels();
    return MODEL_CATALOG.map(model => ({
      ...model,
      installed: installed.includes(model.name)
    }));
  }

  /**
   * Download a model from HuggingFace.
   * @param {string} modelName - Model filename
   * @param {function} progressCallback - Progress callback (0-100)
   */
  async downloadModel(modelName, progressCallback) {
    const model = MODEL_CATALOG.find(m => m.name === modelName);
    if (!model) {
      throw new Error(`Unknown model: ${modelName}`);
    }

    const destPath = path.join(this.modelsDir, modelName);

    if (fs.existsSync(destPath)) {
      logger.info('model-manager', `Model already exists: ${modelName}`);
      if (progressCallback) progressCallback(100);
      return true;
    }

    const url = `${BASE_URL}/${modelName}`;
    logger.info('model-manager', `Downloading model: ${modelName}`, { url, expectedSize: model.size });

    return new Promise((resolve, reject) => {
      const download = (downloadUrl) => {
        const client = downloadUrl.startsWith('https') ? https : http;
        client.get(downloadUrl, {
          headers: { 'User-Agent': 'MagicWhisper/1.0' }
        }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
            download(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }

          const totalSize = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;
          let lastProgress = 0;

          const fileStream = fs.createWriteStream(destPath);

          res.on('data', (chunk) => {
            downloaded += chunk.length;
            if (totalSize > 0) {
              const progress = Math.round((downloaded / totalSize) * 100);
              if (progress !== lastProgress) {
                lastProgress = progress;
                if (progressCallback) progressCallback(progress);
              }
            }
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            logger.info('model-manager', `Model downloaded successfully: ${modelName}`, {
              size: downloaded
            });
            resolve(true);
          });

          fileStream.on('error', (err) => {
            logger.error('model-manager', `Model download write error: ${modelName}`, { error: err.message });
            try { fs.unlinkSync(destPath); } catch (e) {}
            reject(err);
          });
        }).on('error', (err) => {
          logger.error('model-manager', `Model download network error: ${modelName}`, { error: err.message });
          try { fs.unlinkSync(destPath); } catch (e) {}
          reject(err);
        });
      };

      download(url);
    });
  }

  /**
   * Delete an installed model.
   */
  async deleteModel(modelName) {
    const modelPath = path.join(this.modelsDir, modelName);
    try {
      if (fs.existsSync(modelPath)) {
        fs.unlinkSync(modelPath);
        logger.info('model-manager', `Model deleted: ${modelName}`);
      }
      return true;
    } catch (err) {
      logger.error('model-manager', `Failed to delete model: ${modelName}`, { error: err.message });
      throw err;
    }
  }
}

module.exports = { ModelManager, MODEL_CATALOG };
