// ============================================
// MagicWhisper — Voice Snippets
// ============================================
// Voice shortcuts: speak a trigger phrase to
// insert pre-defined text instantly.
// ============================================

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { logger } = require('./logger');

class Snippets {
  constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'snippets.json');
    this.snippets = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        this.snippets = JSON.parse(raw);
        logger.debug('snippets', `Loaded ${this.snippets.length} snippets`);
      }
    } catch (e) {
      logger.error('snippets', 'Failed to load snippets', { error: e.message });
      this.snippets = [];
    }
  }

  save() {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dbPath, JSON.stringify(this.snippets, null, 2), 'utf-8');
    } catch (e) {
      logger.error('snippets', 'Failed to save snippets', { error: e.message });
    }
  }

  /**
   * Add a new snippet.
   * @param {string} trigger - Spoken trigger phrase
   * @param {string} expansion - Text to insert
   * @param {string} category - Category for organization
   */
  add(trigger, expansion, category = 'general') {
    if (!trigger || !expansion) return null;

    // Check for duplicate trigger
    const existing = this.snippets.find(s =>
      s.trigger.toLowerCase() === trigger.trim().toLowerCase()
    );
    if (existing) {
      existing.expansion = expansion;
      existing.category = category;
      this.save();
      return existing;
    }

    const snippet = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      trigger: trigger.trim(),
      expansion: expansion,
      category,
      useCount: 0,
      createdAt: new Date().toISOString()
    };

    this.snippets.push(snippet);
    this.save();
    logger.info('snippets', `Snippet added: "${trigger}"`, { category });
    return snippet;
  }

  /**
   * Try to expand snippets in transcribed text.
   * Returns the text with any matching triggers replaced.
   */
  expand(text) {
    if (!text || this.snippets.length === 0) return text;

    let expanded = text;
    let wasExpanded = false;

    for (const snippet of this.snippets) {
      const regex = new RegExp(
        `\\b${this.escapeRegex(snippet.trigger)}\\b`,
        'gi'
      );

      if (regex.test(expanded)) {
        expanded = expanded.replace(regex, snippet.expansion);
        snippet.useCount = (snippet.useCount || 0) + 1;
        wasExpanded = true;
        logger.debug('snippets', `Expanded: "${snippet.trigger}"`, {
          id: snippet.id,
          useCount: snippet.useCount
        });
      }
    }

    if (wasExpanded) this.save();
    return expanded;
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  remove(id) {
    this.snippets = this.snippets.filter(s => s.id !== id);
    this.save();
    logger.debug('snippets', 'Snippet removed', { id });
  }

  update(id, updates) {
    const snippet = this.snippets.find(s => s.id === id);
    if (snippet) {
      Object.assign(snippet, updates);
      this.save();
    }
    return snippet;
  }

  getAll() {
    return this.snippets;
  }

  search(query) {
    if (!query) return this.snippets;
    const q = query.toLowerCase();
    return this.snippets.filter(s =>
      s.trigger.toLowerCase().includes(q) ||
      s.expansion.toLowerCase().includes(q)
    );
  }

  getByCategory(category) {
    return this.snippets.filter(s => s.category === category);
  }

  export() {
    return JSON.stringify(this.snippets, null, 2);
  }

  import(jsonString) {
    try {
      const imported = JSON.parse(jsonString);
      if (!Array.isArray(imported)) throw new Error('Invalid format');

      let added = 0;
      for (const snippet of imported) {
        if (snippet.trigger && snippet.expansion) {
          const existing = this.snippets.find(s =>
            s.trigger.toLowerCase() === snippet.trigger.toLowerCase()
          );
          if (!existing) {
            this.snippets.push({
              ...snippet,
              id: snippet.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 5))
            });
            added++;
          }
        }
      }

      this.save();
      logger.info('snippets', `Imported ${added} snippets`);
      return added;
    } catch (e) {
      logger.error('snippets', 'Import failed', { error: e.message });
      throw e;
    }
  }

  clear() {
    this.snippets = [];
    this.save();
    logger.info('snippets', 'Snippets cleared');
  }
}

module.exports = { Snippets };
