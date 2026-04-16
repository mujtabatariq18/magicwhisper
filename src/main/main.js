// ============================================
// MagicWhisper — Main Process Entry Point
// ============================================
// Initializes all modules, manages app lifecycle,
// creates windows, and sets up IPC handlers.
// ============================================

const { app, BrowserWindow, ipcMain, clipboard, shell, Notification } = require('electron');
const path = require('path');

// ── Module Imports ───────────────────────────────────────
const { logger } = require('./logger');
const { getStore } = require('./store');
const { PermissionsManager } = require('./permissions');
const { createTray, updateTrayState, rebuildTrayMenu } = require('./tray');
const { createOverlay, updateOverlayState, sendAudioLevel, getOverlay } = require('./overlay');
const { Transcriber } = require('./transcriber');
const { TextInjector } = require('./injector');
const { ModelManager } = require('./model-manager');
const { ClipboardHistory } = require('./clipboard-history');
const { HotkeyManager } = require('./hotkey-manager');
const { Dictionary } = require('./dictionary');
const { Snippets } = require('./snippets');
const { TextProcessor } = require('./text-processor');
const { MicrophoneManager } = require('./microphone');
const { StyleManager } = require('./styles');
const { SoundManager } = require('./sound');
const { ChallengesManager } = require('./challenges');
const { CloudTranscriber } = require('./cloud-transcriber');

// ── State ────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let store = null;
let transcriber = null;
let injector = null;
let modelManager = null;
let clipboardHistory = null;
let hotkeyManager = null;
let dictionary = null;
let snippets = null;
let textProcessor = null;
let permissions = null;
let micManager = null;
let styleManager = null;
let soundManager = null;
let challenges = null;
let cloudTranscriber = null;
let isRecording = false;

const isMac = process.platform === 'darwin';

// ── Enforce Single Instance ─────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Another instance is already running — quit immediately.
  // The first instance will receive 'second-instance' event
  // and bring its window to front.
  app.quit();
} else {
  app.on('second-instance', () => {
    // Second instance tried to start — bring existing window to front
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    logger.info('main', 'Second instance blocked — brought existing window to front');
  });
}

// ── Window Creation ─────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 680,
    minHeight: 500,
    show: false,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    vibrancy: isMac ? 'under-window' : undefined,
    backgroundMaterial: !isMac ? 'acrylic' : undefined,
    backgroundColor: isMac ? '#00000000' : '#FAF8F5',
    transparent: isMac,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('ready-to-show', () => {
    // Don't auto-show — runs as tray app
    logger.info('main', 'Main window ready');
  });

  // Give sound manager access to the window for Web Audio playback
  if (soundManager) soundManager.setWindow(mainWindow);

  logger.info('main', 'Main window created');
}

// ── Recording Flow ──────────────────────────────────────
function startRecording() {
  if (isRecording) return;
  isRecording = true;

  logger.info('main', 'Recording started');
  updateTrayState(tray, 'recording');
  updateOverlayState('recording');

  // Play start sound
  const settings = store.get('settings', {});
  if (settings.soundFeedback !== false) {
    soundManager.play('start');
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recording-state', true);
    mainWindow.webContents.send('start-recording');
  }
}

function stopRecording(duration) {
  if (!isRecording) return;
  isRecording = false;

  logger.info('main', 'Recording stopped', { durationMs: duration });
  updateTrayState(tray, 'processing');
  updateOverlayState('processing');

  // Play stop sound
  const settings = store.get('settings', {});
  if (settings.soundFeedback !== false) {
    soundManager.play('stop');
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recording-state', false);
    mainWindow.webContents.send('stop-recording', duration || 0);
  }
}

