import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, testEngines } from './helpers/browser.mjs';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.THEME_PORT ?? 4197), base = `http://127.0.0.1:${port}`;
const results = `${root}/test-results/two-shot`;
const engines = testEngines('THEME_ENGINE');
const evidence = { startedAt: new Date().toISOString(), sources: {}, galleryPause: 'Gallery has no public pause control; all six are tested during running playback. Paused tests cover Stunt and Lab.' };
const progressIds = ['stuntSeek', 'progress'];

async function hashes() {
  const files = ['tests/theme.e2e.mjs'];
  async function walk(directory) {
    for (const entry of await readdir(`${root}/${directory}`, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (/\.(?:js|css|html)$/.test(entry.name)) files.push(path);
    }
  }
  await walk('playground');
  const hashes = {};
  for (const file of files.sort()) hashes[file] = createHash('sha256').update(await readFile(`${root}/${file}`)).digest('hex');
  return hashes;
}
async function save() { await writeFile(`${results}/theme-evidence.json`, JSON.stringify(evidence, null, 2) + '\n'); }
async function server() {
  const child = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = '';
  child.stderr.on('data', data => { diagnostics += data; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Theme server startup timeout')); }, 10000);
    child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { if (code) { clearTimeout(timeout); reject(new Error(diagnostics || `Server exited ${code}`)); } });
  });
  return child;
}
async function ready(page) {
  await page.waitForFunction(() => !document.documentElement.classList.contains('i18n-pending') && document.querySelectorAll('[data-demo]').length === 6 && document.querySelector('#themeSelect') && document.documentElement.dataset.theme);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => import('/playground/theme.js'));
}
async function settled(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function select(page, selector, value) { await page.locator(selector).evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); }, value); }
async function range(page, selector, value) { await page.locator(selector).evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); }, value); }
async function themeState(page) {
  return page.evaluate(async () => {
    const { getTheme, getThemeMode } = await import('/playground/theme.js');
    const { getLanguage, getLanguageMode, t } = await import('/playground/i18n.js');
    let stored; try { stored = localStorage.getItem('tflip.theme'); } catch { stored = 'blocked'; }
    return { theme: getTheme(), mode: getThemeMode(), htmlTheme: document.documentElement.dataset.theme, htmlMode: document.documentElement.dataset.themeMode, colorScheme: getComputedStyle(document.documentElement).colorScheme, select: document.querySelector('#themeSelect').value, stored, language: getLanguage(), languageMode: getLanguageMode(), themeLabel: document.querySelector('label[for="themeSelect"]')?.textContent.trim(), expectedLabel: t('ui.theme.label'), a11y: document.querySelector('#themeSelect').getAttribute('aria-label'), expectedA11y: t('ui.theme.a11y'), options: [...document.querySelector('#themeSelect').options].map(option => ({ value: option.value, text: option.textContent.trim(), expected: t(`ui.theme.${option.value}`) })) };
  });
}
async function assertTheme(page, theme, mode = 'auto') {
  const state = await themeState(page);
  assert.equal(state.theme, theme); assert.equal(state.htmlTheme, theme);
  assert.equal(state.mode, mode); assert.equal(state.htmlMode, mode); assert.equal(state.select, mode);
  assert.equal(state.colorScheme, theme, 'Native controls use the active color scheme');
  assert.equal(state.themeLabel, state.expectedLabel); assert.equal(state.a11y, state.expectedA11y);
  assert.ok(state.options.every(option => option.text === option.expected));
  return state;
}

async function surfaces(page) {
  return page.evaluate(() => {
    const selectors = ['html', '.site-header', '.roadster-feature', '.roadster-controls', '.demo-card', '.demo-info', '#lab', '#stage', '.settings-panel', '.transport-panel', '.event-panel', '.code-panel', '.code-topbar', '.site-footer'];
    const background = node => {
      for (let current = node; current; current = current.parentElement) {
        const color = getComputedStyle(current).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
      }
      return 'transparent';
    };
    return selectors.map(selector => { const node = document.querySelector(selector); if (!node) throw new Error(`Missing shell ${selector}`); const style = getComputedStyle(node); return { selector, background: background(node), color: style.color, border: style.borderTopColor }; });
  });
}

