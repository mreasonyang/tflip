import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const bootstrapSource = await readFile(new URL('../playground/theme-bootstrap.js', import.meta.url), 'utf8');
let moduleId = 0;
const markup = '<!doctype html><html lang="zh-CN" data-language="zh" data-language-mode="auto"><head><meta name="color-scheme" content="light dark"></head><body><select id="themeSelect"><option value="auto">System</option><option value="light">Light</option><option value="dark">Dark</option></select><select id="languageSelect"><option value="zh" selected>中文</option><option value="en">English</option></select><main><button id="play">Play</button><input id="progress" type="range" min="0" max="1000" value="360"><canvas id="scene" width="320" height="200"></canvas><div id="motion" style="transform:translate(20px, 30px)"><span>Business content</span></div></main></body></html>';

async function environment(t, { dark = false, saved, blocked = false, writeBlocked = false, mediaMode = 'modern', bootstrap = true, load = true } = {}) {
  const dom = new JSDOM(markup, { url: 'https://tflip.test/', runScripts: 'outside-only' });
  const { window } = dom;
  const values = new Map([['tflip.language', 'zh']]);
  if (saved !== undefined) values.set('tflip.theme', saved);
  const writes = [];
  Object.defineProperty(window, 'localStorage', { configurable: true, get() {
    if (blocked) throw new window.DOMException('Storage unavailable', 'SecurityError');
    return {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { if (writeBlocked) throw new window.DOMException('Write unavailable', 'QuotaExceededError'); writes.push(['set', key, value]); values.set(key, value); },
      removeItem: key => { if (writeBlocked) throw new window.DOMException('Write unavailable', 'SecurityError'); writes.push(['remove', key]); values.delete(key); },
    };
  } });
  const media = new window.EventTarget(); media.matches = dark;
  const legacyListeners = new Set(), queries = [];
  if (mediaMode === 'legacy') { media.addEventListener = undefined; media.addListener = listener => legacyListeners.add(listener); }
  if (mediaMode !== 'missing') window.matchMedia = query => {
    queries.push(query);
    if (mediaMode === 'throws') throw new Error('Preference unavailable');
    return media;
  };
  t.after(() => window.close());
  const beforeNodes = [...window.document.querySelectorAll('*')];
  if (bootstrap) window.eval(bootstrapSource);
  const bootstrapState = { theme: window.document.documentElement.dataset.theme, mode: window.document.documentElement.dataset.themeMode, colorScheme: window.document.documentElement.style.colorScheme, background: window.document.documentElement.style.backgroundColor, hidden: window.document.body.hidden || window.document.documentElement.classList.contains('i18n-pending'), nodeCount: window.document.querySelectorAll('*').length };
  let module;
  if (load) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
    try { module = await import(`${new URL('../playground/theme.js', import.meta.url).href}?theme-test=${++moduleId}`); }
    finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; }
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }
  return { window, document: window.document, module, writes, values, media, queries, bootstrapState, beforeNodes,
    changeSystem(next) { media.matches = next; if (mediaMode === 'legacy') legacyListeners.forEach(listener => listener({ matches: next })); else media.dispatchEvent(new window.Event('change')); },
  };
}

function assertView(env, theme, mode) {
  assert.equal(env.module.getTheme(), theme);
  assert.equal(env.module.getThemeMode(), mode);
  const html = env.document.documentElement;
  assert.equal(html.dataset.theme, theme); assert.equal(html.dataset.themeMode, mode);
  assert.equal(html.style.colorScheme, theme);
  assert.equal(html.style.backgroundColor, theme === 'dark' ? 'rgb(16, 18, 24)' : 'rgb(244, 242, 237)');
  assert.equal(env.document.querySelector('meta[name="color-scheme"]').content, theme);
  assert.equal(env.document.querySelector('#themeSelect').value, mode);
}

test('system light and dark resolve synchronously in bootstrap and module without persisting', async t => {
  for (const dark of [false, true]) await t.test(dark ? 'dark' : 'light', async t => {
    const env = await environment(t, { dark });
    const expected = dark ? 'dark' : 'light';
    assertView(env, expected, 'auto');
    assert.equal(env.bootstrapState.theme, expected); assert.equal(env.bootstrapState.mode, 'auto');
    assert.equal(env.bootstrapState.colorScheme, expected); assert.equal(env.bootstrapState.hidden, false);
    assert.deepEqual(env.writes, []);
    assert.ok(env.queries.every(query => query === '(prefers-color-scheme: dark)'));
  });
});

