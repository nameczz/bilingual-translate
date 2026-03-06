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
const PROVIDER_TOGGLE_ID = 'bilingual-provider-toggle';
const HIDDEN_CLASS = 'bilingual-hidden';

let isTranslating = false;
let translationsHidden = false;
let settings = null;
let fab = null;
let providerToggle = null;
let lastAIProvider = null;
let mutationObserver = null;
let observerTranslateTimer = null;
let isAutoTranslating = false; // true when MutationObserver-driven translation is active
let wasStopped = false; // true after manual stop — allows resuming translation on next click

const MAX_CONCURRENCY = 3; // parallel streaming connections

let translateAbort = null;  // AbortController for stopping translation
let activePorts = new Set(); // track open streaming ports for cleanup

let intersectionObserver = null;
const paragraphMap = new WeakMap();  // blockEl -> paragraph (for IO lookup)
let lazyQueue = [];
let activeLazyCount = 0;
let pendingMutationRoots = null;

/**
 * Initialize content script.
 */
async function init() {
  settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
  if (settings?.provider && settings.provider !== 'google-translate') {
    lastAIProvider = settings.provider;
  }
  setupMessageListener();

  // Check site rules before creating FAB
  const hostname = window.location.hostname;
  if (hostname) {
    try {
      const { rule } = await chrome.runtime.sendMessage({
        action: 'checkSiteRule',
        hostname,
      });
      if (rule === 'blacklist') {
        // Site is blacklisted — don't create FAB, don't translate
        return;
      }
      if (rule === 'whitelist') {
        // Site is whitelisted — auto-translate after FAB creation
        createFAB();
        setupHoverTranslation();
        translatePage();
        return;
      }
    } catch { /* ignore, proceed normally */ }
  }

  createFAB();
  setupHoverTranslation();
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

      case 'stopTranslation':
        stopTranslation();
        sendResponse({ success: true });
        return false;

      case 'getTranslationStatus':
        sendResponse({ isTranslating: isTranslating || isLazyTranslating(), hasTranslations: hasTranslations(), translationsHidden });
        return false;

      case 'settingsUpdated':
        settings = message.settings;
        updateProviderToggleLabel();
        sendResponse({ success: true });
        return false;

      case 'getSelection': {
        const text = window.getSelection()?.toString()?.trim();
        sendResponse({ text: text || '' });
        return false;
      }
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
  createProviderToggle();
}

// ========================================
// Provider Toggle Button
// ========================================

function createProviderToggle() {
  if (document.getElementById(PROVIDER_TOGGLE_ID)) return;

  providerToggle = document.createElement('button');
  providerToggle.id = PROVIDER_TOGGLE_ID;
  providerToggle.setAttribute('aria-label', 'Switch translation provider');

  updateProviderToggleLabel();
  providerToggle.addEventListener('click', handleProviderToggleClick);
  document.body.appendChild(providerToggle);
  syncTogglePosition();
}

function updateProviderToggleLabel() {
  if (!providerToggle) return;
  const isGoogle = settings?.provider === 'google-translate';
  providerToggle.textContent = isGoogle ? 'G' : 'AI';
  providerToggle.classList.toggle('google-mode', isGoogle);
  providerToggle.classList.toggle('ai-mode', !isGoogle);
  providerToggle.title = isGoogle ? 'Using Google Translate (click for AI)' : 'Using AI (click for Google)';
}

async function handleProviderToggleClick(e) {
  e.stopPropagation();
  const isGoogle = settings?.provider === 'google-translate';

  if (isGoogle) {
    settings.provider = lastAIProvider || 'claude';
  } else {
    lastAIProvider = settings.provider;
    settings.provider = 'google-translate';
  }

  updateProviderToggleLabel();

  try {
    await chrome.runtime.sendMessage({ action: 'saveSettings', settings });
  } catch { /* ignore */ }

  if (hasTranslations()) {
    removeAllTranslations();
    translationsHidden = false;
    translatePage();
  }
}

