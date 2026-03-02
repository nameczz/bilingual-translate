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

  const provider = getProvider(settings.provider);
  if (!provider) {
    throw new Error(`Translation provider "${settings.provider}" not found.`);
  }

  // Load API key
  const apiKey = await getApiKey(settings.provider);
  if (!apiKey) {
    throw new Error(`No API key configured for ${provider.getDisplayName()}. Please add your API key in the extension settings.`);
  }
  provider.setApiKey(apiKey);
  if (settings.model) provider.setModel(settings.model);

  const result = await provider.translate({ text, sourceLang, targetLang });

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

  const provider = getProvider(settings.provider);
  if (!provider) {
    throw new Error(`Translation provider "${settings.provider}" not found.`);
  }

  const apiKey = await getApiKey(settings.provider);
  if (!apiKey) {
    throw new Error(`No API key configured for ${provider.getDisplayName()}.`);
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

  const provider = getProvider(settings.provider);
  if (!provider) {
    throw new Error(`Translation provider "${settings.provider}" not found.`);
  }

  const apiKey = await getApiKey(settings.provider);
  if (!apiKey) {
    throw new Error(`No API key configured for ${provider.getDisplayName()}.`);
  }
  provider.setApiKey(apiKey);
  if (settings.model) provider.setModel(settings.model);

  const translated = await provider.translateBatch({
    texts: uncachedTexts,
    sourceLang,
    targetLang,
  });

  // Merge results and cache
  for (let i = 0; i < uncachedIndices.length; i++) {
    const idx = uncachedIndices[i];
    results[idx] = { translatedText: translated[i].translatedText, fromCache: false };
    await saveToCache(texts[idx], targetLang, translated[i].translatedText);
  }

  return results;
}
