/**
 * Popup script for Bilingual Translate.
 * Handles settings UI, API key management, and translation controls.
 */

// DOM elements
const els = {
  sourceLang: document.getElementById('sourceLang'),
  targetLang: document.getElementById('targetLang'),
  provider: document.getElementById('provider'),
  apiKey: document.getElementById('apiKey'),
  apiUrl: document.getElementById('apiUrl'),
  apiUrlGroup: document.getElementById('apiUrlGroup'),
  model: document.getElementById('model'),
  togglePower: document.getElementById('togglePower'),
  toggleKeyVisibility: document.getElementById('toggleKeyVisibility'),
  verifyKey: document.getElementById('verifyKey'),
  saveSettings: document.getElementById('saveSettings'),
  statusBar: document.getElementById('statusBar'),
  fontSize: document.getElementById('fontSize'),
  fontSizeValue: document.getElementById('fontSizeValue'),
};

// Tab navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

/**
 * Load and display current settings.
 */
async function loadSettings() {
  try {
    const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });

    if (els.sourceLang) els.sourceLang.value = settings.sourceLang || 'auto';
    if (els.targetLang) els.targetLang.value = settings.targetLang || 'zh-CN';

    // Set provider first, then update model dropdown, then set model value
    const provider = settings.provider || 'claude';
    if (els.provider) els.provider.value = provider;
    updateModelOptions(provider);
    if (els.model) els.model.value = settings.model || PROVIDER_MODELS[provider]?.[0]?.value || '';

    // Display settings
    const displayStyle = document.querySelector(`input[name="displayStyle"][value="${settings.displayStyle || 'underline'}"]`);
    if (displayStyle) displayStyle.checked = true;

    const trigger = document.querySelector(`input[name="trigger"][value="${settings.trigger || 'button'}"]`);
    if (trigger) trigger.checked = true;

    if (els.fontSize) {
      els.fontSize.value = settings.translationFontSize || 90;
      if (els.fontSizeValue) els.fontSizeValue.textContent = `${els.fontSize.value}%`;
    }

    const colorToggle = document.getElementById('colorTranslation');
    if (colorToggle) colorToggle.checked = settings.colorTranslation !== false;

    const animToggle = document.getElementById('smoothAnimations');
    if (animToggle) animToggle.checked = settings.smoothAnimations !== false;

    // Load API key (masked)
    const { hasKey } = await chrome.runtime.sendMessage({
      action: 'hasApiKey',
      provider: settings.provider || 'claude',
    });

    if (hasKey && els.apiKey) {
      els.apiKey.placeholder = 'Key saved (enter new to replace)';
    }

    updateStatus('Ready to translate', 'ready');
  } catch (err) {
    updateStatus('Error loading settings', 'error');
    console.error('[Bilingual Translate] Load settings error:', err);
  }
}

/**
 * Save current settings.
 */
async function saveAllSettings() {
  const settings = {
    sourceLang: els.sourceLang?.value || 'auto',
    targetLang: els.targetLang?.value || 'zh-CN',
    provider: els.provider?.value || 'claude',
    model: els.model?.value || 'claude-sonnet-4-5-20250929',
    displayStyle: document.querySelector('input[name="displayStyle"]:checked')?.value || 'underline',
    trigger: document.querySelector('input[name="trigger"]:checked')?.value || 'button',
    translationFontSize: parseInt(els.fontSize?.value || '90', 10),
    colorTranslation: document.getElementById('colorTranslation')?.checked ?? true,
    smoothAnimations: document.getElementById('smoothAnimations')?.checked ?? true,
  };

  // Save custom API URL if present
  if (els.apiUrl?.value) {
    settings.customApiUrl = els.apiUrl.value;
  }

  try {
    await chrome.runtime.sendMessage({ action: 'saveSettings', settings });

    // Save API key if entered
    const apiKeyValue = els.apiKey?.value?.trim();
    if (apiKeyValue) {
      await chrome.runtime.sendMessage({
        action: 'saveApiKey',
        provider: settings.provider,
        apiKey: apiKeyValue,
      });
      els.apiKey.value = '';
      els.apiKey.placeholder = 'Key saved (enter new to replace)';
    }

    updateStatus('Settings saved!', 'success');

    // Notify content script of settings change
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'settingsUpdated',
          settings,
        });
      } catch {
        // Content script not loaded on this page
      }
    }
  } catch (err) {
    updateStatus('Error saving settings', 'error');
    console.error('[Bilingual Translate] Save error:', err);
  }
}

/**
 * Toggle translation on/off for the current page.
 */
