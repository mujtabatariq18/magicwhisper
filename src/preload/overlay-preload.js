// ============================================
// MagicWhisper — Overlay Preload Script
// ============================================
// Bridge for the floating widget: state updates,
// drag positioning, right-click menu, audio levels.
// ============================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  // State updates (recording, processing, success, idle)
  onState: (callback) => {
    ipcRenderer.on('overlay-state', (event, data) => callback(data));
  },

  // Audio level for waveform visualization (0.0 – 1.0)
  onAudioLevel: (callback) => {
    ipcRenderer.on('audio-level', (event, level) => callback(level));
  },

  // Drag: send position deltas to main process
  dragMove: (deltaX, deltaY) => {
    ipcRenderer.send('overlay-drag-move', { deltaX, deltaY });
  },

  // Save position when drag ends
  dragEnd: () => {
    ipcRenderer.send('overlay-drag-end');
  },

  // Request right-click context menu
  showContextMenu: () => {
    ipcRenderer.send('overlay-context-menu');
  }
});
