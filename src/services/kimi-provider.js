/**
 * Kimi (Moonshot AI) translation provider.
 * Uses OpenAI-compatible chat completions API.
 */
import { TranslationProvider } from './provider.js';

const KIMI_API_URL = 'https://api.moonshot.cn/v1/chat/completions';
const MODEL = 'moonshot-v1-8k';
const TEMPERATURE = 0.3;

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

export class KimiProvider extends TranslationProvider {
  constructor() {
    super('Kimi');
    this.apiKey = null;
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  /**
   * Translate a single text using Kimi API.
   */
  async translate({ text, sourceLang, targetLang }) {
    if (!this.apiKey) {
      throw new Error('API key not configured. Please set your Kimi API key in the extension settings.');
    }

    const targetName = getLanguageName(targetLang);
    const sourceInstruction = sourceLang === 'auto'
      ? 'Detect the source language and'
      : `The source language is ${getLanguageName(sourceLang)}.`;

    const systemPrompt = `You are a professional translator. ${sourceInstruction} Translate the following text to ${targetName}.
Rules:
- Output ONLY the translated text, nothing else
- Preserve the original formatting (line breaks, spacing)
- Keep proper nouns, brand names, and technical terms as-is when appropriate
- Maintain the tone and style of the original text`;

    const response = await this._callApi(systemPrompt, text);
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

    const systemPrompt = `You are a professional translator. ${sourceInstruction} Translate all the following numbered texts to ${targetName}.
Rules:
- Output each translation with its number prefix like [1], [2], etc.
- Output ONLY the translations, nothing else
- Preserve original formatting within each segment
- Keep proper nouns, brand names, and technical terms as-is when appropriate`;

    const response = await this._callApi(systemPrompt, numberedTexts);
    return this._parseBatchResponse(response, texts.length);
  }

  /**
   * Translate text using streaming SSE (OpenAI-compatible).
   */
  async translateStream({ text, sourceLang, targetLang }) {
    if (!this.apiKey) {
      throw new Error('API key not configured.');
    }

    const targetName = getLanguageName(targetLang);
    const sourceInstruction = sourceLang === 'auto'
      ? 'Detect the source language and'
      : `The source language is ${getLanguageName(sourceLang)}.`;

    const systemPrompt = `You are a professional translator. ${sourceInstruction} Translate the following text to ${targetName}.
Rules:
- Output ONLY the translated text, nothing else
- Preserve the original formatting (line breaks, spacing)
- Keep proper nouns, brand names, and technical terms as-is when appropriate
- Maintain the tone and style of the original text`;

    const response = await fetch(KIMI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model || MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        temperature: TEMPERATURE,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    return response.body;
  }

  /**
   * Validate an API key by making a minimal API call.
   */
  async validateKey(apiKey) {
    try {
      const response = await fetch(KIMI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 10,
          temperature: TEMPERATURE,
        }),
      });

      if (response.ok) {
        return { valid: true };
      }

      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        return { valid: false, error: 'Invalid API key' };
      }
      return { valid: false, error: data.error?.message || `API error: ${response.status}` };
    } catch (err) {
      return { valid: false, error: `Connection error: ${err.message}` };
    }
  }

  /**
   * Call the Kimi chat completions API (OpenAI-compatible format).
   */
  async _callApi(systemPrompt, userMessage) {
    const response = await fetch(KIMI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model || MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: TEMPERATURE,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const msg = error.error?.message || `HTTP ${response.status}`;
      if (response.status === 429) {
        throw new Error(`Rate limited. Please wait a moment and try again. (${msg})`);
      }
      if (response.status === 401) {
        throw new Error('Invalid API key. Please check your settings.');
      }
      throw new Error(`Translation API error: ${msg}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
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
    return 'Kimi (Moonshot AI)';
  }
}
