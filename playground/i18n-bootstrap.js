(function bootstrapLanguage() {
  'use strict';
  var storageKey = 'tflip.language';
  var mode = 'auto';
  try {
    var saved = window.localStorage.getItem(storageKey);
    if (saved === 'zh' || saved === 'en') mode = saved;
  } catch (_) { /* Storage can be unavailable in private or embedded contexts. */ }

  function detectLanguage() {
    var languages = [];
    try {
      if (Array.isArray(navigator.languages)) languages = navigator.languages.slice();
      if (typeof navigator.language === 'string') languages.push(navigator.language);
    } catch (_) { /* The English fallback remains available. */ }
    for (var i = 0; i < languages.length; i++) {
      if (typeof languages[i] !== 'string') continue;
      var match = /^(zh|en)(?:[-_]|$)/i.exec(languages[i].trim());
      if (match) return match[1].toLowerCase();
    }
    return 'en';
  }

  var language = mode === 'auto' ? detectLanguage() : mode;
  var html = document.documentElement;
  html.lang = language === 'zh' ? 'zh-CN' : 'en';
  html.dataset.language = language;
  html.dataset.languageMode = mode;

  // A failed module request must not leave the static page permanently hidden.
  // No-JS pages never execute this bootstrap and therefore never gain the gate.
  var style = document.createElement('style');
  style.id = 'tflip-i18n-gate';
  style.textContent = 'html.i18n-pending body{visibility:hidden;animation:tflip-i18n-reveal 0s 3s forwards}@keyframes tflip-i18n-reveal{to{visibility:visible}}';
  var timeout;
  function release() {
    window.clearTimeout(timeout);
    html.classList.remove('i18n-pending');
    style.remove();
  }
  timeout = window.setTimeout(release, 2500);
  window.__tflipI18nBootstrap = { language: language, mode: mode, release: release };
  document.head.appendChild(style);
  html.classList.add('i18n-pending');
}());
