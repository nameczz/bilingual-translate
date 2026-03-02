import { jest } from '@jest/globals';
import { ClaudeProvider } from '../src/services/claude-provider.js';

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
      content: [{ type: 'text', text }],
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

describe('ClaudeProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new ClaudeProvider();
  });

  describe('constructor and setup', () => {
    test('has correct name', () => {
      expect(provider.name).toBe('Claude');
    });

    test('getDisplayName returns full name', () => {
      expect(provider.getDisplayName()).toBe('Claude (Anthropic)');
    });

    test('apiKey starts as null', () => {
      expect(provider.apiKey).toBeNull();
    });

    test('setApiKey stores key', () => {
      provider.setApiKey('sk-ant-test');
      expect(provider.apiKey).toBe('sk-ant-test');
    });
  });

  describe('translate()', () => {
    test('throws when no API key is set', async () => {
      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('API key not configured');
    });

    test('calls Anthropic API with correct params', async () => {
      provider.setApiKey('sk-ant-test');
      mockFetch.mockResolvedValueOnce(mockApiResponse('你好'));

      const result = await provider.translate({
        text: 'hello',
        sourceLang: 'en',
        targetLang: 'zh-CN',
      });

      expect(result.translatedText).toBe('你好');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(options.method).toBe('POST');
      expect(options.headers['x-api-key']).toBe('sk-ant-test');
      expect(options.headers['anthropic-version']).toBe('2023-06-01');

      const body = JSON.parse(options.body);
      expect(body.model).toBe('claude-sonnet-4-5-20250929');
      expect(body.messages[0].content).toBe('hello');
      expect(body.system).toContain('English');
      expect(body.system).toContain('Simplified Chinese');
    });

    test('uses auto-detect prompt when sourceLang is auto', async () => {
      provider.setApiKey('sk-ant-test');
      mockFetch.mockResolvedValueOnce(mockApiResponse('你好'));

      await provider.translate({
        text: 'hello',
        sourceLang: 'auto',
        targetLang: 'zh-CN',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toContain('Detect the source language');
    });

    test('handles 401 error', async () => {
      provider.setApiKey('invalid-key');
      mockFetch.mockResolvedValueOnce(mockErrorResponse(401, 'Unauthorized'));

      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('Invalid API key');
    });

    test('handles 429 rate limit error', async () => {
      provider.setApiKey('sk-ant-test');
      mockFetch.mockResolvedValueOnce(mockErrorResponse(429, 'Rate limited'));

      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('Rate limited');
    });

    test('handles unexpected response format', async () => {
      provider.setApiKey('sk-ant-test');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: [] }),
      });

      await expect(
        provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' })
      ).rejects.toThrow('Unexpected API response format');
    });

    test('trims whitespace from translated text', async () => {
      provider.setApiKey('sk-ant-test');
      mockFetch.mockResolvedValueOnce(mockApiResponse('  你好  \n'));

      const result = await provider.translate({
        text: 'hello',
        sourceLang: 'en',
        targetLang: 'zh-CN',
      });

      expect(result.translatedText).toBe('你好');
    });
  });

  describe('translateBatch()', () => {
    test('returns empty array for empty texts', async () => {
      provider.setApiKey('sk-ant-test');
      const results = await provider.translateBatch({
        texts: [],
        sourceLang: 'en',
        targetLang: 'zh-CN',
      });
      expect(results).toEqual([]);
    });

    test('delegates single text to translate()', async () => {
      provider.setApiKey('sk-ant-test');
      mockFetch.mockResolvedValueOnce(mockApiResponse('你好'));

      const results = await provider.translateBatch({
        texts: ['hello'],
        sourceLang: 'en',
        targetLang: 'zh-CN',
      });

      expect(results).toEqual([{ translatedText: '你好', detectedLang: 'en' }]);
    });

    test('sends numbered format for multiple texts', async () => {
      provider.setApiKey('sk-ant-test');
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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: 'text', text: 'Hi!' }] }),
      });

      const result = await provider.validateKey('sk-ant-valid');
      expect(result).toEqual({ valid: true });
    });

    test('returns invalid for 401 response', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(401, 'Unauthorized'));

      const result = await provider.validateKey('sk-ant-invalid');
      expect(result).toEqual({ valid: false, error: 'Invalid API key' });
    });

    test('returns error for other HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(500, 'Internal Server Error'));

      const result = await provider.validateKey('sk-ant-test');
      expect(result).toEqual({ valid: false, error: 'Internal Server Error' });
    });

    test('returns connection error on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.validateKey('sk-ant-test');
      expect(result).toEqual({ valid: false, error: 'Connection error: Network error' });
    });

    test('sends minimal request for validation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: 'text', text: 'Hi!' }] }),
      });

      await provider.validateKey('sk-ant-test');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(10); // minimal tokens for validation
      expect(body.messages[0].content).toBe('Hi');
    });
  });
});