test('only valid stored manual themes override the system; invalid stored values safely use auto', async t => {
  for (const [saved, expected, mode] of [['light', 'light', 'light'], ['dark', 'dark', 'dark'], ['auto', 'dark', 'auto'], ['DARK', 'dark', 'auto'], ['purple', 'dark', 'auto'], ['', 'dark', 'auto']]) {
    await t.test(JSON.stringify(saved), async t => {
      const env = await environment(t, { dark: true, saved });
      assertView(env, expected, mode);
      assert.equal(env.bootstrapState.theme, expected); assert.equal(env.bootstrapState.mode, mode);
      assert.deepEqual(env.writes, [], 'Startup does not rewrite storage');
    });
  }
});

test('manual changes persist, auto clears the override and system changes only affect auto mode', async t => {
  const env = await environment(t), changes = [];
  env.module.onThemeChange(detail => changes.push(detail));
  assert.equal(env.module.setTheme('dark'), 'dark'); assertView(env, 'dark', 'dark');
  assert.deepEqual(env.writes, [['set', 'tflip.theme', 'dark']]);
  env.changeSystem(true); env.changeSystem(false);
  assertView(env, 'dark', 'dark'); assert.equal(changes.length, 1);
  assert.equal(env.module.setTheme('auto'), 'light'); assertView(env, 'light', 'auto');
  assert.equal(env.values.has('tflip.theme'), false);
  assert.deepEqual(env.writes[1], ['remove', 'tflip.theme']);
  env.changeSystem(true); assertView(env, 'dark', 'auto');
  env.changeSystem(false); assertView(env, 'light', 'auto');
  assert.equal(env.writes.length, 2, 'System changes do not create manual overrides');
  assert.equal(env.values.get('tflip.language'), 'zh', 'Theme never writes the language preference');
});

test('invalid API modes leave view, mode and storage untouched', async t => {
  const env = await environment(t, { dark: true });
  for (const mode of [undefined, null, '', 'DARK', 'system', 'purple', 1, {}]) assert.throws(() => env.module.setTheme(mode), TypeError);
  assertView(env, 'dark', 'auto'); assert.deepEqual(env.writes, []);
  assert.throws(() => env.module.onThemeChange('callback'), TypeError);
});

test('blocked storage reads or writes do not disable session-local theme controls', async t => {
  for (const options of [{ blocked: true }, { writeBlocked: true }]) await t.test(JSON.stringify(options), async t => {
    const env = await environment(t, { ...options, dark: true });
    assertView(env, 'dark', 'auto');
    env.module.setTheme('light'); assertView(env, 'light', 'light');
    env.changeSystem(false); env.changeSystem(true); assertView(env, 'light', 'light');
    env.module.setTheme('auto'); assertView(env, 'dark', 'auto');
    assert.deepEqual(env.writes, []);
  });
});

test('unavailable matchMedia falls back to light; legacy media listeners still follow system changes', async t => {
  for (const mediaMode of ['missing', 'throws']) await t.test(mediaMode, async t => {
    const env = await environment(t, { mediaMode });
    assertView(env, 'light', 'auto'); assert.equal(env.bootstrapState.theme, 'light');
    env.module.setTheme('dark'); assertView(env, 'dark', 'dark');
  });
  await t.test('legacy', async t => {
    const env = await environment(t, { mediaMode: 'legacy' });
    env.changeSystem(true); assertView(env, 'dark', 'auto');
    env.changeSystem(false); assertView(env, 'light', 'auto');
  });
});

test('selector changes update root, metadata and native color scheme before subscribers', async t => {
  const env = await environment(t), select = env.document.querySelector('#themeSelect'), seen = [], events = [];
  env.window.addEventListener('tflip:themechange', event => events.push(event.detail));
  const off = env.module.onThemeChange(detail => { assertView(env, detail.theme, detail.mode); seen.push(detail); });
  select.value = 'dark'; select.dispatchEvent(new env.window.Event('change', { bubbles: true }));
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { theme: 'dark', mode: 'dark', previousTheme: 'light', previousMode: 'auto' });
  assert.deepEqual(events, seen);
  off(); select.value = 'auto'; select.dispatchEvent(new env.window.Event('change', { bubbles: true }));
  assertView(env, 'light', 'auto'); assert.equal(seen.length, 1);
});

