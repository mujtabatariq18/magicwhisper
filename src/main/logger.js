// ============================================
// MagicWhisper — Centralized Error Logging System
// ============================================
// Logging is ON by default. After successful operations,
// users can toggle it OFF from Settings.
//
// Log levels: DEBUG, INFO, WARN, ERROR, FATAL
// Output: rotating log files in userData/logs/
// Format: [timestamp] [LEVEL] [module] message {metadata}
// ============================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4
};

const LOG_LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per log file
const MAX_LOG_FILES = 5;
const MAX_MEMORY_ENTRIES = 500; // In-memory buffer for UI viewing

class Logger {
  constructor() {
    this.enabled = true;
    this.minLevel = LOG_LEVELS.DEBUG;
    this.logDir = null;
    this.currentLogFile = null;
    this.memoryBuffer = [];
    this.initialized = false;
    this.isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  }

  /**
   * Initialize the logger. Must be called after app.whenReady()
   * so that app.getPath('userData') is available.
   */
  init(options = {}) {
    if (this.initialized) return;

    this.logDir = path.join(app.getPath('userData'), 'logs');
    this.enabled = options.enabled !== undefined ? options.enabled : true;

    // Create log directory
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
    } catch (e) {
      console.error('[Logger] Failed to create log directory:', e.message);
    }

    // Set current log file
    this.currentLogFile = this.getLogFilePath();

    // Install global error handlers
    this.installCrashHandlers();

