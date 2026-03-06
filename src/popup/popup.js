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
    if (els.fontSize) {
      els.fontSize.value = settings.translationFontSize || 90;
      if (els.fontSizeValue) els.fontSizeValue.textContent = `${els.fontSize.value}%`;
    }

    const translationOnlyToggle = document.getElementById('translationOnly');
    if (translationOnlyToggle) translationOnlyToggle.checked = settings.translationOnly === true;

    const colorToggle = document.getElementById('colorTranslation');
    if (colorToggle) colorToggle.checked = settings.colorTranslation !== false;

    const animToggle = document.getElementById('smoothAnimations');
    if (animToggle) animToggle.checked = settings.smoothAnimations !== false;

    // Load API key (masked) — skip for free providers
    if (!FREE_PROVIDERS.has(provider)) {
      const { hasKey } = await chrome.runtime.sendMessage({
        action: 'hasApiKey',
        provider,
      });

      if (hasKey && els.apiKey) {
        els.apiKey.placeholder = 'Key saved (enter new to replace)';
      }
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
    translationFontSize: parseInt(els.fontSize?.value || '90', 10),
    translationOnly: document.getElementById('translationOnly')?.checked ?? false,
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
    showButtonFeedback(els.saveSettings, 'Saved!', 'success');

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
    showButtonFeedback(els.saveSettings, 'Failed', 'error');
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

/**
 * Show temporary feedback on a button, then restore original text.
 */
function showButtonFeedback(btn, text, type) {
  if (!btn) return;
  const original = btn.innerHTML;
  btn.textContent = text;
  btn.classList.add(`btn-${type}`);
  btn.disabled = true;
  setTimeout(() => {
    btn.innerHTML = original;
    btn.classList.remove(`btn-${type}`);
    btn.disabled = false;
  }, 1500);
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
// Providers that don't require an API key
const FREE_PROVIDERS = new Set(['google-translate']);

const PROVIDER_MODELS = {
  'google-translate': [],
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
  const isFree = FREE_PROVIDERS.has(provider);
  const apiKeyGroup = document.getElementById('apiKeyGroup');
  const modelGroup = document.getElementById('modelGroup');
  const verifyKey = document.getElementById('verifyKey');

  // Hide API key, model, and verify button for free providers
  if (apiKeyGroup) apiKeyGroup.style.display = isFree ? 'none' : '';
  if (modelGroup) modelGroup.style.display = isFree ? 'none' : '';
  if (verifyKey) verifyKey.style.display = isFree ? 'none' : '';

  if (!els.model) return;
  const models = PROVIDER_MODELS[provider];
  if (!models || models.length === 0) {
    els.model.innerHTML = '';
    return;
  }
  els.model.innerHTML = models.map(m =>
    `<option value="${m.value}">${m.label}</option>`
  ).join('');
}

els.provider?.addEventListener('change', async () => {
  const provider = els.provider.value;
  updateModelOptions(provider);

  // Free providers don't need API key management
  if (FREE_PROVIDERS.has(provider)) return;

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

// ========================================
// Site Rule Quick Toggle
// ========================================

const siteRuleIcon = document.getElementById('siteRuleIcon');
const siteRuleLabel = document.getElementById('siteRuleLabel');
const siteAutoTranslate = document.getElementById('siteAutoTranslate');
const siteNeverTranslate = document.getElementById('siteNeverTranslate');

async function loadSiteRuleStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    const hostname = new URL(tab.url).hostname;
    if (!hostname) return;

    const { rule } = await chrome.runtime.sendMessage({
      action: 'checkSiteRule',
      hostname,
    });

    if (rule === 'whitelist') {
      if (siteRuleIcon) siteRuleIcon.style.color = '#4A8B6C';
      if (siteRuleLabel) siteRuleLabel.textContent = 'Auto-translate this site';
      siteAutoTranslate?.classList.add('active');
      siteNeverTranslate?.classList.remove('active');
    } else if (rule === 'blacklist') {
      if (siteRuleIcon) siteRuleIcon.style.color = '#C4534A';
      if (siteRuleLabel) siteRuleLabel.textContent = 'Never translate this site';
      siteAutoTranslate?.classList.remove('active');
      siteNeverTranslate?.classList.add('active');
    } else {
      if (siteRuleIcon) siteRuleIcon.style.color = '#999';
      if (siteRuleLabel) siteRuleLabel.textContent = 'No rule for this site';
      siteAutoTranslate?.classList.remove('active');
      siteNeverTranslate?.classList.remove('active');
    }
  } catch { /* ignore for non-http pages */ }
}

siteAutoTranslate?.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const hostname = new URL(tab.url).hostname;
    const { rule } = await chrome.runtime.sendMessage({ action: 'checkSiteRule', hostname });
    if (rule === 'whitelist') {
      await chrome.runtime.sendMessage({ action: 'removeSiteRule', list: 'whitelist', pattern: hostname });
    } else {
      await chrome.runtime.sendMessage({ action: 'addSiteRule', list: 'whitelist', pattern: hostname });
    }
    loadSiteRuleStatus();
  } catch { /* ignore */ }
});

siteNeverTranslate?.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const hostname = new URL(tab.url).hostname;
    const { rule } = await chrome.runtime.sendMessage({ action: 'checkSiteRule', hostname });
    if (rule === 'blacklist') {
      await chrome.runtime.sendMessage({ action: 'removeSiteRule', list: 'blacklist', pattern: hostname });
    } else {
      await chrome.runtime.sendMessage({ action: 'addSiteRule', list: 'blacklist', pattern: hostname });
    }
    loadSiteRuleStatus();
  } catch { /* ignore */ }
});

// Initialize
loadSettings();
loadSiteRuleStatus();
