// ============================================
// MagicWhisper — Text Injector (Auto-Paste)
// ============================================
// Copies transcribed text to clipboard and
// simulates Cmd+V / Ctrl+V to paste into the
// active application.
// ============================================

const { clipboard, systemPreferences } = require('electron');
const { exec } = require('child_process');
const { logger } = require('./logger');

const isMac = process.platform === 'darwin';

class TextInjector {
  /**
   * Inject text into the active application.
   * 1. Writes text to clipboard
   * 2. Simulates paste keystroke
   * @param {string} text - Text to inject
   * @returns {Promise<boolean>} Whether auto-paste succeeded
   */
  async injectText(text) {
    if (!text) return false;

    // Always copy to clipboard
    clipboard.writeText(text);
    logger.debug('injector', 'Text copied to clipboard', { length: text.length });

    // Attempt auto-paste
    try {
      if (isMac) {
        const trusted = systemPreferences.isTrustedAccessibilityClient(false);
        if (!trusted) {
          logger.warn('injector', 'Accessibility not granted — skipping auto-paste. Text is on clipboard.');
          return false;
        }
        await this.simulateKeyMac();
        logger.info('injector', 'Auto-paste successful (macOS)');
        return true;
      } else {
        await this.simulateKeyWindows();
        logger.info('injector', 'Auto-paste successful (Windows)');
        return true;
      }
    } catch (err) {
      logger.error('injector', 'Auto-paste failed', { error: err.message });
      return false;
    }
  }

  simulateKeyMac() {
    return new Promise((resolve, reject) => {
      const script = 'tell application "System Events" to keystroke "v" using command down';
      exec(`osascript -e '${script}'`, { timeout: 3000 }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  simulateKeyWindows() {
    return new Promise((resolve, reject) => {
      const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')`;
      exec(`powershell -NoProfile -Command "${script}"`, { timeout: 3000 }, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

module.exports = { TextInjector };
