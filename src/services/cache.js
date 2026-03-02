/**
 * Translation cache using chrome.storage.local.
 * Reduces redundant API calls for previously translated text.
 */

const CACHE_PREFIX = 'tc_';
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_MAX_ENTRIES = 1000;

/**
 * Generate a cache key from text and target language.
 */
function cacheKey(text, targetLang) {
  // Use a simple hash for the key
  let hash = 0;
  const str = `${targetLang}:${text}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit int
  }
  return CACHE_PREFIX + Math.abs(hash).toString(36);
}

/**
 * Get a cached translation.
 * @param {string} text - Original text
 * @param {string} targetLang - Target language code
 * @returns {Promise<string|null>} Cached translation or null
 */
export async function getFromCache(text, targetLang) {
  const key = cacheKey(text, targetLang);
  const result = await chrome.storage.local.get(key);
  const entry = result[key];

  if (!entry) return null;

  // Check if expired
  if (Date.now() - entry.timestamp > CACHE_MAX_AGE) {
    await chrome.storage.local.remove(key);
    return null;
  }

  // Verify original text matches (hash collision protection)
  if (entry.original !== text || entry.targetLang !== targetLang) {
    return null;
  }

  return entry.translated;
}

/**
 * Save a translation to cache.
 * @param {string} text - Original text
 * @param {string} targetLang - Target language
 * @param {string} translated - Translated text
 */
export async function saveToCache(text, targetLang, translated) {
  const key = cacheKey(text, targetLang);
  await chrome.storage.local.set({
    [key]: {
      original: text,
      targetLang,
      translated,
      timestamp: Date.now(),
    }
  });
}

/**
 * Clear expired cache entries.
 */
export async function cleanCache() {
  const all = await chrome.storage.local.get(null);
  const keysToRemove = [];
  const cacheEntries = [];

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(CACHE_PREFIX)) continue;
    if (Date.now() - value.timestamp > CACHE_MAX_AGE) {
      keysToRemove.push(key);
    } else {
      cacheEntries.push({ key, timestamp: value.timestamp });
    }
  }

  // Also remove oldest entries if over limit
  if (cacheEntries.length > CACHE_MAX_ENTRIES) {
    cacheEntries.sort((a, b) => a.timestamp - b.timestamp);
    const excess = cacheEntries.slice(0, cacheEntries.length - CACHE_MAX_ENTRIES);
    keysToRemove.push(...excess.map(e => e.key));
  }

  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
}

/**
 * Clear all cached translations.
 */
export async function clearAllCache() {
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter(k => k.startsWith(CACHE_PREFIX));
  if (cacheKeys.length > 0) {
    await chrome.storage.local.remove(cacheKeys);
  }
}
