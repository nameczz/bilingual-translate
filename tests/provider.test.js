import { jest } from '@jest/globals';
import {
  TranslationProvider,
  registerProvider,
  getProvider,
  getProviderIds,
} from '../src/services/provider.js';

describe('TranslationProvider base class', () => {
  test('constructor sets name', () => {
    const p = new TranslationProvider('TestProvider');
    expect(p.name).toBe('TestProvider');
  });

  test('translate() throws not-implemented error', async () => {
    const p = new TranslationProvider('TestProvider');
    await expect(p.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh-CN' }))
      .rejects.toThrow('TestProvider: translate() not implemented');
  });

  test('validateKey() throws not-implemented error', async () => {
    const p = new TranslationProvider('TestProvider');
    await expect(p.validateKey('some-key'))
      .rejects.toThrow('TestProvider: validateKey() not implemented');
  });

  test('getDisplayName() returns name', () => {
    const p = new TranslationProvider('MyProvider');
    expect(p.getDisplayName()).toBe('MyProvider');
  });

  test('translateBatch() calls translate() for each text sequentially', async () => {
    const p = new TranslationProvider('MockProvider');
    const calls = [];
    p.translate = async (req) => {
      calls.push(req.text);
      return { translatedText: `translated:${req.text}`, detectedLang: 'en' };
    };

    const results = await p.translateBatch({
      texts: ['hello', 'world'],
      sourceLang: 'en',
      targetLang: 'zh-CN',
    });

    expect(calls).toEqual(['hello', 'world']);
    expect(results).toEqual([
      { translatedText: 'translated:hello', detectedLang: 'en' },
      { translatedText: 'translated:world', detectedLang: 'en' },
    ]);
  });
});

describe('Provider registry', () => {
  test('registerProvider and getProvider', () => {
    const provider = new TranslationProvider('RegTest');
    registerProvider('reg-test', provider);
    expect(getProvider('reg-test')).toBe(provider);
  });

  test('getProvider returns undefined for unknown provider', () => {
    expect(getProvider('nonexistent-provider-xyz')).toBeUndefined();
  });

  test('getProviderIds returns registered IDs', () => {
    registerProvider('test-id-1', new TranslationProvider('A'));
    registerProvider('test-id-2', new TranslationProvider('B'));
    const ids = getProviderIds();
    expect(ids).toContain('test-id-1');
    expect(ids).toContain('test-id-2');
  });

  test('re-registering same ID overwrites provider', () => {
    const p1 = new TranslationProvider('First');
    const p2 = new TranslationProvider('Second');
    registerProvider('overwrite-test', p1);
    registerProvider('overwrite-test', p2);
    expect(getProvider('overwrite-test')).toBe(p2);
    expect(getProvider('overwrite-test').name).toBe('Second');
  });
});
