/**
 * Chrome storage wrapper with encryption support for sensitive data.
 */
import { encrypt, decrypt } from './crypto.js';

const SETTINGS_KEY = 'settings';
const API_KEY_PREFIX = 'apikey_';

const DEFAULT_SETTINGS = {
  provider: 'claude',
  model: 'claude-sonnet-4-5-20250929',
  targetLang: 'zh-CN',
  sourceLang: 'auto',
  trigger: 'button',
  displayStyle: 'underline',
  translationFontSize: 90,
  colorTranslation: true,
  smoothAnimations: true,
  autoTranslate: false,
  theme: 'auto', // 'auto' | 'light' | 'dark'
};

/**
 * Get extension settings, merged with defaults.
 * @returns {Promise<object>}
 */
export async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...result[SETTINGS_KEY] };
}

/**
 * Save extension settings (partial update).
 * @param {object} updates
 */
export async function saveSettings(updates) {
  const current = await getSettings();
  const merged = { ...current, ...updates };
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
}

/**
 * Save an API key (encrypted).
 * @param {string} provider - Provider name (e.g. 'claude')
 * @param {string} apiKey - The plaintext API key
 */
export async function saveApiKey(provider, apiKey) {
  const encrypted = await encrypt(apiKey);
  await chrome.storage.local.set({ [API_KEY_PREFIX + provider]: encrypted });
}

/**
 * Retrieve an API key (decrypted).
 * @param {string} provider
 * @returns {Promise<string|null>}
 */
export async function getApiKey(provider) {
  const result = await chrome.storage.local.get(API_KEY_PREFIX + provider);
  const encrypted = result[API_KEY_PREFIX + provider];
  if (!encrypted) return null;
  try {
    return await decrypt(encrypted);
  } catch {
    return null;
  }
}

/**
 * Remove a stored API key.
 * @param {string} provider
 */
export async function removeApiKey(provider) {
  await chrome.storage.local.remove(API_KEY_PREFIX + provider);
}

/**
 * Check if an API key is stored for a provider.
 * @param {string} provider
 * @returns {Promise<boolean>}
 */
export async function hasApiKey(provider) {
  const result = await chrome.storage.local.get(API_KEY_PREFIX + provider);
  return !!result[API_KEY_PREFIX + provider];
}
