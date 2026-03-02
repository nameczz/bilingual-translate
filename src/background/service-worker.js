/**
 * Background service worker for the Bilingual Translate extension.
 * Handles translation requests from content scripts and manages extension lifecycle.
 */
import { ClaudeProvider } from '../services/claude-provider.js';
import { KimiProvider } from '../services/kimi-provider.js';
import { OpenAIProvider } from '../services/openai-provider.js';
import { GeminiProvider } from '../services/gemini-provider.js';
import { DeepSeekProvider } from '../services/deepseek-provider.js';
import { QwenProvider } from '../services/qwen-provider.js';
import { DoubaoProvider } from '../services/doubao-provider.js';
import { registerProvider, getProvider } from '../services/provider.js';
import { translateText, translateBatch } from '../services/translator.js';
import { cleanCache, clearAllCache } from '../services/cache.js';
import { getSettings, saveSettings, saveApiKey, getApiKey, hasApiKey, removeApiKey } from '../utils/storage.js';

// Register providers
registerProvider('claude', new ClaudeProvider());
registerProvider('kimi', new KimiProvider());
registerProvider('openai', new OpenAIProvider());
registerProvider('gemini', new GeminiProvider());
registerProvider('deepseek', new DeepSeekProvider());
registerProvider('qwen', new QwenProvider());
registerProvider('doubao', new DoubaoProvider());

// Context menu setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translate-page',
    title: 'Translate this page',
    contexts: ['page'],
  });

  chrome.contextMenus.create({
    id: 'translate-selection',
    title: 'Translate selection',
    contexts: ['selection'],
  });

  // Clean cache on install/update
  cleanCache();
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'translate-page') {
    chrome.tabs.sendMessage(tab.id, { action: 'translatePage' });
  } else if (info.menuItemId === 'translate-selection') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'translateSelection',
      text: info.selectionText,
    });
  }
});

// Message handler for content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true; // Keep message channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.action) {
    case 'translate': {
      const result = await translateText(
        message.text,
        message.targetLang,
        message.sourceLang
      );
      return result;
    }

    case 'translateBatch': {
      const results = await translateBatch(
        message.texts,
        message.targetLang,
        message.sourceLang
      );
      return { results };
    }

    case 'getSettings': {
      return await getSettings();
    }

    case 'saveSettings': {
      await saveSettings(message.settings);
      return { success: true };
    }

    case 'saveApiKey': {
      await saveApiKey(message.provider, message.apiKey);
      return { success: true };
    }

    case 'getApiKey': {
      const key = await getApiKey(message.provider);
      return { apiKey: key };
    }

    case 'hasApiKey': {
      const has = await hasApiKey(message.provider);
      return { hasKey: has };
    }

    case 'removeApiKey': {
      await removeApiKey(message.provider);
      return { success: true };
    }

    case 'clearCache': {
      await clearAllCache();
      return { success: true };
    }

    case 'validateApiKey': {
      const providerId = message.provider || 'claude';
      const provider = getProvider(providerId);
      if (!provider) {
        return { valid: false, error: `Unknown provider: ${providerId}` };
      }
      const result = await provider.validateKey(message.apiKey);
      return result;
    }

    default:
      throw new Error(`Unknown action: ${message.action}`);
  }
}

// Periodic cache cleanup (every 24 hours)
chrome.alarms.create('cleanCache', { periodInMinutes: 24 * 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanCache') {
    cleanCache();
  }
});