function syncTogglePosition() {
  if (!providerToggle || !fab) return;
  const fabRight = parseInt(fab.style.right);
  const fabBottom = parseInt(fab.style.bottom);
  // Badge center sits at FAB's top-right corner
  providerToggle.style.right = (fabRight - 6) + 'px';
  providerToggle.style.bottom = (fabBottom + 36 - 6) + 'px';
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

  if (isTranslating || isLazyTranslating()) {
    stopTranslation();
    return;
  }

  if (hasTranslations() && !wasStopped) {
    // Toggle visibility instead of removing
    toggleTranslations();
  } else {
    wasStopped = false;
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
      updateFABTooltip('Translating... (click to stop)');
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

    const newRight = Math.max(8, Math.min(window.innerWidth - 44, startRight - dx));
    const newBottom = Math.max(8, Math.min(window.innerHeight - 44, startBottom - dy));

    el.style.right = newRight + 'px';
    el.style.bottom = newBottom + 'px';
    syncTogglePosition();
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
// MutationObserver for Dynamic Content
// ========================================

/**
 * Start observing DOM for new content (infinite scroll, SPA navigation, etc.)
 * Translates newly added text nodes automatically after translatePage() completes.
 */
function startObservingDOM() {
  if (mutationObserver) return;

  isAutoTranslating = true;

  mutationObserver = new MutationObserver((mutations) => {
    if (translationsHidden || !isAutoTranslating) return;

    // Collect new DOM root nodes instead of just flagging hasNewContent
    if (!pendingMutationRoots) pendingMutationRoots = new Set();

    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE &&
              !node.classList?.contains(TRANSLATION_CLASS) &&
              !node.closest?.(`#${FAB_ID}, #${PROGRESS_BAR_ID}, #${PROVIDER_TOGGLE_ID}, .bilingual-hover-tooltip, .bilingual-popup`)) {
            pendingMutationRoots.add(node);
          }
        }
      }
    }

    if (pendingMutationRoots.size === 0) return;

    // Debounce: wait for DOM to settle, then translate only new subtrees
    clearTimeout(observerTranslateTimer);
    observerTranslateTimer = setTimeout(() => {
      const roots = pendingMutationRoots;
      pendingMutationRoots = null;
      translateNewContent(roots);
    }, 800);
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

/**
 * Stop observing DOM changes.
 */
function stopObservingDOM() {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
  isAutoTranslating = false;
  clearTimeout(observerTranslateTimer);
}

/**
 * Translate only newly added (untranslated) content on the page.
 * Called by the MutationObserver when new DOM nodes appear.
 * @param {Set<Element>} [roots] - specific DOM subtrees to scan; falls back to document.body
 */
async function translateNewContent(roots) {
  if (isTranslating) return;

  let rawParagraphs = [];

  if (roots && roots.size > 0) {
    // Only traverse the newly added subtrees — not the whole document
    for (const root of roots) {
      if (!root.isConnected) continue; // node may have been removed already
      const paras = extractParagraphs(root);
      rawParagraphs.push(...paras);
    }
  } else {
    // Fallback for SPA navigation or cases where roots aren't available
    rawParagraphs = extractParagraphs(document.body);
  }

  if (rawParagraphs.length === 0) return;

  isTranslating = true;
  translateAbort = new AbortController();
  const signal = translateAbort.signal;

  try {
    const { eager, lazy } = categorizeAndSort(rawParagraphs);

    if (eager.length > 0) {
      await runWithConcurrency(
        eager,
        MAX_CONCURRENCY,
        (para) => translateParagraphStreaming(para),
        undefined,
        signal,
      );
    }

    if (signal.aborted) return;

    setupLazyTranslation(lazy);
  } finally {
    if (!signal.aborted) {
      isTranslating = false;
    }
  }
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

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'ARTICLE', 'SECTION', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION', 'DD', 'DT',
]);

/**
 * Find the nearest block-level ancestor of a node.
 */
function getBlockAncestor(node) {
  let el = node.parentElement;
  while (el && el !== document.body) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return node.parentElement || document.body;
}

/**
 * Group text nodes by their block-level ancestor (paragraph grouping).
 * Returns an array of { blockEl, nodes: [{node, text}] } in DOM order.
 */
function extractParagraphs(root) {
  const textNodes = extractTextNodes(root);
  if (textNodes.length === 0) return [];

  const groups = [];
  const blockMap = new Map();

  for (const item of textNodes) {
    const block = getBlockAncestor(item.node);
    if (!blockMap.has(block)) {
      const group = { blockEl: block, nodes: [] };
      blockMap.set(block, group);
      groups.push(group);
    }
    blockMap.get(block).nodes.push(item);
  }

  return groups;
}

/**
 * Translate a single paragraph group using streaming.
 * Shows translation character-by-character as it arrives.
 */
