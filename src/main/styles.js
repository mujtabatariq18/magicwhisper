// ============================================
// MagicWhisper — Style / Tone Profiles
// ============================================
// Per-app writing style profiles. Users can set
// different tones (formal, casual, etc.) for
// different applications. The text processor
// applies the appropriate style after transcription.
// ============================================

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { logger } = require('./logger');

// Built-in style presets
const STYLE_PRESETS = {
  natural: {
    id: 'natural',
    name: 'Natural',
    description: 'As you speak — no modifications',
    icon: '💬',
    rules: {
      formality: 'neutral',
      sentenceCase: false,
      contractions: true,
      removeFillers: true,
      expandAbbreviations: false
    }
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    description: 'Formal business communication',
    icon: '💼',
    rules: {
      formality: 'formal',
      sentenceCase: true,
      contractions: false,         // "don't" → "do not"
      removeFillers: true,
      expandAbbreviations: true    // "ASAP" stays, informal shortened terms expanded
    }
  },
  casual: {
    id: 'casual',
    name: 'Casual',
    description: 'Friendly, conversational tone',
    icon: '😊',
    rules: {
      formality: 'informal',
      sentenceCase: false,
      contractions: true,
      removeFillers: true,
      expandAbbreviations: false
    }
  },
  academic: {
    id: 'academic',
    name: 'Academic',
    description: 'Scholarly and precise language',
    icon: '📚',
    rules: {
      formality: 'very_formal',
      sentenceCase: true,
      contractions: false,
      removeFillers: true,
      expandAbbreviations: true
    }
  },
  concise: {
    id: 'concise',
    name: 'Concise',
    description: 'Short and to the point',
    icon: '⚡',
    rules: {
      formality: 'neutral',
      sentenceCase: true,
      contractions: true,
      removeFillers: true,
      expandAbbreviations: false,
      shortenSentences: true
    }
  },
  creative: {
    id: 'creative',
    name: 'Creative',
    description: 'Expressive, free-flowing writing',
    icon: '🎨',
    rules: {
      formality: 'informal',
      sentenceCase: false,
      contractions: true,
      removeFillers: false,        // Keep some natural speech patterns
      expandAbbreviations: false
    }
  }
};

// Common contraction/expansion pairs
const CONTRACTIONS = {
  "don't": "do not",
  "doesn't": "does not",
  "won't": "will not",
  "wouldn't": "would not",
  "couldn't": "could not",
  "shouldn't": "should not",
  "can't": "cannot",
  "isn't": "is not",
  "aren't": "are not",
  "wasn't": "was not",
  "weren't": "were not",
  "hasn't": "has not",
  "haven't": "have not",
  "hadn't": "had not",
  "didn't": "did not",
  "it's": "it is",
  "that's": "that is",
  "there's": "there is",
  "here's": "here is",
  "what's": "what is",
  "who's": "who is",
  "let's": "let us",
  "i'm": "I am",
  "you're": "you are",
  "we're": "we are",
  "they're": "they are",
  "i've": "I have",
  "you've": "you have",
  "we've": "we have",
  "they've": "they have",
  "i'll": "I will",
  "you'll": "you will",
  "we'll": "we will",
  "they'll": "they will",
  "i'd": "I would",
  "you'd": "you would",
  "we'd": "we would",
  "they'd": "they would"
};

// Reverse map for formal→casual contraction
const EXPANSIONS_TO_CONTRACTIONS = {};
for (const [contraction, expansion] of Object.entries(CONTRACTIONS)) {
  EXPANSIONS_TO_CONTRACTIONS[expansion.toLowerCase()] = contraction;
}

