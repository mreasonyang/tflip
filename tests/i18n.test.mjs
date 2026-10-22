import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const engineSource = await readFile(new URL('../playground/i18n.js', import.meta.url), 'utf8');
const bootstrapSource = await readFile(new URL('../playground/i18n-bootstrap.js', import.meta.url), 'utf8');
const catalog = {
  zh: { title: '动效实验室', description: '调整动作', hello: '你好，{name}', label: '播放', placeholder: '输入文本', html: '<strong>你好</strong> {name}', onlyZh: '中文后备', nested: { value: '嵌套' } },
  en: { title: 'Motion playground', description: 'Tune motion', hello: 'Hello, {name}', label: 'Play', placeholder: 'Enter text', html: '<strong>Hello</strong> {name}', onlyEn: 'English fallback', nested: { value: 'Nested' } },
};
const markup = '<!doctype html><html lang="zh-CN"><head><title data-i18n="title">原始标题</title><meta name="description" data-i18n-content="description" content="原始描述"></head><body><select id="languageSelect"><option value="auto">Auto</option><option value="zh">中文</option><option value="en">English</option></select><button id="play" data-i18n="label" data-i18n-title="label" data-i18n-aria-label="label">播放</button><input id="input" data-i18n-placeholder="placeholder"><p id="hello" data-i18n="hello" data-i18n-params=\'{"name":"Ada"}\'>你好</p><p id="rich" data-i18n-html="html"></p></body></html>';

async function setup(t, { languages = ['en-US'], language = languages[0] ?? 'en-US', saved, blocked = false, bootstrap = true, load = true } = {}) {
  const dom = new JSDOM(markup, { url: 'https://tflip.test/', runScripts: 'outside-only' });
  const { window } = dom;
  let preferences = languages, fallback = language;
  Object.defineProperty(window.navigator, 'languages', { get: () => preferences, configurable: true });
  Object.defineProperty(window.navigator, 'language', { get: () => fallback, configurable: true });
  const writes = [];
  const values = new Map(saved === undefined ? [] : [['tflip.language', saved]]);
  Object.defineProperty(window, 'localStorage', { configurable: true, get() {
    if (blocked) throw new window.DOMException('Storage unavailable', 'SecurityError');
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push(['set', key, value]); values.set(key, value); }, removeItem: key => { writes.push(['remove', key]); values.delete(key); } };
  } });
  const timers = new Map(); let timerId = 0;
  window.setTimeout = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
  window.clearTimeout = id => timers.delete(id);
  t.after(() => window.close());
  if (bootstrap) window.eval(bootstrapSource);
  let module;
  if (load) {
    const directory = await mkdtemp(join(tmpdir(), 'tflip-i18n-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await mkdir(join(directory, 'locales'));
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await writeFile(join(directory, 'i18n.js'), engineSource);
    await writeFile(join(directory, 'locales', 'index.js'), `export default ${JSON.stringify(catalog)};`);
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true });
    try { module = await import(pathToFileURL(join(directory, 'i18n.js')).href); }
    finally {
      if (previous) Object.defineProperty(globalThis, 'window', previous);
      else delete globalThis.window;
    }
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }
  return { window, document: window.document, module, writes, values, timers,
    changeLanguages(next, nextFallback = next[0] ?? 'en-US') { preferences = next; fallback = nextFallback; window.dispatchEvent(new window.Event('languagechange')); },
  };
}

test('initial preference matching preserves browser priority and agrees with bootstrap', async t => {
  for (const [languages, language, expected] of [
    [['fr-FR', 'zh-TW', 'en-US'], 'en-US', 'zh'],
    [['en-GB', 'zh-CN'], 'zh-CN', 'en'],
    [['ZH-hans-CN'], 'en-US', 'zh'],
    [[], 'zh-HK', 'zh'],
    [['fr-FR', 'de'], 'ja', 'en'],
    [['english', 'zhang', null], 'en-AU', 'en'],
  ]) {
    await t.test(JSON.stringify(languages), async t => {
      const env = await setup(t, { languages, language });
      assert.equal(env.module.getLanguage(), expected);
      assert.equal(env.module.getLanguageMode(), 'auto');
      assert.equal(env.document.documentElement.lang, expected === 'zh' ? 'zh-CN' : 'en');
      assert.equal(env.document.documentElement.dataset.language, expected);
      assert.deepEqual(env.writes, [], 'Automatic detection is never persisted');
      assert.equal(env.document.documentElement.classList.contains('i18n-pending'), false);
    });
  }
});