function translateParagraphStreaming(paragraph) {
  return new Promise((resolve, reject) => {
    // If translation was aborted, resolve immediately
    if (translateAbort?.signal.aborted) {
      resolve();
      return;
    }

    const { nodes } = paragraph;
    const fullText = nodes.map(n => n.text).join(' ');

    // Skip if text is already in the target language
    if (isLikelyTargetLang(fullText)) {
      resolve();
      return;
    }

    // Create translation element
    const firstNode = nodes[0].node;
    const parent = firstNode.parentElement;
    if (!parent || parent.hasAttribute(TRANSLATED_ATTR)) {
      resolve();
      return;
    }

    const blockEl = paragraph.blockEl;
    blockEl.setAttribute(TRANSLATED_ATTR, 'true');

    const translationEl = document.createElement('span');
    translationEl.className = TRANSLATION_CLASS;
    translationEl.classList.add('streaming');

    const isTranslationOnly = settings?.translationOnly === true;
    const isInline = !isTranslationOnly && shouldDisplayInline(blockEl, fullText);
    if (isInline) translationEl.classList.add('bilingual-side');
    if (isTranslationOnly) translationEl.classList.add('translation-only');
    if (settings?.colorTranslation === false) translationEl.classList.add('no-color');
    if (settings?.translationFontSize && settings.translationFontSize !== 90) {
      translationEl.style.fontSize = (settings.translationFontSize / 100) + 'em';
    }

    if (isInline) {
      blockEl.appendChild(translationEl);
    } else if (blockEl.nextSibling) {
      blockEl.parentNode.insertBefore(translationEl, blockEl.nextSibling);
    } else {
      blockEl.parentNode.appendChild(translationEl);
    }

    if (isTranslationOnly) {
      blockEl.setAttribute('data-bilingual-original-hidden', 'true');
    }

    for (const item of nodes) {
      const p = item.node.parentElement;
      if (p && p !== blockEl) p.setAttribute(TRANSLATED_ATTR, 'true');
    }

    // Stream translation
    const port = chrome.runtime.connect({ name: 'translate-stream' });
    activePorts.add(port);
    let accumulated = '';
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      activePorts.delete(port);
      translationEl.classList.remove('streaming', 'has-content');
      translationEl.classList.add('stream-done');
      resolve();
    };

    port.onMessage.addListener((msg) => {
      if (msg.type === 'chunk') {
        accumulated += msg.text;
        translationEl.textContent = accumulated;
        if (!translationEl.classList.contains('has-content')) {
          translationEl.classList.add('has-content');
        }
      } else if (msg.type === 'done') {
        port.disconnect();
        finish();
      } else if (msg.type === 'error') {
        console.error('[Bilingual Translate] Stream error:', msg.error || msg);
        port.disconnect();
        // Fallback: use non-streaming
        translateParagraphFallback(paragraph, translationEl)
          .then(finish)
          .catch((err) => { console.error('[Bilingual Translate] Fallback also failed:', err); translationEl.textContent = 'Translation failed'; finish(); });
      }
    });

    port.onDisconnect.addListener(() => {
      if (!accumulated && !settled) {
        // Port disconnected without data — fallback
        translateParagraphFallback(paragraph, translationEl)
          .then(finish)
          .catch((err) => { console.error('[Bilingual Translate] Fallback failed after disconnect:', err); translationEl.textContent = 'Translation failed'; finish(); });
      } else {
        finish();
      }
    });

    port.postMessage({ action: 'translateStream', text: fullText });
  });
}

/**
 * Fallback: translate paragraph via regular (non-streaming) API.
 */
async function translateParagraphFallback(paragraph, translationEl) {
  const fullText = paragraph.nodes.map(n => n.text).join(' ');
  const response = await chrome.runtime.sendMessage({
    action: 'translate',
    text: fullText,
  });
  if (response.error) {
    throw new Error(response.error);
  }
  translationEl.textContent = response.translatedText;
}

/**
 * Lightweight script-based check: is this text likely already in the target language?
 * Works by comparing the dominant Unicode script of the text against the expected
 * script for settings.targetLang.  Only triggers for script families that uniquely
 * identify a language (CJK → zh, Kana → ja, Hangul → ko, Cyrillic, Arabic, Thai…).
 * Returns false for Latin-target languages (en/fr/de/es…) because script alone
 * can't distinguish them.
 */
