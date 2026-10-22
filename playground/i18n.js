import messages from './locales/index.js';

const storageKey = 'tflip.language';
const browser = typeof window === 'undefined' ? undefined : window;
const page = browser?.document;
const listeners = new Set();
const attributes = ['title', 'placeholder', 'content', 'alt', 'label', 'aria-label', 'aria-description', 'aria-valuetext'];
const selector = ['[data-i18n]', '[data-i18n-html]', ...attributes.map(name => `[data-i18n-${name}]`)].join(',');
let revision = 0;

function detectLanguage() {
  const preferences = [];
  try {
    if (Array.isArray(browser?.navigator.languages)) preferences.push(...browser.navigator.languages);
    if (typeof browser?.navigator.language === 'string') preferences.push(browser.navigator.language);
  } catch { /* An inaccessible preference falls back to English. */ }
  for (const preference of preferences) {
    if (typeof preference !== 'string') continue;
    const match = /^(zh|en)(?:[-_]|$)/i.exec(preference.trim());
    if (match) return match[1].toLowerCase();
  }
  return 'en';
}

function readMode() {
  try {
    const stored = browser?.localStorage.getItem(storageKey);
    if (stored === 'zh' || stored === 'en') return stored;
  } catch { /* Manual choices still work for the current page without storage. */ }
  return 'auto';
}

let mode = readMode();
let language = mode === 'auto' ? detectLanguage() : mode;

function lookup(locale, key) {
  const catalog = messages?.[locale];
  if (!catalog || typeof key !== 'string') return undefined;
  if (Object.hasOwn(catalog, key) && typeof catalog[key] === 'string') return catalog[key];
  let value = catalog;
  for (const part of key.split('.')) {
    if (!part || value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return typeof value === 'string' ? value : undefined;
}

function template(key) {
  return lookup(language, key) ?? lookup('en', key) ?? lookup('zh', key) ?? String(key);
}

function interpolate(value, params, convert = String) {
  return value.replace(/\{([\w.-]+)\}/g, (token, name) => params && Object.hasOwn(params, name) ? convert(params[name]) : token);
}

/** Translate a message without changing DOM or animation state. */
export function t(key, params = {}) { return interpolate(template(key), params); }
export function getLanguage() { return language; }
export function getLanguageMode() { return mode; }

function nodeParams(node) {
  try {
    const value = JSON.parse(node.getAttribute('data-i18n-params') || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

/** Declarative HTML messages must come from the trusted static catalog only. */
export function translateDOM(root = page) {
  if (!root) return;
  const nodes = root.matches?.(selector) ? [root] : [];
  if (root.querySelectorAll) nodes.push(...root.querySelectorAll(selector));
  for (const node of nodes) {
    const params = nodeParams(node);
    if (node.hasAttribute('data-i18n-html')) {
      const translated = interpolate(template(node.getAttribute('data-i18n-html')), params, escapeHTML);
      if (node.innerHTML !== translated) node.innerHTML = translated;
    } else if (node.hasAttribute('data-i18n')) {
      const translated = t(node.getAttribute('data-i18n'), params);
      if (node.textContent !== translated) node.textContent = translated;
    }
    for (const attribute of attributes) {
      const key = node.getAttribute(`data-i18n-${attribute}`);
      if (key === null) continue;
      const translated = t(key, params);
      if (node.getAttribute(attribute) !== translated) node.setAttribute(attribute, translated);
    }
  }
}

function translatePage() {
  if (!page) return;
  page.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  page.documentElement.dataset.language = language;
  page.documentElement.dataset.languageMode = mode;
  translateDOM(page);
  const select = page.getElementById('languageSelect');
  if (select) select.value = mode;
}

function apply(nextMode) {
  const previousMode = mode, previousLanguage = language;
  mode = nextMode;
  language = mode === 'auto' ? detectLanguage() : mode;
  translatePage();
  if (mode === previousMode && language === previousLanguage) return language;
  const currentRevision = ++revision;
  const detail = Object.freeze({ language, mode, previousLanguage, previousMode });
  for (const listener of [...listeners]) {
    if (currentRevision !== revision) break;
    if (!listeners.has(listener)) continue;
    try { listener(detail); } catch (error) {
      if (typeof browser?.reportError === 'function') browser.reportError(error);
      else browser?.console.error('Language change listener failed:', error);
    }
  }
  if (currentRevision === revision && browser?.CustomEvent) {
    browser.dispatchEvent(new browser.CustomEvent('tflip:languagechange', { detail }));
  }
  return language;
}

/** Only explicit user choices are persisted; detected browser preferences are not. */
export function setLanguage(nextMode) {
  if (!['zh', 'en', 'auto'].includes(nextMode)) throw new TypeError('Language mode must be zh, en, or auto');
  try {
    if (nextMode === 'auto') browser?.localStorage.removeItem(storageKey);
    else browser?.localStorage.setItem(storageKey, nextMode);
  } catch { /* A blocked storage write does not block the requested UI change. */ }
  return apply(nextMode);
}

export function onLanguageChange(callback) {
  if (typeof callback !== 'function') throw new TypeError('Language change listener must be a function');
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function initializeDOM() {
  try { translatePage(); } finally {
    const bootstrap = browser?.__tflipI18nBootstrap;
    if (typeof bootstrap?.release === 'function') bootstrap.release();
    else page?.documentElement.classList.remove('i18n-pending');
    if (browser) delete browser.__tflipI18nBootstrap;
  }
}

if (browser && page) {
  browser.addEventListener('languagechange', () => { if (mode === 'auto') apply('auto'); });
  page.addEventListener('change', event => {
    if (event.target?.id !== 'languageSelect') return;
    if (['zh', 'en', 'auto'].includes(event.target.value)) setLanguage(event.target.value);
  });
  if (page.readyState === 'loading') page.addEventListener('DOMContentLoaded', initializeDOM, { once: true });
  else initializeDOM();
}
