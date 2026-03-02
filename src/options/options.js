/**
 * Options page script for Bilingual Translate.
 */

const els = {
  provider: document.getElementById('provider'),
  apiKey: document.getElementById('apiKey'),
  model: document.getElementById('model'),
  toggleKey: document.getElementById('toggleKey'),
  verifyKey: document.getElementById('verifyKey'),
  verifyResult: document.getElementById('verifyResult'),
  sourceLang: document.getElementById('sourceLang'),
  targetLang: document.getElementById('targetLang'),
  clearCache: document.getElementById('clearCache'),
  cacheResult: document.getElementById('cacheResult'),
  saveBtn: document.getElementById('saveBtn'),
  saveStatus: document.getElementById('saveStatus'),
};

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

async function loadSettings() {
  const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const provider = settings.provider || 'claude';
  els.provider.value = provider;
  // Update model options for selected provider
  const models = PROVIDER_MODELS[provider];
  if (models) {
    els.model.innerHTML = models.map(m =>
      `<option value="${m.value}">${m.label}</option>`
    ).join('');
  }
  els.model.value = settings.model || models?.[0]?.value || '';
  els.sourceLang.value = settings.sourceLang || 'auto';
  els.targetLang.value = settings.targetLang || 'zh-CN';

  const { hasKey } = await chrome.runtime.sendMessage({
    action: 'hasApiKey',
    provider: settings.provider || 'claude',
  });
  if (hasKey) {
    els.apiKey.placeholder = 'Key saved (enter new to replace)';
  }
}

els.toggleKey.addEventListener('click', () => {
  const isPassword = els.apiKey.type === 'password';
  els.apiKey.type = isPassword ? 'text' : 'password';
  els.toggleKey.textContent = isPassword ? 'Hide' : 'Show';
});

els.verifyKey.addEventListener('click', async () => {
  let apiKey = els.apiKey.value.trim();
  if (!apiKey) {
    const result = await chrome.runtime.sendMessage({
      action: 'getApiKey',
      provider: els.provider.value,
    });
    apiKey = result.apiKey;
  }
  if (!apiKey) {
    showResult(els.verifyResult, 'Please enter an API key first.', 'error');
    return;
  }

  els.verifyKey.disabled = true;
  els.verifyKey.textContent = 'Verifying...';

  const result = await chrome.runtime.sendMessage({
    action: 'validateApiKey',
    provider: els.provider.value,
    apiKey,
  });

  if (result.valid) {
    showResult(els.verifyResult, 'API key is valid!', 'success');
  } else {
    showResult(els.verifyResult, `Invalid: ${result.error}`, 'error');
  }

  els.verifyKey.disabled = false;
  els.verifyKey.textContent = 'Verify API Key';
});

els.clearCache.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'clearCache' });
  showResult(els.cacheResult, 'Cache cleared.', 'success');
});

els.saveBtn.addEventListener('click', async () => {
  const settings = {
    provider: els.provider.value,
    model: els.model.value,
    sourceLang: els.sourceLang.value,
    targetLang: els.targetLang.value,
  };

  await chrome.runtime.sendMessage({ action: 'saveSettings', settings });

  const apiKey = els.apiKey.value.trim();
  if (apiKey) {
    await chrome.runtime.sendMessage({
      action: 'saveApiKey',
      provider: settings.provider,
      apiKey,
    });
    els.apiKey.value = '';
    els.apiKey.placeholder = 'Key saved (enter new to replace)';
  }

  els.saveStatus.textContent = 'Settings saved!';
  els.saveStatus.className = 'save-status success';
  setTimeout(() => {
    els.saveStatus.textContent = '';
    els.saveStatus.className = 'save-status';
  }, 3000);
});

els.provider.addEventListener('change', async () => {
  const provider = els.provider.value;
  const models = PROVIDER_MODELS[provider];
  if (models) {
    els.model.innerHTML = models.map(m =>
      `<option value="${m.value}">${m.label}</option>`
    ).join('');
  }
  const { hasKey } = await chrome.runtime.sendMessage({
    action: 'hasApiKey',
    provider,
  });
  els.apiKey.value = '';
  els.apiKey.placeholder = hasKey ? 'Key saved (enter new to replace)' : 'Enter your API key';
});

function showResult(el, text, type) {
  el.textContent = text;
  el.className = `result result-${type}`;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

loadSettings();