function isLikelyTargetLang(text) {
  const target = settings?.targetLang;
  if (!target) return false;

  // Strip spaces, digits, punctuation, symbols — keep only "letter" characters
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (letters.length < 8) return false; // too short to judge

  const total = letters.length;
  const THRESHOLD = 0.7;

  const count = (regex) => (letters.match(regex) || []).length;

  if (target.startsWith('zh')) {
    return count(/[\u4e00-\u9fff\u3400-\u4dbf]/g) / total > THRESHOLD;
  }
  if (target === 'ja') {
    return count(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) / total > THRESHOLD;
  }
  if (target === 'ko') {
    return count(/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/g) / total > THRESHOLD;
  }
  if (['ru', 'uk', 'bg', 'sr', 'be'].includes(target)) {
    return count(/[\u0400-\u04ff]/g) / total > THRESHOLD;
  }
  if (['ar', 'fa', 'ur'].includes(target)) {
    return count(/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/g) / total > THRESHOLD;
  }
  if (target === 'th') {
    return count(/[\u0e00-\u0e7f]/g) / total > THRESHOLD;
  }
  if (target === 'hi' || target === 'mr' || target === 'ne') {
    return count(/[\u0900-\u097f]/g) / total > THRESHOLD;
  }
  // Latin-script languages — can't distinguish by script alone, always translate
  return false;
}

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const INLINE_CHAR_LIMIT = 60;

/**
 * Determine if translation should display inline (side-by-side) or as a block below.
 * Headings and short single-line text → inline.
 * Paragraphs and long text → block below.
 */
function shouldDisplayInline(blockEl, text) {
  if (HEADING_TAGS.has(blockEl.tagName)) return true;
  if (text.length <= INLINE_CHAR_LIMIT && !text.includes('\n')) return true;
  return false;
}

/**
 * Find the nearest container ancestor of an element.
 * Used to prevent merging paragraphs from different semantic containers
 * (e.g., different tweets, different comments).
 */
function getContainerAncestor(el) {
  const CONTAINER_TAGS = new Set(['ARTICLE', 'SECTION', 'MAIN', 'ASIDE', 'NAV', 'HEADER', 'FOOTER']);
  let node = el;
  while (node && node !== document.body) {
    if (CONTAINER_TAGS.has(node.tagName) || node.getAttribute('role')) return node;
    node = node.parentElement;
  }
  return document.body;
}

/**
 * Determine translation priority for a block element.
 * HIGH (0) = main content — translated first.
 * MEDIUM (1) = default.
 * LOW (2) = chrome/nav — translated last.
 */
function getTranslationPriority(blockEl) {
  const HIGH_TAGS = new Set(['ARTICLE', 'MAIN']);
  const LOW_TAGS = new Set(['NAV', 'ASIDE', 'FOOTER']);

  let el = blockEl;
  while (el && el !== document.body) {
    if (HIGH_TAGS.has(el.tagName) || el.getAttribute('role') === 'main') return 0;
    if (LOW_TAGS.has(el.tagName) ||
        el.getAttribute('role') === 'navigation' ||
        el.getAttribute('role') === 'menu') return 2;
    el = el.parentElement;
  }
  return 1;
}

/**
 * Categorize paragraphs by viewport proximity and semantic priority.
 * Returns { eager: [...], lazy: [...] }
 *  - eager = in viewport (zone 0) + within 1 screen buffer (zone 1) — translated immediately
 *  - lazy  = far from viewport (zone 2) — translated on scroll via IntersectionObserver
 * Within each group, sorted by: zone → priority → distance from viewport center.
 */
function categorizeAndSort(paragraphs) {
  const vh = window.innerHeight;
  const vpTop = window.scrollY;
  const vpBottom = vpTop + vh;
  const vpCenter = vpTop + vh / 2;

  const scored = paragraphs.map((para, i) => {
    const rect = para.blockEl.getBoundingClientRect();
    const absTop = rect.top + window.scrollY;
    const absBottom = rect.bottom + window.scrollY;
    const elCenter = (absTop + absBottom) / 2;

    let zone;
    if (absBottom >= vpTop && absTop <= vpBottom) {
      zone = 0; // in viewport
    } else if (absBottom >= vpTop - vh && absTop <= vpBottom + vh) {
      zone = 1; // within 1-screen buffer
    } else {
      zone = 2; // far away
    }

    return {
      para,
      zone,
      priority: getTranslationPriority(para.blockEl),
      distance: Math.abs(elCenter - vpCenter),
      order: i,
    };
  });

  // Sort: priority first (content before nav), then zone, then distance
  scored.sort((a, b) => a.priority - b.priority || a.zone - b.zone || a.distance - b.distance);

  const eager = [];
  const lazy = [];
  for (const item of scored) {
    // High-priority content (article/main) always eager, even if off-screen
    if (item.zone <= 1 || item.priority === 0) {
      eager.push(item.para);
    } else {
      lazy.push(item.para);
    }
  }

  return { eager, lazy };
}