async function contrastSamples(page) {
  // Establish keyboard modality before measuring the focus-visible indicator.
  await page.keyboard.press('Tab');
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((n, i) => i === 3 ? n / 255 : n); };
    const over = (front, back) => [0, 1, 2].map(i => front[i] * front[3] + back[i] * (1 - front[3])).concat(1);
    const background = node => {
      const chain = []; for (let p = node; p; p = p.parentElement) chain.push(p);
      return chain.reverse().reduce((color, p) => over(rgba(getComputedStyle(p).backgroundColor), color), [255, 255, 255, 1]);
    };
    const luminance = color => color.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const selectors = ['.site-header nav a', '.roadster-subtitle', '#stuntStatus', '#stuntMotionNote', '.demo-description', '.demo-status', '#settingsTitle', 'label[for="height"]', '.npm-install-note', '.field-grid label', '.integration-copy p', '#codePreview', '#copyStatus', '.site-footer', 'label[for="themeSelect"]', '#themeSelect', '#languageSelect'];
    const text = selectors.map(selector => {
      const node = document.querySelector(selector), style = getComputedStyle(node), bg = background(node), fg = over(rgba(style.color), bg);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
      return { selector, text: node.textContent.trim().slice(0, 80), foreground: style.color, background: bg, ratio: ratio(fg, bg), minimum: large ? 3 : 4.5 };
    });
    const borders = ['#themeSelect', '#languageSelect', '#turns', '#direction'].map(selector => {
      const node = document.querySelector(selector), style = getComputedStyle(node), inner = background(node), outer = background(node.parentElement), border = over(rgba(style.borderTopColor), outer);
      return { selector, width: parseFloat(style.borderTopWidth), color: style.borderTopColor, innerRatio: ratio(border, inner), outerRatio: ratio(border, outer), minimum: 3 };
    });
    const focusNode = document.querySelector('#themeSelect'); focusNode.focus({ preventScroll: true });
    const style = getComputedStyle(focusNode), bg = background(focusNode.parentElement), outline = over(rgba(style.outlineColor), bg);
    return { text, borders, focus: { visible: focusNode.matches(':focus-visible'), width: parseFloat(style.outlineWidth), style: style.outlineStyle, color: style.outlineColor, ratio: ratio(outline, bg), minimum: 3 } };
  });
}