    this.initialized = true;
    this.info('logger', 'Logger initialized', {
      logDir: this.logDir,
      enabled: this.enabled,
      isDev: this.isDev,
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      appVersion: app.getVersion()
    });
  }

  /**
   * Enable or disable logging at runtime.
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this.info('logger', 'Logging enabled by user');
    }
  }

  /**
   * Check if logging is enabled.
   */
  isEnabled() {
    return this.enabled;
  }

  // ─── Log Methods ──────────────────────────────────────────

  debug(module, message, metadata) {
    this._log(LOG_LEVELS.DEBUG, module, message, metadata);
  }

  info(module, message, metadata) {
    this._log(LOG_LEVELS.INFO, module, message, metadata);
  }

  warn(module, message, metadata) {
    this._log(LOG_LEVELS.WARN, module, message, metadata);
  }

  error(module, message, metadata) {
    this._log(LOG_LEVELS.ERROR, module, message, metadata);
  }

  fatal(module, message, metadata) {
    this._log(LOG_LEVELS.FATAL, module, message, metadata);
  }

  // ─── Core Logging ─────────────────────────────────────────

  _log(level, module, message, metadata) {
    // Always log to memory buffer for UI viewing
    const entry = this._createEntry(level, module, message, metadata);
    this._addToMemoryBuffer(entry);

    // Console output always in dev mode
    if (this.isDev) {
      this._consoleLog(entry);
    }

    // File output only if enabled
    if (this.enabled && this.initialized) {
      this._writeToFile(entry);
    }
  }

  _createEntry(level, module, message, metadata) {
    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level] || 'UNKNOWN';

    return {
      timestamp,
      level: levelName,
      levelNum: level,
      module: module || 'app',
      message: String(message),
      metadata: metadata || null,
      pid: process.pid
    };
  }

  _formatEntry(entry) {
    let line = `[${entry.timestamp}] [${entry.level.padEnd(5)}] [${entry.module}] ${entry.message}`;
    if (entry.metadata) {
      try {
        // For Error objects, serialize stack trace
        if (entry.metadata instanceof Error) {
          line += ` ${JSON.stringify({ error: entry.metadata.message, stack: entry.metadata.stack })}`;
        } else {
          line += ` ${JSON.stringify(entry.metadata)}`;
        }
      } catch (e) {
        line += ` [metadata serialization failed]`;
      }
    }
    return line;
  }

  _consoleLog(entry) {
    const formatted = this._formatEntry(entry);
    switch (entry.levelNum) {
      case LOG_LEVELS.DEBUG:
        console.debug(formatted);
        break;
      case LOG_LEVELS.INFO:
        console.log(formatted);
        break;
      case LOG_LEVELS.WARN:
        console.warn(formatted);
        break;
      case LOG_LEVELS.ERROR:
      case LOG_LEVELS.FATAL:
        console.error(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  _writeToFile(entry) {
    if (!this.currentLogFile) return;

    try {
      const line = this._formatEntry(entry) + '\n';

      // Check file size rotation
      this._rotateIfNeeded();

      fs.appendFileSync(this.currentLogFile, line, 'utf-8');
    } catch (e) {
      // Don't recurse — just console
      console.error('[Logger] Failed to write log:', e.message);
    }
  }

  _addToMemoryBuffer(entry) {
    this.memoryBuffer.push(entry);
    if (this.memoryBuffer.length > MAX_MEMORY_ENTRIES) {
      this.memoryBuffer = this.memoryBuffer.slice(-MAX_MEMORY_ENTRIES);
    }
  }

  // ─── File Rotation ────────────────────────────────────────

  getLogFilePath() {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(this.logDir, `magicwhisper-${date}.log`);
  }

  _rotateIfNeeded() {
    try {
      // Update log file path (new day = new file)
      const expectedPath = this.getLogFilePath();
      if (expectedPath !== this.currentLogFile) {
        this.currentLogFile = expectedPath;
      }

      // Check size
      if (fs.existsSync(this.currentLogFile)) {
        const stats = fs.statSync(this.currentLogFile);
        if (stats.size >= MAX_FILE_SIZE) {
          // Rename current file with timestamp suffix
          const timestamp = Date.now();
          const rotatedPath = this.currentLogFile.replace('.log', `-${timestamp}.log`);
          fs.renameSync(this.currentLogFile, rotatedPath);
        }
      }

      // Clean up old files
      this._cleanOldLogs();
    } catch (e) {
      // Silent fail on rotation
    }
  }

  _cleanOldLogs() {
    try {
      const files = fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('magicwhisper-') && f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(this.logDir, f),
          mtime: fs.statSync(path.join(this.logDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.mtime - a.mtime);

      // Keep only MAX_LOG_FILES most recent
      if (files.length > MAX_LOG_FILES) {
        for (let i = MAX_LOG_FILES; i < files.length; i++) {
          fs.unlinkSync(files[i].path);
        }
      }
    } catch (e) {
      // Silent fail
    }
  }

  // ─── Crash Handlers ───────────────────────────────────────

  installCrashHandlers() {
    process.on('uncaughtException', (error) => {
      this.fatal('crash', 'Uncaught Exception', {
        error: error.message,
        stack: error.stack
      });
      // Flush synchronously before potential crash
      this._flushSync();
    });

    process.on('unhandledRejection', (reason) => {
      this.error('crash', 'Unhandled Promise Rejection', {
        reason: reason instanceof Error
          ? { message: reason.message, stack: reason.stack }
          : String(reason)
      });
    });
  }

  _flushSync() {
    // Force write any buffered entries
    try {
      if (this.currentLogFile && this.memoryBuffer.length > 0) {
        const lines = this.memoryBuffer
          .slice(-10) // Last 10 entries
          .map(e => this._formatEntry(e))
          .join('\n') + '\n';
        fs.appendFileSync(this.currentLogFile, lines, 'utf-8');
      }
    } catch (e) {
      // Last resort
    }
  }

  // ─── Public API for UI ────────────────────────────────────

  /**
   * Get recent log entries for display in the UI.
   */
  getRecentEntries(count = 100, level = 'DEBUG') {
    const minLevel = LOG_LEVELS[level] || LOG_LEVELS.DEBUG;
    return this.memoryBuffer
      .filter(e => e.levelNum >= minLevel)
      .slice(-count);
  }

  /**
   * Get all log file paths for export.
   */
  getLogFiles() {
    try {
      return fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('magicwhisper-') && f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(this.logDir, f),
          size: fs.statSync(path.join(this.logDir, f)).size
        }))
        .sort((a, b) => b.name.localeCompare(a.name));
    } catch (e) {
      return [];
    }
  }

  /**
   * Read a specific log file's content.
   */
  readLogFile(filePath) {
    try {
      if (!filePath.startsWith(this.logDir)) {
        throw new Error('Invalid log file path');
      }
      return fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      return `Error reading log file: ${e.message}`;
    }
  }

  /**
   * Export all logs as a single string (for support/debugging).
   */
  exportAllLogs() {
    const files = this.getLogFiles();
    const sections = [];

    sections.push(`═══ MagicWhisper Log Export ═══`);
    sections.push(`Date: ${new Date().toISOString()}`);
    sections.push(`Platform: ${process.platform} ${os.release()}`);
    sections.push(`Arch: ${process.arch}`);
    sections.push(`App Version: ${app.getVersion()}`);
    sections.push(`Electron: ${process.versions.electron}`);
    sections.push(`Node: ${process.versions.node}`);
    sections.push(`═══════════════════════════════\n`);

    for (const file of files) {
      sections.push(`───── ${file.name} (${(file.size / 1024).toFixed(1)} KB) ─────`);
      try {
        sections.push(fs.readFileSync(file.path, 'utf-8'));
      } catch (e) {
        sections.push(`[Error reading: ${e.message}]`);
      }
      sections.push('');
    }

    return sections.join('\n');
  }

  /**
   * Clear all log files.
   */
  clearLogs() {
    try {
      const files = fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('magicwhisper-') && f.endsWith('.log'));
      for (const f of files) {
        fs.unlinkSync(path.join(this.logDir, f));
      }
      this.memoryBuffer = [];
      this.currentLogFile = this.getLogFilePath();
      this.info('logger', 'Logs cleared');
    } catch (e) {
      console.error('[Logger] Failed to clear logs:', e.message);
    }
  }
}

// Singleton
const logger = new Logger();

module.exports = { logger, LOG_LEVELS };