class StyleManager {
  constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'styles.json');
    this.data = {
      defaultStyle: 'natural',
      appStyles: {},     // { "com.apple.mail": "professional", "Slack": "casual" }
      customStyles: []   // User-created style presets
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        this.data = { ...this.data, ...JSON.parse(raw) };
        logger.debug('styles', `Loaded styles config`, {
          default: this.data.defaultStyle,
          appMappings: Object.keys(this.data.appStyles).length,
          customStyles: this.data.customStyles.length
        });
      }
    } catch (e) {
      logger.error('styles', 'Failed to load styles', { error: e.message });
    }
  }

  save() {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      logger.error('styles', 'Failed to save styles', { error: e.message });
    }
  }

  /**
   * Get all available style presets (built-in + custom).
   */
  getPresets() {
    const builtIn = Object.values(STYLE_PRESETS);
    const custom = this.data.customStyles || [];
    return [...builtIn, ...custom];
  }

  /**
   * Get the default style ID.
   */
  getDefaultStyle() {
    return this.data.defaultStyle || 'natural';
  }

  /**
   * Set the default style.
   */
  setDefaultStyle(styleId) {
    this.data.defaultStyle = styleId;
    this.save();
    logger.info('styles', `Default style set to: ${styleId}`);
  }

  /**
   * Get style for a specific app.
   * Falls back to default style if no per-app style set.
   */
  getStyleForApp(appName) {
    return this.data.appStyles[appName] || this.data.defaultStyle || 'natural';
  }

  /**
   * Set style for a specific app.
   */
  setStyleForApp(appName, styleId) {
    this.data.appStyles[appName] = styleId;
    this.save();
    logger.info('styles', `Style for "${appName}" set to: ${styleId}`);
  }

  /**
   * Remove per-app style override (falls back to default).
   */
  removeAppStyle(appName) {
    delete this.data.appStyles[appName];
    this.save();
    logger.debug('styles', `Removed style override for: ${appName}`);
  }

  /**
   * Get all per-app style mappings.
   */
  getAppStyles() {
    return { ...this.data.appStyles };
  }

  /**
   * Add a custom style preset.
   */
  addCustomStyle(name, description, rules) {
    const style = {
      id: 'custom_' + Date.now().toString(36),
      name,
      description,
      icon: '✨',
      rules: {
        formality: 'neutral',
        sentenceCase: false,
        contractions: true,
        removeFillers: true,
        expandAbbreviations: false,
        ...rules
      },
      custom: true
    };
    this.data.customStyles.push(style);
    this.save();
    logger.info('styles', `Custom style created: ${name}`, { id: style.id });
    return style;
  }

  /**
   * Remove a custom style.
   */
  removeCustomStyle(styleId) {
    this.data.customStyles = this.data.customStyles.filter(s => s.id !== styleId);
    // Remove any app mappings using this style
    for (const [app, id] of Object.entries(this.data.appStyles)) {
      if (id === styleId) delete this.data.appStyles[app];
    }
    this.save();
    logger.debug('styles', `Custom style removed: ${styleId}`);
  }

  /**
   * Get a preset by ID.
   */
  getPreset(styleId) {
    return STYLE_PRESETS[styleId] ||
      this.data.customStyles.find(s => s.id === styleId) ||
      STYLE_PRESETS.natural;
  }

  /**
   * Apply a style to transcribed text.
   * @param {string} text - Processed text
   * @param {string} styleId - Style preset ID
   * @returns {string} Styled text
   */
  applyStyle(text, styleId) {
    if (!text) return text;

    const preset = this.getPreset(styleId);
    const rules = preset.rules;
    let result = text;

    // Contraction handling
    if (rules.contractions === false) {
      // Expand contractions for formal tone
      result = this._expandContractions(result);
    }

    // Sentence case enforcement
    if (rules.sentenceCase) {
      result = this._enforceSentenceCase(result);
    }

    // Shorten sentences for concise style
    if (rules.shortenSentences) {
      result = this._shortenSentences(result);
    }

    logger.debug('styles', `Applied style: ${preset.name}`, {
      originalLength: text.length,
      resultLength: result.length
    });

    return result;
  }

  _expandContractions(text) {
    let result = text;
    for (const [contraction, expansion] of Object.entries(CONTRACTIONS)) {
      const regex = new RegExp(`\\b${contraction.replace("'", "'")}\\b`, 'gi');
      result = result.replace(regex, (match) => {
        // Preserve capitalization of first letter
        if (match[0] === match[0].toUpperCase()) {
          return expansion.charAt(0).toUpperCase() + expansion.slice(1);
        }
        return expansion;
      });
    }
    return result;
  }

  _enforceSentenceCase(text) {
    // Capitalize first letter of each sentence
    return text.replace(/(^|[.!?]\s+)(\w)/g, (match, prefix, letter) => {
      return prefix + letter.toUpperCase();
    });
  }

  _shortenSentences(text) {
    // Remove unnecessary words for concise style
    const removables = [
      /\b(just|really|very|quite|rather|somewhat|pretty much|basically|essentially|fundamentally)\b/gi,
      /\b(in order to)\b/gi,
      /\b(due to the fact that)\b/gi,
      /\b(at this point in time)\b/gi,
      /\b(in the event that)\b/gi
    ];

    const replacements = [
      [/\bin order to\b/gi, 'to'],
      [/\bdue to the fact that\b/gi, 'because'],
      [/\bat this point in time\b/gi, 'now'],
      [/\bin the event that\b/gi, 'if'],
      [/\bfor the purpose of\b/gi, 'to'],
      [/\bin spite of the fact that\b/gi, 'although']
    ];

    let result = text;
    for (const [pattern, replacement] of replacements) {
      result = result.replace(pattern, replacement);
    }

    // Clean up double spaces
    return result.replace(/\s{2,}/g, ' ').trim();
  }

  /**
   * Export all style data.
   */
  export() {
    return JSON.stringify(this.data, null, 2);
  }

  /**
   * Import style data.
   */
  import(jsonString) {
    try {
      const imported = JSON.parse(jsonString);
      if (imported.customStyles) {
        let added = 0;
        for (const style of imported.customStyles) {
          if (!this.data.customStyles.find(s => s.id === style.id)) {
            this.data.customStyles.push(style);
            added++;
          }
        }
        this.save();
        logger.info('styles', `Imported ${added} custom styles`);
        return added;
      }
      return 0;
    } catch (e) {
      logger.error('styles', 'Import failed', { error: e.message });
      throw e;
    }
  }
}

module.exports = { StyleManager, STYLE_PRESETS };
