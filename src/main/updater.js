// ============================================
// MagicWhisper - Application Update Manager
// ============================================
// Uses GitHub Releases through electron-updater.
// Packaged apps can check, download, and install
// future Windows updates without a fresh setup.
// ============================================

const { app, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { logger } = require('./logger');

class UpdateManager {
  constructor() {
    this.mainWindow = null;
    this.lastStatus = {
      state: 'idle',
      message: 'Updates are idle',
      version: app.getVersion()
    };
    this.manualCheckInProgress = false;
  }

  init(mainWindow) {
    this.mainWindow = mainWindow;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on('checking-for-update', () => {
      this.setStatus('checking', 'Checking for updates...');
    });

    autoUpdater.on('update-available', async (info) => {
      this.setStatus('available', `Update ${info.version} is available`, info);
      const response = await dialog.showMessageBox(this.mainWindow, {
        type: 'info',
        buttons: ['Download update', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'MagicWhisper update available',
        message: `MagicWhisper ${info.version} is available.`,
        detail: 'Download it now and MagicWhisper will install it when you restart.'
      });

      if (response.response === 0) {
        await autoUpdater.downloadUpdate();
      }
    });

    autoUpdater.on('update-not-available', (info) => {
      this.setStatus('current', 'MagicWhisper is up to date', info);
      if (this.manualCheckInProgress) {
        dialog.showMessageBox(this.mainWindow, {
          type: 'info',
          buttons: ['OK'],
          title: 'No updates available',
          message: 'MagicWhisper is already up to date.'
        });
      }
      this.manualCheckInProgress = false;
    });

    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.round(progress.percent || 0);
      this.setStatus('downloading', `Downloading update... ${percent}%`, progress);
    });

    autoUpdater.on('update-downloaded', async (info) => {
      this.setStatus('downloaded', `Update ${info.version} is ready to install`, info);
      const response = await dialog.showMessageBox(this.mainWindow, {
        type: 'info',
        buttons: ['Restart and install', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update ready',
        message: `MagicWhisper ${info.version} has been downloaded.`,
        detail: 'Restart MagicWhisper to finish installing the update.'
      });

      if (response.response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    });

    autoUpdater.on('error', (error) => {
      this.setStatus('error', error.message || 'Update check failed', { error: error.message });
      if (this.manualCheckInProgress) {
        dialog.showMessageBox(this.mainWindow, {
          type: 'warning',
          buttons: ['OK'],
          title: 'Update check failed',
          message: 'MagicWhisper could not check for updates.',
          detail: error.message || String(error)
        });
      }
      this.manualCheckInProgress = false;
    });

    ipcMain.handle('check-for-updates', async () => this.checkForUpdates(true));
    ipcMain.handle('get-update-status', () => this.lastStatus);
    ipcMain.handle('install-downloaded-update', () => {
      autoUpdater.quitAndInstall(false, true);
      return true;
    });

    logger.info('updater', 'Update manager initialized', {
      packaged: app.isPackaged,
      version: app.getVersion()
    });
  }

  async checkForUpdates(manual = false) {
    if (!app.isPackaged) {
      const status = this.setStatus('disabled', 'Updates are only available in the installed app');
      if (manual) {
        await dialog.showMessageBox(this.mainWindow, {
          type: 'info',
          buttons: ['OK'],
          title: 'Updater disabled',
          message: 'Update checks only run from the installed MagicWhisper app.'
        });
      }
      return status;
    }

    this.manualCheckInProgress = manual;
    try {
      const result = await autoUpdater.checkForUpdates();
      return result || this.lastStatus;
    } catch (error) {
      this.manualCheckInProgress = false;
      this.setStatus('error', error.message || 'Update check failed', { error: error.message });
      throw error;
    }
  }

  scheduleStartupCheck(delayMs = 30000) {
    setTimeout(() => {
      this.checkForUpdates(false).catch((error) => {
        logger.warn('updater', 'Startup update check failed', { error: error.message });
      });
    }, delayMs);
  }

  setStatus(state, message, data = {}) {
    this.lastStatus = {
      state,
      message,
      version: app.getVersion(),
      at: new Date().toISOString(),
      data
    };

    logger.info('updater', message, { state, data });

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-status', this.lastStatus);
    }

    return this.lastStatus;
  }
}

module.exports = { UpdateManager };
