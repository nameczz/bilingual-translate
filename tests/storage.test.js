import { jest } from '@jest/globals';

// Mock crypto module before importing storage
const mockEncrypt = jest.fn(async (text) => `encrypted:${text}`);
const mockDecrypt = jest.fn(async (text) => text.replace('encrypted:', ''));

jest.unstable_mockModule('../src/utils/crypto.js', () => ({
  encrypt: mockEncrypt,
  decrypt: mockDecrypt,
}));

const { getSettings, saveSettings, saveApiKey, getApiKey, removeApiKey, hasApiKey } =
  await import('../src/utils/storage.js');

beforeEach(() => {
  globalThis.__resetChromeStorage();
  mockEncrypt.mockClear();
  mockDecrypt.mockClear();
  mockEncrypt.mockImplementation(async (text) => `encrypted:${text}`);
  mockDecrypt.mockImplementation(async (text) => text.replace('encrypted:', ''));
});

describe('getSettings', () => {
  test('returns default settings when none are saved', async () => {
    const settings = await getSettings();
    expect(settings).toEqual({
      provider: 'claude',
      model: 'claude-sonnet-4-5-20250929',
      targetLang: 'zh-CN',
      sourceLang: 'auto',
      trigger: 'button',
      displayStyle: 'underline',
      translationFontSize: 90,
      colorTranslation: true,
      smoothAnimations: true,
      autoTranslate: false,
      theme: 'auto',
    });
  });

  test('returns merged settings with defaults', async () => {
    globalThis.__setChromeStorage({
      settings: { provider: 'openai', targetLang: 'ja' },
    });
    const settings = await getSettings();
    expect(settings.provider).toBe('openai');
    expect(settings.targetLang).toBe('ja');
    expect(settings.sourceLang).toBe('auto'); // default value
    expect(settings.trigger).toBe('button'); // default value
  });
});

describe('saveSettings', () => {
  test('saves partial settings merged with current', async () => {
    await saveSettings({ targetLang: 'fr' });
    const settings = await getSettings();
    expect(settings.targetLang).toBe('fr');
    expect(settings.provider).toBe('claude'); // default preserved
  });

  test('multiple saves accumulate correctly', async () => {
    await saveSettings({ targetLang: 'fr' });
    await saveSettings({ provider: 'openai' });
    const settings = await getSettings();
    expect(settings.targetLang).toBe('fr');
    expect(settings.provider).toBe('openai');
  });

  test('overwrites existing settings', async () => {
    await saveSettings({ targetLang: 'fr' });
    await saveSettings({ targetLang: 'de' });
    const settings = await getSettings();
    expect(settings.targetLang).toBe('de');
  });
});

describe('saveApiKey', () => {
  test('encrypts and saves API key', async () => {
    await saveApiKey('claude', 'sk-ant-test-key');
    expect(mockEncrypt).toHaveBeenCalledWith('sk-ant-test-key');
    const storage = globalThis.__getChromeStorage();
    expect(storage['apikey_claude']).toBe('encrypted:sk-ant-test-key');
  });

  test('stores with provider-specific key prefix', async () => {
    await saveApiKey('openai', 'sk-openai-key');
    const storage = globalThis.__getChromeStorage();
    expect(storage['apikey_openai']).toBe('encrypted:sk-openai-key');
    expect(storage['apikey_claude']).toBeUndefined();
  });
});

describe('getApiKey', () => {
  test('decrypts and returns stored API key', async () => {
    await saveApiKey('claude', 'sk-ant-test-key');
    const key = await getApiKey('claude');
    expect(key).toBe('sk-ant-test-key');
    expect(mockDecrypt).toHaveBeenCalled();
  });

  test('returns null for non-existent provider', async () => {
    const key = await getApiKey('nonexistent');
    expect(key).toBeNull();
  });

  test('returns null when decryption fails', async () => {
    mockDecrypt.mockRejectedValueOnce(new Error('decrypt failed'));
    globalThis.__setChromeStorage({ apikey_claude: 'corrupted-data' });
    const key = await getApiKey('claude');
    expect(key).toBeNull();
  });
});

describe('removeApiKey', () => {
  test('removes stored API key', async () => {
    await saveApiKey('claude', 'sk-ant-test-key');
    await removeApiKey('claude');
    const key = await getApiKey('claude');
    expect(key).toBeNull();
  });
});

describe('hasApiKey', () => {
  test('returns true when key exists', async () => {
    await saveApiKey('claude', 'sk-ant-test-key');
    const has = await hasApiKey('claude');
    expect(has).toBe(true);
  });

  test('returns false when key does not exist', async () => {
    const has = await hasApiKey('nonexistent');
    expect(has).toBe(false);
  });

  test('returns false after key removal', async () => {
    await saveApiKey('claude', 'sk-ant-test-key');
    await removeApiKey('claude');
    const has = await hasApiKey('claude');
    expect(has).toBe(false);
  });
});
