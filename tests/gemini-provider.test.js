import { jest } from '@jest/globals';
import { GeminiProvider } from '../src/services/gemini-provider.js';

// Mock global fetch
const mockFetch = jest.fn();
globalThis.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

function mockApiResponse(text, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
  };
}

function mockErrorResponse(status, message = 'Error') {
  return {
    ok: false,
    status,
    json: async () => ({
      error: { message },
    }),
  };
}

describe('GeminiProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new GeminiProvider();
  });

  describe('constructor and setup', () => {
    test('has correct name', () => {
      expect(provider.name).toBe('Gemini');
    });

    test('getDisplayName returns full name', () => {
      expect(provider.getDisplayName()).toBe('Gemini (Google)');
    });

    test('apiKey starts as null', () => {
      expect(provider.apiKey).toBeNull();
    });

    test('setApiKey stores key', () => {
      provider.setApiKey('AIza-test-key');
      expect(provider.apiKey).toBe('AIza-test-key');
    });
  });

  describe('translate()', () => {
    test('throws when no API key is set', async () => {
      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('API key not configured');
    });

    test('calls Gemini API with correct params', async () => {
      provider.setApiKey('AIza-test-key');
      mockFetch.mockResolvedValueOnce(mockApiResponse('你好'));

      const result = await provider.translate({
        text: 'hello',
        sourceLang: 'en',
        targetLang: 'zh-CN',
      });

      expect(result.translatedText).toBe('你好');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      // Gemini passes API key in URL query param
      expect(url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIza-test-key'
      );
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      // Gemini uses contents/parts format, not messages
      expect(body.contents).toHaveLength(1);
      expect(body.contents[0].parts).toHaveLength(1);
      expect(body.contents[0].parts[0].text).toContain('hello');
      expect(body.contents[0].parts[0].text).toContain('English');
      expect(body.contents[0].parts[0].text).toContain('Simplified Chinese');
      expect(body.generationConfig.temperature).toBe(0.3);
      expect(body.generationConfig.maxOutputTokens).toBe(4096);
    });

    test('uses auto-detect prompt when sourceLang is auto', async () => {
      provider.setApiKey('AIza-test-key');
      mockFetch.mockResolvedValueOnce(mockApiResponse('你好'));

      await provider.translate({
        text: 'hello',
        sourceLang: 'auto',
        targetLang: 'zh-CN',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.contents[0].parts[0].text).toContain('Detect the source language');
    });

    test('handles 403 error as invalid API key', async () => {
      provider.setApiKey('invalid-key');
      mockFetch.mockResolvedValueOnce(mockErrorResponse(403, 'Forbidden'));

      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('Invalid API key');
    });

    test('handles 429 rate limit error', async () => {
      provider.setApiKey('AIza-test-key');
      mockFetch.mockResolvedValueOnce(mockErrorResponse(429, 'Rate limited'));

      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('Rate limited');
    });

    test('handles unexpected response format', async () => {
      provider.setApiKey('AIza-test-key');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [] }),
      });

      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('Unexpected API response format');
    });

    test('handles generic API error', async () => {
      provider.setApiKey('AIza-test-key');
      mockFetch.mockResolvedValueOnce(mockErrorResponse(500, 'Internal Server Error'));

      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('Translation API error');
    });

    test('trims whitespace from translated text', async () => {
      provider.setApiKey('AIza-test-key');
      mockFetch.mockResolvedValueOnce(mockApiResponse('  你好  \n'));

      const result = await provider.translate({
        text: 'hello',
        sourceLang: 'en',
        targetLang: 'zh-CN',
      });

      expect(result.translatedText).toBe('你好');
    });

    test('handles network error', async () => {
      provider.setApiKey('AIza-test-key');
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('Network error');
    });
  });

  describe('translateBatch()', () => {
    test('returns empty array for empty texts', async () => {
      provider.setApiKey('AIza-test-key');
      const results = await provider.translateBatch({
        texts: [],
        sourceLang: 'en',
        targetLang: 'zh-CN',
      });
      expect(results).toEqual([]);
    });

    test('delegates single text to translate()', async () => {
      provider.setApiKey('AIza-test-key');
      mockFetch.mockResolvedValueOnce(mockApiResponse('你好'));

      const results = await provider.translateBatch({
        texts: ['hello'],
        sourceLang: 'en',
        targetLang: 'zh-CN',
      });

      expect(results).toEqual([{ translatedText: '你好', detectedLang: 'en' }]);
    });

    test('sends numbered format for multiple texts', async () => {
      provider.setApiKey('AIza-test-key');
      mockFetch.mockResolvedValueOnce(
        mockApiResponse('[1] 你好\n\n[2] 世界')
      );

      const results = await provider.translateBatch({
        texts: ['hello', 'world'],
        sourceLang: 'en',
        targetLang: 'zh-CN',
      });

      expect(results.length).toBe(2);
      expect(results[0].translatedText).toBe('你好');
      expect(results[1].translatedText).toBe('世界');
    });

    test('throws when no API key is set', async () => {
      await expect(
        provider.translateBatch({ texts: ['hello'], sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('API key not configured');
    });
  });

  describe('_parseBatchResponse()', () => {
    test('parses numbered response correctly', () => {
      const response = '[1] First translation\n[2] Second translation\n[3] Third one';
      const results = provider._parseBatchResponse(response, 3);
      expect(results.length).toBe(3);
      expect(results[0].translatedText).toBe('First translation');
      expect(results[1].translatedText).toBe('Second translation');
      expect(results[2].translatedText).toBe('Third one');
    });

    test('handles multiline translations', () => {
      const response = '[1] Line one\nLine two\n[2] Single line';
      const results = provider._parseBatchResponse(response, 2);
      expect(results[0].translatedText).toBe('Line one\nLine two');
      expect(results[1].translatedText).toBe('Single line');
    });

    test('fills missing indices with empty results', () => {
      const response = '[1] Only first';
      const results = provider._parseBatchResponse(response, 3);
      expect(results.length).toBe(3);
      expect(results[0].translatedText).toBe('Only first');
      expect(results[1].translatedText).toBe('');
      expect(results[2].translatedText).toBe('');
    });

    test('truncates extra results beyond expected count', () => {
      const response = '[1] A\n[2] B\n[3] C\n[4] D';
      const results = provider._parseBatchResponse(response, 2);
      expect(results.length).toBe(2);
    });
  });

  describe('validateKey()', () => {
    test('returns valid for 200 response', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse('Hi!'));

      const result = await provider.validateKey('AIza-valid-key');
      expect(result).toEqual({ valid: true });
    });

    test('returns invalid for 400 response with API key error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: 'API key not valid. Please pass a valid API key.' },
        }),
      });

      const result = await provider.validateKey('AIza-invalid');
      expect(result).toEqual({ valid: false, error: 'Invalid API key' });
    });

    test('returns invalid for 403 response', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(403, 'Forbidden'));

      const result = await provider.validateKey('AIza-invalid');
      expect(result).toEqual({ valid: false, error: 'Invalid API key or API not enabled' });
    });

    test('returns error for other HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(500, 'Internal Server Error'));

      const result = await provider.validateKey('AIza-test-key');
      expect(result).toEqual({ valid: false, error: 'Internal Server Error' });
    });

    test('returns connection error on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.validateKey('AIza-test-key');
      expect(result).toEqual({ valid: false, error: 'Connection error: Network error' });
    });

    test('sends minimal request for validation with API key in URL', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse('Hi!'));

      await provider.validateKey('AIza-test-key');

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('key=AIza-test-key');
      expect(url).toContain('gemini-2.0-flash:generateContent');
      const body = JSON.parse(options.body);
      expect(body.generationConfig.maxOutputTokens).toBe(10);
      expect(body.contents[0].parts[0].text).toBe('Hi');
    });
  });
});