async function handleAudioData(event, audioBuffer, recordDuration) {
  try {
    updateTrayState(tray, 'processing');
    updateOverlayState('processing');

    const settings = store.get('settings', {});
    const modelName = settings.model || 'ggml-base.en.bin';
    const language = settings.language || 'en';

    logger.info('main', 'Starting transcription pipeline', { model: modelName, language });

    // Step 1: Transcribe (hybrid — cloud first if priority, then local fallback)
    let text = null;
    let usedEngine = 'local';

    if (cloudTranscriber.shouldUsePrimary()) {
      // Try cloud transcription first
      try {
        const hasInternet = await cloudTranscriber.checkConnectivity();
        if (hasInternet) {
          logger.info('main', 'Using cloud transcription (priority mode)');
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('transcription-engine', 'cloud');
          }
          text = await cloudTranscriber.transcribe(audioBuffer, { language });
          usedEngine = 'cloud';
        } else {
          logger.info('main', 'Cloud priority but no internet — falling back to local');
        }
      } catch (cloudErr) {
        logger.warn('main', 'Cloud transcription failed — falling back to local', {
          error: cloudErr.message
        });
      }
    }

    // Local fallback (or primary if cloud not enabled/priority)
    if (!text) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transcription-engine', 'local');
      }
      text = await transcriber.transcribe(audioBuffer, {
        model: modelName,
        language: language
      });
      usedEngine = 'local';
    }

    if (text && text.trim()) {
      // Step 2: Process text (filler removal, corrections, etc.)
      text = textProcessor.process(text);

      // Step 3: Apply style/tone
      const activeStyle = styleManager.getDefaultStyle();
      text = styleManager.applyStyle(text, activeStyle);

      // Step 4: Inject (clipboard + auto-paste)
      const pasted = await injector.injectText(text.trim());

      // Step 5: Save to history
      const entry = clipboardHistory.add(text.trim(), {
        language: language,
        model: modelName,
        duration: recordDuration || 0
      });

      // Step 6: Record words for challenges & check milestones
      const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
      const achievement = challenges.recordWords(wordCount);

      // Step 7: Notify UI
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transcription-result', text.trim());
        mainWindow.webContents.send('history-updated', entry);

        // Send achievement notification if any
        if (achievement) {
          mainWindow.webContents.send('achievement', achievement);
          if (settings.soundFeedback !== false) {
            soundManager.play('milestone');
          }
          // System notification for milestones
          if (settings.notifMilestones !== false && Notification.isSupported()) {
            const notif = new Notification({
              title: achievement.title,
              body: achievement.message,
              silent: true
            });
            notif.show();
          }
        }
      }

      // Play success sound
      if (settings.soundFeedback !== false) {
        soundManager.play('success');
      }

      updateOverlayState('success');
      logger.info('main', 'Transcription pipeline complete', {
        wordCount,
        pasted,
        engine: usedEngine,
        style: activeStyle,
        entryId: entry?.id,
        achievement: achievement?.type || null
      });
    } else {
      logger.warn('main', 'Transcription returned empty text');
      updateOverlayState('idle');
    }

    updateTrayState(tray, 'idle');
  } catch (err) {
    logger.error('main', 'Transcription pipeline error', { error: err.message, stack: err.stack });
    updateTrayState(tray, 'idle');
    updateOverlayState('idle');

    // Play error sound
    const settings = store.get('settings', {});
    if (settings.soundFeedback !== false) {
      soundManager.play('error');
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transcription-error', err.message);
    }
  }
}

// ── Hotkeys ─────────────────────────────────────────────
function registerHotkeys() {
  const settings = store.get('settings', {});
  const shortcut = settings.hotkey || (isMac ? 'Option+Space' : 'Ctrl+Shift+Space');

  hotkeyManager.register(shortcut, {
    onStart: () => startRecording(),
    onStop: (duration) => stopRecording(duration)
  });
}