test('dark/light theme integration in Brave and WebKit', { timeout: 300000 }, async t => {
  await mkdir(results, { recursive: true }); evidence.sources = await hashes();
  for (const file of ['playground/theme-bootstrap.js', 'playground/theme.js', 'playground/theme.css']) assert.ok(evidence.sources[file], `${file} must be frozen before tests run`);
  const host = await server(); t.after(() => host.kill()); t.after(save);
  for (const engine of engines) await t.test(engine, { timeout: 145000 }, async t => {
    const browser = await launchBrowser(engine);
    t.after(() => browser.close()); evidence[engine] = { version: browser.version(), errors: [] };
    const errors = evidence[engine].errors;
    async function session({ system = 'light', saved, blocked = false, width = 1440, height = 1000, language = 'en-US', navigate = true } = {}) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'no-preference', colorScheme: system, locale: language });
      await context.addInitScript(({ saved, blocked }) => {
        if (saved !== undefined && !sessionStorage.getItem('__themeSeeded')) { localStorage.setItem('tflip.theme', saved); sessionStorage.setItem('__themeSeeded', 'true'); }
        if (blocked) Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage denied by test', 'SecurityError'); } });
      }, { saved, blocked });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400 && ['script', 'stylesheet'].includes(response.request().resourceType())) errors.push(`${response.status()} ${response.url()}`); });
      if (navigate) { await page.goto(`${base}/playground/`, { waitUntil: 'load' }); await ready(page); }
      return { context, page };
    }

    await t.test('system defaults, manual persistence, auto events, blocked and invalid storage', async () => {
      const checks = [];
      for (const system of ['light', 'dark']) {
        const { context, page } = await session({ system });
        try { const state = await assertTheme(page, system); assert.equal(state.stored, null); checks.push({ system, state }); }
        finally { await context.close(); }
      }
      const { context, page } = await session({ system: 'dark' });
      try {
        await select(page, '#themeSelect', 'light'); let state = await assertTheme(page, 'light', 'light'); assert.equal(state.stored, 'light');
        await page.reload({ waitUntil: 'load' }); await ready(page); await assertTheme(page, 'light', 'light');
        await page.emulateMedia({ colorScheme: 'light' }); await page.emulateMedia({ colorScheme: 'dark' }); await assertTheme(page, 'light', 'light');
        await select(page, '#themeSelect', 'dark'); state = await assertTheme(page, 'dark', 'dark'); assert.equal(state.stored, 'dark');
        await page.reload({ waitUntil: 'load' }); await ready(page); await assertTheme(page, 'dark', 'dark');
        await select(page, '#themeSelect', 'auto'); state = await assertTheme(page, 'dark'); assert.equal(state.stored, null);
        await page.emulateMedia({ colorScheme: 'light' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light'); await assertTheme(page, 'light');
        await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark'); await assertTheme(page, 'dark');
        checks.push({ manualLightReload: true, manualDarkReload: true, manualIgnoresSystem: true, autoClearsStorage: true, autoFollowsEvents: true });
      } finally { await context.close(); }
      for (const options of [{ blocked: true, system: 'dark' }, { saved: 'not-a-theme', system: 'light' }, { saved: 'auto', system: 'dark' }]) {
        const { context, page } = await session(options);
        try {
          await assertTheme(page, options.system);
          await select(page, '#themeSelect', options.system === 'light' ? 'dark' : 'light'); await assertTheme(page, options.system === 'light' ? 'dark' : 'light', options.system === 'light' ? 'dark' : 'light');
          await select(page, '#themeSelect', 'auto'); await assertTheme(page, options.system);
          checks.push({ options, usable: true });
        } finally { await context.close(); }
      }
      evidence[engine].preferences = checks; await save();
    });

    await t.test('theme and language stay independent, notify listeners, and preserve parameters', async () => {
      const { context, page } = await session({ language: 'zh-CN' });
      try {
        const state = await page.evaluate(async () => {
          const theme = await import('/playground/theme.js'), language = await import('/playground/i18n.js');
          const notices = []; const unsubscribe = theme.onThemeChange((...args) => notices.push({ args, theme: theme.getTheme(), mode: theme.getThemeMode() }));
          document.querySelector('#height').value = '237'; document.querySelector('#turns').value = '1.75'; document.querySelector('#speed').value = '.35';
          const params = () => [...document.querySelectorAll('#settingsForm input,#settingsForm select,#settingsForm textarea')].map(node => [node.id, node.value, node.checked]);
          const before = params(); language.setLanguage('en'); theme.setTheme('dark');
          const first = { theme: theme.getTheme(), mode: theme.getThemeMode(), language: language.getLanguage(), languageMode: language.getLanguageMode(), storedLanguage: localStorage.getItem('tflip.language'), storedTheme: localStorage.getItem('tflip.theme') };
          language.setLanguage('zh'); const afterLanguage = { theme: theme.getTheme(), mode: theme.getThemeMode() };
          theme.setTheme('light'); const afterTheme = { language: language.getLanguage(), mode: language.getLanguageMode() };
          if (typeof unsubscribe === 'function') unsubscribe();
          const count = notices.length; theme.setTheme('dark');
          return { before, after: params(), first, afterLanguage, afterTheme, notices, countAfterUnsubscribe: notices.length, unsubscribed: typeof unsubscribe === 'function' && count === notices.length };
        });
        assert.deepEqual(state.after, state.before); assert.deepEqual(state.first, { theme: 'dark', mode: 'dark', language: 'en', languageMode: 'en', storedLanguage: 'en', storedTheme: 'dark' });
        assert.deepEqual(state.afterLanguage, { theme: 'dark', mode: 'dark' }); assert.deepEqual(state.afterTheme, { language: 'zh', mode: 'zh' }); assert.ok(state.notices.length >= 2);
        evidence[engine].isolation = state; await save();
      } finally { await context.close(); }
    });

    await t.test('paused pixels and running playback identities/progress survive theme changes', async () => {
      const { context, page } = await session();
      try {
        await select(page, '#layout', 'freeze');
        await range(page, '#stuntSeek', 10000 / 13800 * 1000); await range(page, '#progress', 360); await settled(page);
        const paused = await page.evaluate(async () => {
          const { setTheme } = await import('/playground/theme.js');
          for (const canvas of document.querySelectorAll('canvas')) for (let i = 0; i < 6; i++) canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
          for (const id of ['stuntJet']) document.getElementById(id).dispatchEvent(new Event('change', { bubbles: true }));
          const canvases = [...document.querySelectorAll('canvas')], beforePixels = canvases.map(canvas => canvas.toDataURL());
          const selectors = ['#stuntCanvas', '#stuntDriver', '[data-lab-visual]', '#sourceAnchor', '#targetAnchor', ...[...document.querySelectorAll('[data-demo]')].map(card => `[data-demo="${card.dataset.demo}"]`)];
          const nodes = selectors.map(selector => document.querySelector(selector));
          const snapshot = () => ({ shot: document.querySelector('#stuntStage').dataset.shot, phase: document.querySelector('#stuntStage').dataset.phase, values: ['stuntSeek', 'progress'].map(id => document.getElementById(id).value), status: ['stuntStatus', 'playbackStatus'].map(id => document.getElementById(id).textContent) });
          const before = snapshot(); setTheme('dark'); const after = snapshot();
          const samePixels = canvases.map((canvas, i) => canvas.toDataURL() === beforePixels[i]);
          setTheme('light'); const roundTrip = canvases.map((canvas, i) => canvas.toDataURL() === beforePixels[i]);
          return { before, after, samePixels, roundTrip, identities: selectors.map((selector, i) => nodes[i] === document.querySelector(selector)), canvases: canvases.length };
        });
        assert.deepEqual(paused.after, paused.before); assert.equal(paused.before.shot, 'roadster'); assert.ok(paused.samePixels.every(Boolean) && paused.roundTrip.every(Boolean)); assert.ok(paused.identities.every(Boolean));
        await page.waitForTimeout(100); assert.deepEqual(await page.locator('#stuntSeek,#progress').evaluateAll(nodes => nodes.map(node => node.value)), paused.before.values);
        await page.evaluate(() => { ['stuntPause', 'pauseButton'].forEach(id => document.getElementById(id).click()); document.querySelectorAll('[data-demo-play]').forEach(button => button.click()); });
        await page.waitForTimeout(160);
        const running = await page.evaluate(async () => {
          const { setTheme } = await import('/playground/theme.js');
          const nodes = [...document.querySelectorAll('.demo-motion,[data-lab-visual],#stuntCanvas')], cards = [...document.querySelectorAll('[data-demo]')];
          const snapshot = () => ({ shot: document.querySelector('#stuntStage').dataset.shot, phase: document.querySelector('#stuntStage').dataset.phase, values: ['stuntSeek', 'progress'].map(id => document.getElementById(id).value), gallery: cards.map(card => card.style.getPropertyValue('--demo-progress')), transforms: nodes.map(node => node.style.transform), status: ['stuntStatus', 'playbackStatus'].map(id => document.getElementById(id).textContent), combo: document.querySelector('[data-demo-combo]').textContent });
          const before = snapshot(); setTheme('dark'); const after = snapshot(); window.__themeMotionNodes = nodes;
          return { before, after, retained: nodes.every(node => node.isConnected), allPlaying: cards.every(card => card.dataset.playing === 'true'), nodeCount: nodes.length };
        });
        assert.deepEqual(running.after, running.before); assert.equal(running.after.shot, 'roadster'); assert.ok(running.retained && running.allPlaying);
        await page.waitForTimeout(120);
        const advanced = await page.evaluate(() => ({ values: ['stuntSeek', 'progress'].map(id => Number(document.getElementById(id).value)), gallery: [...document.querySelectorAll('[data-demo]')].map(card => Number(card.style.getPropertyValue('--demo-progress'))), allPlaying: [...document.querySelectorAll('[data-demo]')].every(card => card.dataset.playing === 'true'), retained: window.__themeMotionNodes.every(node => node.isConnected) }));
        assert.ok(advanced.values.every((value, i) => value > Number(running.before.values[i]))); assert.ok(advanced.gallery.every((value, i) => value > Number(running.before.gallery[i]))); assert.ok(advanced.retained && advanced.allPlaying);
        evidence[engine].motion = { paused, running, advanced }; await save();
      } finally { await context.close(); }
    });

    await t.test('both themes restyle all UI shells; common text, borders and focus remain legible', async () => {
      const { context, page } = await session();
      try {
        const modes = {};
        for (const mode of ['light', 'dark']) {
          await select(page, '#themeSelect', mode); await settled(page);
          modes[mode] = { surfaces: await surfaces(page), contrast: await contrastSamples(page) };
        }
        evidence[engine].appearance = modes; await save();
        for (const [i, light] of modes.light.surfaces.entries()) assert.notEqual(modes.dark.surfaces[i].background, light.background, `${light.selector} must have a themed shell background`);
        for (const [mode, data] of Object.entries(modes)) {
          const failures = data.contrast.text.filter(sample => sample.ratio + .01 < sample.minimum);
          assert.deepEqual(failures, [], `${mode}: text contrast below threshold`);
          const borderFailures = data.contrast.borders.filter(sample => sample.width <= 0 || Math.max(sample.innerRatio, sample.outerRatio) + .01 < sample.minimum);
          assert.deepEqual(borderFailures, [], `${mode}: control boundary contrast below 3:1`);
          const focus = data.contrast.focus;
          assert.ok(focus.visible && focus.width >= 2 && focus.style !== 'none' && focus.ratio >= 3, `${mode}: focus indicator ${JSON.stringify(focus)}`);
        }
      } finally { await context.close(); }
    });

    await t.test('Chinese/English light/dark layouts fit 1440px and 390px and retain seven scenes/eight jets', async () => {
      const screenshots = []; evidence[engine].layouts = screenshots;
      for (const width of [1440, 390]) {
        const { context, page } = await session({ width, height: width === 390 ? 844 : 1000 });
        try {
          for (const language of ['zh', 'en']) for (const mode of ['light', 'dark']) {
            await select(page, '#languageSelect', language); await select(page, '#themeSelect', mode); await settled(page); await assertTheme(page, mode, mode);
            const layout = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, boxes: [...document.querySelectorAll('.site-header,#stuntStage,#showcaseGrid,#lab,#integration,#themeSelect,#languageSelect')].map(node => { const box = node.getBoundingClientRect(); return { id: node.id || node.className, left: box.left, right: box.right }; }), scenes: document.querySelectorAll('#stuntStage,[data-demo]').length, jets: [...document.querySelectorAll('#stuntJet,#jet,[data-demo-jet]')].map(node => node.checked) }));
            assert.ok(layout.documentWidth <= width + 1, `Document overflow: ${JSON.stringify(layout)}`); assert.ok(layout.boxes.every(box => box.left >= -1 && box.right <= width + 1), `Section overflow: ${JSON.stringify(layout)}`);
            assert.equal(layout.scenes, 7); assert.deepEqual(layout.jets, Array(8).fill(true));
            const filename = `theme-${engine}-${width}-${language}-${mode}.png`; await page.screenshot({ path: `${results}/${filename}`, fullPage: true });
            let preview;
            if (engine === 'brave' && language === 'zh') {
              await page.evaluate(() => scrollTo(0, 0)); await settled(page);
              preview = `theme-preview-${width}-zh-${mode}.png`;
              await page.screenshot({ path: `${results}/${preview}` });
            }
            screenshots.push({ width, language, theme: mode, filename, ...(preview ? { preview } : {}), layout }); await save();
          }
        } finally { await context.close(); }
      }
    });

    await t.test('synchronous bootstrap applies system or stored theme before delayed module execution', async () => {
      const checks = []; evidence[engine].firstPaint = checks;
      for (const options of [{ system: 'dark', expected: 'dark', mode: 'auto' }, { system: 'light', saved: 'dark', expected: 'dark', mode: 'dark' }, { system: 'dark', saved: 'light', expected: 'light', mode: 'light' }]) {
        const { context, page } = await session({ ...options, navigate: false });
        let release; const gate = new Promise(resolve => { release = resolve; });
        await page.route('**/playground/theme.js', async route => { await gate; await route.continue(); });
        try {
          await page.goto(`${base}/playground/`, { waitUntil: 'commit' });
          await page.waitForFunction(() => document.body && document.documentElement.dataset.theme && [...document.styleSheets].some(sheet => sheet.href?.endsWith('/theme.css')));
          const pending = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, mode: document.documentElement.dataset.themeMode, colorScheme: getComputedStyle(document.documentElement).colorScheme, background: getComputedStyle(document.documentElement).backgroundColor, language: document.documentElement.lang }));
          assert.equal(pending.theme, options.expected); assert.equal(pending.mode, options.mode); assert.equal(pending.colorScheme, options.expected);
          const filename = `theme-${engine}-bootstrap-${options.system}-${options.saved || 'auto'}.png`;
          const old = process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY; process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
          try { await page.screenshot({ path: `${results}/${filename}` }); }
          finally { if (old === undefined) delete process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY; else process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = old; }
          release(); await page.waitForLoadState('load'); await ready(page); const after = await assertTheme(page, options.expected, options.mode);
          checks.push({ options, pending, after, filename }); await save();
        } finally { release(); await context.close(); }
      }
    });
    assert.deepEqual(errors, [], 'No JavaScript errors or failed script/style loads');
  });
  evidence.completedAt = new Date().toISOString();
  assert.deepEqual(await hashes(), evidence.sources, 'Tests and screenshots must be bound to one frozen source version');
  await save();
});
