// ============================================
// MagicWhisper — Global Hotkey Manager
// ============================================
// Toggle mode: Press hotkey to START recording,
// press again to STOP and transcribe.
//
// Electron's globalShortcut on macOS fires once
// on keypress (no repeat/keyup events), so toggle
// mode is the only reliable approach without
// native modules.
//
// Includes minimum recording duration (500ms) to
// prevent accidental short recordings.
// ============================================

const { globalShortcut } = require('electron');
const { logger } = require('./logger');

const MIN_RECORD_DURATION_MS = 500;  // Minimum 500ms to avoid empty transcriptions

class HotkeyManager {
  constructor() {
    this.isRecording = false;
    this.onRecordStart = null;
    this.onRecordStop = null;
    this.currentShortcut = null;
    this.recordStartTime = null;
    this.lastTriggerTime = 0;
    this.debounceMs = 300;  // Prevent double-tap issues
  }

  /**
   * Register a global shortcut for toggle recording.
   * First press = start recording, second press = stop recording.
   * @param {string} shortcut - Electron accelerator string
   * @param {object} callbacks - { onStart, onStop }
   * @returns {boolean} Whether registration succeeded
   */
  register(shortcut, { onStart, onStop }) {
    this.unregister();
    this.onRecordStart = onStart;
    this.onRecordStop = onStop;
    this.currentShortcut = shortcut;

    try {
      const registered = globalShortcut.register(shortcut, () => {
        this.handleToggle();
      });

      if (!registered) {
        logger.error('hotkey', `Failed to register hotkey: ${shortcut}`);
        return false;
      }

      logger.info('hotkey', `Hotkey registered: ${shortcut} (toggle mode)`);
      return true;
    } catch (err) {
      logger.error('hotkey', `Error registering hotkey: ${shortcut}`, { error: err.message });
      return false;
    }
  }

  /**
   * Handle toggle: start if stopped, stop if recording.
   */
  handleToggle() {
    const now = Date.now();

    // Debounce rapid presses
    if (now - this.lastTriggerTime < this.debounceMs) {
      logger.debug('hotkey', 'Debounced rapid press', { gap: now - this.lastTriggerTime });
      return;
    }
    this.lastTriggerTime = now;

    if (this.isRecording) {
      // Check minimum duration
      const elapsed = now - (this.recordStartTime || now);
      if (elapsed < MIN_RECORD_DURATION_MS) {
        logger.debug('hotkey', 'Ignoring stop — below minimum duration', {
          elapsed,
          minRequired: MIN_RECORD_DURATION_MS
        });
        return;
      }
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  unregister() {
    if (this.currentShortcut) {
      try {
        globalShortcut.unregister(this.currentShortcut);
        logger.debug('hotkey', `Hotkey unregistered: ${this.currentShortcut}`);
      } catch (e) {}
    }
    this.currentShortcut = null;
  }

  startRecording() {
    if (this.isRecording) return;
    this.isRecording = true;
    this.recordStartTime = Date.now();
    logger.info('hotkey', '▶ Recording STARTED via hotkey');
    if (this.onRecordStart) this.onRecordStart();
  }

  stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;
    const duration = Date.now() - (this.recordStartTime || Date.now());
    this.recordStartTime = null;
    logger.info('hotkey', '■ Recording STOPPED via hotkey', { durationMs: duration });
    if (this.onRecordStop) this.onRecordStop(duration);
  }

  /**
   * Force stop recording (e.g., from UI button).
   */
  forceStop() {
    if (this.isRecording) {
      this.stopRecording();
    }
  }

  resetRecordingState() {
    this.isRecording = false;
    this.recordStartTime = null;
  }

  destroy() {
    this.unregister();
    globalShortcut.unregisterAll();
    logger.info('hotkey', 'All hotkeys destroyed');
  }
}

module.exports = { HotkeyManager };
