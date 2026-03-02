/**
 * Content script for Bilingual Translate.
 * Handles webpage text extraction, translation display, UI injection,
 * and the floating action button (FAB).
 */

const TRANSLATED_ATTR = 'data-bilingual-translated';
const TRANSLATION_CLASS = 'bilingual-translation';
const FAB_ID = 'bilingual-fab';
const FAB_STORAGE_KEY = 'bilingual-fab-position';
const PROGRESS_BAR_ID = 'bilingual-progress-bar';
const HIDDEN_CLASS = 'bilingual-hidden';

let isTranslating = false;
let translationsHidden = false;
let settings = null;
let fab = null;

/**
 * Initialize content script.
 */
async function init() {
  settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
  setupMessageListener();
  createFAB();
}

function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'translatePage':
        translatePage().then(() => sendResponse({ success: true }))
          .catch(err => sendResponse({ error: err.message }));
        return true;

      case 'translateSelection':
        translateSelection(message.text).then(() => sendResponse({ success: true }))
          .catch(err => sendResponse({ error: err.message }));
        return true;

      case 'removeTranslations':
        removeAllTranslations();
        translationsHidden = false;
        updateFABState('idle');
        sendResponse({ success: true });
        return false;

      case 'toggleTranslations':
        toggleTranslations();
        sendResponse({ success: true, hidden: translationsHidden });
        return false;

      case 'getTranslationStatus':
        sendResponse({ isTranslating, hasTranslations: hasTranslations(), translationsHidden });
        return false;

      case 'settingsUpdated':
        settings = message.settings;
        sendResponse({ success: true });
        return false;
    }
  });
}

// ========================================
// Floating Action Button (FAB)
// ========================================

/**
 * Create and inject the floating action button.
 */
function createFAB() {
  // Don't create if already exists
  if (document.getElementById(FAB_ID)) return;

  fab = document.createElement('button');
  fab.id = FAB_ID;
  fab.setAttribute('aria-label', 'Toggle translation');

  // Icon: translate symbol (two overlapping pages with text lines)
  fab.innerHTML = `
    <div class="fab-icon">
      <svg viewBox="0 0 24 24">
        <path d="M3 5h8"/>
        <path d="M7 3v2"/>
        <path d="M4 9c0 0 1.5 4 3 4s3-4 3-4"/>
        <path d="M13 15l3-8 3 8"/>
        <path d="M14 17h4"/>
      </svg>
    </div>
    <div class="fab-tooltip">Translate this page</div>
    <div class="fab-progress">
      <svg viewBox="0 0 54 54">
        <circle class="fab-progress-track" cx="27" cy="27" r="24"/>
        <circle class="fab-progress-bar" cx="27" cy="27" r="24"/>
      </svg>
    </div>
  `;

  // Restore saved position or use default
  const savedPos = getSavedFABPosition();
  fab.style.right = savedPos.right + 'px';
  fab.style.bottom = savedPos.bottom + 'px';

  // Set initial state based on existing translations
  if (hasTranslations()) {
    fab.classList.add('active');
    updateFABTooltip('Remove translations');
  }

  // Click handler
  fab.addEventListener('click', handleFABClick);

  // Drag handlers
  setupFABDrag(fab);

  document.body.appendChild(fab);
}

/**
 * Handle FAB click — translate, toggle visibility, or show translations.
 */
async function handleFABClick(e) {
  // Ignore if this was the end of a drag
  if (fab.dataset.wasDragged === 'true') {
    fab.dataset.wasDragged = 'false';
    return;
  }

  if (isTranslating) return;

  if (hasTranslations()) {
    // Toggle visibility instead of removing
    toggleTranslations();
  } else {
    try {
      await translatePage();
    } catch (err) {
      updateFABState('error');
      showToast(`Translation failed: ${err.message}`, 'error');
      setTimeout(() => updateFABState('idle'), 3000);
    }
  }
}

/**
 * Update FAB visual state.
 */
function updateFABState(state) {
  if (!fab) return;

  fab.classList.remove('active', 'loading', 'error', 'hidden');

  switch (state) {
    case 'active':
      fab.classList.add('active');
      updateFABTooltip('Hide translations');
      break;
    case 'hidden':
      fab.classList.add('hidden');
      updateFABTooltip('Show translations');
      break;
    case 'loading':
      fab.classList.add('loading');
      updateFABTooltip('Translating...');
      break;
    case 'error':
      fab.classList.add('error');
      updateFABTooltip('Translation failed');
      break;
    default: // idle
      updateFABTooltip('Translate this page');
      break;
  }
}

/**
 * Update FAB tooltip text.
 */
function updateFABTooltip(text) {
  if (!fab) return;
  const tooltip = fab.querySelector('.fab-tooltip');
  if (tooltip) tooltip.textContent = text;
}

/**
 * Set up drag behavior for the FAB.
 */