test('theme changes preserve every DOM node, language state, canvas dimensions and animation-owned properties', async t => {
  const env = await environment(t), { document, module } = env;
  const button = document.querySelector('#play'), motion = document.querySelector('#motion'), canvas = document.querySelector('#scene');
  const nodes = [...document.querySelectorAll('*')], originalTransform = motion.style.transform;
  let clicks = 0; button.addEventListener('click', () => clicks++);
  for (const mode of ['dark', 'light', 'auto']) module.setTheme(mode);
  assert.deepEqual([...document.querySelectorAll('*')], nodes);
  assert.ok(env.beforeNodes.every((node, i) => node === nodes[i]), 'Bootstrap and initialization also preserve the DOM tree');
  button.click(); assert.equal(clicks, 1);
  assert.equal(motion.style.transform, originalTransform);
  assert.equal(document.querySelector('#progress').value, '360');
  assert.deepEqual([canvas.width, canvas.height], [320, 200]);
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(document.documentElement.dataset.language, 'zh');
  assert.equal(document.querySelector('#languageSelect').value, 'zh');
  assert.equal(document.body.innerHTML.includes('Business content'), true);
});

test('bootstrap does not hide the page or depend on a successful module; module can initialize alone', async t => {
  const boot = await environment(t, { dark: true, load: false });
  assert.equal(boot.document.documentElement.dataset.theme, 'dark');
  assert.equal(boot.document.documentElement.style.backgroundColor, 'rgb(16, 18, 24)');
  assert.equal(boot.document.querySelector('meta[name="color-scheme"]').content, 'dark');
  assert.equal(boot.document.body.hidden, false);
  assert.equal(boot.document.documentElement.className, '');
  assert.equal(boot.document.querySelectorAll('style').length, 0, 'No injected visibility or animation rules');
  assert.equal(boot.bootstrapState.nodeCount, boot.beforeNodes.length);
  const noJS = await environment(t, { bootstrap: false, load: false });
  assert.equal(noJS.document.documentElement.dataset.theme, undefined);
  assert.equal(noJS.document.body.hidden, false);
  const moduleOnly = await environment(t, { bootstrap: false, dark: true });
  assertView(moduleOnly, 'dark', 'auto');
});

test('listener faults are isolated and reentrant selections do not dispatch stale events', async t => {
  const env = await environment(t), reports = [], seen = [], events = [];
  env.window.reportError = error => reports.push(error.message);
  const offFault = env.module.onThemeChange(() => { throw new Error('subscriber fault'); });
  env.module.onThemeChange(detail => seen.push(detail.theme));
  env.module.setTheme('dark');
  assert.deepEqual(reports, ['subscriber fault']); assert.deepEqual(seen, ['dark']); offFault();
  env.window.addEventListener('tflip:themechange', event => events.push(event.detail.theme));
  const offNested = env.module.onThemeChange(detail => { if (detail.theme === 'light') env.module.setTheme('dark'); });
  env.module.setTheme('light');
  assertView(env, 'dark', 'dark'); assert.deepEqual(events, ['dark']); offNested();
});


test('Tflip theme preference is consistent across bootstrap, persistence and reset', async t => {
  for (const [saved, expected, mode] of [[undefined, 'light', 'auto'], ['dark', 'dark', 'dark'], ['light', 'light', 'light'], ['invalid', 'light', 'auto'], ['', 'light', 'auto']]) {
    await t.test(String(saved), async t => {
      const env = await environment(t, { saved });
      assertView(env, expected, mode);
      assert.equal(env.bootstrapState.theme, expected); assert.equal(env.bootstrapState.mode, mode);
      assert.deepEqual(env.writes, [], 'Detected preferences are not persisted');
      env.module.setTheme('dark'); assert.equal(env.values.get('tflip.theme'), 'dark');
      env.module.setTheme('auto'); assert.equal(env.values.has('tflip.theme'), false);
    });
  }
});
