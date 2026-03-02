/**
 * Translation provider abstraction layer.
 * All providers must implement this interface.
 */

/**
 * @typedef {Object} TranslationRequest
 * @property {string} text - Text to translate
 * @property {string} sourceLang - Source language code (or 'auto')
 * @property {string} targetLang - Target language code
 */

/**
 * @typedef {Object} TranslationResult
 * @property {string} translatedText - The translated text
 * @property {string} detectedLang - Detected source language (if auto)
 */

/**
 * @typedef {Object} BatchTranslationRequest
 * @property {string[]} texts - Array of texts to translate
 * @property {string} sourceLang
 * @property {string} targetLang
 */

/**
 * Base class for translation providers.
 * Subclasses must implement translate() and validateKey().
 */
export class TranslationProvider {
  constructor(name) {
    this.name = name;
    this.model = null;
  }

  /**
   * Set the model to use for translation.
   * @param {string} model - Model identifier
   */
  setModel(model) {
    this.model = model;
  }

  /**
   * Translate a single text.
   * @param {TranslationRequest} request
   * @returns {Promise<TranslationResult>}
   */
  async translate(request) {
    throw new Error(`${this.name}: translate() not implemented`);
  }

  /**
   * Translate multiple texts in a single API call when possible.
   * Default implementation calls translate() for each text.
   * @param {BatchTranslationRequest} request
   * @returns {Promise<TranslationResult[]>}
   */
  async translateBatch(request) {
    const results = [];
    for (const text of request.texts) {
      const result = await this.translate({
        text,
        sourceLang: request.sourceLang,
        targetLang: request.targetLang,
      });
      results.push(result);
    }
    return results;
  }

  /**
   * Translate text with streaming support.
   * Returns a ReadableStream of SSE data.
   * @param {TranslationRequest} request
   * @returns {Promise<ReadableStream>}
   */
  async translateStream(request) {
    throw new Error(`${this.name} does not support streaming.`);
  }

  /**
   * Validate the API key.
   * @param {string} apiKey
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  async validateKey(apiKey) {
    throw new Error(`${this.name}: validateKey() not implemented`);
  }

  /**
   * Get the display name for this provider.
   * @returns {string}
   */
  getDisplayName() {
    return this.name;
  }
}

/**
 * Provider registry - manages available translation providers.
 */
const providers = new Map();

/**
 * Register a translation provider.
 * @param {string} id - Unique provider identifier
 * @param {TranslationProvider} provider
 */
export function registerProvider(id, provider) {
  providers.set(id, provider);
}

/**
 * Get a registered provider by ID.
 * @param {string} id
 * @returns {TranslationProvider|undefined}
 */
export function getProvider(id) {
  return providers.get(id);
}

/**
 * Get all registered provider IDs.
 * @returns {string[]}
 */
export function getProviderIds() {
  return Array.from(providers.keys());
}
