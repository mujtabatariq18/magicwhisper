// ============================================
// MagicWhisper — Renderer Application Logic
// ============================================

let currentSettings = {};
let audioStream = null;
let recordStartTime = null;
let persistentMicStream = null;
let micSafetyTimer = null;
let isMicCapturing = false;
let currentPage = 'home';

const MAX_RENDERER_RECORDING_MS = 5 * 60 * 1000;

// ── Initialization ──────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadAppVersion();
  await checkSetupStatus();
  updateGreeting();
  await loadHomeStats();
  await loadChallengeProgress();
  await loadWeeklyChart();
  await loadHomeHistory();
  setupEventListeners();
  setupScratchpad();
});

async function loadAppVersion() {
  if (!window.magicAPI.getAppVersion) return;
  const version = await window.magicAPI.getAppVersion();
  document.querySelectorAll('[data-app-version]').forEach(el => {
    el.textContent = version;
  });
}

window.addEventListener('beforeunload', () => {
  releaseMicResources();
});

function updateGreeting() {
  const hour = new Date().getHours();
  let greeting = 'Good evening';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 17) greeting = 'Good afternoon';
  document.getElementById('greeting').textContent = greeting;
}

async function loadSettings() {
  currentSettings = await window.magicAPI.getSettings();

  // Apply settings to UI
  const shortcut = currentSettings.hotkey || (window.magicAPI.isMac ? 'Option+Space' : 'Ctrl+Shift+Space');
  document.getElementById('shortcut-desc').innerHTML =
    `Press <strong>${shortcut.replace('+', ' + ')}</strong> and speak. <a href="#" onclick="navigateTo(\'settings-general\');return false;">Change →</a>`;
  document.getElementById('status-detail').textContent = `Press ${shortcut} to dictate`;

  // Language name
  const langNames = {
    en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', ru: 'Russian', ja: 'Japanese', ko: 'Korean',
    zh: 'Chinese', ar: 'Arabic', hi: 'Hindi', ur: 'Urdu', auto: 'Auto-detect'
  };
  document.getElementById('lang-name').textContent = langNames[currentSettings.language] || 'English';

  // Toggles
  setToggle('toggle-launch', currentSettings.launchAtLogin);
  setToggle('toggle-flowbar', currentSettings.overlayEnabled !== false);
  setToggle('toggle-dock', currentSettings.showInDock);
  setToggle('toggle-sounds', currentSettings.soundFeedback !== false);
  setToggle('toggle-mute', currentSettings.muteMusicWhileDictating);
  setToggle('toggle-notif-suggest', currentSettings.notifSuggestions !== false);
  setToggle('toggle-notif-announce', currentSettings.notifAnnouncements !== false);
  setToggle('toggle-notif-miles', currentSettings.notifMilestones !== false);
  setToggle('toggle-autodict', currentSettings.autoAddToDictionary !== false);
  setToggle('toggle-logging', currentSettings.loggingEnabled !== false);
  setToggle('toggle-minimize-tray', currentSettings.minimizeToTray !== false);
  setToggle('toggle-dev-mode', currentSettings.developerMode === true);
  setToggle('toggle-dev-syntax', currentSettings.developerSyntaxFormatting !== false);
  setToggle('toggle-dev-files', currentSettings.developerFileTagging !== false);
  setToggle('toggle-prefer-gpu', currentSettings.preferGpuForLargeModels !== false);
}

function setToggle(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}

async function checkSetupStatus() {
  const status = await window.magicAPI.getWhisperStatus();
  if (!status.binaryExists) {
    document.getElementById('setup-overlay').classList.remove('hidden');
  }
}

// ── Event Listeners ─────────────────────────────────────

function setupEventListeners() {
  window.magicAPI.onRecordingState((isRecording) => {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-label');
    const detail = document.getElementById('status-detail');

    if (isRecording === null) {
      dot.className = 'status-dot idle';
      label.textContent = 'Ready';
      const shortcut = currentSettings.hotkey || (window.magicAPI.isMac ? 'Option+Space' : 'Ctrl+Shift+Space');
      detail.textContent = `Press ${shortcut} to dictate`;
      return;
    }

    if (isRecording) {
      dot.className = 'status-dot recording';
      label.textContent = 'Recording';
      detail.textContent = 'Speak now... press shortcut again to stop';
    } else {
      dot.className = 'status-dot processing';
      label.textContent = 'Processing';
      detail.textContent = 'Transcribing your speech...';
    }
  });

  window.magicAPI.onStartRecording(async () => {
    recordStartTime = Date.now();
    await startMicCapture();
  });

  window.magicAPI.onStopRecording(async (duration) => {
    await stopMicCapture(duration);
  });

  if (window.magicAPI.onReleaseMicrophone) {
    window.magicAPI.onReleaseMicrophone(() => {
      releaseMicResources();
    });
  }

  window.magicAPI.onTranscriptionResult((text) => {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-label');
    const detail = document.getElementById('status-detail');

    dot.className = 'status-dot idle';
    label.textContent = 'Ready';
    const shortcut = currentSettings.hotkey || (window.magicAPI.isMac ? 'Option+Space' : 'Ctrl+Shift+Space');
    detail.textContent = `Press ${shortcut} to dictate`;

    if (text) {
      showToast('Transcribed & pasted!');
      loadHomeStats();
      loadChallengeProgress();
      loadWeeklyChart();
      loadHomeHistory();
    }
  });

  window.magicAPI.onTranscriptionError((error) => {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-label');
    const detail = document.getElementById('status-detail');

    dot.className = 'status-dot idle';
    label.textContent = 'Error';
    detail.textContent = error;

    setTimeout(() => {
      label.textContent = 'Ready';
      const shortcut = currentSettings.hotkey || (window.magicAPI.isMac ? 'Option+Space' : 'Ctrl+Shift+Space');
      detail.textContent = `Press ${shortcut} to dictate`;
    }, 4000);
  });

  window.magicAPI.onDownloadProgress(({ model, progress }) => {
    const btn = document.getElementById(`dl-${model}`);
    if (btn) { btn.textContent = `${progress}%`; btn.disabled = true; }
  });

  window.magicAPI.onSetupProgress((data) => {
    document.getElementById('setup-status-text').textContent = data.message;
    if (data.stage === 'binary') {
      document.getElementById('step-binary-progress').classList.remove('hidden');
      document.getElementById('binary-progress-text').textContent = data.message;
    }
  });

  if (window.magicAPI.onGpuSetupProgress) {
    window.magicAPI.onGpuSetupProgress((data) => {
      const status = document.getElementById('gpu-status');
      if (status) status.textContent = data.message || 'Installing GPU backend...';
    });
  }

  window.magicAPI.onNeedsSetup((needs) => {
    if (needs) document.getElementById('setup-overlay').classList.remove('hidden');
  });

  window.magicAPI.onHistoryUpdated(() => {
    if (currentPage === 'home') loadHomeHistory();
    loadHomeStats();
    loadChallengeProgress();
  });

  window.magicAPI.onNavigate((page) => {
    navigateTo(page);
  });

  window.magicAPI.onAchievement((data) => {
    showAchievementBanner(data);
  });

  window.magicAPI.onTranscriptionEngine((engine) => {
    const detail = document.getElementById('status-detail');
    if (engine === 'cloud') {
      detail.textContent = 'Transcribing via OpenAI API...';
    } else {
      detail.textContent = 'Transcribing locally...';
    }
  });

  if (window.magicAPI.onUpdateStatus) {
    window.magicAPI.onUpdateStatus((status) => {
      updateUpdateStatus(status);
    });
  }
}