function setupFABDrag(el) {
  let isDragging = false;
  let startX, startY, startRight, startBottom;
  const DRAG_THRESHOLD = 5;
  let hasMoved = false;

  el.addEventListener('pointerdown', (e) => {
    // Only respond to primary button
    if (e.button !== 0) return;

    isDragging = true;
    hasMoved = false;
    el.dataset.wasDragged = 'false';

    const rect = el.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startRight = window.innerWidth - rect.right;
    startBottom = window.innerHeight - rect.bottom;

    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!hasMoved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
      return;
    }

    hasMoved = true;
    el.classList.add('dragging');

    const newRight = Math.max(8, Math.min(window.innerWidth - 56, startRight - dx));
    const newBottom = Math.max(8, Math.min(window.innerHeight - 56, startBottom - dy));

    el.style.right = newRight + 'px';
    el.style.bottom = newBottom + 'px';
  });

  el.addEventListener('pointerup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    el.classList.remove('dragging');

    if (hasMoved) {
      el.dataset.wasDragged = 'true';
      // Save position
      saveFABPosition({
        right: parseInt(el.style.right),
        bottom: parseInt(el.style.bottom),
      });
    }
  });
}

/**
 * Get saved FAB position from localStorage.
 */
function getSavedFABPosition() {
  try {
    const saved = localStorage.getItem(FAB_STORAGE_KEY);
    if (saved) {
      const pos = JSON.parse(saved);
      if (typeof pos.right === 'number' && typeof pos.bottom === 'number') {
        return pos;
      }
    }
  } catch { /* ignore */ }
  return { right: 24, bottom: 24 };
}

/**
 * Save FAB position to localStorage.
 */
function saveFABPosition(pos) {
  try {
    localStorage.setItem(FAB_STORAGE_KEY, JSON.stringify(pos));
  } catch { /* ignore */ }
}

// ========================================
// Progress Bar
// ========================================

/**
 * Show the top progress bar.
 */
function showProgressBar() {
  let bar = document.getElementById(PROGRESS_BAR_ID);
  if (bar) {
    bar.style.display = 'block';
    return bar;
  }

  bar = document.createElement('div');
  bar.id = PROGRESS_BAR_ID;
  bar.innerHTML = `
    <div class="bilingual-progress-fill"></div>
    <div class="bilingual-progress-text"></div>
  `;
  document.body.appendChild(bar);
  return bar;
}

/**
 * Update progress bar value.
 */
function updateProgressBar(completed, total) {
  const bar = document.getElementById(PROGRESS_BAR_ID);
  if (!bar) return;
  const pct = Math.round((completed / total) * 100);
  const fill = bar.querySelector('.bilingual-progress-fill');
  const text = bar.querySelector('.bilingual-progress-text');
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = `Translating... ${completed}/${total}`;
}

/**
 * Hide and remove the progress bar.
 */
function hideProgressBar() {
  const bar = document.getElementById(PROGRESS_BAR_ID);
  if (!bar) return;
  bar.classList.add('bilingual-progress-done');
  setTimeout(() => bar.remove(), 600);
}

// ========================================
// Toggle Translations Visibility
// ========================================

/**
 * Toggle translation visibility (hide/show without removing).
 */
function toggleTranslations() {
  if (translationsHidden) {
    showTranslations();
  } else {
    hideTranslations();
  }
}

/**
 * Hide all translations via CSS class.
 */
function hideTranslations() {
  document.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach(el => {
    el.classList.add(HIDDEN_CLASS);
  });
  translationsHidden = true;
  updateFABState('hidden');
}

/**
 * Show all hidden translations.
 */
function showTranslations() {
  document.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach(el => {
    el.classList.remove(HIDDEN_CLASS);
  });
  translationsHidden = false;
  updateFABState('active');
}

// ========================================
// Translation Logic
// ========================================

/**
 * Translate the entire page content.
 */
async function translatePage() {
  if (isTranslating) return;
  isTranslating = true;
  translationsHidden = false;
  updateFABState('loading');

  try {
    const textNodes = extractTextNodes(document.body);
    if (textNodes.length === 0) {
      updateFABState('idle');
      return;
    }

    const batches = batchTextNodes(textNodes, 1500);
    const totalBatches = batches.length;

    showProgressBar();
    updateProgressBar(0, totalBatches);

    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
      const batch = batches[bIdx];
      const texts = batch.map(item => item.text);

      try {
        const response = await chrome.runtime.sendMessage({
          action: 'translateBatch',
          texts,
        });

        if (response.error) {
          console.error('[Bilingual Translate]', response.error);
          break;
        }

        for (let i = 0; i < batch.length; i++) {
          const { node } = batch[i];
          const translated = response.results[i]?.translatedText;
          if (translated) {
            insertTranslation(node, translated);
          }
        }
      } catch (err) {
        console.error('[Bilingual Translate] Batch error:', err);
      }

      updateProgressBar(bIdx + 1, totalBatches);
    }

    hideProgressBar();
    updateFABState(hasTranslations() ? 'active' : 'idle');
  } finally {
    isTranslating = false;
  }
}

