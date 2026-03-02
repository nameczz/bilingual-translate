/**
 * Text segmentation utilities for splitting webpage content into
 * translatable chunks while preserving structure.
 */

const MAX_SEGMENT_LENGTH = 2000;
const MIN_SEGMENT_LENGTH = 10;

/**
 * Split text into segments suitable for translation API calls.
 * Tries to split on sentence boundaries.
 * @param {string} text
 * @param {number} maxLength
 * @returns {string[]}
 */
export function segmentText(text, maxLength = MAX_SEGMENT_LENGTH) {
  if (!text || text.trim().length < MIN_SEGMENT_LENGTH) return [];
  if (text.length <= maxLength) return [text];

  const segments = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      segments.push(remaining);
      break;
    }

    // Try to break at sentence boundaries
    let breakIndex = findBreakPoint(remaining, maxLength);
    segments.push(remaining.slice(0, breakIndex).trim());
    remaining = remaining.slice(breakIndex).trim();
  }

  return segments.filter(s => s.length >= MIN_SEGMENT_LENGTH);
}

/**
 * Find a good break point in text, preferring sentence endings.
 */
function findBreakPoint(text, maxLength) {
  const slice = text.slice(0, maxLength);

  // Prefer breaking at sentence-ending punctuation
  const sentenceBreaks = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
  let bestBreak = -1;
  for (const brk of sentenceBreaks) {
    const idx = slice.lastIndexOf(brk);
    if (idx > bestBreak) bestBreak = idx + brk.length;
  }
  if (bestBreak > maxLength * 0.3) return bestBreak;

  // Fall back to paragraph break
  const paraBreak = slice.lastIndexOf('\n\n');
  if (paraBreak > maxLength * 0.3) return paraBreak + 2;

  // Fall back to line break
  const lineBreak = slice.lastIndexOf('\n');
  if (lineBreak > maxLength * 0.3) return lineBreak + 1;

  // Fall back to space
  const spaceBreak = slice.lastIndexOf(' ');
  if (spaceBreak > maxLength * 0.3) return spaceBreak + 1;

  // Hard break at max length
  return maxLength;
}

/**
 * Extract translatable text nodes from a DOM element.
 * Returns an array of { node, text } objects.
 * @param {Element} root
 * @returns {Array<{node: Node, text: string}>}
 */
export function extractTextNodes(root) {
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'KBD',
    'TEXTAREA', 'INPUT', 'SVG', 'MATH', 'IFRAME',
  ]);

  const results = [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[translate="no"], .notranslate')) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[data-bilingual-translated]')) return NodeFilter.FILTER_REJECT;
        const text = node.textContent.trim();
        if (text.length < MIN_SEGMENT_LENGTH) return NodeFilter.FILTER_REJECT;
        // Skip if text is only numbers/punctuation
        if (/^[\d\s\p{P}]+$/u.test(text)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node;
  while ((node = walker.nextNode())) {
    results.push({ node, text: node.textContent.trim() });
  }
  return results;
}

/**
 * Group adjacent text nodes into batches for efficient translation.
 * @param {Array<{node: Node, text: string}>} textNodes
 * @param {number} maxBatchSize
 * @returns {Array<Array<{node: Node, text: string}>>}
 */
export function batchTextNodes(textNodes, maxBatchSize = MAX_SEGMENT_LENGTH) {
  const batches = [];
  let currentBatch = [];
  let currentSize = 0;

  for (const item of textNodes) {
    if (currentSize + item.text.length > maxBatchSize && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
    currentBatch.push(item);
    currentSize += item.text.length;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}