test('saved manual choice wins while invalid saved values are ignored without writes', async t => {
  for (const [saved, expected, mode] of [['en', 'en', 'en'], ['zh', 'zh', 'zh'], ['fr', 'zh', 'auto'], ['auto', 'zh', 'auto'], ['', 'zh', 'auto']]) {
    await t.test(JSON.stringify(saved), async t => {
      const env = await setup(t, { languages: ['zh-CN'], saved });
      assert.equal(env.module.getLanguage(), expected);
      assert.equal(env.module.getLanguageMode(), mode);
      assert.deepEqual(env.writes, []);
      assert.equal(env.document.querySelector('#languageSelect').value, mode);
    });
  }
});

test('explicit overrides persist, auto removes the override, invalid modes change nothing', async t => {
  const env = await setup(t, { languages: ['zh-CN'] });
  const { module } = env;
  assert.equal(module.setLanguage('en'), 'en');
  assert.deepEqual(env.writes, [['set', 'tflip.language', 'en']]);
  env.changeLanguages(['zh-TW']);
  assert.equal(module.getLanguage(), 'en', 'Manual mode ignores later browser language changes');
  assert.equal(module.setLanguage('auto'), 'zh');
  assert.equal(env.values.has('tflip.language'), false);
  env.changeLanguages(['fr', 'en-AU']);
  assert.equal(module.getLanguage(), 'en');
  assert.equal(module.getLanguageMode(), 'auto');
  const before = env.writes.slice();
  for (const invalid of ['de', 'EN', '', undefined, null, 1, {}]) assert.throws(() => module.setLanguage(invalid), TypeError);
  assert.deepEqual(env.writes, before);
  assert.equal(module.getLanguage(), 'en');
  assert.equal(module.getLanguageMode(), 'auto');
});

test('storage failure leaves the language selector usable for the current page', async t => {
  const env = await setup(t, { languages: ['zh-CN'], blocked: true });
  assert.equal(env.module.getLanguage(), 'zh');
  env.module.setLanguage('en');
  assert.equal(env.module.getLanguageMode(), 'en');
  env.changeLanguages(['zh-HK']);
  assert.equal(env.module.getLanguage(), 'en');
  env.module.setLanguage('auto');
  assert.equal(env.module.getLanguage(), 'zh');
  assert.deepEqual(env.writes, []);
});

test('DOM text, metadata and accessibility attributes translate before subscribers and preserve controls', async t => {
  const env = await setup(t);
  const button = env.document.querySelector('#play'), input = env.document.querySelector('#input');
  let clicks = 0, subscriberCalls = 0;
  button.addEventListener('click', () => clicks++);
  input.value = 'User-owned value';
  const events = [];
  env.window.addEventListener('tflip:languagechange', event => events.push(event.detail));
  const off = env.module.onLanguageChange(detail => {
    subscriberCalls++;
    assert.equal(detail.language, 'zh');
    assert.equal(button.textContent, '播放');
    assert.equal(button.getAttribute('aria-label'), '播放');
    assert.equal(env.document.title, '动效实验室');
    assert.equal(env.document.querySelector('meta[name="description"]').content, '调整动作');
    assert.equal(env.document.querySelector('#languageSelect').value, 'zh');
  });
  env.module.setLanguage('zh');
  assert.equal(button, env.document.querySelector('#play'), 'Existing nodes are not rebuilt');
  button.click();
  assert.equal(clicks, 1);
  assert.equal(input.value, 'User-owned value');
  assert.equal(input.placeholder, '输入文本');
  assert.equal(button.title, '播放');
  assert.equal(env.document.querySelector('#hello').textContent, '你好，Ada');
  assert.equal(subscriberCalls, 1);
  assert.deepEqual(events[0], { language: 'zh', mode: 'zh', previousLanguage: 'en', previousMode: 'auto' });
  off();
  env.module.setLanguage('en');
  assert.equal(subscriberCalls, 1);
});

