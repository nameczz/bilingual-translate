import { jest } from '@jest/globals';
import { OpenAIProvider } from '../src/services/openai-provider.js';

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
      choices: [{ message: { content: text } }],
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

describe('OpenAIProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new OpenAIProvider();
  });

  describe('constructor and setup', () => {
    test('has correct name', () => {
      expect(provider.name).toBe('OpenAI');
    });

    test('getDisplayName returns full name', () => {
      expect(provider.getDisplayName()).toBe('OpenAI');
    });

    test('apiKey starts as null', () => {
      expect(provider.apiKey).toBeNull();
    });

    test('setApiKey stores key', () => {
      provider.setApiKey('sk-openai-test');
      expect(provider.apiKey).toBe('sk-openai-test');
    });
  });

  describe('translate()', () => {
    test('throws when no API key is set', async () => {
      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('API key not configured');
    });

    test('calls OpenAI API with correct params', async () => {
      provider.setApiKey('sk-openai-test');
      mockFetch.mockResolvedValueOnce(mockApiResponse('你好'));

      const result = await provider.translate({
        text: 'hello',
        sourceLang: 'en',
        targetLang: 'zh-CN',
      });

      expect(result.translatedText).toBe('你好');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('Bearer sk-openai-test');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.model).toBe('gpt-4o');
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[0].content).toContain('English');
      expect(body.messages[0].content).toContain('Simplified Chinese');
      expect(body.messages[1].role).toBe('user');
      expect(body.messages[1].content).toBe('hello');
      expect(body.temperature).toBe(0.3);
    });

    test('uses auto-detect prompt when sourceLang is auto', async () => {
      provider.setApiKey('sk-openai-test');
      mockFetch.mockResolvedValueOnce(mockApiResponse('你好'));

      await provider.translate({
        text: 'hello',
        sourceLang: 'auto',
        targetLang: 'zh-CN',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('Detect the source language');
    });

    test('handles 401 error', async () => {
      provider.setApiKey('invalid-key');
      mockFetch.mockResolvedValueOnce(mockErrorResponse(401, 'Unauthorized'));

      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('Invalid API key');
    });

    test('handles 429 rate limit error', async () => {
      provider.setApiKey('sk-openai-test');
      mockFetch.mockResolvedValueOnce(mockErrorResponse(429, 'Rate limited'));

      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('Rate limited');
    });

    test('handles unexpected response format', async () => {
      provider.setApiKey('sk-openai-test');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
      });

      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('Unexpected API response format');
    });

    test('handles generic API error', async () => {
      provider.setApiKey('sk-openai-test');
      mockFetch.mockResolvedValueOnce(mockErrorResponse(500, 'Internal Server Error'));

      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('Translation API error');
    });

    test('trims whitespace from translated text', async () => {
      provider.setApiKey('sk-openai-test');
      mockFetch.mockResolvedValueOnce(mockApiResponse('  你好  \n'));

      const result = await provider.translate({
        text: 'hello',
        sourceLang: 'en',
        targetLang: 'zh-CN',
      });

      expect(result.translatedText).toBe('你好');
    });

    test('handles network error', async () => {
      provider.setApiKey('sk-openai-test');
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('Network error');
    });
  });

  describe('translateBatch()', () => {
    test('returns empty array for empty texts', async () => {
      provider.setApiKey('sk-openai-test');
      const results = await provider.translateBatch({
        texts: [],
        sourceLang: 'en',
        targetLang: 'zh-CN',
      });
      expect(results).toEqual([]);
    });

    test('delegates single text to translate()', async () => {
      provider.setApiKey('sk-openai-test');
      mockFetch.mockResolvedValueOnce(mockApiResponse('你好'));

      const results = await provider.translateBatch({
        texts: ['hello'],
        sourceLang: 'en',
        targetLang: 'zh-CN',
      });

      expect(results).toEqual([{ translatedText: '你好', detectedLang: 'en' }]);
    });

    test('sends numbered format for multiple texts', async () => {
      provider.setApiKey('sk-openai-test');
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

      const result = await provider.validateKey('sk-openai-valid');
      expect(result).toEqual({ valid: true });
    });

    test('returns invalid for 401 response', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(401, 'Unauthorized'));

      const result = await provider.validateKey('sk-openai-invalid');
      expect(result).toEqual({ valid: false, error: 'Invalid API key' });
    });

    test('returns error for other HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(500, 'Internal Server Error'));

      const result = await provider.validateKey('sk-openai-test');
      expect(result).toEqual({ valid: false, error: 'Internal Server Error' });
    });

    test('returns connection error on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.validateKey('sk-openai-test');
      expect(result).toEqual({ valid: false, error: 'Connection error: Network error' });
    });

    test('sends minimal request for validation', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse('Hi!'));

      await provider.validateKey('sk-openai-test');

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(options.headers['Authorization']).toBe('Bearer sk-openai-test');
      const body = JSON.parse(options.body);
      expect(body.max_tokens).toBe(10);
      expect(body.messages[0].content).toBe('Hi');
      expect(body.model).toBe('gpt-4o');
      expect(body.temperature).toBe(0.3);
    });
  });
});
