(function bootstrapTheme() {
  'use strict';
  var mode = 'auto';
  try {
    var saved = window.localStorage.getItem('tflip.theme');
    if (saved === 'light' || saved === 'dark') mode = saved;
  } catch (_) { /* A denied preference store does not block first paint. */ }

  var dark = false;
  try { dark = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
  catch (_) { /* Light is the fallback when system preference is unavailable. */ }
  var theme = mode === 'auto' ? (dark ? 'dark' : 'light') : mode;
  var html = document.documentElement;
  html.dataset.theme = theme;
  html.dataset.themeMode = mode;
  html.style.colorScheme = theme;
  // Match theme.css while its request is still pending. No visibility gate is
  // needed: a failed module must leave the document readable immediately.
  html.style.backgroundColor = theme === 'dark' ? '#101218' : '#f4f2ed';

  function syncMeta() {
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = html.dataset.theme;
  }
  syncMeta();
  // Also handle a host placing the metadata after this blocking head script.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncMeta, { once: true });
}());
