// ============================================
// MagicWhisper — Clipboard History Manager
// ============================================
// Stores all transcription entries with metadata.
// Supports search, pin, stats, and date grouping.
// ============================================

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { logger } = require('./logger');

const MAX_HISTORY = 500;

class ClipboardHistory {
  constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'clipboard-history.json');
    this.history = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        this.history = JSON.parse(raw);
        logger.debug('history', `Loaded ${this.history.length} history entries`);
      }
    } catch (e) {
      logger.error('history', 'Failed to load clipboard history', { error: e.message });
      this.history = [];
    }
  }

  save() {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dbPath, JSON.stringify(this.history, null, 2), 'utf-8');
    } catch (e) {
      logger.error('history', 'Failed to save clipboard history', { error: e.message });
    }
  }

  add(text, metadata = {}) {
    if (!text || !text.trim()) return null;

    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text: text.trim(),
      timestamp: new Date().toISOString(),
      charCount: text.trim().length,
      wordCount: text.trim().split(/\s+/).filter(Boolean).length,
      language: metadata.language || 'en',
      model: metadata.model || 'unknown',
      duration: metadata.duration || 0,
      app: metadata.app || 'unknown',
      pinned: false
    };

    this.history.unshift(entry);

    // Keep only unpinned entries within limit, always keep pinned
    const pinned = this.history.filter(e => e.pinned);
    const unpinned = this.history.filter(e => !e.pinned);
    if (unpinned.length > MAX_HISTORY) {
      this.history = [...pinned, ...unpinned.slice(0, MAX_HISTORY)];
    }

    this.save();
    logger.debug('history', 'Entry added', { id: entry.id, wordCount: entry.wordCount });
    return entry;
  }

  getAll() {
    return this.history;
  }

  search(query) {
    if (!query || !query.trim()) return this.history;
    const q = query.toLowerCase();
    return this.history.filter(entry =>
      entry.text.toLowerCase().includes(q)
    );
  }

  getById(id) {
    return this.history.find(e => e.id === id);
  }

  pin(id) {
    const entry = this.history.find(e => e.id === id);
    if (entry) {
      entry.pinned = !entry.pinned;
      this.save();
      logger.debug('history', `Entry ${entry.pinned ? 'pinned' : 'unpinned'}`, { id });
    }
    return entry;
  }

  remove(id) {
    this.history = this.history.filter(e => e.id !== id);
    this.save();
    logger.debug('history', 'Entry removed', { id });
  }

  clear() {
    const pinnedCount = this.history.filter(e => e.pinned).length;
    this.history = this.history.filter(e => e.pinned);
    this.save();
    logger.info('history', 'History cleared', { kept: pinnedCount });
  }

  getStats() {
    const totalWords = this.history.reduce((sum, e) => sum + e.wordCount, 0);
    const totalChars = this.history.reduce((sum, e) => sum + e.charCount, 0);
    const totalDuration = this.history.reduce((sum, e) => sum + (e.duration || 0), 0);

    // Calculate WPM (words per minute of recording)
    const totalMinutes = totalDuration / 60000;
    const wpm = totalMinutes > 0 ? Math.round(totalWords / totalMinutes) : 0;

    // Calculate streak
    const streak = this._calculateStreak();

    return {
      totalEntries: this.history.length,
      totalWords,
      totalChars,
      pinnedCount: this.history.filter(e => e.pinned).length,
      wpm,
      streak,
      todayWords: this._getTodayWords(),
      oldestEntry: this.history.length > 0 ? this.history[this.history.length - 1].timestamp : null,
      newestEntry: this.history.length > 0 ? this.history[0].timestamp : null
    };
  }

  _getTodayWords() {
    const today = new Date().toISOString().slice(0, 10);
    return this.history
      .filter(e => e.timestamp.startsWith(today))
      .reduce((sum, e) => sum + e.wordCount, 0);
  }

  _calculateStreak() {
    if (this.history.length === 0) return 0;

    const days = new Set();
    for (const entry of this.history) {
      days.add(entry.timestamp.slice(0, 10));
    }

    const sortedDays = [...days].sort().reverse();
    const today = new Date().toISOString().slice(0, 10);

    // Check if user was active today or yesterday
    if (sortedDays[0] !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (sortedDays[0] !== yesterday) return 0;
    }

    let streak = 1;
    for (let i = 1; i < sortedDays.length; i++) {
      const prevDate = new Date(sortedDays[i - 1]);
      const currDate = new Date(sortedDays[i]);
      const diffDays = (prevDate - currDate) / 86400000;

      if (diffDays === 1) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }

  /**
   * Get history grouped by date for display.
   */
  getGrouped() {
    const groups = {};
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    for (const entry of this.history) {
      const date = entry.timestamp.slice(0, 10);
      let label;
      if (date === today) label = 'Today';
      else if (date === yesterday) label = 'Yesterday';
      else label = new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      if (!groups[label]) groups[label] = [];
      groups[label].push(entry);
    }

    return groups;
  }
}

module.exports = { ClipboardHistory };
