import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, testEngines } from './helpers/browser.mjs';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.I18N_PORT ?? 4196), base = `http://127.0.0.1:${port}`;
const engines = testEngines('I18N_ENGINE');
const results = `${root}/test-results/two-shot`;
const sourceFiles = ['playground/index.html', 'playground/style.css', 'playground/i18n.css', 'playground/i18n-bootstrap.js', 'playground/i18n.js', 'playground/locales/index.js', 'playground/locales/static.js', 'playground/locales/lab.js', 'playground/locales/featured.js', 'playground/locales/showcase.js', 'playground/app.js', 'playground/stunt.js', 'playground/stunt-motion.js', 'playground/stunt-scene.js', 'playground/roadster-motion.js', 'playground/roadster-scene.js', 'playground/roadster-geometry.js', 'playground/ramp-motion.js', 'playground/ramp-scene.js', 'playground/showcase.js', 'tests/i18n.e2e.mjs'];
const evidence = { startedAt: new Date().toISOString(), sources: {} };
async function hashes() {
  const hashes = {};
  for (const file of sourceFiles) hashes[file] = createHash('sha256').update(await readFile(`${root}/${file}`)).digest('hex');
  return hashes;
}
async function save() { await writeFile(`${results}/i18n-evidence.json`, JSON.stringify(evidence, null, 2) + '\n'); }
async function server() {
  const process_ = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = '';
  process_.stderr.on('data', data => { diagnostics += data; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { process_.kill(); reject(new Error('i18n server startup timeout')); }, 10000);
    process_.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    process_.once('error', error => { clearTimeout(timeout); reject(error); });
    process_.once('exit', code => { if (code) { clearTimeout(timeout); reject(new Error(diagnostics)); } });
  });
  return process_;
}
async function ready(page) {
  await page.waitForFunction(() => !document.documentElement.classList.contains('i18n-pending') && document.querySelectorAll('[data-demo]').length === 6 && document.querySelector('#languageSelect'));
  await page.evaluate(() => document.fonts.ready);
}
async function change(page, language) {
  await page.locator('#languageSelect').evaluate((select, language) => { select.value = language; select.dispatchEvent(new Event('change', { bubbles: true })); }, language);
}
async function click(page, selector) { await page.locator(selector).evaluate(button => button.click()); }
async function setRange(page, selector, value) { await page.locator(selector).evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }, value); }
async function settled(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function languageState(page) {
  return page.evaluate(async () => {
    const { getLanguage, getLanguageMode, t } = await import('/playground/i18n.js');
    const title = document.querySelector('title'), meta = document.querySelector('meta[name="description"]');
    const missing = [];
    for (const node of document.querySelectorAll('*')) for (const attribute of node.attributes) {
      if ((attribute.name === 'data-i18n' || attribute.name.startsWith('data-i18n-')) && attribute.name !== 'data-i18n-params' && t(attribute.value) === attribute.value) missing.push(attribute.value);
    }
    return { language: getLanguage(), mode: getLanguageMode(), htmlLang: document.documentElement.lang, title: document.title, expectedTitle: t(title.dataset.i18n), description: meta.content, expectedDescription: t(meta.dataset.i18nContent), select: document.querySelector('#languageSelect').value, missing };
  });
}
async function assertLanguage(page, language, mode = 'auto') {
  const state = await languageState(page);
  assert.equal(state.language, language); assert.equal(state.mode, mode); assert.equal(state.select, mode);
  assert.equal(state.htmlLang, language === 'zh' ? 'zh-CN' : 'en');
  assert.equal(state.title, state.expectedTitle); assert.equal(state.description, state.expectedDescription);
  assert.deepEqual(state.missing, [], 'Every declarative message key resolves');
  assert.notEqual(state.title, 'undefined'); assert.notEqual(state.description, 'undefined');
  if (language === 'en') assert.doesNotMatch(state.title + state.description, /[\u3400-\u9fff]/);
  else assert.match(state.description, /[\u3400-\u9fff]/);
  return state;
}
async function chineseResidue(page) {
  return page.evaluate(() => {
    const matches = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script,style,#languageSelect') || !/[\u3400-\u9fff]/.test(node.textContent)) continue;
      const style = getComputedStyle(parent);
      if (parent.getClientRects().length && style.visibility !== 'hidden' && style.display !== 'none') matches.push({ text: node.textContent.trim(), node: parent.id || parent.tagName });
    }
    for (const node of document.querySelectorAll('[aria-label], [title], [placeholder]')) {
      if (node.closest('#languageSelect')) continue;
      for (const attribute of ['aria-label', 'title', 'placeholder']) if (/[\u3400-\u9fff]/.test(node.getAttribute(attribute) || '')) matches.push({ text: node.getAttribute(attribute), node: node.id || node.tagName, attribute });
    }
    return matches;
  });
}
async function clean(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await settled(page);
  assert.equal(await page.locator('canvas[data-tflip-particles], [data-tflip-overlay], #showcaseGrid .demo-motion').count(), 0);
}

