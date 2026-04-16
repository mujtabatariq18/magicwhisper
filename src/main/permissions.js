// ============================================
// MagicWhisper — Permissions Manager
// ============================================
// One-time permission requests for Microphone and
// Accessibility. Caches grant status to avoid
// re-prompting on every recording session.
// ============================================

const { systemPreferences, dialog, shell, session } = require('electron');
const { logger } = require('./logger');

const isMac = process.platform === 'darwin';

class PermissionsManager {
  constructor() {
    this.micGranted = false;
    this.accessibilityGranted = false;
    this.micCheckDone = false;
  }

  /**
   * Request microphone permission (macOS-specific).
   * On Windows, mic permission is handled by getUserMedia in the renderer.
   * @returns {boolean} Whether mic access is granted
   */
  async requestMicrophone() {
    if (this.micGranted) return true;

    if (isMac) {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      logger.info('permissions', `Microphone status: ${status}`);

      if (status === 'granted') {
        this.micGranted = true;
        return true;
      }

      if (status === 'not-determined' && !this.micCheckDone) {
        this.micCheckDone = true;
        logger.info('permissions', 'Requesting microphone access for the first time');
        const granted = await systemPreferences.askForMediaAccess('microphone');
        this.micGranted = granted;

        if (!granted) {
          logger.warn('permissions', 'Microphone access denied by user');
          dialog.showMessageBox({
            type: 'warning',
            title: 'Microphone Access',
            message: 'MagicWhisper needs microphone access to work.',
            detail: 'Please enable it in System Settings > Privacy & Security > Microphone.',
            buttons: ['OK']
          });
        } else {
          logger.info('permissions', 'Microphone access granted');
        }
        return granted;
      }

      if (status === 'denied') {
        this.micGranted = false;
        if (!this.micCheckDone) {
          this.micCheckDone = true;
          logger.warn('permissions', 'Microphone access was previously denied');
          dialog.showMessageBox({
            type: 'warning',
            title: 'Microphone Access Denied',
            message: 'Microphone access was previously denied.',
            detail: 'To use MagicWhisper, enable microphone access in System Settings > Privacy & Security > Microphone, then restart the app.',
            buttons: ['Open Settings', 'Later']
          }).then(({ response }) => {
            if (response === 0) {
              shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
            }
          });
        }
        return false;
      }

      return false;
    } else {
      // Windows/Linux — mic permission handled by getUserMedia
      this.micGranted = true;
      return true;
    }
  }

  /**
   * Check and request Accessibility permission (macOS only).
   * Required for simulating Cmd+V paste via osascript.
   * @returns {boolean} Whether accessibility is granted
   */
  checkAccessibility() {
    if (!isMac) {
      this.accessibilityGranted = true;
      return true;
    }

    const trusted = systemPreferences.isTrustedAccessibilityClient(false);

    if (trusted) {
      this.accessibilityGranted = true;
      logger.info('permissions', 'Accessibility access granted');
      return true;
    }

    // Prompt the user — surfaces the system permission dialog once
    logger.warn('permissions', 'Accessibility not granted, prompting user');
    systemPreferences.isTrustedAccessibilityClient(true);

    dialog.showMessageBox({
      type: 'warning',
      title: 'Accessibility Access Required',
      message: 'MagicWhisper needs Accessibility access to paste transcribed text.',
      detail: 'Please enable MagicWhisper in System Settings > Privacy & Security > Accessibility, then restart the app.\n\nWithout this, transcriptions will still be copied to the clipboard but cannot be auto-pasted.',
      buttons: ['Open Settings', 'Later'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) {
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      }
    });

    this.accessibilityGranted = false;
    return false;
  }

  /**
   * Install Electron-level permission handlers to auto-approve
   * media requests from the renderer (prevents Electron's own prompts).
   * OS-level permissions still enforced by macOS/Windows.
   */
  installElectronPermissionHandlers() {
    const ses = session.defaultSession;

    ses.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'media' || permission === 'microphone' || permission === 'audioCapture') {
        logger.debug('permissions', `Auto-approving Electron permission: ${permission}`);
        callback(true);
        return;
      }
      callback(false);
    });

    ses.setPermissionCheckHandler((webContents, permission) => {
      if (permission === 'media' || permission === 'microphone' || permission === 'audioCapture') {
        return true;
      }
      return false;
    });

    if (ses.setDevicePermissionHandler) {
      ses.setDevicePermissionHandler(() => true);
    }

    logger.info('permissions', 'Electron permission handlers installed');
  }

  /**
   * Get current permission status summary.
   */
  getStatus() {
    let micStatus = 'unknown';
    if (isMac) {
      micStatus = systemPreferences.getMediaAccessStatus('microphone');
    } else {
      micStatus = this.micGranted ? 'granted' : 'not-determined';
    }

    return {
      microphone: micStatus,
      accessibility: isMac ? systemPreferences.isTrustedAccessibilityClient(false) : true,
      platform: process.platform
    };
  }
}

module.exports = { PermissionsManager };
