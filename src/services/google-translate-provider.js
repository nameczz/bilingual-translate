/**
 * Google Translate provider (free, no API key required).
 * Used as fallback when the user hasn't configured an AI provider key.
 */
import { TranslationProvider } from './provider.js';

const GT_API = 'https://translate.googleapis.com/translate_a/single';

export class GoogleTranslateProvider extends TranslationProvider {
  constructor() {
    super('Google Translate');
  }

  setApiKey() { /* no key needed */ }

  async translate({ text, sourceLang, targetLang }) {
    const sl = sourceLang === 'auto' ? 'auto' : this._normalizeCode(sourceLang);
    const tl = this._normalizeCode(targetLang);

    const params = new URLSearchParams({
      client: 'gtx',
      sl,
      tl,
      dt: 't',
      q: text,
    });

    const response = await fetch(`${GT_API}?${params}`);
    if (!response.ok) {
      throw new Error(`Google Translate error: HTTP ${response.status}`);
    }

    const data = await response.json();
    // Response format: [[["translated","original",...],...],...,detectedLang]
    const translatedText = data[0]
      .map(segment => segment[0])
      .filter(Boolean)
      .join('');

    return {
      translatedText,
      detectedLang: data[2] || sourceLang,
    };
  }

  async validateKey() {
    return { valid: true };
  }

  /**
   * Normalize language codes for Google Translate.
   * Google uses 'zh-CN' / 'zh-TW', while settings may use 'zh'.
   */
  _normalizeCode(code) {
    if (code === 'zh') return 'zh-CN';
    return code;
  }

  getDisplayName() {
    return 'Google Translate (Free)';
  }
}