// ── Navigation ──────────────────────────────────────────

function navigateTo(page) {
  currentPage = page;

  // Deactivate all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Activate target page
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  // Activate nav item
  const navBase = page.startsWith('settings-') ? 'settings' : page;
  const navEl = document.getElementById(`nav-${navBase}`);
  if (navEl) navEl.classList.add('active');

  // Load page data
  if (page === 'home') { loadHomeStats(); loadChallengeProgress(); loadWeeklyChart(); loadHomeHistory(); }
  if (page === 'dictionary') loadDictionary();
  if (page === 'snippets') loadSnippets();
  if (page === 'style') loadStyles();
  if (page === 'settings-models') { loadModels(); loadAccelerationStatus(); }
  if (page === 'settings-advanced') loadAdvancedInfo();
}

// ── Home ────────────────────────────────────────────────

async function loadHomeStats() {
  try {
    const stats = await window.magicAPI.getHistoryStats();
    document.getElementById('stat-total-words').textContent = stats.totalWords.toLocaleString();
    document.getElementById('stat-wpm').textContent = stats.wpm || 0;
    document.getElementById('stat-streak').textContent = stats.streak || 0;
  } catch (e) {}
}

async function loadHomeHistory() {
  try {
    const grouped = await window.magicAPI.getHistoryGrouped();
    const container = document.getElementById('home-history');

    const keys = Object.keys(grouped);
    if (keys.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No transcriptions yet. Hold your hotkey and speak!</p></div>';
      return;
    }

    let html = '';
    for (const dateLabel of keys) {
      const entries = grouped[dateLabel].slice(0, 10); // Limit per group
      html += `<div class="history-date-group">`;
      html += `<div class="history-date-label">${escapeHtml(dateLabel)}</div>`;

      for (const entry of entries) {
        const time = formatTime(entry.timestamp);
        html += `
          <div class="history-entry" data-id="${entry.id}">
            <span class="history-time">${time}</span>
            <div class="history-text">${escapeHtml(entry.text)}</div>
            <div class="history-actions">
              <button class="act-btn" title="Copy" onclick="copyItem('${entry.id}')">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V3h8" stroke-linecap="round"/></svg>
              </button>
              <button class="act-btn" title="Paste" onclick="pasteItem('${entry.id}')">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="2" width="10" height="12" rx="1.5"/><line x1="6" y1="6" x2="10" y2="6"/><line x1="6" y1="9" x2="10" y2="9"/></svg>
              </button>
              <button class="act-btn danger" title="Delete" onclick="deleteItem('${entry.id}')">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
              </button>
            </div>
          </div>`;
      }
      html += `</div>`;
    }

    container.innerHTML = html;
  } catch (e) {
    console.error('Failed to load history:', e);
  }
}

async function copyItem(id) {
  await window.magicAPI.copyHistoryItem(id);
  showToast('Copied to clipboard');
}

async function pasteItem(id) {
  await window.magicAPI.pasteHistoryItem(id);
  showToast('Pasted into active app');
}

async function deleteItem(id) {
  await window.magicAPI.deleteHistory(id);
  loadHomeHistory();
  loadHomeStats();
}

// ── Dictionary ──────────────────────────────────────────

