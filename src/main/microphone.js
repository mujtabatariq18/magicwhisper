// ============================================
// MagicWhisper — Microphone Device Manager
// ============================================
// Enumerates available audio input devices and
// manages the selected microphone preference.
// ============================================

const { logger } = require('./logger');

class MicrophoneManager {
  constructor() {
    this.devices = [];
  }

  /**
   * Get list of audio input devices from the renderer.
   * This must be called via IPC since navigator.mediaDevices
   * is only available in the renderer process.
   * @param {object} webContents - BrowserWindow webContents
   * @returns {Promise<Array>} List of audio input devices
   */
  async enumerateDevices(webContents) {
    try {
      const devices = await webContents.executeJavaScript(`
        navigator.mediaDevices.enumerateDevices()
          .then(devices => devices
            .filter(d => d.kind === 'audioinput')
            .map(d => ({
              deviceId: d.deviceId,
              label: d.label || 'Unnamed Microphone',
              groupId: d.groupId
            }))
          )
      `);

      this.devices = devices;
      logger.info('microphone', `Found ${devices.length} audio input devices`, {
        devices: devices.map(d => d.label)
      });
      return devices;
    } catch (e) {
      logger.error('microphone', 'Failed to enumerate devices', { error: e.message });
      return [];
    }
  }

  /**
   * Get cached device list.
   */
  getDevices() {
    return this.devices;
  }

  /**
   * Get a device by ID.
   */
  getDevice(deviceId) {
    return this.devices.find(d => d.deviceId === deviceId);
  }
}

module.exports = { MicrophoneManager };
