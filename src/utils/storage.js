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

// ========================================
// Site Rules (Whitelist / Blacklist)
// ========================================

const SITE_RULES_KEY = 'siteRules';
const DEFAULT_SITE_RULES = { whitelist: [], blacklist: [] };

/**
 * Get site rules (whitelist and blacklist).
 * @returns {Promise<{whitelist: string[], blacklist: string[]}>}
 */
export async function getSiteRules() {
  const result = await chrome.storage.local.get(SITE_RULES_KEY);
  return { ...DEFAULT_SITE_RULES, ...result[SITE_RULES_KEY] };
}

/**
 * Add a site rule. Removes from the other list if it exists there.
 * @param {'whitelist'|'blacklist'} list
 * @param {string} pattern - URL pattern like "*.github.com"
 */
export async function addSiteRule(list, pattern) {
  const rules = await getSiteRules();
  pattern = pattern.trim().toLowerCase();
  if (!pattern) return rules;

  const otherList = list === 'whitelist' ? 'blacklist' : 'whitelist';
  rules[otherList] = rules[otherList].filter(p => p !== pattern);

  if (!rules[list].includes(pattern)) {
    rules[list].push(pattern);
  }

  await chrome.storage.local.set({ [SITE_RULES_KEY]: rules });
  return rules;
}

/**
 * Remove a site rule.
 * @param {'whitelist'|'blacklist'} list
 * @param {string} pattern
 */
export async function removeSiteRule(list, pattern) {
  const rules = await getSiteRules();
  rules[list] = rules[list].filter(p => p !== pattern);
  await chrome.storage.local.set({ [SITE_RULES_KEY]: rules });
  return rules;
}

/**
 * Check if a hostname matches any site rule.
 * @param {string} hostname
 * @returns {Promise<'whitelist'|'blacklist'|null>}
 */
export async function checkSiteRule(hostname) {
  const rules = await getSiteRules();
  hostname = hostname.toLowerCase();

  for (const pattern of rules.whitelist) {
    if (matchPattern(pattern, hostname)) return 'whitelist';
  }
  for (const pattern of rules.blacklist) {
    if (matchPattern(pattern, hostname)) return 'blacklist';
  }
  return null;
}

/**
 * Match a glob-style pattern against a hostname.
 * Supports * wildcard. e.g. "*.github.com" matches "www.github.com"
 */
function matchPattern(pattern, hostname) {
  if (pattern === hostname) return true;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return hostname === suffix || hostname.endsWith('.' + suffix);
  }
  const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
  return regex.test(hostname);
}