/**
 * Translate selected text and show as a tooltip/popup.
 */
async function translateSelection(text) {
  if (!text || text.trim().length < 3) return;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'translate',
      text: text.trim(),
    });

    if (response.error) {
      showToast(`Translation error: ${response.error}`, 'error');
      return;
    }

    showSelectionPopup(response.translatedText);
  } catch (err) {
    showToast(`Translation failed: ${err.message}`, 'error');
  }
}

/**
 * Extract translatable text nodes from the DOM.
 */
function extractTextNodes(root) {
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'KBD',
    'TEXTAREA', 'INPUT', 'SVG', 'MATH', 'IFRAME',
  ]);

  const MIN_LENGTH = 10;
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
        if (parent.closest(`[${TRANSLATED_ATTR}]`)) return NodeFilter.FILTER_REJECT;
        if (parent.classList.contains(TRANSLATION_CLASS)) return NodeFilter.FILTER_REJECT;
        // Skip FAB element
        if (parent.closest(`#${FAB_ID}`)) return NodeFilter.FILTER_REJECT;
        const text = node.textContent.trim();
        if (text.length < MIN_LENGTH) return NodeFilter.FILTER_REJECT;
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
 * Group text nodes into batches for efficient translation.
 */
function batchTextNodes(textNodes, maxBatchSize) {
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

/**
 * Insert a bilingual translation element after the original text node.
 */
function insertTranslation(textNode, translatedText) {
  const parent = textNode.parentElement;
  if (!parent || parent.hasAttribute(TRANSLATED_ATTR)) return;

  parent.setAttribute(TRANSLATED_ATTR, 'true');

  const translationEl = document.createElement('span');
  translationEl.className = TRANSLATION_CLASS;

  // Apply display style setting
  const style = settings?.displayStyle || 'underline';
  if (style === 'side') {
    translationEl.classList.add('bilingual-side');
  }

  // Apply settings-based classes
  if (settings?.colorTranslation === false) {
    translationEl.classList.add('no-color');
  }
  if (settings?.smoothAnimations === false) {
    translationEl.classList.add('no-anim');
  }

  // Apply custom font size
  if (settings?.translationFontSize && settings.translationFontSize !== 90) {
    translationEl.style.fontSize = (settings.translationFontSize / 100) + 'em';
  }

  translationEl.textContent = translatedText;

  // Insert after the parent element or at the end of parent
  if (parent.nextSibling) {
    parent.parentNode.insertBefore(translationEl, parent.nextSibling);
  } else {
    parent.parentNode.appendChild(translationEl);
  }
}

/**
 * Remove all translations from the page.
 */
function removeAllTranslations() {
  document.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach(el => el.remove());
  document.querySelectorAll(`[${TRANSLATED_ATTR}]`).forEach(el => {
    el.removeAttribute(TRANSLATED_ATTR);
  });
}

/**
 * Check if translations exist on the page.
 */
function hasTranslations() {
  return document.querySelectorAll(`.${TRANSLATION_CLASS}`).length > 0;
}

/**
 * Show a selection translation popup near the cursor.
 */
function showSelectionPopup(translatedText) {
  const existing = document.getElementById('bilingual-selection-popup');
  if (existing) existing.remove();

  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  const popup = document.createElement('div');
  popup.id = 'bilingual-selection-popup';
  popup.className = 'bilingual-popup';
  popup.innerHTML = `
    <div class="bilingual-popup-content">${escapeHtml(translatedText)}</div>
    <button class="bilingual-popup-close" aria-label="Close">&times;</button>
  `;

  popup.style.position = 'fixed';
  popup.style.left = `${Math.min(rect.left, window.innerWidth - 320)}px`;
  popup.style.top = `${rect.bottom + 8}px`;
  popup.style.zIndex = '2147483647';

  document.body.appendChild(popup);

  const closeHandler = (e) => {
    if (!popup.contains(e.target)) {
      popup.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 100);

  popup.querySelector('.bilingual-popup-close').addEventListener('click', () => {
    popup.remove();
    document.removeEventListener('click', closeHandler);
  });
}

/**
 * Show a toast notification.
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `bilingual-toast bilingual-toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 80px; right: 24px; z-index: 2147483647;
    padding: 12px 20px; border-radius: 10px; font-size: 13px;
    color: white; max-width: 400px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    background: ${type === 'error' ? 'rgba(196, 83, 74, 0.92)' : 'rgba(45, 43, 41, 0.88)'};
    animation: bilingual-fade-in 0.3s ease;
    backdrop-filter: blur(8px);
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
init();