test('translation supports parameters, missing-key fallback and trusted HTML with escaped parameters', async t => {
  const env = await setup(t, { languages: ['zh'] });
  const { module, document } = env;
  assert.equal(module.t('hello', { name: 'Ada' }), '你好，Ada');
  assert.equal(module.t('hello'), '你好，{name}');
  assert.equal(module.t('onlyEn'), 'English fallback');
  assert.equal(module.t('missing.key'), 'missing.key');
  assert.equal(module.t('nested.value'), '嵌套');
  assert.equal(module.t('toString'), 'toString', 'Prototype fields are not translations');
  const rich = document.querySelector('#rich');
  rich.setAttribute('data-i18n-params', JSON.stringify({ name: '<img src=x onerror=alert(1)>' }));
  module.translateDOM(rich);
  assert.equal(rich.querySelector('strong').textContent, '你好');
  assert.equal(rich.querySelector('img'), null, 'Parameters cannot inject HTML into static rich text');
  assert.ok(rich.textContent.includes('<img src=x onerror=alert(1)>'));
  const label = document.createElement('span');
  label.dataset.i18n = 'hello'; label.dataset.i18nParams = 'malformed';
  module.translateDOM(label);
  assert.equal(label.textContent, '你好，{name}');
});

test('language selector change selects manual or automatic mode without rebuilding its options', async t => {
  const env = await setup(t, { languages: ['zh-CN'] });
  const select = env.document.querySelector('#languageSelect'), option = select.options[0];
  select.value = 'en'; select.dispatchEvent(new env.window.Event('change', { bubbles: true }));
  assert.equal(env.module.getLanguage(), 'en');
  assert.equal(env.module.getLanguageMode(), 'en');
  select.value = 'auto'; select.dispatchEvent(new env.window.Event('change', { bubbles: true }));
  assert.equal(env.module.getLanguage(), 'zh');
  assert.equal(env.module.getLanguageMode(), 'auto');
  assert.equal(select.options[0], option);
});

test('bootstrap sets initial language before body translation and fails open if the module is unavailable', async t => {
  const env = await setup(t, { languages: ['zh-HK'], load: false });
  assert.equal(env.document.documentElement.lang, 'zh-CN');
  assert.equal(env.document.documentElement.classList.contains('i18n-pending'), true);
  assert.match(env.document.querySelector('#tflip-i18n-gate').textContent, /3s forwards/);
  assert.equal(env.timers.size, 1);
  const timer = [...env.timers.values()][0];
  assert.equal(timer.delay, 2500);
  timer.callback();
  assert.equal(env.document.documentElement.classList.contains('i18n-pending'), false);
  assert.equal(env.document.querySelector('#tflip-i18n-gate'), null);
  assert.equal(env.timers.size, 0);
});

test('no-JS static markup remains visible and the engine also works without bootstrap', async t => {
  const noJS = await setup(t, { bootstrap: false, load: false });
  assert.equal(noJS.document.documentElement.classList.contains('i18n-pending'), false);
  assert.equal(noJS.document.querySelector('#tflip-i18n-gate'), null);
  const env = await setup(t, { bootstrap: false, languages: ['en'] });
  assert.equal(env.module.getLanguage(), 'en');
  assert.equal(env.document.querySelector('#play').textContent, 'Play');
});

test('one listener error does not block other subscribers and reentrant changes do not emit stale events', async t => {
  const env = await setup(t), reported = [], seen = [];
  env.window.reportError = error => reported.push(error.message);
  const offError = env.module.onLanguageChange(() => { throw new Error('subscriber fault'); });
  env.module.onLanguageChange(detail => seen.push(detail.language));
  env.module.setLanguage('zh');
  assert.deepEqual(reported, ['subscriber fault']);
  assert.deepEqual(seen, ['zh']);
  offError();
  const events = [];
  env.window.addEventListener('tflip:languagechange', event => events.push(event.detail.language));
  const offNested = env.module.onLanguageChange(detail => { if (detail.language === 'en') env.module.setLanguage('zh'); });
  env.module.setLanguage('en');
  assert.equal(env.module.getLanguage(), 'zh');
  assert.deepEqual(events, ['zh']);
  offNested();
});


test('Tflip language preference is consistent across bootstrap, persistence and reset', async t => {
  for (const [saved, expected, mode] of [[undefined, 'en', 'auto'], ['zh', 'zh', 'zh'], ['en', 'en', 'en'], ['invalid', 'en', 'auto'], ['', 'en', 'auto']]) {
    await t.test(String(saved), async t => {
      const env = await setup(t, { saved, languages: ['en-US'] });
      assert.equal(env.module.getLanguage(), expected); assert.equal(env.module.getLanguageMode(), mode);
      assert.deepEqual(env.writes, [], 'Detected preferences are not persisted');
      const boot = await setup(t, { saved, languages: ['en-US'], load: false });
      assert.equal(boot.document.documentElement.dataset.language, expected);
      env.module.setLanguage('zh'); assert.equal(env.values.get('tflip.language'), 'zh');
      env.module.setLanguage('auto'); assert.equal(env.values.has('tflip.language'), false);
    });
  }
});
