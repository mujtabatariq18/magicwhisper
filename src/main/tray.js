// ============================================
// MagicWhisper — System Tray Manager
// ============================================
// Wispr Flow-style tray menu with submenus for
// microphone, languages, and dynamic state display.
// ============================================

const { Tray, Menu, nativeImage, app, clipboard } = require('electron');
const path = require('path');
const { logger } = require('./logger');

let trayIcon = null;

function createTrayIcon(state = 'idle') {
  if (process.platform === 'win32') {
    return nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
  }

  const size = 22;

  let svgContent;
  if (state === 'recording') {
    // Red pulsing dot
    svgContent = `<svg width="${size}" height="${size}" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="11" r="8" fill="#FF3B30"/>
    </svg>`;
  } else if (state === 'processing') {
    // Orange processing dot
    svgContent = `<svg width="${size}" height="${size}" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="11" r="8" fill="#FF9500"/>
    </svg>`;
  } else {
    // Waveform bars icon (like Wispr Flow tray icon)
    svgContent = `<svg width="${size}" height="${size}" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="8" width="2" height="6" rx="1" fill="black"/>
      <rect x="6.5" y="5" width="2" height="12" rx="1" fill="black"/>
      <rect x="10" y="3" width="2" height="16" rx="1" fill="black"/>
      <rect x="13.5" y="5" width="2" height="12" rx="1" fill="black"/>
      <rect x="17" y="8" width="2" height="6" rx="1" fill="black"/>
    </svg>`;
  }

  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`;
  const img = nativeImage.createFromDataURL(dataUrl).resize({ width: size, height: size });
  img.setTemplateImage(true);
  return img;
}

/**
 * Create the system tray with Wispr Flow-style context menu.
 * @param {BrowserWindow} mainWindow
 * @param {object} deps - { store, micManager, clipboardHistory, cloudTranscriber }
 */
function createTray(mainWindow, deps = {}) {
  const icon = createTrayIcon('idle');
  trayIcon = new Tray(icon);
  trayIcon.setToolTip('MagicWhisper');

  // Build and set initial menu
  rebuildTrayMenu(mainWindow, deps);

  // Click toggles main window
  trayIcon.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  logger.info('tray', 'System tray created');
  return trayIcon;
}

/**
 * Rebuild the tray context menu (call after settings/device changes).
 */
function rebuildTrayMenu(mainWindow, deps = {}) {
  if (!trayIcon) return;

  const store = deps.store;
  const settings = store ? store.get('settings', {}) : {};
  const cloudEnabled = settings.cloudEnabled && settings.cloudPriority;

  // Build microphone submenu
  const micSubmenu = buildMicSubmenu(mainWindow, deps);

  // Build language submenu
  const langSubmenu = buildLanguageSubmenu(mainWindow, deps);

  // Model status display
  const modelLabel = cloudEnabled
    ? 'Primarily use cloud model...'
    : 'Primarily use local model...';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Home',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('navigate', 'home');
        }
      }
    },
    {
      label: 'Meeting Notes',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('navigate', 'meetings');
        }
      }
    },
    {
      label: 'Check for updates...',
      click: async () => {
        logger.info('tray', 'Check for updates clicked');
        if (deps.updater) {
          await deps.updater.checkForUpdates(true);
        } else {
          require('electron').shell.openExternal('https://github.com/mujtabatariq18/magicwhisper/releases');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Paste last transcript',
      accelerator: 'Ctrl+Command+V',
      click: () => {
        pasteLastTranscript(deps);
      }
    },
    {
      label: modelLabel,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Shortcuts',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('navigate', 'settings-general');
        }
      }
    },
    {
      label: 'Microphone',
      submenu: micSubmenu
    },
    {
      label: 'Languages',
      submenu: langSubmenu
    },
    { type: 'separator' },
    {
      label: 'Help Center',
      click: () => {
        require('electron').shell.openExternal('https://magicwhisper.app/help');
      }
    },
    {
      label: 'Talk to support',
      accelerator: 'Command+/',
      click: () => {
        require('electron').shell.openExternal('mailto:support@magicwhisper.app');
      }
    },
    {
      label: 'General feedback',
      click: () => {
        require('electron').shell.openExternal('https://magicwhisper.app/feedback');
      }
    },
    { type: 'separator' },
    {
      label: 'Quit MagicWhisper',
      accelerator: 'Command+Q',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  trayIcon.setContextMenu(contextMenu);
  logger.debug('tray', 'Tray menu rebuilt');
}

function buildMicSubmenu(mainWindow, deps) {
  const store = deps.store;
  const settings = store ? store.get('settings', {}) : {};
  const currentMic = settings.microphone || 'default';

  // We build a basic list — actual device enumeration happens async
  // so we start with common options
  return [
    {
      label: 'Built-in mic (recommended)',
      type: 'radio',
      checked: currentMic === 'default',
      click: () => {
        if (store) {
          store.set('settings.microphone', 'default');
          logger.info('tray', 'Microphone set to default');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Select from Settings...',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('navigate', 'settings-general');
        }
      }
    }
  ];
}

function buildLanguageSubmenu(mainWindow, deps) {
  const store = deps.store;
  const settings = store ? store.get('settings', {}) : {};
  const currentLang = settings.language || 'en';

  const languages = [
    ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
    ['it', 'Italian'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['ja', 'Japanese'],
    ['ko', 'Korean'], ['zh', 'Chinese'], ['ar', 'Arabic'], ['hi', 'Hindi'],
    ['ur', 'Urdu'], ['auto', 'Auto-detect']
  ];

  return languages.map(([code, name]) => ({
    label: name,
    type: 'radio',
    checked: currentLang === code,
    click: () => {
      if (store) {
        store.set('settings.language', code);
        logger.info('tray', `Language set to ${name} (${code})`);
        rebuildTrayMenu(mainWindow, deps);
      }
    }
  }));
}

function pasteLastTranscript(deps) {
  const clipHistory = deps.clipboardHistory;
  if (clipHistory) {
    const entries = clipHistory.getRecent(1);
    if (entries.length > 0) {
      clipboard.writeText(entries[0].text);
      const { exec } = require('child_process');
      if (process.platform === 'darwin') {
        exec(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, { timeout: 3000 });
      }
      logger.info('tray', 'Pasted last transcript', { textLength: entries[0].text.length });
    } else {
      logger.debug('tray', 'No transcript to paste');
    }
  }
}

function updateTrayState(tray, state) {
  if (!tray) return;
  const icon = createTrayIcon(state);
  tray.setImage(icon);

  const tooltips = {
    idle: 'MagicWhisper — Ready',
    recording: 'MagicWhisper — Recording...',
    processing: 'MagicWhisper — Transcribing...'
  };
  tray.setToolTip(tooltips[state] || 'MagicWhisper');
}

module.exports = { createTray, updateTrayState, rebuildTrayMenu };