test('whole-page language integration in Brave and WebKit', { timeout: 240000 }, async t => {
  await mkdir(results, { recursive: true }); evidence.sources = await hashes();
  const host = await server(); t.after(() => host.kill()); t.after(save);
  for (const engine of engines) {
    await t.test(engine, { timeout: 115000 }, async t => {
      const browser = await launchBrowser(engine);
      t.after(() => browser.close()); evidence[engine] = { version: browser.version() };
      const errors = [];
      async function session(languages = ['en-US'], { blocked = false, width = 1440, height = 1000, navigate = true, monitor = true } = {}) {
        const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'no-preference' });
        await context.addInitScript(({ languages, blocked }) => {
          window.__i18nLanguages = languages;
          Object.defineProperty(navigator, 'languages', { configurable: true, get: () => window.__i18nLanguages });
          Object.defineProperty(navigator, 'language', { configurable: true, get: () => window.__i18nLanguages[0] || 'fr-FR' });
          if (blocked) Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage denied', 'SecurityError'); } });
        }, { languages, blocked });
        const page = await context.newPage(); page.setDefaultTimeout(10000);
        if (monitor) {
          page.on('pageerror', error => errors.push(error.message));
          page.on('response', response => { if (response.status() >= 400 && ['script', 'stylesheet'].includes(response.request().resourceType())) errors.push(`${response.status()} ${response.url()}`); });
        }
        if (navigate) { await page.goto(`${base}/playground/`, { waitUntil: 'load' }); await ready(page); }
        return { context, page };
      }

      await t.test('browser preference order, metadata, seven scenes and eight default jet toggles', async () => {
        const matrix = [];
        for (const [preferences, expected] of [[['zh-CN'], 'zh'], [['zh-TW'], 'zh'], [['en-US'], 'en'], [['fr', 'en-GB', 'zh-CN'], 'en'], [['fr', 'zh-HK', 'en-US'], 'zh'], [['fr', 'de', 'ja'], 'en']]) {
          const { context, page } = await session(preferences);
          try {
            matrix.push({ preferences, ...await assertLanguage(page, expected) });
            assert.equal(await page.locator('#stuntStage, [data-demo]').count(), 7);
            assert.deepEqual(await page.locator('#stuntJet, #jet, [data-demo-jet]').evaluateAll(inputs => inputs.map(input => input.checked)), Array(8).fill(true));
            assert.equal(await page.evaluate(() => localStorage.getItem('tflip.language')), null, 'Auto detection never writes an override');
            if (expected === 'en') assert.deepEqual(await chineseResidue(page), [], 'English UI and accessibility text contain no untranslated Chinese');
          } finally { await context.close(); }
        }
        evidence[engine].preferences = matrix; await save();
      });

      await t.test('manual selection persists across reload; auto follows system changes; blocked storage is usable', async () => {
        const { context, page } = await session(['zh-CN']);
        try {
          await change(page, 'en'); await assertLanguage(page, 'en', 'en');
          assert.equal(await page.evaluate(() => localStorage.getItem('tflip.language')), 'en');
          await page.reload({ waitUntil: 'load' }); await ready(page); await assertLanguage(page, 'en', 'en');
          await page.evaluate(() => { window.__i18nLanguages = ['zh-TW']; window.dispatchEvent(new Event('languagechange')); });
          await assertLanguage(page, 'en', 'en');
          await change(page, 'auto'); await assertLanguage(page, 'zh');
          assert.equal(await page.evaluate(() => localStorage.getItem('tflip.language')), null);
          await page.evaluate(() => { window.__i18nLanguages = ['fr', 'en-US']; window.dispatchEvent(new Event('languagechange')); });
          await assertLanguage(page, 'en');
        } finally { await context.close(); }
        const blocked = await session(['zh-CN'], { blocked: true });
        try { await change(blocked.page, 'en'); await assertLanguage(blocked.page, 'en', 'en'); await change(blocked.page, 'auto'); await assertLanguage(blocked.page, 'zh'); }
        finally { await blocked.context.close(); }
        evidence[engine].persistence = { reload: true, manualIgnoresSystem: true, autoRemovesOverride: true, systemChanges: true, blockedStorage: true }; await save();
      });

      await t.test('switching paused and running scenes preserves nodes, progress and exact canvas bytes', async () => {
        const { context, page } = await session(['zh-CN']);
        try {
          // Avoid scrolling any active playback: direct DOM controls exercise the
          // real public UI handlers without Playwright auto-scrolling the page.
          await page.locator('#layout').evaluate(select => { select.value = 'freeze'; select.dispatchEvent(new Event('change', { bubbles: true })); });
          await setRange(page, '#stuntSeek', 10000 / 13800 * 1000); await setRange(page, '#progress', 360); await settled(page);
          const paused = await page.evaluate(async () => {
            const { setLanguage, t } = await import('/playground/i18n.js');
            for (const canvas of document.querySelectorAll('canvas')) for (let i = 0; i < 6; i++) canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
            for (const id of ['stuntJet']) document.getElementById(id).dispatchEvent(new Event('change', { bubbles: true }));
            const canvases = [...document.querySelectorAll('canvas')], pixels = canvases.map(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);
            const selectors = ['#stuntCanvas', '#stuntDriver', '[data-lab-visual]', '#sourceAnchor', '#targetAnchor'];
            const nodes = selectors.map(selector => document.querySelector(selector));
            const before = ['stuntSeek', 'progress'].map(id => document.getElementById(id).value);
            const sceneBefore = { shot: document.querySelector('#stuntStage').dataset.shot, phase: document.querySelector('#stuntStage').dataset.phase };
            setLanguage('en');
            const sceneAfter = { shot: document.querySelector('#stuntStage').dataset.shot, phase: document.querySelector('#stuntStage').dataset.phase };
            const shotLabel = { actual: document.querySelector('#stuntPhase').textContent, expected: t('featured.stunt.shot.roadster') };
            const differences = canvases.map((canvas, index) => {
              const actual = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
              let changed = Math.abs(actual.length - pixels[index].length);
              for (let i = 0; i < actual.length; i++) if (actual[i] !== pixels[index][i]) changed++;
              return changed;
            });
            return { before, sceneBefore, sceneAfter, shotLabel, after: ['stuntSeek', 'progress'].map(id => document.getElementById(id).value), identities: selectors.map((selector, i) => nodes[i] && nodes[i] === document.querySelector(selector)), differences, statuses: ['stuntStatus', 'playbackStatus'].map(id => document.getElementById(id).textContent), expected: [t('featured.status.paused'), t('lab.status.paused')], resume: ['stuntPause', 'pauseButton'].map(id => document.getElementById(id).getAttribute('aria-label')) };
          });
          assert.deepEqual(paused.after, paused.before); assert.deepEqual(paused.sceneAfter, paused.sceneBefore); assert.equal(paused.sceneBefore.shot, 'roadster'); assert.ok(paused.shotLabel.actual.includes(paused.shotLabel.expected)); assert.notEqual(paused.shotLabel.expected, 'featured.stunt.shot.roadster'); assert.ok(paused.identities.every(Boolean)); assert.ok(paused.differences.every(value => value === 0), `Paused pixel changes: ${JSON.stringify(paused)}`);
          assert.deepEqual(paused.statuses, paused.expected); assert.ok(paused.resume.every(text => text.startsWith('Resume')));
          await page.waitForTimeout(120);
          assert.deepEqual(await page.locator('#stuntSeek, #progress').evaluateAll(inputs => inputs.map(input => input.value)), paused.before);
          assert.deepEqual(await chineseResidue(page), []);
          await page.evaluate(() => { ['stuntPause', 'pauseButton'].forEach(id => document.getElementById(id).click()); document.querySelectorAll('[data-demo-play]').forEach(button => button.click()); });
          await page.waitForTimeout(180);
          const running = await page.evaluate(async () => {
            const { setLanguage } = await import('/playground/i18n.js');
            const nodes = [...document.querySelectorAll('.demo-motion, [data-lab-visual], #stuntCanvas')];
            const cards = [...document.querySelectorAll('[data-demo]')];
            const before = { shot: document.querySelector('#stuntStage').dataset.shot, times: ['stuntSeek', 'progress'].map(id => document.getElementById(id).value), gallery: cards.map(card => card.style.getPropertyValue('--demo-progress')), transforms: nodes.map(node => node.style.transform), combo: document.querySelector('[data-demo-combo]').textContent };
            setLanguage('zh');
            const after = { shot: document.querySelector('#stuntStage').dataset.shot, times: ['stuntSeek', 'progress'].map(id => document.getElementById(id).value), gallery: cards.map(card => card.style.getPropertyValue('--demo-progress')), transforms: nodes.map(node => node.style.transform), combo: document.querySelector('[data-demo-combo]').textContent };
            window.__i18nRunningNodes = nodes;
            return { before, after, retained: nodes.every(node => node.isConnected), allPlaying: cards.every(card => card.dataset.playing === 'true'), status: [document.querySelector('#stuntStatus').textContent, document.querySelector('#playbackStatus').textContent, ...cards.map(card => card.querySelector('[data-demo-status]').textContent)] };
          });
          assert.deepEqual(running.after, running.before); assert.equal(running.after.shot, 'roadster'); assert.ok(running.retained && running.allPlaying); assert.ok(running.status.every(text => /播放中/.test(text)));
          await page.waitForTimeout(120);
          assert.equal(await page.evaluate(() => window.__i18nRunningNodes.every(node => node.isConnected)), true, 'No next-frame cancellation after translating layout');
          const advanced = await page.locator('#stuntSeek, #progress').evaluateAll(inputs => inputs.map(input => Number(input.value)));
          assert.ok(advanced.every((value, i) => value > Number(running.before.times[i])), 'Both full controls continue advancing');
          assert.equal(await page.locator('#showcaseGrid [data-playing="true"]').count(), 6);
          await change(page, 'en'); assert.deepEqual(await chineseResidue(page), [], 'Active dynamic states, logs and transient cards translate');
          await click(page, '#cancelButton'); await clean(page);
          evidence[engine].motion = { paused, running, advanced, noRebuild: true }; await save();
        } finally { await context.close(); }
      });

      await t.test('English and Chinese fit 1440px and 390px layouts with translated accessibility text', async () => {
        const screenshots = [];
        for (const width of [1440, 390]) {
          const { context, page } = await session(['en-US'], { width, height: width === 390 ? 844 : 1000 });
          try {
            for (const language of ['en', 'zh']) {
              await change(page, language); await settled(page);
              const layout = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, boxes: [...document.querySelectorAll('.site-header,#stuntStage,#showcaseGrid,#lab,#integration')].map(node => { const box = node.getBoundingClientRect(); return { id: node.id || node.className, left: box.left, right: box.right }; }) }));
              assert.ok(layout.documentWidth <= width + 1, `Page overflow ${width}/${language}: ${JSON.stringify(layout)}`);
              assert.ok(layout.boxes.every(box => box.left >= -1 && box.right <= width + 1), `Section overflow ${JSON.stringify(layout)}`);
              if (language === 'en') assert.deepEqual(await chineseResidue(page), []);
              const filename = `i18n-${engine}-${width}-${language}.png`;
              await page.screenshot({ path: `${results}/${filename}`, fullPage: true });
              screenshots.push({ width, language, filename, layout });
            }
          } finally { await context.close(); }
        }
        evidence[engine].layouts = screenshots; await save();
      });

      await t.test('validation and clipboard feedback retranslate without public diagnostic logs', async () => {
        const { context, page } = await session(['zh-CN']);
        try {
          const validation = [];
          for (const [key, fields, fieldKey] of [
            ['lab.error.numberRange', { turns: '-1' }, 'lab.field.turns'],
            ['lab.error.pathJSON', { waypoints: '{broken' }],
            ['lab.error.flightPhases', { launch: '0', roll: '0', descent: '0' }],
          ]) {
            await click(page, '#resetButton'); await change(page, 'zh');
            await page.evaluate(fields => { for (const [id, value] of Object.entries(fields)) document.getElementById(id).value = value; document.querySelector('#playButton').click(); }, fields);
            await page.waitForFunction(() => !document.querySelector('#errorMessage').hidden);
            const variants = [];
            for (const language of ['zh', 'en']) {
              await change(page, language);
              const result = await page.evaluate(async ({ key, fieldKey }) => {
                const { t } = await import('/playground/i18n.js');
                return { actual: document.querySelector('#errorMessage').textContent, expected: t(key, fieldKey ? { field: t(fieldKey) } : {}), visible: !document.querySelector('#errorMessage').hidden };
              }, { key, fieldKey });
              assert.equal(result.actual, result.expected); assert.equal(result.visible, true); variants.push({ language, text: result.actual });
            }
            validation.push({ key, variants });
          }
          await click(page, '#resetButton'); await change(page, 'zh');
          await click(page, '#playButton');
          await page.waitForFunction(() => Number(document.querySelector('#progress').value) > 10);
          await click(page, '#pauseButton'); await click(page, '#cancelButton'); await settled(page);
          assert.equal(await page.locator('#eventLog, #clearLog, .event-panel, [data-i18n="ui.stunt.disclaimer"]').count(), 0);
          await change(page, 'en');
          await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new DOMException('Blocked by test', 'NotAllowedError')) } }));
          await click(page, '#copyButton'); await page.waitForFunction(() => document.querySelector('#copyStatus').textContent.includes('blocked'));
          await change(page, 'zh');
          const clipboard = await page.evaluate(async () => { const { t } = await import('/playground/i18n.js'); return { actual: document.querySelector('#copyStatus').textContent, expected: t('lab.copy.denied') }; });
          assert.equal(clipboard.actual, clipboard.expected);
          evidence[engine].feedback = { validation, clipboard, publicDiagnosticLogs: false }; await save();
        } finally { await context.close(); }
      });

      await t.test('head bootstrap hides untranslated first paint while the module is delayed and then reveals English', async () => {
        const { context, page } = await session(['en-US'], { navigate: false });
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        await page.route('**/playground/i18n.js', async route => { await gate; await route.continue(); });
        try {
          await page.goto(`${base}/playground/`, { waitUntil: 'commit' });
          await page.waitForFunction(() => document.body && document.documentElement.classList.contains('i18n-pending'));
          const pending = await page.evaluate(() => ({ language: document.documentElement.lang, hidden: getComputedStyle(document.body).visibility, text: document.body.innerText }));
          assert.equal(pending.language, 'en'); assert.equal(pending.hidden, 'hidden');
          // WebKit's fonts.ready can await document completion while this test
          // intentionally holds the module response. The hidden body has no
          // glyphs to wait for; skip that screenshot-only wait, then restore it.
          const fontWait = process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
          process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
          try { await page.screenshot({ path: `${results}/i18n-${engine}-pending.png` }); }
          finally {
            if (fontWait === undefined) delete process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
            else process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = fontWait;
          }
          release();
          await page.waitForLoadState('load'); await ready(page);
          assert.equal(await page.locator('body').evaluate(body => getComputedStyle(body).visibility), 'visible');
          await assertLanguage(page, 'en'); assert.deepEqual(await chineseResidue(page), []);
          evidence[engine].firstPaint = { pendingLanguage: pending.language, bodyHidden: true, translatedReveal: true }; await save();
        } finally { release(); await context.close(); }
      });
      assert.deepEqual(errors, [], 'No page errors or failed script/style requests');
    });
  }
  evidence.completedAt = new Date().toISOString();
  assert.deepEqual(await hashes(), evidence.sources, 'Evidence must use one frozen source version');
  await save();
});
