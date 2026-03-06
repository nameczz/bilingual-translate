/**
 * Translation orchestrator - coordinates between providers, caching, and content.
 */
import { getProvider } from './provider.js';
import { getFromCache, saveToCache } from './cache.js';
import { getSettings, getApiKey } from '../utils/storage.js';

/**
 * Translate a single text using the configured provider.
 * @param {string} text
 * @param {string} [targetLang]
 * @param {string} [sourceLang]
 * @returns {Promise<{translatedText: string, fromCache: boolean}>}
 */
export async function translateText(text, targetLang, sourceLang) {
  const settings = await getSettings();
  targetLang = targetLang || settings.targetLang;
  sourceLang = sourceLang || settings.sourceLang;

  // Check cache first
  const cached = await getFromCache(text, targetLang);
  if (cached) {
    return { translatedText: cached, fromCache: true };
  }

  let provider = getProvider(settings.provider);
  if (!provider) {
    throw new Error(`Translation provider "${settings.provider}" not found.`);
  }

  // Free providers (e.g. Google Translate) don't need an API key
  const isFreeProvider = settings.provider === 'google-translate';
  if (!isFreeProvider) {
    const apiKey = await getApiKey(settings.provider);
    if (!apiKey) {
      provider = getProvider('google-translate');
      if (!provider) {
        throw new Error(`No API key configured. Please add your API key in the extension settings.`);
      }
    } else {
      provider.setApiKey(apiKey);
      if (settings.model) provider.setModel(settings.model);
    }
  }

  let result;
  try {
    result = await provider.translate({ text, sourceLang, targetLang });
  } catch (err) {
    // If AI provider fails (quota, rate limit, etc.), fallback to Google Translate
    const fallback = getProvider('google-translate');
    if (fallback && settings.provider !== 'google-translate') {
      console.warn(`[Bilingual Translate] ${settings.provider} failed: ${err.message}, falling back to Google Translate`);
      result = await fallback.translate({ text, sourceLang, targetLang });
    } else {
      throw err;
    }
  }

  // Cache the result
  await saveToCache(text, targetLang, result.translatedText);

  return { translatedText: result.translatedText, fromCache: false };
}

/**
 * Translate text with streaming support.
 * Returns the raw ReadableStream from the provider.
 * @param {string} text
 * @param {string} [targetLang]
 * @param {string} [sourceLang]
 * @returns {Promise<{stream: ReadableStream, provider: string}>}
 */
export async function translateTextStream(text, targetLang, sourceLang) {
  const settings = await getSettings();
  targetLang = targetLang || settings.targetLang;
  sourceLang = sourceLang || settings.sourceLang;

  let provider = getProvider(settings.provider);
  if (!provider) {
    throw new Error(`Translation provider "${settings.provider}" not found.`);
  }

  // Free providers don't support streaming — fallback to non-streaming path
  if (settings.provider === 'google-translate') {
    throw new Error('no-streaming-support');
  }

  const apiKey = await getApiKey(settings.provider);
  if (!apiKey) {
    // No key — streaming not available, will fallback to non-streaming Google Translate
    throw new Error('no-key-fallback');
  }
  provider.setApiKey(apiKey);
  if (settings.model) provider.setModel(settings.model);

  const stream = await provider.translateStream({ text, sourceLang, targetLang });
  return { stream, provider: settings.provider };
}

/**
 * Translate multiple texts in batch.
 * @param {string[]} texts
 * @param {string} [targetLang]
 * @param {string} [sourceLang]
 * @returns {Promise<Array<{translatedText: string, fromCache: boolean}>>}
 */
export async function translateBatch(texts, targetLang, sourceLang) {
  const settings = await getSettings();
  targetLang = targetLang || settings.targetLang;
  sourceLang = sourceLang || settings.sourceLang;

  // Check cache for each text
  const results = new Array(texts.length);
  const uncachedIndices = [];
  const uncachedTexts = [];

  for (let i = 0; i < texts.length; i++) {
    const cached = await getFromCache(texts[i], targetLang);
    if (cached) {
      results[i] = { translatedText: cached, fromCache: true };
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(texts[i]);
    }
  }

  if (uncachedTexts.length === 0) return results;

  let provider = getProvider(settings.provider);
  if (!provider) {
    throw new Error(`Translation provider "${settings.provider}" not found.`);
  }

  const isFreeProvider = settings.provider === 'google-translate';
  if (!isFreeProvider) {
    const apiKey = await getApiKey(settings.provider);
    if (!apiKey) {
      provider = getProvider('google-translate');
      if (!provider) {
        throw new Error(`No API key configured. Please add your API key in the extension settings.`);
      }
    } else {
      provider.setApiKey(apiKey);
      if (settings.model) provider.setModel(settings.model);
    }
  }

  let translated;
  try {
    translated = await provider.translateBatch({
      texts: uncachedTexts,
      sourceLang,
      targetLang,
    });
  } catch (err) {
    const fallback = getProvider('google-translate');
    if (fallback && settings.provider !== 'google-translate') {
      console.warn(`[Bilingual Translate] ${settings.provider} batch failed: ${err.message}, falling back to Google Translate`);
      translated = await fallback.translateBatch({
        texts: uncachedTexts,
        sourceLang,
        targetLang,
      });
    } else {
      throw err;
    }
  }

  // Merge results and cache
  for (let i = 0; i < uncachedIndices.length; i++) {
    const idx = uncachedIndices[i];
    results[idx] = { translatedText: translated[i].translatedText, fromCache: false };
    await saveToCache(texts[idx], targetLang, translated[i].translatedText);
  }

  return results;
}
