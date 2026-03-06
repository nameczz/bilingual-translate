/**
 * Google Gemini translation provider.
 * Uses the Gemini generateContent API (non-OpenAI format).
 */
import { TranslationProvider } from './provider.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.0-flash';

const LANGUAGE_NAMES = {
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  'zh': 'Simplified Chinese',
  'en': 'English',
  'ja': 'Japanese',
  'ko': 'Korean',
  'fr': 'French',
  'de': 'German',
  'es': 'Spanish',
  'pt': 'Portuguese',
  'ru': 'Russian',
  'ar': 'Arabic',
  'it': 'Italian',
  'th': 'Thai',
  'vi': 'Vietnamese',
};

function getLanguageName(code) {
  return LANGUAGE_NAMES[code] || code;
}

export class GeminiProvider extends TranslationProvider {
  constructor() {
    super('Gemini');
    this.apiKey = null;
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  /**
   * Translate a single text using Gemini API.
   */
  async translate({ text, sourceLang, targetLang }) {
    if (!this.apiKey) {
      throw new Error('API key not configured. Please set your Gemini API key in the extension settings.');
    }

    const targetName = getLanguageName(targetLang);
    const sourceInstruction = sourceLang === 'auto'
      ? 'Detect the source language and'
      : `The source language is ${getLanguageName(sourceLang)}.`;

    const prompt = `You are a professional translator. ${sourceInstruction} Translate the following text to ${targetName}.
Rules:
- Output ONLY the translated text, nothing else
- Preserve the original formatting (line breaks, spacing)
- Keep proper nouns, brand names, and technical terms as-is when appropriate
- Maintain the tone and style of the original text

Text to translate:
${text}`;

    const response = await this._callApi(prompt);
    return {
      translatedText: response.trim(),
      detectedLang: sourceLang === 'auto' ? 'auto' : sourceLang,
    };
  }

  /**
   * Translate multiple texts in one API call for efficiency.
   */
  async translateBatch({ texts, sourceLang, targetLang }) {
    if (!this.apiKey) {
      throw new Error('API key not configured.');
    }
    if (texts.length === 0) return [];
    if (texts.length === 1) {
      const result = await this.translate({ text: texts[0], sourceLang, targetLang });
      return [result];
    }

    const targetName = getLanguageName(targetLang);
    const sourceInstruction = sourceLang === 'auto'
      ? 'Detect the source language and'
      : `The source language is ${getLanguageName(sourceLang)}.`;

    const numberedTexts = texts.map((t, i) => `[${i + 1}] ${t}`).join('\n\n');

    const prompt = `You are a professional translator. ${sourceInstruction} Translate all the following numbered texts to ${targetName}.
Rules:
- Output each translation with its number prefix like [1], [2], etc.
- Output ONLY the translations, nothing else
- Preserve original formatting within each segment
- Keep proper nouns, brand names, and technical terms as-is when appropriate

${numberedTexts}`;

    const response = await this._callApi(prompt);
    return this._parseBatchResponse(response, texts.length);
  }

  /**
   * Validate an API key by making a minimal API call.
   */
  async validateKey(apiKey) {
    try {
      const url = `${GEMINI_API_BASE}/${MODEL}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      });

      if (response.ok) {
        return { valid: true };
      }

      const data = await response.json().catch(() => ({}));
      if (response.status === 400 && data.error?.message?.includes('API key')) {
        return { valid: false, error: 'Invalid API key' };
      }
      if (response.status === 403) {
        return { valid: false, error: 'Invalid API key or API not enabled' };
      }
      return { valid: false, error: data.error?.message || `API error: ${response.status}` };
    } catch (err) {
      return { valid: false, error: `Connection error: ${err.message}` };
    }
  }

  /**
   * Translate text using streaming SSE.
   * Uses Gemini's streamGenerateContent endpoint with alt=sse.
   */
  async translateStream({ text, sourceLang, targetLang }) {
    if (!this.apiKey) {
      throw new Error('API key not configured.');
    }

    const targetName = getLanguageName(targetLang);
    const sourceInstruction = sourceLang === 'auto'
      ? 'Detect the source language and'
      : `The source language is ${getLanguageName(sourceLang)}.`;

    const prompt = `You are a professional translator. ${sourceInstruction} Translate the following text to ${targetName}.
Rules:
- Output ONLY the translated text, nothing else
- Preserve the original formatting (line breaks, spacing)
- Keep proper nouns, brand names, and technical terms as-is when appropriate
- Maintain the tone and style of the original text

Text to translate:
${text}`;

    const model = this.model || MODEL;
    const url = `${GEMINI_API_BASE}/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    return response.body;
  }

  /**
   * Call the Gemini generateContent API.
   * Gemini uses a different format than OpenAI: contents/parts instead of messages.
   */
  async _callApi(prompt) {
    const model = this.model || MODEL;
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const msg = error.error?.message || `HTTP ${response.status}`;
      if (response.status === 429) {
        throw new Error(`Rate limited. Please wait a moment and try again. (${msg})`);
      }
      if (response.status === 403) {
        throw new Error('Invalid API key. Please check your settings.');
      }
      throw new Error(`Translation API error: ${msg}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error('Unexpected API response format');
    }
    return content;
  }

  /**
   * Parse a batch translation response into individual results.
   */
  _parseBatchResponse(response, expectedCount) {
    const results = [];
    const lines = response.split('\n');
    let current = '';
    let currentIndex = -1;

    for (const line of lines) {
      const match = line.match(/^\[(\d+)\]\s*(.*)/);
      if (match) {
        if (currentIndex >= 0) {
          results[currentIndex] = {
            translatedText: current.trim(),
            detectedLang: 'auto',
          };
        }
        currentIndex = parseInt(match[1], 10) - 1;
        current = match[2];
      } else if (currentIndex >= 0) {
        current += '\n' + line;
      }
    }

    if (currentIndex >= 0) {
      results[currentIndex] = {
        translatedText: current.trim(),
        detectedLang: 'auto',
      };
    }

    for (let i = 0; i < expectedCount; i++) {
      if (!results[i]) {
        results[i] = { translatedText: '', detectedLang: 'auto' };
      }
    }

    return results.slice(0, expectedCount);
  }

  getDisplayName() {
    return 'Gemini (Google)';
  }
}