// ── IPC Handlers ────────────────────────────────────────
function setupIPC() {
  // ─ Audio ─
  ipcMain.on('audio-data', (event, audioBuffer, recordDuration) => {
    handleAudioData(event, audioBuffer, recordDuration);
  });

  // ─ Settings ─
  ipcMain.handle('get-settings', () => {
    return store.get('settings', {});
  });

  ipcMain.handle('save-settings', (event, settings) => {
    store.set('settings', settings);
    registerHotkeys();

    // Update overlay visibility
    const overlay = getOverlay();
    if (overlay && !overlay.isDestroyed()) {
      if (settings.overlayEnabled === false) {
        overlay.hide();
      } else {
        overlay.show();
      }
    }

    // Update logging
    if (settings.loggingEnabled !== undefined) {
      logger.setEnabled(settings.loggingEnabled);
    }

    // Update sound
    if (settings.soundFeedback !== undefined) {
      soundManager.setEnabled(settings.soundFeedback);
    }

    return true;
  });

  // ─ Models ─
  ipcMain.handle('get-available-models', () => modelManager.getAvailableModels());

  ipcMain.handle('download-model', async (event, modelName) => {
    return await modelManager.downloadModel(modelName, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', { model: modelName, progress });
      }
    });
  });

  ipcMain.handle('delete-model', async (event, modelName) => {
    return await modelManager.deleteModel(modelName);
  });

  // ─ Whisper Setup ─
  ipcMain.handle('get-whisper-status', () => ({
    binaryExists: transcriber.binaryExists(),
    ready: transcriber.isReady()
  }));

  ipcMain.handle('setup-whisper', async () => {
    return await transcriber.setup((progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('setup-progress', progress);
      }
    });
  });

  // ─ History ─
  ipcMain.handle('get-history', (event, { query, limit, offset } = {}) => {
    let items = query ? clipboardHistory.search(query) : clipboardHistory.getAll();
    const total = items.length;
    if (offset) items = items.slice(offset);
    if (limit) items = items.slice(0, limit);
    return { items, total };
  });

  ipcMain.handle('get-history-stats', () => clipboardHistory.getStats());
  ipcMain.handle('get-history-grouped', () => clipboardHistory.getGrouped());
  ipcMain.handle('pin-history', (event, id) => clipboardHistory.pin(id));
  ipcMain.handle('delete-history', (event, id) => { clipboardHistory.remove(id); return true; });
  ipcMain.handle('clear-history', () => { clipboardHistory.clear(); return true; });

  ipcMain.handle('copy-history-item', (event, id) => {
    const entry = clipboardHistory.getById(id);
    if (entry) { clipboard.writeText(entry.text); return true; }
    return false;
  });

  ipcMain.handle('paste-history-item', async (event, id) => {
    const entry = clipboardHistory.getById(id);
    if (entry) { await injector.injectText(entry.text); return true; }
    return false;
  });

  // ─ Dictionary ─
  ipcMain.handle('get-dictionary', () => dictionary.getAll());
  ipcMain.handle('add-dictionary-word', (event, { word, category, alternatives }) =>
    dictionary.add(word, category, alternatives));
  ipcMain.handle('remove-dictionary-word', (event, id) => { dictionary.remove(id); return true; });
  ipcMain.handle('import-dictionary', (event, json) => dictionary.import(json));
  ipcMain.handle('export-dictionary', () => dictionary.export());

  // ─ Snippets ─
  ipcMain.handle('get-snippets', () => snippets.getAll());
  ipcMain.handle('add-snippet', (event, { trigger, expansion, category }) =>
    snippets.add(trigger, expansion, category));
  ipcMain.handle('remove-snippet', (event, id) => { snippets.remove(id); return true; });
  ipcMain.handle('update-snippet', (event, { id, updates }) => snippets.update(id, updates));
  ipcMain.handle('import-snippets', (event, json) => snippets.import(json));
  ipcMain.handle('export-snippets', () => snippets.export());

  // ─ Styles ─
  ipcMain.handle('get-style-presets', () => styleManager.getPresets());
  ipcMain.handle('get-default-style', () => styleManager.getDefaultStyle());
  ipcMain.handle('set-default-style', (event, styleId) => {
    styleManager.setDefaultStyle(styleId);
    return true;
  });
  ipcMain.handle('get-app-styles', () => styleManager.getAppStyles());
  ipcMain.handle('set-app-style', (event, { appName, styleId }) => {
    styleManager.setStyleForApp(appName, styleId);
    return true;
  });
  ipcMain.handle('remove-app-style', (event, appName) => {
    styleManager.removeAppStyle(appName);
    return true;
  });
  ipcMain.handle('add-custom-style', (event, { name, description, rules }) => {
    return styleManager.addCustomStyle(name, description, rules);
  });
  ipcMain.handle('remove-custom-style', (event, styleId) => {
    styleManager.removeCustomStyle(styleId);
    return true;
  });

  // ─ Challenges ─
  ipcMain.handle('get-challenges-stats', () => challenges.getStats());
  ipcMain.handle('set-daily-goal', (event, words) => {
    challenges.setDailyGoal(words);
    return true;
  });
  ipcMain.handle('get-today-progress', () => challenges.getTodayProgress());
  ipcMain.handle('get-weekly-summary', () => challenges.getWeeklySummary());

  // ─ Cloud Transcription ─
  ipcMain.handle('get-cloud-status', () => cloudTranscriber.getStatus());

  ipcMain.handle('save-cloud-config', async (event, config) => {
    // Update cloud transcriber
    cloudTranscriber.configure(config);

    // Persist to settings
    if (config.apiKey !== undefined) store.set('settings.cloudApiKey', config.apiKey);
    if (config.enabled !== undefined) store.set('settings.cloudEnabled', config.enabled);
    if (config.priority !== undefined) store.set('settings.cloudPriority', config.priority);
    if (config.model !== undefined) store.set('settings.cloudModel', config.model);

    return cloudTranscriber.getStatus();
  });

  ipcMain.handle('verify-api-key', async (event, apiKey) => {
    return await cloudTranscriber.verifyApiKey(apiKey);
  });

  ipcMain.handle('check-cloud-connectivity', async () => {
    return await cloudTranscriber.checkConnectivity();
  });

  // ─ Microphone ─
  ipcMain.handle('get-microphones', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return await micManager.enumerateDevices(mainWindow.webContents);
    }
    return [];
  });

  // ─ Logging ─
  ipcMain.handle('get-logs', (event, { count, level } = {}) =>
    logger.getRecentEntries(count || 100, level || 'DEBUG'));
  ipcMain.handle('get-log-files', () => logger.getLogFiles());
  ipcMain.handle('export-logs', () => logger.exportAllLogs());
  ipcMain.handle('clear-logs', () => { logger.clearLogs(); return true; });
  ipcMain.handle('get-logging-enabled', () => logger.isEnabled());
  ipcMain.handle('set-logging-enabled', (event, enabled) => {
    logger.setEnabled(enabled);
    store.set('settings.loggingEnabled', enabled);
    return true;
  });

  // ─ Permissions ─
  ipcMain.handle('get-permission-status', () => permissions.getStatus());

  // ─ Window Controls ─
  ipcMain.on('show-window', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
  ipcMain.on('hide-window', () => {
    if (mainWindow) mainWindow.hide();
  });
  ipcMain.on('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
  });

  // ─ Overlay Appearance ─
  ipcMain.on('update-overlay-appearance', (event, settings) => {
    logger.debug('main', 'Overlay appearance update', settings);

    // Forward to overlay window
    const ow = getOverlay();
    if (ow && !ow.isDestroyed()) {
      ow.webContents.send('update-appearance', settings);
    }

    // Rebuild tray if tray color changed
    if (settings.trayIconColor && tray) {
      rebuildTrayMenu(tray, store, mainWindow);
    }
  });
}

