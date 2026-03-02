import { jest } from '@jest/globals';
import { segmentText, batchTextNodes } from '../src/utils/segmenter.js';

describe('segmentText', () => {
  test('returns empty array for empty/null input', () => {
    expect(segmentText('')).toEqual([]);
    expect(segmentText(null)).toEqual([]);
    expect(segmentText(undefined)).toEqual([]);
  });

  test('returns empty array for text shorter than MIN_SEGMENT_LENGTH', () => {
    expect(segmentText('Hi')).toEqual([]);
    expect(segmentText('   ab   ')).toEqual([]);
  });

  test('returns single segment for text within maxLength', () => {
    const text = 'This is a normal paragraph of text that fits within the limit.';
    const result = segmentText(text, 200);
    expect(result).toEqual([text]);
  });

  test('splits long text at sentence boundaries', () => {
    const text = 'First sentence here. Second sentence here. Third sentence that is also present.';
    const result = segmentText(text, 45);
    expect(result.length).toBeGreaterThan(1);
    // Each segment should be within maxLength
    for (const seg of result) {
      expect(seg.length).toBeLessThanOrEqual(45);
    }
  });

  test('splits at paragraph boundaries when no sentence break available', () => {
    const longWord = 'a'.repeat(30);
    const text = `${longWord}\n\n${longWord}`;
    const result = segmentText(text, 35);
    expect(result.length).toBe(2);
  });

  test('handles text with only line breaks as split points', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz\nabcdefghijklmnopqrstuvwxyz';
    const result = segmentText(text, 30);
    expect(result.length).toBe(2);
  });

  test('hard breaks when no natural break point exists', () => {
    const text = 'a'.repeat(100);
    const result = segmentText(text, 40);
    expect(result.length).toBeGreaterThan(1);
  });

  test('filters out segments shorter than MIN_SEGMENT_LENGTH', () => {
    const text = 'This is a long sentence that should be kept. Hi.';
    const result = segmentText(text, 46);
    // "Hi." is too short and should be filtered out
    for (const seg of result) {
      expect(seg.length).toBeGreaterThanOrEqual(10);
    }
  });

  test('uses default maxLength of 2000', () => {
    const text = 'a'.repeat(1999);
    const result = segmentText(text);
    expect(result).toEqual([text]);
  });

  test('handles text with exclamation and question marks as break points', () => {
    const text = 'What is this! Something else? And more stuff here.';
    const result = segmentText(text, 25);
    expect(result.length).toBeGreaterThan(1);
  });
});

describe('batchTextNodes', () => {
  test('returns empty array for empty input', () => {
    expect(batchTextNodes([])).toEqual([]);
  });

  test('groups all items in one batch when total size is within limit', () => {
    const items = [
      { node: {}, text: 'Hello world' },
      { node: {}, text: 'Goodbye world' },
    ];
    const result = batchTextNodes(items, 100);
    expect(result).toEqual([items]);
  });

  test('splits into multiple batches when total exceeds maxBatchSize', () => {
    const items = [
      { node: {}, text: 'a'.repeat(50) },
      { node: {}, text: 'b'.repeat(50) },
      { node: {}, text: 'c'.repeat(50) },
    ];
    const result = batchTextNodes(items, 80);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual([items[0]]);
    expect(result[1]).toEqual([items[1]]);
    expect(result[2]).toEqual([items[2]]);
  });

  test('groups adjacent small items together', () => {
    const items = [
      { node: {}, text: 'short one' },
      { node: {}, text: 'short two' },
      { node: {}, text: 'a'.repeat(100) },
    ];
    const result = batchTextNodes(items, 50);
    expect(result.length).toBe(2);
    expect(result[0]).toEqual([items[0], items[1]]);
    expect(result[1]).toEqual([items[2]]);
  });

  test('uses default maxBatchSize of 2000', () => {
    const items = [{ node: {}, text: 'a'.repeat(1999) }];
    const result = batchTextNodes(items);
    expect(result).toEqual([items]);
  });

  test('single item larger than maxBatchSize still creates a batch', () => {
    const items = [{ node: {}, text: 'a'.repeat(200) }];
    const result = batchTextNodes(items, 50);
    expect(result).toEqual([items]);
  });
});
