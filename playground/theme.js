const storageKey = 'tflip.theme';
const browser = typeof window === 'undefined' ? undefined : window;
const page = browser?.document;
const listeners = new Set();
let media;
try { media = browser?.matchMedia?.('(prefers-color-scheme: dark)'); }
catch { /* Default to light if preference detection is unavailable. */ }

function systemTheme() {
  try { return media?.matches ? 'dark' : 'light'; }
  catch { return 'light'; }
}

function storedMode() {
  try {
    const saved = browser?.localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* The current page still supports manual selection. */ }
  return 'auto';
}

let mode = storedMode();
let theme = mode === 'auto' ? systemTheme() : mode;
let revision = 0;

export function getTheme() { return theme; }
export function getThemeMode() { return mode; }

function updateView() {
  if (!page) return;
  const html = page.documentElement;
  html.dataset.theme = theme;
  html.dataset.themeMode = mode;
  html.style.colorScheme = theme;
  html.style.backgroundColor = theme === 'dark' ? '#101218' : '#f4f2ed';
  const meta = page.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = theme;
  const select = page.getElementById('themeSelect');
  if (select) select.value = mode;
}

function apply(nextMode) {
  const previousMode = mode, previousTheme = theme;
  mode = nextMode;
  theme = mode === 'auto' ? systemTheme() : mode;
  updateView();
  if (mode === previousMode && theme === previousTheme) return theme;
  const version = ++revision;
  const detail = Object.freeze({ theme, mode, previousTheme, previousMode });
  for (const listener of [...listeners]) {
    if (version !== revision) break;
    if (!listeners.has(listener)) continue;
    try { listener(detail); } catch (error) {
      if (typeof browser?.reportError === 'function') browser.reportError(error);
      else browser?.console.error('Theme change listener failed:', error);
    }
  }
  if (version === revision && browser?.CustomEvent) {
    browser.dispatchEvent(new browser.CustomEvent('tflip:themechange', { detail }));
  }
  return theme;
}

/** Persist only explicit user choices, never a detected system preference. */
export function setTheme(nextMode) {
  if (!['auto', 'light', 'dark'].includes(nextMode)) throw new TypeError('Theme mode must be auto, light, or dark');
  try {
    if (nextMode === 'auto') browser?.localStorage.removeItem(storageKey);
    else browser?.localStorage.setItem(storageKey, nextMode);
  } catch { /* Keep the selected mode in memory if persistence is blocked. */ }
  return apply(nextMode);
}

export function onThemeChange(callback) {
  if (typeof callback !== 'function') throw new TypeError('Theme change listener must be a function');
  listeners.add(callback);
  return () => listeners.delete(callback);
}

if (browser && page) {
  const changed = () => { if (mode === 'auto') apply('auto'); };
  if (typeof media?.addEventListener === 'function') media.addEventListener('change', changed);
  else if (typeof media?.addListener === 'function') media.addListener(changed);
  page.addEventListener('change', event => {
    if (event.target?.id === 'themeSelect' && ['auto', 'light', 'dark'].includes(event.target.value)) setTheme(event.target.value);
  });
  updateView();
  if (page.readyState === 'loading') page.addEventListener('DOMContentLoaded', updateView, { once: true });
}