// ========================================
// Lazy (Viewport-Driven) Translation
// ========================================

/**
 * Set up IntersectionObserver-based lazy translation for off-screen paragraphs.
 * When a lazy paragraph scrolls into view (with 300px margin), it's queued for translation.
 */
function setupLazyTranslation(paragraphs) {
  if (paragraphs.length === 0) return;

  cleanupLazyTranslation();

  // Register each paragraph's blockEl in the WeakMap for IO callback lookup
  for (const para of paragraphs) {
    paragraphMap.set(para.blockEl, para);
  }

  intersectionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const para = paragraphMap.get(entry.target);
      if (!para) continue;

      // Stop observing — translate only once
      intersectionObserver.unobserve(entry.target);
      paragraphMap.delete(entry.target);

      // Add to lazy queue and kick processing
      lazyQueue.push(para);
      processLazyQueue();
    }
  }, {
    rootMargin: '300px',
  });

  for (const para of paragraphs) {
    intersectionObserver.observe(para.blockEl);
  }
}

/**
 * Self-driving queue processor for lazy paragraphs.
 * Translates up to MAX_CONCURRENCY paragraphs in parallel;
 * as each finishes, the next one is pulled from the queue automatically.
 */
function processLazyQueue() {
  while (activeLazyCount < MAX_CONCURRENCY && lazyQueue.length > 0) {
    const para = lazyQueue.shift();
    activeLazyCount++;

    // Show loading state when lazy translation is active
    if (activeLazyCount === 1) updateFABState('loading');

    translateParagraphStreaming(para)
      .catch(err => console.error('[Bilingual Translate] Lazy paragraph error:', err))
      .finally(() => {
        activeLazyCount--;
        // Restore active state when all lazy work is done
        if (activeLazyCount === 0 && lazyQueue.length === 0) {
          updateFABState('active');
        }
        processLazyQueue();
      });
  }
}

/**
 * Check if lazy translation is currently active.
 */
function isLazyTranslating() {
  return activeLazyCount > 0 || lazyQueue.length > 0 || intersectionObserver !== null;
}

/**
 * Clean up lazy translation state: disconnect IO, clear queue.
 */
function cleanupLazyTranslation() {
  if (intersectionObserver) {
    intersectionObserver.disconnect();
    intersectionObserver = null;
  }
  lazyQueue = [];
  activeLazyCount = 0;
}

/**
 * Stop all in-progress translation (eager + lazy + streaming).
 * Already-completed translations are preserved on the page.
 */
function stopTranslation() {
  // 1. Trigger abort signal — runWithConcurrency workers stop taking new tasks
  if (translateAbort) {
    translateAbort.abort();
    translateAbort = null;
  }

  // 2. Disconnect all open streaming ports
  for (const port of activePorts) {
    try { port.disconnect(); } catch {}
  }
  activePorts.clear();

  // 3. Clean up lazy translation queue
  cleanupLazyTranslation();

  // 4. Reset state
  isTranslating = false;
  wasStopped = true;
  hideProgressBar();
  updateFABState('idle');
}

/**
 * Run an array of async tasks with concurrency limit.
 * @param {Array} items
 * @param {number} concurrency
 * @param {function} fn - async (item, index) => void
 * @param {function} [onProgress] - (completed) => void
 */
