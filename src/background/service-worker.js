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
import { GoogleTranslateProvider } from '../services/google-translate-provider.js';
import { registerProvider, getProvider } from '../services/provider.js';
import { translateText, translateBatch, translateTextStream } from '../services/translator.js';
import { cleanCache, clearAllCache } from '../services/cache.js';
import { getSettings, saveSettings, saveApiKey, getApiKey, hasApiKey, removeApiKey, getSiteRules, addSiteRule, removeSiteRule, checkSiteRule } from '../utils/storage.js';

// Register providers
registerProvider('claude', new ClaudeProvider());
registerProvider('kimi', new KimiProvider());
registerProvider('openai', new OpenAIProvider());
registerProvider('gemini', new GeminiProvider());
registerProvider('deepseek', new DeepSeekProvider());
registerProvider('qwen', new QwenProvider());
registerProvider('doubao', new DoubaoProvider());
registerProvider('google-translate', new GoogleTranslateProvider());

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

    case 'getSiteRules': {
      return await getSiteRules();
    }

    case 'addSiteRule': {
      return await addSiteRule(message.list, message.pattern);
    }

    case 'removeSiteRule': {
      return await removeSiteRule(message.list, message.pattern);
    }

    case 'checkSiteRule': {
      const rule = await checkSiteRule(message.hostname);
      return { rule };
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

// Keyboard shortcut handler
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  switch (command) {
    case 'translate-page':
      chrome.tabs.sendMessage(tab.id, { action: 'translatePage' });
      break;
    case 'toggle-translations':
      chrome.tabs.sendMessage(tab.id, { action: 'toggleTranslations' });
      break;
    case 'translate-selection': {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getSelection' });
        if (response?.text) {
          chrome.tabs.sendMessage(tab.id, { action: 'translateSelection', text: response.text });
        }
      } catch { /* content script not loaded */ }
      break;
    }
  }
});

// Streaming translation via port-based messaging
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'translate-stream') return;

  port.onMessage.addListener(async (message) => {
    if (message.action !== 'translateStream') return;

    try {
      const { stream, provider } = await translateTextStream(
        message.text,
        message.targetLang,
        message.sourceLang
      );

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              port.postMessage({ type: 'chunk', text: parsed.delta.text });
            }
            if (parsed.choices?.[0]?.delta?.content) {
              port.postMessage({ type: 'chunk', text: parsed.choices[0].delta.content });
            }
            // Gemini streamGenerateContent SSE format
            if (parsed.candidates?.[0]?.content?.parts?.[0]?.text) {
              port.postMessage({ type: 'chunk', text: parsed.candidates[0].content.parts[0].text });
            }
          } catch { /* skip unparseable lines */ }
        }
      }

      port.postMessage({ type: 'done' });
    } catch (err) {
      port.postMessage({ type: 'error', error: err.message });
    }
  });
});