async function toggleTranslation() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    const status = await chrome.tabs.sendMessage(tab.id, {
      action: 'getTranslationStatus',
    });

    if (status.hasTranslations) {
      // Toggle visibility instead of removing
      const result = await chrome.tabs.sendMessage(tab.id, { action: 'toggleTranslations' });
      if (result.hidden) {
        updateStatus('Translations hidden', 'ready');
        els.togglePower?.classList.remove('active');
        els.togglePower?.classList.add('hidden');
      } else {
        updateStatus('Translations visible', 'success');
        els.togglePower?.classList.remove('hidden');
        els.togglePower?.classList.add('active');
      }
    } else {
      updateStatus('Translating page...', 'translating');
      els.togglePower?.classList.add('active');
      await chrome.tabs.sendMessage(tab.id, { action: 'translatePage' });
      updateStatus('Translation complete!', 'success');
    }
  } catch {
    updateStatus('Cannot translate this page', 'error');
  }
}

/**
 * Verify API key connection.
 */
async function verifyApiKey() {
  const provider = els.provider?.value || 'claude';
  let apiKey = els.apiKey?.value?.trim();

  // If no new key entered, try existing
  if (!apiKey) {
    const result = await chrome.runtime.sendMessage({
      action: 'getApiKey',
      provider,
    });
    apiKey = result.apiKey;
  }

  if (!apiKey) {
    updateStatus('Please enter an API key first', 'error');
    return;
  }

  updateStatus('Verifying API key...', 'translating');
  if (els.verifyKey) els.verifyKey.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'validateApiKey',
      provider,
      apiKey,
    });

    if (result.valid) {
      updateStatus('API key verified successfully!', 'success');
    } else {
      updateStatus(`Verification failed: ${result.error}`, 'error');
    }
  } catch (err) {
    updateStatus(`Verification error: ${err.message}`, 'error');
  } finally {
    if (els.verifyKey) els.verifyKey.disabled = false;
  }
}

/**
 * Toggle API key visibility.
 */
function toggleKeyVisibility() {
  if (!els.apiKey) return;
  els.apiKey.type = els.apiKey.type === 'password' ? 'text' : 'password';
}

/**
 * Update status bar display.
 */
function updateStatus(text, type) {
  if (!els.statusBar) return;
  const dot = els.statusBar.querySelector('.status-dot');
  const textEl = els.statusBar.querySelector('.status-text');
  if (textEl) textEl.textContent = text;
  if (dot) {
    dot.className = 'status-dot';
    if (type) dot.classList.add(`status-${type}`);
  }
}

// Event listeners
els.togglePower?.addEventListener('click', toggleTranslation);
els.toggleKeyVisibility?.addEventListener('click', toggleKeyVisibility);
els.verifyKey?.addEventListener('click', verifyApiKey);
els.saveSettings?.addEventListener('click', saveAllSettings);

els.fontSize?.addEventListener('input', () => {
  if (els.fontSizeValue) {
    els.fontSizeValue.textContent = `${els.fontSize.value}%`;
  }
});

// Update model options and API key placeholder based on provider
const PROVIDER_MODELS = {
  claude: [
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Fast)' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  ],
  kimi: [
    { value: 'moonshot-v1-8k', label: 'Moonshot v1 8K' },
    { value: 'moonshot-v1-32k', label: 'Moonshot v1 32K' },
    { value: 'moonshot-v1-128k', label: 'Moonshot v1 128K' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast)' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  gemini: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-pro', label: 'Gemini 2.0 Pro' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'DeepSeek Chat' },
    { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  ],
  qwen: [
    { value: 'qwen-max', label: 'Qwen Max' },
    { value: 'qwen-plus', label: 'Qwen Plus' },
    { value: 'qwen-turbo', label: 'Qwen Turbo (Fast)' },
  ],
  doubao: [
    { value: 'doubao-1.5-pro-32k', label: 'Doubao 1.5 Pro' },
    { value: 'doubao-1.5-lite-32k', label: 'Doubao 1.5 Lite (Fast)' },
    { value: 'doubao-pro-32k', label: 'Doubao Pro' },
  ],
};

function updateModelOptions(provider) {
  if (!els.model) return;
  const models = PROVIDER_MODELS[provider];
  if (!models) return;
  els.model.innerHTML = models.map(m =>
    `<option value="${m.value}">${m.label}</option>`
  ).join('');
}

els.provider?.addEventListener('change', async () => {
  const provider = els.provider.value;
  updateModelOptions(provider);

  // Check if this provider has a saved key
  const { hasKey } = await chrome.runtime.sendMessage({
    action: 'hasApiKey',
    provider,
  });
  if (els.apiKey) {
    els.apiKey.value = '';
    els.apiKey.placeholder = hasKey ? 'Key saved (enter new to replace)' : 'Enter your API key';
  }
});

// Initialize
loadSettings();
