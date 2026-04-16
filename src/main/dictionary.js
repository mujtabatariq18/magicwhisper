// ============================================
// MagicWhisper — Personal Dictionary
// ============================================
// Learns custom words, names, and terms.
// Auto-learns from corrections and supports
// manual entries with categories.
// ============================================

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { logger } = require('./logger');

class Dictionary {
  constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'dictionary.json');
    this.entries = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        this.entries = JSON.parse(raw);
        logger.debug('dictionary', `Loaded ${this.entries.length} dictionary entries`);
      }
    } catch (e) {
      logger.error('dictionary', 'Failed to load dictionary', { error: e.message });
      this.entries = [];
    }
  }

  save() {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dbPath, JSON.stringify(this.entries, null, 2), 'utf-8');
    } catch (e) {
      logger.error('dictionary', 'Failed to save dictionary', { error: e.message });
    }
  }

  /**
   * Add a word to the dictionary.
   * @param {string} word - The correct spelling
   * @param {string} category - 'name', 'technical', 'custom'
   * @param {string[]} alternatives - Common misspellings or phonetic variants
   */
  add(word, category = 'custom', alternatives = []) {
    if (!word || !word.trim()) return null;

    // Check if already exists
    const existing = this.entries.find(e =>
      e.word.toLowerCase() === word.trim().toLowerCase()
    );

    if (existing) {
      // Merge alternatives
      const newAlts = alternatives.filter(a =>
        !existing.alternatives.includes(a.toLowerCase())
      );
      existing.alternatives.push(...newAlts.map(a => a.toLowerCase()));
      existing.useCount = (existing.useCount || 0) + 1;
      this.save();
      return existing;
    }

    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      word: word.trim(),
      category,
      alternatives: alternatives.map(a => a.toLowerCase()),
      useCount: 0,
      addedAt: new Date().toISOString(),
      autoLearned: false
    };

    this.entries.push(entry);
    this.save();
    logger.info('dictionary', `Word added: "${word}"`, { category });
    return entry;
  }

  /**
   * Auto-learn a word from a correction.
   * Called when user manually corrects transcription.
   */
  autoLearn(wrongWord, correctWord) {
    if (!wrongWord || !correctWord) return;

    const existing = this.entries.find(e =>
      e.word.toLowerCase() === correctWord.toLowerCase()
    );

    if (existing) {
      if (!existing.alternatives.includes(wrongWord.toLowerCase())) {
        existing.alternatives.push(wrongWord.toLowerCase());
        this.save();
      }
      return existing;
    }

    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      word: correctWord,
      category: 'custom',
      alternatives: [wrongWord.toLowerCase()],
      useCount: 0,
      addedAt: new Date().toISOString(),
      autoLearned: true
    };

    this.entries.push(entry);
    this.save();
    logger.info('dictionary', `Auto-learned: "${wrongWord}" → "${correctWord}"`);
    return entry;
  }

  /**
   * Apply dictionary corrections to transcribed text.
   * Replaces known misspellings with correct spellings.
   */
  applyCorrections(text) {
    if (!text || this.entries.length === 0) return text;

    let corrected = text;
    for (const entry of this.entries) {
      for (const alt of entry.alternatives) {
        // Word-boundary replacement (case-insensitive)
        const regex = new RegExp(`\\b${this.escapeRegex(alt)}\\b`, 'gi');
        if (regex.test(corrected)) {
          corrected = corrected.replace(regex, entry.word);
          entry.useCount = (entry.useCount || 0) + 1;
        }
      }
    }

    if (corrected !== text) {
      this.save(); // Update use counts
      logger.debug('dictionary', 'Applied corrections', {
        original: text.slice(0, 100),
        corrected: corrected.slice(0, 100)
      });
    }

    return corrected;
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  remove(id) {
    this.entries = this.entries.filter(e => e.id !== id);
    this.save();
    logger.debug('dictionary', 'Entry removed', { id });
  }

  update(id, updates) {
    const entry = this.entries.find(e => e.id === id);
    if (entry) {
      Object.assign(entry, updates);
      this.save();
    }
    return entry;
  }

  getAll() {
    return this.entries;
  }

  search(query) {
    if (!query) return this.entries;
    const q = query.toLowerCase();
    return this.entries.filter(e =>
      e.word.toLowerCase().includes(q) ||
      e.alternatives.some(a => a.includes(q))
    );
  }

  getByCategory(category) {
    return this.entries.filter(e => e.category === category);
  }

  /**
   * Export dictionary as JSON string.
   */
  export() {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * Import entries from a JSON string (merges, doesn't replace).
   */
  import(jsonString) {
    try {
      const imported = JSON.parse(jsonString);
      if (!Array.isArray(imported)) throw new Error('Invalid format');

      let added = 0;
      for (const entry of imported) {
        if (entry.word && !this.entries.find(e => e.word.toLowerCase() === entry.word.toLowerCase())) {
          this.entries.push({
            ...entry,
            id: entry.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 5))
          });
          added++;
        }
      }

      this.save();
      logger.info('dictionary', `Imported ${added} entries`);
      return added;
    } catch (e) {
      logger.error('dictionary', 'Import failed', { error: e.message });
      throw e;
    }
  }

  clear() {
    this.entries = [];
    this.save();
    logger.info('dictionary', 'Dictionary cleared');
  }
}

module.exports = { Dictionary };