async function runWithConcurrency(items, concurrency, fn, onProgress, signal) {
  let next = 0;
  let completed = 0;

  async function worker() {
    while (next < items.length) {
      if (signal?.aborted) return;
      const idx = next++;
      try {
        await fn(items[idx], idx);
      } catch (err) {
        console.error('[Bilingual Translate] Paragraph error:', err);
      }
      completed++;
      onProgress?.(completed);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

/**
 * Translate the entire page content, paragraph by paragraph with concurrency.
 */
async function translatePage() {
  if (isTranslating) return;
  isTranslating = true;
  translateAbort = new AbortController();
  const signal = translateAbort.signal;
  translationsHidden = false;
  updateFABState('loading');

  try {
    const rawParagraphs = extractParagraphs(document.body);
    if (rawParagraphs.length === 0) {
      updateFABState('idle');
      return;
    }

    const { eager, lazy } = categorizeAndSort(rawParagraphs);

    // Progress bar tracks only eager (viewport) content for fast perceived completion
    if (eager.length > 0) {
      showProgressBar();
      updateProgressBar(0, eager.length);

      await runWithConcurrency(
        eager,
        MAX_CONCURRENCY,
        (para) => translateParagraphStreaming(para),
        (done) => updateProgressBar(done, eager.length),
        signal,
      );
    }

    // If aborted during eager phase, don't continue to lazy
    if (signal.aborted) return;

    // Off-screen content is translated lazily as user scrolls
    setupLazyTranslation(lazy);

    hideProgressBar();
    wasStopped = false;
    updateFABState(hasTranslations() ? 'active' : 'idle');

    // Start watching for dynamically loaded content (infinite scroll, SPA, etc.)
    if (hasTranslations()) {
      startObservingDOM();
    }
  } finally {
    if (!signal.aborted) {
      isTranslating = false;
    }
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
        // Skip extension UI elements
        if (parent.closest(`#${FAB_ID}, #${PROGRESS_BAR_ID}, #${PROVIDER_TOGGLE_ID}, .bilingual-hover-tooltip, .bilingual-popup, .bilingual-toast`)) return NodeFilter.FILTER_REJECT;
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
 * Insert a bilingual translation element after the original text node.
 */
function insertTranslation(textNode, translatedText) {
  const parent = textNode.parentElement;
  if (!parent || parent.hasAttribute(TRANSLATED_ATTR)) return;

  parent.setAttribute(TRANSLATED_ATTR, 'true');

  const translationEl = document.createElement('span');
  translationEl.className = TRANSLATION_CLASS;

  const isTranslationOnly = settings?.translationOnly === true;
  const text = textNode.textContent.trim();
  const isInline = !isTranslationOnly && shouldDisplayInline(parent, text);
  if (isInline) translationEl.classList.add('bilingual-side');
  if (isTranslationOnly) translationEl.classList.add('translation-only');

  if (settings?.colorTranslation === false) {
    translationEl.classList.add('no-color');
  }
  if (settings?.smoothAnimations === false) {
    translationEl.classList.add('no-anim');
  }
  if (settings?.translationFontSize && settings.translationFontSize !== 90) {
    translationEl.style.fontSize = (settings.translationFontSize / 100) + 'em';
  }

  translationEl.textContent = translatedText;

  // Inline → append inside parent; block → insert after parent
  if (isInline) {
    parent.appendChild(translationEl);
  } else if (parent.nextSibling) {
    parent.parentNode.insertBefore(translationEl, parent.nextSibling);
  } else {
    parent.parentNode.appendChild(translationEl);
  }

  // Hide original in translation-only mode
  if (isTranslationOnly) {
    parent.setAttribute('data-bilingual-original-hidden', 'true');
  }
}

/**
 * Remove all translations from the page.
 */
function removeAllTranslations() {
  // Stop any in-progress translation first
  if (translateAbort) {
    translateAbort.abort();
    translateAbort = null;
  }
  for (const port of activePorts) {
    try { port.disconnect(); } catch {}
  }
  activePorts.clear();
  isTranslating = false;

  stopObservingDOM();
  cleanupLazyTranslation();
  document.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach(el => el.remove());
  document.querySelectorAll(`[${TRANSLATED_ATTR}]`).forEach(el => {
    el.removeAttribute(TRANSLATED_ATTR);
  });
  // Restore hidden originals from translation-only mode
  document.querySelectorAll('[data-bilingual-original-hidden]').forEach(el => {
    el.removeAttribute('data-bilingual-original-hidden');
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

// ========================================
// Hover Translation Tooltip
// ========================================

let hoverTooltip = null;
let hoverTimeout = null;

function setupHoverTranslation() {
  document.addEventListener('mouseup', (e) => {
    // Ignore clicks on our own UI
    if (e.target.closest(`#${FAB_ID}, .bilingual-popup, .bilingual-hover-tooltip`)) return;

    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString()?.trim();
      if (!text || text.length < 2 || text.length > 500) return;

      // Don't translate if selection is inside our translation elements
      const anchorEl = selection.anchorNode?.parentElement;
      if (anchorEl?.closest(`.${TRANSLATION_CLASS}`)) return;

      showHoverTooltip(text, e.clientX, e.clientY);
    }, 300);
  });

  // Dismiss tooltip on click outside
  document.addEventListener('mousedown', (e) => {
    if (hoverTooltip && !hoverTooltip.contains(e.target)) {
      dismissHoverTooltip();
    }
  });
}

async function showHoverTooltip(text, x, y) {
  dismissHoverTooltip();

  // Create tooltip immediately with loading state
  hoverTooltip = document.createElement('div');
  hoverTooltip.className = 'bilingual-hover-tooltip';

  hoverTooltip.innerHTML = `
    <div class="tooltip-source">TRANSLATION</div>
    <div class="tooltip-text" style="opacity: 0.5;">Translating...</div>
  `;

  // Position: prefer below cursor, flip if not enough space
  const tooltipWidth = 320;
  const left = Math.min(x, window.innerWidth - tooltipWidth - 16);
  hoverTooltip.style.left = `${Math.max(8, left)}px`;

  if (y + 40 + 100 > window.innerHeight) {
    hoverTooltip.style.bottom = `${window.innerHeight - y + 8}px`;
    hoverTooltip.classList.add('arrow-top');
  } else {
    hoverTooltip.style.top = `${y + 16}px`;
  }

  document.body.appendChild(hoverTooltip);

  // Try streaming first, fallback to regular translation
  try {
    const tooltipText = hoverTooltip.querySelector('.tooltip-text');
    const port = chrome.runtime.connect({ name: 'translate-stream' });
    let fullText = '';
    let didFallback = false;

    port.onMessage.addListener((msg) => {
      if (msg.type === 'chunk') {
        fullText += msg.text;
        if (tooltipText) {
          tooltipText.style.opacity = '1';
          tooltipText.textContent = fullText;
        }
      } else if (msg.type === 'done') {
        port.disconnect();
      } else if (msg.type === 'error') {
        // Fallback to regular translation
        didFallback = true;
        port.disconnect();
        fallbackTranslateTooltip(text, tooltipText);
      }
    });

    port.onDisconnect.addListener(() => {
      // If no text was received and we haven't already triggered fallback
      if (!fullText && !didFallback && tooltipText) {
        fallbackTranslateTooltip(text, tooltipText);
      }
    });

    port.postMessage({ action: 'translateStream', text });
  } catch {
    // Streaming not available, use regular translation
    const tooltipText = hoverTooltip?.querySelector('.tooltip-text');
    if (tooltipText) {
      fallbackTranslateTooltip(text, tooltipText);
    }
  }
}

async function fallbackTranslateTooltip(text, tooltipText) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'translate',
      text,
    });
    if (response.error) {
      tooltipText.textContent = 'Translation failed';
    } else {
      tooltipText.style.opacity = '1';
      tooltipText.textContent = response.translatedText;
    }
  } catch {
    tooltipText.textContent = 'Translation failed';
  }
}

function dismissHoverTooltip() {
  if (hoverTooltip) {
    hoverTooltip.remove();
    hoverTooltip = null;
  }
}

// ========================================
// SPA Navigation Detection
// ========================================

/**
 * Detect SPA page navigation (URL changes without full reload).
 * When detected, clear old translations and re-translate if auto-translating.
 */
function setupSPANavigationDetection() {
  let lastUrl = location.href;

  // Watch for URL changes via popstate (back/forward) and pushState/replaceState
  const onNavigate = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    handleSPANavigation();
  };

  window.addEventListener('popstate', onNavigate);

  // Patch pushState and replaceState to detect programmatic navigation
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function (...args) {
    origPushState.apply(this, args);
    onNavigate();
  };
  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    onNavigate();
  };
}

/**
 * Handle SPA navigation: clean up old translations, re-translate if active.
 */
function handleSPANavigation() {
  const wasAutoTranslating = isAutoTranslating;

  // Clean up old state
  isTranslating = false;
  removeAllTranslations();

  // If we were auto-translating, wait for new content to load then re-translate
  if (wasAutoTranslating) {
    setTimeout(() => {
      translatePage();
    }, 500);
  }
}

// Initialize
setupSPANavigationDetection();
init();