async function loadDictionary(query) {
  try {
    let entries = await window.magicAPI.getDictionary();
    if (query) {
      const q = query.toLowerCase();
      entries = entries.filter(e => e.word.toLowerCase().includes(q) || (e.alternatives || []).some(a => a.includes(q)));
    }

    const container = document.getElementById('dictionary-list');
    if (entries.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No custom words yet. Add words or they\'ll be auto-learned as you use MagicWhisper.</p></div>';
      return;
    }

    container.innerHTML = entries.map(entry => `
      <div class="card-item" data-id="${entry.id}">
        <div class="card-item-content">
          <div class="card-item-title">${escapeHtml(entry.word)}</div>
          <div class="card-item-desc">
            ${entry.alternatives.length > 0 ? `Also matches: ${entry.alternatives.join(', ')}` : entry.category}
            ${entry.autoLearned ? ' · Auto-learned' : ''}
            ${entry.useCount > 0 ? ` · Used ${entry.useCount}×` : ''}
          </div>
        </div>
        <span class="card-item-badge">${entry.category}</span>
        <div class="card-item-actions">
          <button class="act-btn danger" title="Remove" onclick="removeDictWord('${entry.id}')">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
          </button>
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

function searchDictionary(q) { loadDictionary(q); }

async function removeDictWord(id) {
  await window.magicAPI.removeDictionaryWord(id);
  loadDictionary();
  showToast('Word removed');
}

function showAddWordDialog() {
  openModal('Add Word', `
    <label>Word</label>
    <input type="text" id="new-word" placeholder="e.g. Kubernetes">
    <label>Category</label>
    <select id="new-word-category">
      <option value="custom">Custom</option>
      <option value="name">Name</option>
      <option value="technical">Technical</option>
    </select>
    <label>Alternative spellings (comma separated)</label>
    <input type="text" id="new-word-alts" placeholder="e.g. kubernetees, kubernets">
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="addWord()">Add</button>
    </div>
  `);
}

async function addWord() {
  const word = document.getElementById('new-word').value.trim();
  const category = document.getElementById('new-word-category').value;
  const alts = document.getElementById('new-word-alts').value
    .split(',').map(s => s.trim()).filter(Boolean);

  if (!word) return;
  await window.magicAPI.addDictionaryWord(word, category, alts);
  closeModal();
  loadDictionary();
  showToast(`"${word}" added to dictionary`);
}

// ── Snippets ────────────────────────────────────────────

async function loadSnippets(query) {
  try {
    let entries = await window.magicAPI.getSnippets();
    if (query) {
      const q = query.toLowerCase();
      entries = entries.filter(e => e.trigger.toLowerCase().includes(q) || e.expansion.toLowerCase().includes(q));
    }

    const container = document.getElementById('snippets-list');
    if (entries.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No snippets yet. Create a snippet to insert commonly used text with your voice.</p></div>';
      return;
    }

    container.innerHTML = entries.map(entry => `
      <div class="card-item" data-id="${entry.id}">
        <div class="card-item-content">
          <div class="card-item-title">"${escapeHtml(entry.trigger)}"</div>
          <div class="card-item-desc">${escapeHtml(entry.expansion.slice(0, 120))}${entry.expansion.length > 120 ? '...' : ''}</div>
        </div>
        ${entry.useCount > 0 ? `<span class="card-item-badge">Used ${entry.useCount}×</span>` : ''}
        <div class="card-item-actions">
          <button class="act-btn danger" title="Remove" onclick="removeSnippet('${entry.id}')">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
          </button>
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

function searchSnippets(q) { loadSnippets(q); }

async function removeSnippet(id) {
  await window.magicAPI.removeSnippet(id);
  loadSnippets();
  showToast('Snippet removed');
}

function showAddSnippetDialog() {
  openModal('Add Snippet', `
    <label>Trigger Phrase</label>
    <input type="text" id="new-trigger" placeholder='e.g. "my calendar"'>
    <label>Expanded Text</label>
    <textarea id="new-expansion" placeholder="The text that will be inserted when you say the trigger phrase"></textarea>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="addSnippet()">Create</button>
    </div>
  `);
}

async function addSnippet() {
  const trigger = document.getElementById('new-trigger').value.trim();
  const expansion = document.getElementById('new-expansion').value.trim();
  if (!trigger || !expansion) return;
  await window.magicAPI.addSnippet(trigger, expansion, 'general');
  closeModal();
  loadSnippets();
  showToast(`Snippet "${trigger}" created`);
}

// ── Models ──────────────────────────────────────────────

async function loadModels() {
  try {
    const models = await window.magicAPI.getAvailableModels();
    const container = document.getElementById('models-list');
    const activeModel = currentSettings.model || 'ggml-base.en.bin';

    container.innerHTML = models.map(model => {
      const dots = Array.from({ length: 5 }, (_, i) =>
        `<div class="quality-dot ${i < model.quality ? 'filled' : ''}"></div>`
      ).join('');

      const isActive = model.name === activeModel;

      let actions;
      if (model.installed) {
        if (isActive) {
          actions = '<button class="model-btn model-btn-secondary" disabled>Selected</button>';
        } else {
          actions = `
            <button class="model-btn model-btn-secondary" onclick="selectModel('${model.name}','${model.label}','${model.description}')">Use</button>
            <button class="model-btn model-btn-danger" onclick="deleteModel('${model.name}')">Remove</button>`;
        }
      } else {
        actions = `<button class="model-btn model-btn-primary" onclick="downloadModel('${model.name}',this)" id="dl-${model.name}">Download</button>`;
      }

      return `
        <div class="model-card ${isActive ? 'active-model' : ''}">
          <div class="model-card-quality">${dots}</div>
          <div class="model-card-info">
            <div class="model-card-name">
              ${model.label}
              ${model.default ? '<span class="model-badge">Recommended</span>' : ''}
              ${isActive ? '<span class="model-badge">Active</span>' : ''}
            </div>
            <div class="model-card-meta">${model.description} · ${model.size}</div>
          </div>
          <div class="model-card-actions">${actions}</div>
        </div>`;
    }).join('');

    const active = models.find(m => m.name === activeModel);
    if (active) {
      document.getElementById('active-model-name').textContent = active.label;
      document.getElementById('active-model-desc').textContent = active.description;
    }
    await loadAccelerationStatus();
  } catch (e) {}
}

async function selectModel(name, label, desc) {
  currentSettings.model = name;
  await saveSetting('model', name);
  document.getElementById('active-model-name').textContent = label;
  document.getElementById('active-model-desc').textContent = desc;
  loadModels();
  showToast(`Model switched to ${label}`);
}

async function downloadModel(name, btn) {
  btn.textContent = 'Starting...';
  btn.disabled = true;
  try {
    await window.magicAPI.downloadModel(name);
    btn.textContent = 'Done!';
    if (name === 'ggml-large-v3-turbo.bin') {
      await selectModel(name, 'Large V3 Turbo', 'Best accuracy, requires more RAM');
    }
    setTimeout(() => loadModels(), 500);
  } catch (err) {
    btn.textContent = 'Failed';
    btn.disabled = false;
  }
}

async function loadAccelerationStatus() {
  if (!window.magicAPI.getAccelerationStatus) return;
  try {
    const status = await window.magicAPI.getAccelerationStatus();
    const el = document.getElementById('gpu-status');
    const btn = document.getElementById('gpu-setup-btn');
    if (!el || !btn) return;

    if (status.cudaReady) {
      el.textContent = 'CUDA GPU backend installed. Large V3 Turbo will use the GPU automatically.';
      btn.textContent = 'Reinstall GPU Backend';
    } else {
      el.textContent = 'CUDA GPU backend not installed. Large V3 Turbo will fall back to CPU until installed.';
      btn.textContent = 'Install GPU Backend';
    }
  } catch (e) {}
}

async function setupGpuAcceleration() {
  const btn = document.getElementById('gpu-setup-btn');
  const status = document.getElementById('gpu-status');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Installing...';
  }
  if (status) status.textContent = 'Downloading CUDA GPU backend...';

  try {
    await window.magicAPI.setupGpuAcceleration();
    await saveSetting('localAcceleration', 'auto');
    await saveSetting('preferGpuForLargeModels', true);
    await loadAccelerationStatus();
    showToast('GPU backend installed');
  } catch (err) {
    if (status) status.textContent = `GPU setup failed: ${err.message}`;
    showToast('GPU backend setup failed');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteModel(name) {
  if (name === currentSettings.model) {
    showToast('Cannot delete the active model');
    return;
  }
  await window.magicAPI.deleteModel(name);
  loadModels();
  showToast('Model removed');
}

// ── Settings ────────────────────────────────────────────

async function saveSetting(key, value) {
  currentSettings[key] = value;
  await window.magicAPI.saveSettings(currentSettings);
}

async function toggleLogging(enabled) {
  await window.magicAPI.setLoggingEnabled(enabled);
  showToast(enabled ? 'Logging enabled' : 'Logging disabled');
}

// ── Shortcut Recording ──────────────────────────────────

let recordingShortcut = false;

function startRecordingShortcut() {
  if (recordingShortcut) return;
  recordingShortcut = true;
  const btn = document.getElementById('change-shortcut-btn');
  btn.textContent = 'Press keys...';

  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;

    const parts = [];
    if (e.ctrlKey) parts.push('Control');
    if (e.altKey) parts.push('Option');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Command');

    let key = e.key;
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    parts.push(key);

    const shortcut = parts.join('+');
    currentSettings.hotkey = shortcut;
    saveSetting('hotkey', shortcut);
    document.getElementById('shortcut-desc').innerHTML =
      `Press <strong>${shortcut.replace(/\+/g, ' + ')}</strong> and speak. <a href="#" onclick="navigateTo('settings-general');return false;">Change →</a>`;
    document.getElementById('status-detail').textContent = `Press ${shortcut} to dictate`;

    recordingShortcut = false;
    btn.textContent = 'Change';
    document.removeEventListener('keydown', handler);
    showToast(`Shortcut set to ${shortcut}`);
  };
  document.addEventListener('keydown', handler);
}

// ── Language / Microphone Selectors ─────────────────────

function showLanguageSelector() {
  const langs = [
    ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
    ['it', 'Italian'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['ja', 'Japanese'],
    ['ko', 'Korean'], ['zh', 'Chinese'], ['ar', 'Arabic'], ['hi', 'Hindi'],
    ['ur', 'Urdu'], ['auto', 'Auto-detect']
  ];

  const options = langs.map(([code, name]) =>
    `<option value="${code}" ${currentSettings.language === code ? 'selected' : ''}>${name}</option>`
  ).join('');

  openModal('Select Language', `
    <label>Transcription Language</label>
    <select id="lang-select">${options}</select>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="setLanguage()">Save</button>
    </div>
  `);
}

async function setLanguage() {
  const lang = document.getElementById('lang-select').value;
  await saveSetting('language', lang);
  const langNames = {
    en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', ru: 'Russian', ja: 'Japanese', ko: 'Korean',
    zh: 'Chinese', ar: 'Arabic', hi: 'Hindi', ur: 'Urdu', auto: 'Auto-detect'
  };
  document.getElementById('lang-name').textContent = langNames[lang] || lang;
  closeModal();
  showToast(`Language set to ${langNames[lang]}`);
}

async function showMicSelector() {
  try {
    const mics = await window.magicAPI.getMicrophones();
    const options = mics.map(m =>
      `<option value="${m.deviceId}" ${currentSettings.microphone === m.deviceId ? 'selected' : ''}>${m.label}</option>`
    ).join('');

    openModal('Select Microphone', `
      <label>Audio Input Device</label>
      <select id="mic-select">${options || '<option>No microphones found</option>'}</select>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="setMicrophone()">Save</button>
      </div>
    `);
  } catch (e) {
    showToast('Failed to load microphones');
  }
}

async function setMicrophone() {
  const mic = document.getElementById('mic-select').value;
  const label = document.getElementById('mic-select').selectedOptions[0]?.text || 'Unknown';
  await saveSetting('microphone', mic);
  document.getElementById('mic-name').textContent = label;
  closeModal();
  showToast(`Microphone set to ${label}`);
}

// ── Advanced Settings ───────────────────────────────────

async function loadAdvancedInfo() {
  try {
    const status = await window.magicAPI.getPermissionStatus();
    const micLabel = status.microphone === 'granted' ? '✓ Mic granted' :
                     status.microphone === 'denied' ? '✗ Mic denied' : '? Mic pending';
    const accLabel = status.accessibility ? '✓ Accessibility granted' : '✗ Accessibility needed';
    document.getElementById('perm-status').textContent = `${micLabel} · ${accLabel}`;

    const logFiles = await window.magicAPI.getLogFiles();
    document.getElementById('log-file-count').textContent = `${logFiles.length} log file${logFiles.length !== 1 ? 's' : ''}`;

    // Load cloud transcription status
    await loadCloudStatus();
    if (window.magicAPI.getUpdateStatus) {
      updateUpdateStatus(await window.magicAPI.getUpdateStatus());
    }

    // Init model selector and overlay appearance
    initModelSelector();
    initOverlayAppearance();
  } catch (e) {}
}

async function checkForAppUpdates() {
  try {
    updateUpdateStatus({ message: 'Checking for updates...' });
    await window.magicAPI.checkForUpdates();
  } catch (e) {
    updateUpdateStatus({ message: `Update check failed: ${e.message}` });
  }
}

function updateUpdateStatus(status) {
  const el = document.getElementById('update-status');
  if (!el || !status) return;
  el.textContent = status.message || 'Update status unavailable';
}

async function loadCloudStatus() {
  try {
    const cloud = await window.magicAPI.getCloudStatus();

    // Update API key status display
    const keyStatus = document.getElementById('cloud-key-status');
    if (cloud.hasApiKey) {
      keyStatus.textContent = cloud.connected ? '✓ API key configured · Connected' : '✓ API key configured';
      keyStatus.style.color = 'var(--success)';
    } else {
      keyStatus.textContent = 'Not configured';
      keyStatus.style.color = '';
    }

    // Update toggles
    setToggle('toggle-cloud-enabled', cloud.enabled);
    setToggle('toggle-cloud-priority', cloud.priority);

    // Update connection status
    const connStatus = document.getElementById('cloud-connection-status');
    if (!cloud.hasApiKey) {
      connStatus.textContent = 'Configure API key first';
    } else if (cloud.connected) {
      connStatus.textContent = '✓ Connected to OpenAI';
      connStatus.style.color = 'var(--success)';
    } else {
      connStatus.textContent = '✗ Not connected';
      connStatus.style.color = 'var(--danger)';
    }
  } catch (e) {}
}

function showCloudApiDialog() {
  window.magicAPI.getCloudStatus().then(cloud => {
    const maskedKey = cloud.hasApiKey ? '••••••••' + '(key saved)' : '';
    openModal('OpenAI API Key', `
      <label>API Key</label>
      <input type="text" id="cloud-api-key-input" placeholder="sk-..." value="${maskedKey}">
      <p style="font-size:12px;color:var(--text-secondary);margin-top:6px;line-height:1.5;">
        Get your API key from <a href="#" style="color:var(--text-link)">platform.openai.com/api-keys</a>.
        Your key is stored locally and never shared.
      </p>
      <div id="api-key-verify-result" style="margin-top:8px;font-size:13px;"></div>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="verifyCloudApiKey()" id="verify-key-btn">Verify Key</button>
        <button class="btn-primary" onclick="saveCloudApiKey()">Save</button>
      </div>
    `);
  });
}

async function verifyCloudApiKey() {
  const key = document.getElementById('cloud-api-key-input').value.trim();
  if (!key || key.startsWith('••')) {
    showToast('Enter a new API key to verify');
    return;
  }
  const btn = document.getElementById('verify-key-btn');
  const result = document.getElementById('api-key-verify-result');
  btn.textContent = 'Verifying...';
  btn.disabled = true;

  try {
    const check = await window.magicAPI.verifyApiKey(key);
    if (check.valid) {
      result.innerHTML = '<span style="color:var(--success)">✓ API key is valid!</span>';
    } else {
      result.innerHTML = `<span style="color:var(--danger)">✗ ${check.error}</span>`;
    }
  } catch (e) {
    result.innerHTML = `<span style="color:var(--danger)">✗ Verification failed</span>`;
  }
  btn.textContent = 'Verify Key';
  btn.disabled = false;
}

async function saveCloudApiKey() {
  const key = document.getElementById('cloud-api-key-input').value.trim();
  // Only update if user entered a new key (not masked placeholder)
  if (key && !key.startsWith('••')) {
    await window.magicAPI.saveCloudConfig({ apiKey: key });
    showToast('API key saved');
  }
  closeModal();
  loadCloudStatus();
}

async function toggleCloudSetting(setting, value) {
  const config = {};
  if (setting === 'enabled') config.enabled = value;
  if (setting === 'priority') config.priority = value;
  await window.magicAPI.saveCloudConfig(config);
  loadCloudStatus();
  showToast(setting === 'enabled'
    ? (value ? 'Cloud transcription enabled' : 'Cloud transcription disabled')
    : (value ? 'Cloud priority enabled — API will be tried first' : 'Cloud priority disabled — using local model'));
}

async function checkCloudConnection() {
  const connEl = document.getElementById('cloud-connection-status');
  connEl.textContent = 'Testing...';
  connEl.style.color = '';

  try {
    const connected = await window.magicAPI.checkCloudConnectivity();
    if (connected) {
      connEl.textContent = '✓ Connected to OpenAI';
      connEl.style.color = 'var(--success)';
      showToast('Connection successful');
    } else {
      connEl.textContent = '✗ Cannot reach OpenAI';
      connEl.style.color = 'var(--danger)';
      showToast('No connectivity — local model will be used');
    }
  } catch (e) {
    connEl.textContent = '✗ Connection test failed';
    connEl.style.color = 'var(--danger)';
  }
}

async function checkPermissions() {
  const status = await window.magicAPI.getPermissionStatus();
  const micLabel = status.microphone === 'granted' ? '✓ Mic granted' :
                   status.microphone === 'denied' ? '✗ Mic denied' : '? Mic pending';
  const accLabel = status.accessibility ? '✓ Accessibility granted' : '✗ Accessibility needed';
  document.getElementById('perm-status').textContent = `${micLabel} · ${accLabel}`;
  showToast('Permissions checked');
}

async function exportLogs() {
  try {
    const logs = await window.magicAPI.exportLogs();
    const blob = new Blob([logs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `magicwhisper-logs-${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Logs exported');
  } catch (e) {
    showToast('Failed to export logs');
  }
}

async function clearAllData() {
  if (!confirm('Clear all history, dictionary, and snippets? This cannot be undone.')) return;
  await window.magicAPI.clearHistory();
  showToast('All data cleared');
  loadHomeStats();
  loadHomeHistory();
}

// ── Cloud Model Selector ────────────────────────────────

const MODEL_COSTS = {
  'gpt-4o-transcribe':      0.006,  // $/min
  'gpt-4o-mini-transcribe': 0.003,
  'whisper-1':              0.006
};

async function setCloudModel(model) {
  currentSettings.cloudModel = model;
  saveSetting('cloudModel', model);
  await window.magicAPI.saveCloudConfig({ model });
  updateCostEstimate();
  const name = model === 'gpt-4o-transcribe' ? 'GPT-4o Transcribe (Best)' :
               model === 'gpt-4o-mini-transcribe' ? 'GPT-4o Mini (Budget)' : 'Whisper-1 (Legacy)';
  showToast(`Model set to ${name}`);
}

function updateCostEstimate() {
  const slider = document.getElementById('cost-daily-minutes');
  if (!slider) return;
  const minutes = parseInt(slider.value, 10);
  const model = currentSettings.cloudModel || 'gpt-4o-transcribe';
  const rate = MODEL_COSTS[model] || 0.006;

  const perDay = minutes * rate;
  const perMonth = perDay * 30;
  const perYear = perDay * 365;

  document.getElementById('cost-daily-value').textContent = `${minutes} min`;
  document.getElementById('cost-per-day').textContent = `$${perDay.toFixed(2)}`;
  document.getElementById('cost-per-month').textContent = `$${perMonth.toFixed(2)}`;
  document.getElementById('cost-per-year').textContent = `$${perYear.toFixed(2)}`;

  // Save daily minutes preference
  currentSettings.cloudDailyMinutes = minutes;
  saveSetting('cloudDailyMinutes', minutes);
}

function initModelSelector() {
  const model = currentSettings.cloudModel || 'gpt-4o-transcribe';
  const radios = document.querySelectorAll('input[name="cloud-model"]');
  radios.forEach(r => { r.checked = r.value === model; });

  const slider = document.getElementById('cost-daily-minutes');
  if (slider) {
    slider.value = currentSettings.cloudDailyMinutes || 30;
  }
  updateCostEstimate();
}

// ── Overlay Appearance Settings ─────────────────────────

async function setOverlaySetting(key, value) {
  currentSettings[key] = value;
  saveSetting(key, value);

  // Update hex display for color pickers
  if (key === 'waveformColor') {
    const hex = document.getElementById('waveform-color-hex');
    if (hex) hex.textContent = value;
  }
  if (key === 'trayIconColor') {
    const hex = document.getElementById('tray-color-hex');
    if (hex) hex.textContent = value;
  }

  // Send to main process to update overlay/tray in real-time
  if (window.magicAPI.updateOverlayAppearance) {
    window.magicAPI.updateOverlayAppearance({ [key]: value });
  }

  const labels = {
    overlayIdleIcon: 'Idle icon',
    waveformColor: 'Waveform color',
    waveformBars: 'Waveform bars',
    trayIconColor: 'Tray icon color'
  };
  showToast(`${labels[key] || key} updated`);
}

function initOverlayAppearance() {
  const iconSelect = document.getElementById('overlay-idle-icon');
  if (iconSelect) iconSelect.value = currentSettings.overlayIdleIcon || 'wave';

  const wfColor = document.getElementById('waveform-color-picker');
  const wfHex = document.getElementById('waveform-color-hex');
  if (wfColor) wfColor.value = currentSettings.waveformColor || '#ffffff';
  if (wfHex) wfHex.textContent = currentSettings.waveformColor || '#ffffff';

  const trayColor = document.getElementById('tray-color-picker');
  const trayHex = document.getElementById('tray-color-hex');
  if (trayColor) trayColor.value = currentSettings.trayIconColor || '#ffffff';
  if (trayHex) trayHex.textContent = currentSettings.trayIconColor || '#ffffff';
}

// ── Setup ───────────────────────────────────────────────

async function startSetup() {
  const btn = document.getElementById('setup-btn');
  btn.disabled = true;
  btn.textContent = 'Setting up...';

  try {
    document.getElementById('step-binary-status').textContent = 'In progress...';
    document.getElementById('step-binary-status').style.color = 'var(--warning)';
    document.getElementById('step-binary-progress').classList.remove('hidden');

    await window.magicAPI.setupWhisper();

    document.getElementById('step-binary-status').textContent = 'Done';
    document.getElementById('step-binary-status').style.color = 'var(--success)';

    document.getElementById('step-model-status').textContent = 'Downloading...';
    document.getElementById('step-model-status').style.color = 'var(--warning)';
    document.getElementById('step-model-progress').classList.remove('hidden');

    window.magicAPI.onDownloadProgress(({ model, progress }) => {
      document.getElementById('model-progress-fill').style.width = `${progress}%`;
      document.getElementById('model-progress-text').textContent = `Downloading... ${progress}%`;
    });

    await window.magicAPI.downloadModel(currentSettings.model || 'ggml-large-v3-turbo.bin');

    document.getElementById('step-model-status').textContent = 'Done';
    document.getElementById('step-model-status').style.color = 'var(--success)';

    btn.textContent = 'Done!';
    document.getElementById('setup-status-text').textContent = 'Setup complete!';

    setTimeout(() => {
      document.getElementById('setup-overlay').classList.add('hidden');
    }, 1000);
  } catch (err) {
    document.getElementById('setup-status-text').textContent = `Setup failed: ${err.message}`;
    btn.textContent = 'Retry Setup';
    btn.disabled = false;
  }
}

// ── Audio Recording ─────────────────────────────────────

async function getMicStream() {
  if (persistentMicStream) {
    const tracks = persistentMicStream.getTracks();
    if (tracks.length > 0 && tracks[0].readyState === 'live') {
      return persistentMicStream;
    }
  }
  const selectedMic = currentSettings.microphone && currentSettings.microphone !== 'default'
    ? { exact: currentSettings.microphone }
    : undefined;

  persistentMicStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(selectedMic ? { deviceId: selectedMic } : {}),
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  return persistentMicStream;
}

async function startMicCapture() {
  try {
    if (isMicCapturing) {
      await releaseMicResources();
    }

    isMicCapturing = true;
    const stream = await getMicStream();
    audioStream = stream.clone();

    const audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(audioStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silentSink = audioContext.createGain();
    const pcmChunks = [];

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      pcmChunks.push(new Float32Array(input));

      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      if (window.magicAPI.sendAudioLevel) {
        window.magicAPI.sendAudioLevel(Math.min(1, rms * 12));
      }
    };

    silentSink.gain.value = 0;
    source.connect(processor);
    processor.connect(silentSink);
    silentSink.connect(audioContext.destination);

    window._audioContext = audioContext;
    window._audioProcessor = processor;
    window._audioSource = source;
    window._audioSink = silentSink;
    window._pcmChunks = pcmChunks;

    clearTimeout(micSafetyTimer);
    micSafetyTimer = setTimeout(() => {
      stopMicCapture(Date.now() - (recordStartTime || Date.now()));
    }, MAX_RENDERER_RECORDING_MS);
  } catch (err) {
    console.error('Mic capture failed:', err);
    await releaseMicResources();
    if (window.magicAPI.recordingCancelled) {
      window.magicAPI.recordingCancelled(`microphone-start-failed: ${err.message}`);
    }
  }
}

async function stopMicCapture(duration) {
  try {
    const pcmChunks = window._pcmChunks || [];
    await releaseMicResources();

    // 🔴 CRITICAL: Release the persistent mic stream so macOS
    if (pcmChunks.length === 0) {
      if (window.magicAPI.recordingCancelled) {
        window.magicAPI.recordingCancelled('empty-audio-buffer');
      }
      return;
    }

    const totalLength = pcmChunks.reduce((acc, c) => acc + c.length, 0);
    const pcmData = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of pcmChunks) { pcmData.set(chunk, offset); offset += chunk.length; }

    const wavBuffer = encodeWAV(pcmData, 16000);
    const recordDuration = duration || (Date.now() - (recordStartTime || Date.now()));
    window.magicAPI.sendAudioData(wavBuffer, recordDuration);

    window._pcmChunks = [];
  } catch (err) {
    console.error('Stop mic failed:', err);
    await releaseMicResources();
    if (window.magicAPI.recordingCancelled) {
      window.magicAPI.recordingCancelled(`microphone-stop-failed: ${err.message}`);
    }
  }
}

async function releaseMicResources() {
  clearTimeout(micSafetyTimer);
  micSafetyTimer = null;
  isMicCapturing = false;

  try { if (window._audioProcessor) window._audioProcessor.disconnect(); } catch (e) {}
  try { if (window._audioSource) window._audioSource.disconnect(); } catch (e) {}
  try { if (window._audioSink) window._audioSink.disconnect(); } catch (e) {}
  try {
    if (window._audioContext && window._audioContext.state !== 'closed') {
      await window._audioContext.close();
    }
  } catch (e) {}

  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
  }

  if (persistentMicStream) {
    persistentMicStream.getTracks().forEach(track => track.stop());
    persistentMicStream = null;
  }

  window._audioContext = null;
  window._audioProcessor = null;
  window._audioSource = null;
  window._audioSink = null;
  window._pcmChunks = [];
}

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

// ── Scratchpad ──────────────────────────────────────────

function setupScratchpad() {
  const textarea = document.getElementById('scratchpad-textarea');
  const saved = localStorage.getItem('magicwhisper-scratchpad');
  if (saved) textarea.value = saved;

  textarea.addEventListener('input', () => {
    localStorage.setItem('magicwhisper-scratchpad', textarea.value);
  });
}

// ── Challenges & Daily Progress ─────────────────────────

async function loadChallengeProgress() {
  try {
    const progress = await window.magicAPI.getTodayProgress();
    document.getElementById('challenge-goal-text').textContent =
      `${progress.words} / ${progress.goal} words`;
    document.getElementById('challenge-progress-fill').style.width =
      `${Math.min(100, progress.progress)}%`;
    document.getElementById('challenge-sessions').textContent =
      `${progress.sessions} session${progress.sessions !== 1 ? 's' : ''} today`;
  } catch (e) {}
}

async function loadWeeklyChart() {
  try {
    const weekly = await window.magicAPI.getWeeklySummary();
    const container = document.getElementById('weekly-chart');
    if (!weekly || weekly.length === 0) return;

    const maxWords = Math.max(...weekly.map(d => d.words), 1);
    const today = new Date().toISOString().slice(0, 10);

    container.innerHTML = weekly.map(day => {
      const heightPct = Math.max(4, (day.words / maxWords) * 60);
      const barClass = day.metGoal ? 'met' : (day.words > 0 ? 'partial' : '');
      const isToday = day.date === today;
      return `
        <div class="weekly-bar-wrap">
          <div class="weekly-bar ${barClass}" style="height:${heightPct}px" title="${day.words} words"></div>
          <span class="weekly-day ${isToday ? 'today' : ''}">${day.dayName}</span>
        </div>`;
    }).join('');

    container.classList.add('visible');
  } catch (e) {}
}

function showDailyGoalDialog() {
  openModal('Set Daily Goal', `
    <label>Words per day</label>
    <input type="text" id="daily-goal-input" placeholder="e.g. 100" value="${currentSettings.dailyGoal || 100}">
    <p style="font-size:12px;color:var(--text-secondary);margin-top:8px;">How many words do you want to dictate each day?</p>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="setDailyGoal()">Save</button>
    </div>
  `);
}

async function setDailyGoal() {
  const val = parseInt(document.getElementById('daily-goal-input').value, 10);
  if (isNaN(val) || val < 10) {
    showToast('Goal must be at least 10 words');
    return;
  }
  await window.magicAPI.setDailyGoal(val);
  currentSettings.dailyGoal = val;
  closeModal();
  loadChallengeProgress();
  showToast(`Daily goal set to ${val} words`);
}

let achievementTimeout = null;
function showAchievementBanner(data) {
  const banner = document.getElementById('achievement-banner');
  const icons = { milestone: '🏆', daily_goal: '🎉', streak: '🔥' };
  document.getElementById('achievement-icon').textContent = icons[data.type] || '🎉';
  document.getElementById('achievement-title').textContent = data.title;
  document.getElementById('achievement-msg').textContent = data.message;

  banner.classList.remove('hidden');
  requestAnimationFrame(() => banner.classList.add('show'));

  clearTimeout(achievementTimeout);
  achievementTimeout = setTimeout(() => {
    banner.classList.remove('show');
    setTimeout(() => banner.classList.add('hidden'), 500);
  }, 5000);
}

// ── Styles / Tone Profiles ──────────────────────────────

async function loadStyles() {
  try {
    const presets = await window.magicAPI.getStylePresets();
    const defaultStyle = await window.magicAPI.getDefaultStyle();
    const appStyles = await window.magicAPI.getAppStyles();

    // Render preset grid
    const grid = document.getElementById('style-presets');
    grid.innerHTML = presets.map(preset => `
      <div class="style-card ${preset.id === defaultStyle ? 'selected' : ''}"
           onclick="selectDefaultStyle('${preset.id}')">
        <div class="style-card-icon">${preset.icon}</div>
        <div class="style-card-name">${escapeHtml(preset.name)}</div>
        <div class="style-card-desc">${escapeHtml(preset.description)}</div>
      </div>
    `).join('');

    // Render per-app list
    const list = document.getElementById('app-styles-list');
    const entries = Object.entries(appStyles);
    if (entries.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No per-app styles set. All apps use your default style.</p></div>';
    } else {
      list.innerHTML = entries.map(([appName, styleId]) => {
        const preset = presets.find(p => p.id === styleId);
        return `
          <div class="card-item">
            <div class="card-item-content">
              <div class="card-item-title">${escapeHtml(appName)}</div>
              <div class="card-item-desc">${preset ? preset.icon + ' ' + preset.name : styleId}</div>
            </div>
            <div class="card-item-actions" style="opacity:1">
              <button class="act-btn danger" title="Remove" onclick="removeAppStyleOverride('${escapeHtml(appName)}')">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
              </button>
            </div>
          </div>`;
      }).join('');
    }
  } catch (e) {
    console.error('Failed to load styles:', e);
  }
}

async function selectDefaultStyle(styleId) {
  await window.magicAPI.setDefaultStyle(styleId);
  loadStyles();
  showToast('Default style updated');
}

function showAddAppStyleDialog() {
  // Build style options from presets
  window.magicAPI.getStylePresets().then(presets => {
    const options = presets.map(p =>
      `<option value="${p.id}">${p.icon} ${p.name}</option>`
    ).join('');

    openModal('Add App Style Override', `
      <label>Application Name</label>
      <input type="text" id="app-style-name" placeholder="e.g. Slack, Mail, Chrome">
      <label>Writing Style</label>
      <select id="app-style-select">${options}</select>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="addAppStyleOverride()">Add</button>
      </div>
    `);
  });
}

async function addAppStyleOverride() {
  const appName = document.getElementById('app-style-name').value.trim();
  const styleId = document.getElementById('app-style-select').value;
  if (!appName) return;
  await window.magicAPI.setAppStyle(appName, styleId);
  closeModal();
  loadStyles();
  showToast(`Style for "${appName}" set`);
}

async function removeAppStyleOverride(appName) {
  await window.magicAPI.removeAppStyle(appName);
  loadStyles();
  showToast(`Style override for "${appName}" removed`);
}

// ── Modal ───────────────────────────────────────────────

function openModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ── Utilities ───────────────────────────────────────────

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

let toastTimeout = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500);
}