// ── App Lifecycle ───────────────────────────────────────
app.whenReady().then(async () => {
  // Initialize logger first — captures everything from this point
  logger.init();
  logger.info('main', '═══ MagicWhisper Starting ═══', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch
  });

  // Initialize store
  store = getStore();

  // Apply logging preference from settings
  const loggingEnabled = store.get('settings.loggingEnabled', true);
  logger.setEnabled(loggingEnabled);

  // Hide dock icon on macOS — runs as tray app
  const settings = store.get('settings', {});
  if (isMac && app.dock && !settings.showInDock) {
    app.dock.hide();
  }

  // Initialize modules
  const modelsDir = path.join(app.getPath('userData'), 'models');
  const binDir = path.join(app.getPath('userData'), 'bin');

  modelManager = new ModelManager(modelsDir);
  transcriber = new Transcriber(binDir, modelsDir);
  injector = new TextInjector();
  clipboardHistory = new ClipboardHistory();
  hotkeyManager = new HotkeyManager();
  dictionary = new Dictionary();
  snippets = new Snippets();
  textProcessor = new TextProcessor(dictionary, snippets);
  permissions = new PermissionsManager();
  micManager = new MicrophoneManager();
  styleManager = new StyleManager();
  soundManager = new SoundManager();
  challenges = new ChallengesManager();
  cloudTranscriber = new CloudTranscriber();

  // Apply cloud transcription settings
  cloudTranscriber.configure({
    apiKey: settings.cloudApiKey || '',
    enabled: settings.cloudEnabled || false,
    priority: settings.cloudPriority || false,
    model: settings.cloudModel || 'whisper-1'
  });

  // Apply sound setting
  soundManager.setEnabled(settings.soundFeedback !== false);

  // Create window & tray
  createWindow();

  // Create tray with full dependencies for submenus
  const trayDeps = { store, micManager, clipboardHistory, cloudTranscriber };
  tray = createTray(mainWindow, trayDeps);

  // Create overlay with mainWindow and store for position persistence
  if (settings.overlayEnabled !== false) {
    createOverlay(mainWindow, store);
    updateOverlayState('idle');
  }

  // Setup permissions & IPC
  permissions.installElectronPermissionHandlers();
  setupIPC();
  registerHotkeys();
  await permissions.requestMicrophone();
  permissions.checkAccessibility();

  // Show setup wizard if whisper binary not found
  if (!transcriber.binaryExists()) {
    logger.info('main', 'Whisper binary not found — showing setup wizard');
    if (mainWindow) {
      mainWindow.show();
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('needs-setup', true);
      });
    }
  }

  logger.info('main', '═══ MagicWhisper Ready ═══');
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (hotkeyManager) hotkeyManager.destroy();
  logger.info('main', '═══ MagicWhisper Shutting Down ═══');
});
