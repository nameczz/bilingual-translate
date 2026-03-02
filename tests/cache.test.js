import { jest } from '@jest/globals';
import {
  getFromCache,
  saveToCache,
  cleanCache,
  clearAllCache,
} from '../src/services/cache.js';

beforeEach(() => {
  globalThis.__resetChromeStorage();
});

describe('saveToCache and getFromCache', () => {
  test('caches and retrieves a translation', async () => {
    await saveToCache('hello', 'zh-CN', '你好');
    const result = await getFromCache('hello', 'zh-CN');
    expect(result).toBe('你好');
  });

  test('returns null for uncached text', async () => {
    const result = await getFromCache('unknown text', 'zh-CN');
    expect(result).toBeNull();
  });

  test('returns null for different target language', async () => {
    await saveToCache('hello', 'zh-CN', '你好');
    const result = await getFromCache('hello', 'ja');
    // May return null depending on hash collision — the key is derived differently
    // At minimum, if same key exists, it checks targetLang mismatch
    // This test verifies the collision protection
    if (result !== null) {
      // If hash happens to collide, the collision check should catch it
      expect(result).toBeNull();
    }
  });

  test('returns null for expired cache entries', async () => {
    await saveToCache('old text', 'zh-CN', '旧文本');

    // Manually expire the entry
    const storage = globalThis.__getChromeStorage();
    const cacheKeys = Object.keys(storage).filter(k => k.startsWith('tc_'));
    expect(cacheKeys.length).toBe(1);

    // Set timestamp to 8 days ago (cache max age is 7 days)
    const key = cacheKeys[0];
    storage[key].timestamp = Date.now() - 8 * 24 * 60 * 60 * 1000;
    globalThis.__setChromeStorage(storage);

    const result = await getFromCache('old text', 'zh-CN');
    expect(result).toBeNull();
  });

  test('handles hash collision protection (text mismatch)', async () => {
    await saveToCache('text A', 'zh-CN', '翻译A');

    // Manually tamper with the original text to simulate collision
    const storage = globalThis.__getChromeStorage();
    const cacheKeys = Object.keys(storage).filter(k => k.startsWith('tc_'));
    const key = cacheKeys[0];
    storage[key].original = 'different text';
    globalThis.__setChromeStorage(storage);

    const result = await getFromCache('text A', 'zh-CN');
    expect(result).toBeNull();
  });
});

describe('cleanCache', () => {
  test('removes expired entries', async () => {
    // Add a current entry
    await saveToCache('current', 'zh-CN', '当前');

    // Add an expired entry manually
    const expiredKey = 'tc_expired';
    globalThis.__setChromeStorage({
      [expiredKey]: {
        original: 'expired',
        targetLang: 'zh-CN',
        translated: '过期',
        timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000,
      },
    });

    await cleanCache();

    // Expired entry should be removed
    const storage = globalThis.__getChromeStorage();
    expect(storage[expiredKey]).toBeUndefined();

    // Current entry should still exist
    const result = await getFromCache('current', 'zh-CN');
    expect(result).toBe('当前');
  });

  test('removes oldest entries when over max limit', async () => {
    // Add more than CACHE_MAX_ENTRIES (1000) entries
    const storage = {};
    for (let i = 0; i < 1005; i++) {
      storage[`tc_${i}`] = {
        original: `text${i}`,
        targetLang: 'zh-CN',
        translated: `翻译${i}`,
        timestamp: Date.now() - i * 1000, // older entries have lower timestamps
      };
    }
    globalThis.__setChromeStorage(storage);

    await cleanCache();

    const remaining = globalThis.__getChromeStorage();
    const cacheKeys = Object.keys(remaining).filter(k => k.startsWith('tc_'));
    expect(cacheKeys.length).toBeLessThanOrEqual(1000);
  });
});

describe('clearAllCache', () => {
  test('removes all cache entries but keeps non-cache data', async () => {
    await saveToCache('hello', 'zh-CN', '你好');
    await saveToCache('world', 'zh-CN', '世界');

    // Add non-cache data
    globalThis.__setChromeStorage({
      ...globalThis.__getChromeStorage(),
      settings: { provider: 'claude' },
    });

    await clearAllCache();

    const storage = globalThis.__getChromeStorage();
    const cacheKeys = Object.keys(storage).filter(k => k.startsWith('tc_'));
    expect(cacheKeys.length).toBe(0);
    // Non-cache data should still exist
    expect(storage.settings).toEqual({ provider: 'claude' });
  });

  test('handles empty cache gracefully', async () => {
    await clearAllCache(); // Should not throw
  });
});
