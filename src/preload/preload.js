// ============================================
// MagicWhisper — Preload Script (Main Window)
// ============================================
// Secure IPC bridge between renderer and main process.
// Uses contextBridge for security isolation.
// ============================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('magicAPI', {
  // ─── Settings ─────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // ─── Models ───────────────────────────────────────────
  getAvailableModels: () => ipcRenderer.invoke('get-available-models'),
  downloadModel: (modelName) => ipcRenderer.invoke('download-model', modelName),
  deleteModel: (modelName) => ipcRenderer.invoke('delete-model', modelName),

  // ─── Whisper Setup ────────────────────────────────────
  getWhisperStatus: () => ipcRenderer.invoke('get-whisper-status'),
  setupWhisper: () => ipcRenderer.invoke('setup-whisper'),
  getAccelerationStatus: () => ipcRenderer.invoke('get-acceleration-status'),
  setupGpuAcceleration: () => ipcRenderer.invoke('setup-gpu-acceleration'),

  // ─── Audio ────────────────────────────────────────────
  sendAudioData: (audioBuffer, duration) => ipcRenderer.send('audio-data', audioBuffer, duration),
  sendAudioLevel: (level) => ipcRenderer.send('audio-level', level),
  recordingCancelled: (reason) => ipcRenderer.send('recording-cancelled', reason),

  // ─── History ──────────────────────────────────────────
  getHistory: (opts) => ipcRenderer.invoke('get-history', opts || {}),
  getHistoryStats: () => ipcRenderer.invoke('get-history-stats'),
  getHistoryGrouped: () => ipcRenderer.invoke('get-history-grouped'),
  pinHistory: (id) => ipcRenderer.invoke('pin-history', id),
  deleteHistory: (id) => ipcRenderer.invoke('delete-history', id),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  copyHistoryItem: (id) => ipcRenderer.invoke('copy-history-item', id),
  pasteHistoryItem: (id) => ipcRenderer.invoke('paste-history-item', id),

  // ─── Dictionary ───────────────────────────────────────
  getDictionary: () => ipcRenderer.invoke('get-dictionary'),
  addDictionaryWord: (word, category, alternatives) =>
    ipcRenderer.invoke('add-dictionary-word', { word, category, alternatives }),
  removeDictionaryWord: (id) => ipcRenderer.invoke('remove-dictionary-word', id),
  importDictionary: (json) => ipcRenderer.invoke('import-dictionary', json),
  exportDictionary: () => ipcRenderer.invoke('export-dictionary'),

  // ─── Snippets ─────────────────────────────────────────
  getSnippets: () => ipcRenderer.invoke('get-snippets'),
  addSnippet: (trigger, expansion, category) =>
    ipcRenderer.invoke('add-snippet', { trigger, expansion, category }),
  removeSnippet: (id) => ipcRenderer.invoke('remove-snippet', id),
  updateSnippet: (id, updates) => ipcRenderer.invoke('update-snippet', { id, updates }),
  importSnippets: (json) => ipcRenderer.invoke('import-snippets', json),
  exportSnippets: () => ipcRenderer.invoke('export-snippets'),

  // ─── Microphone ───────────────────────────────────────
  getMicrophones: () => ipcRenderer.invoke('get-microphones'),

  // ─── Styles ───────────────────────────────────────────
  getStylePresets: () => ipcRenderer.invoke('get-style-presets'),
  getDefaultStyle: () => ipcRenderer.invoke('get-default-style'),
  setDefaultStyle: (styleId) => ipcRenderer.invoke('set-default-style', styleId),
  getAppStyles: () => ipcRenderer.invoke('get-app-styles'),
  setAppStyle: (appName, styleId) =>
    ipcRenderer.invoke('set-app-style', { appName, styleId }),
  removeAppStyle: (appName) => ipcRenderer.invoke('remove-app-style', appName),
  addCustomStyle: (name, description, rules) =>
    ipcRenderer.invoke('add-custom-style', { name, description, rules }),
  removeCustomStyle: (styleId) => ipcRenderer.invoke('remove-custom-style', styleId),

  // ─── Challenges ───────────────────────────────────────
  getChallengesStats: () => ipcRenderer.invoke('get-challenges-stats'),
  setDailyGoal: (words) => ipcRenderer.invoke('set-daily-goal', words),
  getTodayProgress: () => ipcRenderer.invoke('get-today-progress'),
  getWeeklySummary: () => ipcRenderer.invoke('get-weekly-summary'),

  // ─── Cloud Transcription ───────────────────────────────
  getCloudStatus: () => ipcRenderer.invoke('get-cloud-status'),
  saveCloudConfig: (config) => ipcRenderer.invoke('save-cloud-config', config),
  verifyApiKey: (apiKey) => ipcRenderer.invoke('verify-api-key', apiKey),
  checkCloudConnectivity: () => ipcRenderer.invoke('check-cloud-connectivity'),

  // ─── Logging ──────────────────────────────────────────
  getLogs: (count, level) => ipcRenderer.invoke('get-logs', { count, level }),
  getLogFiles: () => ipcRenderer.invoke('get-log-files'),
  exportLogs: () => ipcRenderer.invoke('export-logs'),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),
  getLoggingEnabled: () => ipcRenderer.invoke('get-logging-enabled'),
  setLoggingEnabled: (enabled) => ipcRenderer.invoke('set-logging-enabled', enabled),

  // ─── Permissions ──────────────────────────────────────
  getPermissionStatus: () => ipcRenderer.invoke('get-permission-status'),

  // ─── Updates ──────────────────────────────────────────
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  installDownloadedUpdate: () => ipcRenderer.invoke('install-downloaded-update'),

  // ─── Window Controls ──────────────────────────────────
  showWindow: () => ipcRenderer.send('show-window'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),

  // ─── Overlay Appearance ────────────────────────────────
  updateOverlayAppearance: (settings) => ipcRenderer.send('update-overlay-appearance', settings),

  // ─── Event Listeners ──────────────────────────────────
  onRecordingState: (callback) => {
    ipcRenderer.on('recording-state', (event, state) => callback(state));
  },
  onStartRecording: (callback) => {
    ipcRenderer.on('start-recording', () => callback());
  },
  onStopRecording: (callback) => {
    ipcRenderer.on('stop-recording', (event, duration) => callback(duration));
  },
  onReleaseMicrophone: (callback) => {
    ipcRenderer.on('release-microphone', () => callback());
  },
  onTranscriptionResult: (callback) => {
    ipcRenderer.on('transcription-result', (event, text) => callback(text));
  },
  onTranscriptionError: (callback) => {
    ipcRenderer.on('transcription-error', (event, error) => callback(error));
  },
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, data) => callback(data));
  },
  onSetupProgress: (callback) => {
    ipcRenderer.on('setup-progress', (event, data) => callback(data));
  },
  onGpuSetupProgress: (callback) => {
    ipcRenderer.on('gpu-setup-progress', (event, data) => callback(data));
  },
  onNeedsSetup: (callback) => {
    ipcRenderer.on('needs-setup', (event, needs) => callback(needs));
  },
  onHistoryUpdated: (callback) => {
    ipcRenderer.on('history-updated', (event, entry) => callback(entry));
  },
  onNavigate: (callback) => {
    ipcRenderer.on('navigate', (event, page) => callback(page));
  },
  onAchievement: (callback) => {
    ipcRenderer.on('achievement', (event, data) => callback(data));
  },
  onTranscriptionEngine: (callback) => {
    ipcRenderer.on('transcription-engine', (event, engine) => callback(engine));
  },
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, status) => callback(status));
  },

  // ─── Platform Info ────────────────────────────────────
  platform: process.platform,
  isMac: process.platform === 'darwin'
});
