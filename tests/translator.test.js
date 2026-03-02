import { jest } from '@jest/globals';

// Mock dependencies before importing translator
const mockGetFromCache = jest.fn();
const mockSaveToCache = jest.fn();
const mockGetSettings = jest.fn();
const mockGetApiKey = jest.fn();
const mockGetProvider = jest.fn();

jest.unstable_mockModule('../src/services/cache.js', () => ({
  getFromCache: mockGetFromCache,
  saveToCache: mockSaveToCache,
}));

jest.unstable_mockModule('../src/utils/storage.js', () => ({
  getSettings: mockGetSettings,
  getApiKey: mockGetApiKey,
}));

jest.unstable_mockModule('../src/services/provider.js', () => ({
  getProvider: mockGetProvider,
}));

const { translateText, translateBatch } = await import('../src/services/translator.js');

const mockProvider = {
  setApiKey: jest.fn(),
  translate: jest.fn(),
  translateBatch: jest.fn(),
  getDisplayName: jest.fn(() => 'Mock Provider'),
};

beforeEach(() => {
  mockGetFromCache.mockReset();
  mockSaveToCache.mockReset();
  mockGetSettings.mockReset();
  mockGetApiKey.mockReset();
  mockGetProvider.mockReset();
  mockProvider.setApiKey.mockReset();
  mockProvider.translate.mockReset();
  mockProvider.translateBatch.mockReset();

  mockGetSettings.mockResolvedValue({
    provider: 'claude',
    targetLang: 'zh-CN',
    sourceLang: 'auto',
  });
  mockGetProvider.mockReturnValue(mockProvider);
  mockGetApiKey.mockResolvedValue('sk-ant-test-key');
  mockSaveToCache.mockResolvedValue(undefined);
});

describe('translateText', () => {
  test('returns cached result if available', async () => {
    mockGetFromCache.mockResolvedValueOnce('你好');

    const result = await translateText('hello');
    expect(result).toEqual({ translatedText: '你好', fromCache: true });
    expect(mockProvider.translate).not.toHaveBeenCalled();
  });

  test('calls provider when no cache hit', async () => {
    mockGetFromCache.mockResolvedValueOnce(null);
    mockProvider.translate.mockResolvedValueOnce({
      translatedText: '你好',
      detectedLang: 'en',
    });

    const result = await translateText('hello');
    expect(result).toEqual({ translatedText: '你好', fromCache: false });
    expect(mockProvider.translate).toHaveBeenCalledWith({
      text: 'hello',
      sourceLang: 'auto',
      targetLang: 'zh-CN',
    });
  });

  test('caches translation result', async () => {
    mockGetFromCache.mockResolvedValueOnce(null);
    mockProvider.translate.mockResolvedValueOnce({
      translatedText: '你好',
      detectedLang: 'en',
    });

    await translateText('hello');
    expect(mockSaveToCache).toHaveBeenCalledWith('hello', 'zh-CN', '你好');
  });

  test('sets API key on provider', async () => {
    mockGetFromCache.mockResolvedValueOnce(null);
    mockProvider.translate.mockResolvedValueOnce({
      translatedText: '翻译',
      detectedLang: 'en',
    });

    await translateText('text');
    expect(mockProvider.setApiKey).toHaveBeenCalledWith('sk-ant-test-key');
  });

  test('throws when provider not found', async () => {
    mockGetFromCache.mockResolvedValueOnce(null);
    mockGetProvider.mockReturnValueOnce(undefined);

    await expect(translateText('hello'))
      .rejects.toThrow('Translation provider "claude" not found');
  });

  test('throws when no API key configured', async () => {
    mockGetFromCache.mockResolvedValueOnce(null);
    mockGetApiKey.mockResolvedValueOnce(null);

    await expect(translateText('hello'))
      .rejects.toThrow('No API key configured');
  });

  test('uses explicit targetLang and sourceLang params', async () => {
    mockGetFromCache.mockResolvedValueOnce(null);
    mockProvider.translate.mockResolvedValueOnce({
      translatedText: 'bonjour',
      detectedLang: 'en',
    });

    await translateText('hello', 'fr', 'en');
    expect(mockProvider.translate).toHaveBeenCalledWith({
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'fr',
    });
  });
});

describe('translateBatch', () => {
  test('returns all from cache when all cached', async () => {
    mockGetFromCache.mockResolvedValueOnce('你好');
    mockGetFromCache.mockResolvedValueOnce('世界');

    const results = await translateBatch(['hello', 'world']);
    expect(results).toEqual([
      { translatedText: '你好', fromCache: true },
      { translatedText: '世界', fromCache: true },
    ]);
    expect(mockProvider.translateBatch).not.toHaveBeenCalled();
  });

  test('calls provider only for uncached texts', async () => {
    mockGetFromCache.mockResolvedValueOnce('你好'); // 'hello' cached
    mockGetFromCache.mockResolvedValueOnce(null); // 'world' not cached

    mockProvider.translateBatch.mockResolvedValueOnce([
      { translatedText: '世界', detectedLang: 'en' },
    ]);

    const results = await translateBatch(['hello', 'world']);
    expect(results[0]).toEqual({ translatedText: '你好', fromCache: true });
    expect(results[1]).toEqual({ translatedText: '世界', fromCache: false });

    // Should only send uncached text to provider
    expect(mockProvider.translateBatch).toHaveBeenCalledWith({
      texts: ['world'],
      sourceLang: 'auto',
      targetLang: 'zh-CN',
    });
  });

  test('caches newly translated results', async () => {
    mockGetFromCache.mockResolvedValueOnce(null);
    mockGetFromCache.mockResolvedValueOnce(null);

    mockProvider.translateBatch.mockResolvedValueOnce([
      { translatedText: '你好', detectedLang: 'en' },
      { translatedText: '世界', detectedLang: 'en' },
    ]);

    await translateBatch(['hello', 'world']);

    expect(mockSaveToCache).toHaveBeenCalledWith('hello', 'zh-CN', '你好');
    expect(mockSaveToCache).toHaveBeenCalledWith('world', 'zh-CN', '世界');
  });

  test('throws when provider not found', async () => {
    mockGetFromCache.mockResolvedValue(null);
    mockGetProvider.mockReturnValueOnce(undefined);

    await expect(translateBatch(['hello']))
      .rejects.toThrow('Translation provider "claude" not found');
  });
});
