// ============================================
// MagicWhisper — Floating Overlay Window
// ============================================
// Sleek pill-shaped waveform widget, Wispr Flow style.
// Draggable, always-on-top, visible on all workspaces.
// Default position: bottom-left corner.
// Right-click shows context menu.
// ============================================

const { BrowserWindow, screen, Menu, app, ipcMain, clipboard } = require('electron');
const path = require('path');
const { logger } = require('./logger');

let overlayWindow = null;
let savedPosition = null;

function createOverlay(mainWindow, store) {
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;

  // Restore saved position or default to bottom-left
  const settings = store ? store.get('settings', {}) : {};
  const defaultX = 40;
  const defaultY = screenHeight - 80;
  const posX = settings.overlayX != null ? settings.overlayX : defaultX;
  const posY = settings.overlayY != null ? settings.overlayY : defaultY;

  overlayWindow = new BrowserWindow({
    width: 160,
    height: 52,
    x: posX,
    y: posY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    type: 'panel',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  overlayWindow.setIgnoreMouseEvents(false);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Handle drag move from renderer
  ipcMain.on('overlay-drag-move', (event, { deltaX, deltaY }) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const [x, y] = overlayWindow.getPosition();
    const newX = x + deltaX;
    const newY = y + deltaY;
    overlayWindow.setPosition(newX, newY);
    logger.debug('overlay', 'Overlay dragged', { x: newX, y: newY });
  });

  // Save position when drag ends
  ipcMain.on('overlay-drag-end', () => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !store) return;
    const [x, y] = overlayWindow.getPosition();
    store.set('settings.overlayX', x);
    store.set('settings.overlayY', y);
    logger.info('overlay', 'Overlay position saved', { x, y });
  });

  // Handle right-click context menu request
  ipcMain.on('overlay-context-menu', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    showOverlayContextMenu(mainWindow);
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  logger.info('overlay', 'Overlay window created', { x: posX, y: posY });
  return overlayWindow;
}

function showOverlayContextMenu(mainWindow) {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Home',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('navigate', 'home');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Paste last transcript',
      accelerator: 'Ctrl+Command+V',
      click: () => {
        // Paste last clipboard text
        const text = clipboard.readText();
        if (text) {
          const { exec } = require('child_process');
          exec(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, { timeout: 3000 });
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Settings...',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('navigate', 'settings-general');
        }
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

  contextMenu.popup({ window: overlayWindow });
}

function updateOverlayState(state, data = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  overlayWindow.webContents.send('overlay-state', { state, ...data });

  // Adjust size based on state — pill expands when active
  const sizes = {
    idle:       { width: 56,  height: 36 },
    recording:  { width: 160, height: 44 },
    processing: { width: 120, height: 44 },
    success:    { width: 100, height: 44 }
  };

  const config = sizes[state] || sizes.idle;

  // Only resize, don't change position (user may have dragged)
  overlayWindow.setSize(config.width, config.height);

  // Idle state: semi-transparent
  if (state === 'idle') {
    overlayWindow.setOpacity(0.7);
  } else {
    overlayWindow.setOpacity(1.0);
  }

  // Auto-revert success state
  if (state === 'success') {
    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        updateOverlayState('idle');
      }
    }, 2000);
  }

  logger.debug('overlay', `Overlay state: ${state}`, { width: config.width });
}

/**
 * Send audio level data to the overlay for waveform visualization.
 * @param {number} level - Audio level 0.0 to 1.0
 */
function sendAudioLevel(level) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.send('audio-level', level);
}

function getOverlay() {
  return overlayWindow;
}

module.exports = { createOverlay, updateOverlayState, sendAudioLevel, getOverlay };
