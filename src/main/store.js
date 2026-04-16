// ============================================
// MagicWhisper — Settings Persistence Store
// ============================================
// JSON-backed settings store with schema defaults.
// Uses app.getPath('userData') for cross-platform storage.
// ============================================

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { logger } = require('./logger');

let storeInstance = null;

// Default settings schema
const DEFAULTS = {
  settings: {
    // General
    hotkey: process.platform === 'darwin' ? 'Option+Space' : 'Ctrl+Shift+Space',
    model: 'ggml-base.en.bin',
    language: 'en',
    microphone: 'default',

    // System
    launchAtLogin: false,
    showFlowBar: true,
    showInDock: false,
    soundFeedback: true,
    muteMusicWhileDictating: false,

    // Auto behavior
    autoClipboard: true,
    autoPaste: true,
    autoAddToDictionary: true,

    // Overlay
    overlayEnabled: true,
    overlayPosition: 'top-center',

    // Notifications
    notifSuggestions: true,
    notifAnnouncements: true,
    notifMilestones: true,

    // Theme
    theme: 'system', // 'light', 'dark', 'system'

    // Logging
    loggingEnabled: true,

    // Advanced
    maxHistoryEntries: 500,
    whisperThreads: 'auto',

    // Cloud Transcription (OpenAI API)
    cloudApiKey: '',                      // OpenAI API key
    cloudEnabled: false,                  // Enable cloud transcription
    cloudPriority: false,                 // Give cloud priority over local
    cloudModel: 'gpt-4o-transcribe',      // Best accuracy model
    cloudDailyMinutes: 30,                // For cost estimation

    // Overlay Appearance
    overlayIdleIcon: 'wave',              // 'mic', 'wave', 'dot', 'ring'
    waveformColor: '#ffffff',             // Waveform bar color
    waveformBars: 10,                     // Number of waveform bars
    trayIconColor: '#ffffff'              // Tray icon SVG color
  }
};

class SettingsStore {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'magicwhisper-settings.json');
    this.data = {};
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(raw);
        logger.debug('store', 'Settings loaded', { path: this.filePath });
      } else {
        // First run — initialize with defaults
        this.data = JSON.parse(JSON.stringify(DEFAULTS));
        this.save();
        logger.info('store', 'Created default settings file', { path: this.filePath });
      }
    } catch (e) {
      logger.error('store', 'Failed to load settings, using defaults', { error: e.message });
      this.data = JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      logger.error('store', 'Failed to save settings', { error: e.message });
    }
  }

  /**
   * Get a value by dot-notation key path.
   * Example: store.get('settings.language', 'en')
   */
  get(key, defaultValue) {
    const keys = key.split('.');
    let current = this.data;

    for (const k of keys) {
      if (current === undefined || current === null) {
        return defaultValue !== undefined ? defaultValue : this._getDefault(key);
      }
      current = current[k];
    }

    if (current === undefined) {
      return defaultValue !== undefined ? defaultValue : this._getDefault(key);
    }

    return current;
  }

  /**
   * Set a value by dot-notation key path.
   * Example: store.set('settings.language', 'fr')
   */
  set(key, value) {
    const keys = key.split('.');
    let current = this.data;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = value;
    this.save();
    logger.debug('store', `Setting updated: ${key}`, { value });
  }

  /**
   * Get default value for a key from the DEFAULTS schema.
   */
  _getDefault(key) {
    const keys = key.split('.');
    let current = DEFAULTS;
    for (const k of keys) {
      if (current === undefined || current === null) return undefined;
      current = current[k];
    }
    return current;
  }

  /**
   * Get all settings as a plain object.
   */
  getAll() {
    return JSON.parse(JSON.stringify(this.data));
  }

  /**
   * Reset all settings to defaults.
   */
  reset() {
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    this.save();
    logger.info('store', 'Settings reset to defaults');
  }
}

function getStore() {
  if (!storeInstance) {
    storeInstance = new SettingsStore();
  }
  return storeInstance;
}

module.exports = { getStore, DEFAULTS };
