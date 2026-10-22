import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { launchBrowser, testEngines } from './helpers/browser.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = path.join(root, 'test-results/two-shot');
const prefix = '/sandbox/nested/';
const ids = ['lab', 'orbit', 'portal', 'vinyl', 'candy', 'arcade', 'paper', 'stunt'];
const engines = testEngines('AGENT_ENGINE');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = { startedAt: new Date().toISOString(), prefix, reads: [], checks: {}, engines: {} };
let base;
const fixture = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="./agent/examples/gallery/style.css"><link rel="stylesheet" href="./agent/examples/featured/style.css"><style>body{margin:0;background:#eee;font:16px system-ui}.host{width:min(600px,100%);min-height:300px;margin:auto}#hosts{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:600px){#hosts{grid-template-columns:1fr}}</style></head><body><div id="hosts"><div class="host" id="a"><span data-sibling>Caller-owned A</span></div><div class="host" id="b"><span data-sibling>Caller-owned B</span></div></div></body></html>`;
async function save() { await writeFile(path.join(out, 'agent-evidence.json'), JSON.stringify(evidence, null, 2) + '\n'); }
async function server() {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown', '.svg': 'image/svg+xml', '.zip': 'application/zip', '.tgz': 'application/gzip' };
  const host = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) { res.writeHead(404); res.end('Prefix required'); return; }
    if (url.pathname === prefix + '__fixture.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixture); return; }
    let relative;
    try { relative = decodeURIComponent(url.pathname.slice(prefix.length)); } catch { res.writeHead(400); res.end(); return; }
    if (relative.endsWith('/') || !relative) relative += 'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    try {
      const bytes = await readFile(file);
      evidence.reads.push({ path: relative, bytes: bytes.length });
      res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(bytes);
    } catch { res.writeHead(404); res.end('Missing file'); }
  });
  await new Promise(resolve => host.listen(Number(process.env.AGENT_PORT ?? 0), '127.0.0.1', resolve));
  base = `http://127.0.0.1:${host.address().port}${prefix}`;
  evidence.base = base;
  return host;
}
async function frame(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function set(page, selector, value, event = 'change') { await page.locator(selector).evaluate((node, { value, event }) => { if (typeof value === 'boolean') node.checked = value; else node.value = String(value); node.dispatchEvent(new Event(event, { bubbles: true })); }, { value, event }); }
async function click(page, selector) { await page.locator(selector).evaluate(node => node.click()); }
async function uiReady(page) { await page.waitForFunction(() => document.querySelector('#agentCopy')?.disabled === false && document.querySelectorAll('[data-agent-demo]').length === 7 && !document.documentElement.classList.contains('i18n-pending')); }
async function copy(page) {
  await page.evaluate(() => { window.__copies = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copies.push(text); } } }); });
  await click(page, '#agentCopy');
  await page.waitForFunction(() => window.__copies.length === 1);
  return page.evaluate(() => ({ text: window.__copies[0], status: document.querySelector('#agentStatus').textContent, error: document.querySelector('#agentStatus').dataset.error }));
}
function payload(text) { const start = text.indexOf('{\n'); assert.ok(start >= 0, 'Prompt includes JSON'); const tail = text.slice(start); const end = tail.lastIndexOf('\n}'); return JSON.parse(tail.slice(0, end + 2)); }
async function fixtureReady(page) {
  await page.goto(`${base}__fixture.html`, { waitUntil: 'load' });
  await page.evaluate(async base => {
    window.modules = { gallery: await import(`${base}agent/examples/gallery/index.js`), featured: await import(`${base}agent/examples/featured/index.js`) };
    window.mount = (id, host = 'a', jet = true) => ['stunt', 'roadster', 'ramp'].includes(id) ? modules.featured[{ stunt: 'mountStunt', roadster: 'mountRoadster', ramp: 'mountRamp' }[id]](document.getElementById(host), { jet }) : modules.gallery.mountGalleryDemo(document.getElementById(host), id, { jet });
  }, base);
}

test('portable agent handoff and standalone examples', { timeout: 360000 }, async t => {
  await mkdir(out, { recursive: true }); const host = await server();
  t.after(() => new Promise(resolve => host.close(resolve))); t.after(save);
  evidence.testFile = { bytes: (await stat(fileURLToPath(import.meta.url))).size, sha256: sha(await readFile(fileURLToPath(import.meta.url))) };
  evidence.sources = {};
  async function sourceHashes(relative) { for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) { const name = `${relative}/${entry.name}`; if (entry.isDirectory() && entry.name !== 'downloads') await sourceHashes(name); else if (entry.isFile() && /\.(?:js|css|json|md|html)$/.test(name)) { const bytes = await readFile(path.join(root, name)); evidence.sources[name] = { bytes: bytes.length, sha256: sha(bytes) }; } } }
  await sourceHashes('agent'); await sourceHashes('playground');
  await t.test('static Markdown discovery, eight canonical recipes, relative resources and downloaded artifact bytes', async () => {
    const html = await (await fetch(`${base}playground/`)).text();
    assert.match(html, /id="agentEntryLink"[^>]+href="\.\.\/agent\/index\.md"/);
    const catalogURL = new URL('agent/catalog.json', base); const response = await fetch(catalogURL); assert.equal(response.status, 200);
    const catalog = await response.json(); assert.deepEqual(catalog.recipes.map(r => r.id), ids);
    assert.equal(catalog.package.name, '@tflip/motion'); assert.equal(catalog.package.version, '0.3.1');
    assert.equal(catalog.docs.skill, './tflip/SKILL.md');
    assert.deepEqual(catalog.aliases, { roadster: 'stunt', ramp: 'stunt' });
    const schema = await (await fetch(new URL(catalog.docs.configuration, catalogURL))).json();
    for (const alias of ['roadster', 'ramp']) assert.ok(schema.properties.demo.enum.includes(alias), `Legacy JSON ID ${alias} remains documented and valid`);
    assert.ok(schema.properties.sdkVersion.enum.includes('0.1.0')); assert.ok(schema.properties.sdkVersion.enum.includes('0.2.0')); assert.equal(catalog.configuration.sdkVersion, '0.3.1');
    for (const alias of ['roadster', 'ramp']) { const r = await fetch(new URL(`./recipes/${alias}.md`, catalogURL)); assert.equal(r.status, 200); assert.match(await r.text(), /stunt/i); }
    const paths = [...Object.values(catalog.docs), ...catalog.recipes.map(r => r.recipe), './examples/index.html', './examples/index.js', './examples/gallery/index.js', './examples/featured/index.js', './runtime/core/index.js', './runtime/dom/index.js', './runtime/effects/index.js'];
    for (const relative of paths) { assert.ok(!/^(?:[a-z]+:|\/)/i.test(relative)); const url = new URL(relative, catalogURL); assert.ok(url.href.startsWith(base)); const r = await fetch(url); assert.equal(r.status, 200, url.href); assert.ok((await r.arrayBuffer()).byteLength > 0); }
    const artifacts = [];
    for (const item of [catalog.package, ...Object.values(catalog.downloads)]) { const url = new URL(item.url, catalogURL); assert.ok(url.href.startsWith(base)); const r = await fetch(url); assert.equal(r.status, 200); const bytes = Buffer.from(await r.arrayBuffer()); assert.equal(bytes.length, item.bytes); assert.equal(sha(bytes), item.sha256); artifacts.push({ url: url.href, bytes: bytes.length, sha256: sha(bytes) }); }
    evidence.checks.resources = { recipes: ids, catalogRevision: catalog.contentRevision, paths, artifacts }; await save();
  });

  for (const engine of engines) await t.test(engine, { timeout: 170000 }, async t => {
    const browser = await launchBrowser(engine);
    t.after(() => browser.close()); const record = evidence.engines[engine] = { version: browser.version(), errors: [], screenshots: [] };
    async function session({ width = 1440, language = 'en', theme = 'light', reducedMotion = 'no-preference' } = {}) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: language === 'zh' ? 'zh-CN' : 'en-US', colorScheme: theme, reducedMotion });
      await context.addInitScript(({ language, theme }) => {
        localStorage.setItem('tflip.language', language); localStorage.setItem('tflip.theme', theme);
        const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window); window.__frames = new Set();
        window.requestAnimationFrame = callback => { const id = request(time => { window.__frames.delete(id); callback(time); }); window.__frames.add(id); return id; };
        window.cancelAnimationFrame = id => { window.__frames.delete(id); return cancel(id); };
      }, { language, theme });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', error => record.errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400) record.errors.push(`${response.status()} ${response.url()}`); });
      return { context, page };
    }

    await t.test('copies current lab settings, scene jet/speed and framework; real JSON download', async () => {
      const { context, page } = await session();
      try {
        await page.goto(`${base}playground/`, { waitUntil: 'load' }); await uiReady(page);
        const settings = { height: 235, duration: 4200, turns: 1.75, direction: -1, axis: 'z', bounce: .23, depth: 45, speed: 1.35, perspective: 1250, pathMode: 'linear', repeat: 'queue', layout: 'freeze', reducedMotion: 'never', backface: 'hidden', anticipation: 7, launch: 21, roll: 40, descent: 24, settle: 8 };
        for (const [id, value] of Object.entries(settings)) await set(page, `#${id}`, value, ['height', 'duration', 'speed'].includes(id) ? 'input' : 'change');
        await set(page, '#waypoints', '[{"x":120,"y":240,"z":30}]'); await set(page, '#jet', false); await set(page, '#trail', true); await set(page, '#shadow', false);
        await set(page, '#anchorMode', 'points'); for (const [id, value] of Object.entries({ fromX: 101, fromY: 202, toX: 503, toY: 304 })) await set(page, `#${id}`, value);
        await set(page, '#agentFramework', 'react');
        const copied = await copy(page); const data = payload(copied.text);
        assert.equal(copied.error, 'false'); assert.equal(data.sdkVersion, '0.3.1'); assert.equal(data.demo, 'lab'); assert.equal(data.framework, 'react');
        for (const [key, value] of Object.entries(settings)) assert.equal(data.config.motion[key] ?? data.config.motion.phases[key], value, key);
        assert.deepEqual(data.config.motion.path, [{ x: 120, y: 240, z: 30 }]); assert.equal(data.config.motion.shadow, false);
        assert.deepEqual(data.config.anchors, { kind: 'viewport', from: { x: 101, y: 202 }, to: { x: 503, y: 304 }, wrapper: '[data-motion-wrapper]' });
        assert.equal(data.config.effects.jet, false); assert.equal(data.config.effects.trail, true);
        assert.ok(copied.text.includes(`${base}agent/index.md`)); assert.ok(copied.text.includes(`${base}agent/recipes/lab.md`)); assert.doesNotMatch(copied.text, /astute-newt|100\.\d+\.\d+\.\d+|\.ts\.net/);
        const downloaded = page.waitForEvent('download'); await click(page, '#agentDownload'); const download = await downloaded; const downloadedJSON = JSON.parse(await readFile(await download.path(), 'utf8')); assert.deepEqual(downloadedJSON, data);
        await download.saveAs(path.join(out, `agent-${engine}-lab-config.json`));
        for (const id of ids.slice(1)) {
          await set(page, '#agentDemo', id); const featured = id === 'stunt';
          await set(page, featured ? `#${id}Jet` : `[data-demo="${id}"] [data-demo-jet]`, false);
          if (featured) await set(page, `#${id}Speed`, .35);
          const result = payload((await copy(page)).text); assert.equal(result.demo, id); assert.deepEqual(result.config, { jet: false, speed: featured ? .35 : 1 });
        }
        const links = await page.locator('#agentIntegration a').evaluateAll(nodes => nodes.map(node => node.href)); assert.ok(links.every(url => url.startsWith(base)));
        record.config = { lab: data, downloadsEqualCopy: true, sceneSnapshots: 7, links }; await save();
      } finally { await context.close(); }
    });

    await t.test('invalid values refused; clipboard denial exposes selected text without claiming success', async () => {
      const { context, page } = await session();
      try {
        await page.goto(`${base}playground/`, { waitUntil: 'load' }); await uiReady(page);
        await page.evaluate(() => { window.__copies = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => window.__copies.push(text) } }); });
        await set(page, '#turns', -1); await click(page, '#agentCopy'); assert.equal(await page.locator('#agentStatus').getAttribute('data-error'), 'true'); assert.equal(await page.evaluate(() => __copies.length), 0);
        await set(page, '#turns', 1); await set(page, '#waypoints', '{bad json'); await click(page, '#agentCopy'); assert.equal(await page.locator('#agentStatus').getAttribute('data-error'), 'true'); assert.equal(await page.evaluate(() => __copies.length), 0);
        await set(page, '#waypoints', '[]'); await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new DOMException('Denied by test', 'NotAllowedError'); }; }); await click(page, '#agentCopy');
        const fallback = await page.evaluate(async base => { const { t } = await import(`${base}playground/i18n.js`); const n = document.querySelector('#agentPrompt'); return { open: document.querySelector('#agentPreview').open, value: n.value, start: n.selectionStart, end: n.selectionEnd, focused: document.activeElement === n, status: document.querySelector('#agentStatus').textContent, manual: t('agent.status.manual'), copied: t('agent.status.copied') }; }, base);
        assert.ok(fallback.open && fallback.focused); assert.equal(fallback.start, 0); assert.equal(fallback.end, fallback.value.length); assert.equal(fallback.status, fallback.manual); assert.notEqual(fallback.status, fallback.copied); assert.equal(payload(fallback.value).demo, 'lab');
        record.clipboardFallback = { open: true, fullTextSelected: true, noFalseSuccess: true, invalidCopies: 0 }; await save();
      } finally { await context.close(); }
    });

    await t.test('language and scene selection preserve running and paused animation', async () => {
      const { context, page } = await session();
      try {
        await page.goto(`${base}playground/`, { waitUntil: 'load' }); await uiReady(page);
        await click(page, '#stuntPlay'); await page.waitForFunction(() => Number(document.querySelector('#stuntSeek').value) > 20);
        const before = Number(await page.locator('#stuntSeek').inputValue());
        await set(page, '#languageSelect', 'zh'); await set(page, '#agentDemo', 'stunt'); await set(page, '#agentFramework', 'vanilla');
        const after = Number(await page.locator('#stuntSeek').inputValue()); assert.ok(after >= before, 'Selection must not reset active Stunt'); assert.equal(await page.locator('#stuntStage').getAttribute('data-playing'), 'true');
        await click(page, '#stuntPause'); const paused = await page.locator('#stuntSeek').inputValue(); await set(page, '#languageSelect', 'en'); await set(page, '#agentDemo', 'orbit'); await frame(page); assert.equal(await page.locator('#stuntSeek').inputValue(), paused);
        await click(page, '#stuntCancel');
        for (const id of ids.slice(1)) { await click(page, `[data-agent-demo="${id}"]`); assert.equal(await page.locator('#agentDemo').inputValue(), id); }
        record.selection = { runningPreserved: true, pausedPreserved: true, entryButtons: 7 }; await save();
      } finally { await context.close(); }
    });

    await t.test('zh/en light/dark at desktop/mobile, discoverable controls and screenshots', async () => {
      for (const width of [1440, 390]) for (const language of ['zh', 'en']) for (const theme of ['light', 'dark']) {
        const { context, page } = await session({ width, language, theme });
        try {
          await page.goto(`${base}playground/`, { waitUntil: 'load' }); await uiReady(page); await page.locator('#agentIntegration').scrollIntoViewIfNeeded(); await frame(page);
          assert.equal(await page.locator('#agentDemo option').count(), 8); assert.equal(await page.locator('#agentFramework option').count(), 3);
          assert.equal(await page.locator('html').getAttribute('data-theme'), theme); assert.equal(await page.locator('html').getAttribute('lang'), language === 'zh' ? 'zh-CN' : 'en');
          const bounds = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth })); assert.ok(bounds.scroll <= bounds.width + 1, `Horizontal overflow ${JSON.stringify(bounds)}`);
          const labels = await page.evaluate(async base => { const { t } = await import(`${base}playground/i18n.js`); return ['agentCopy', 'agentDownload'].map((id, i) => ({ text: document.getElementById(id).textContent, expected: t(['agent.copy', 'agent.download'][i]) })); }, base); assert.ok(labels.every(label => label.text === label.expected));
          const name = `agent-${engine}-${width}-${language}-${theme}.png`; await page.locator('#agentIntegration').screenshot({ path: path.join(out, name) }); record.screenshots.push(name);
        } finally { await context.close(); }
      }
      await save();
    });

    await t.test('all seven portable scenes render, pause/seek/resume, replace, complete and dispose independently', async () => {
      const { context, page } = await session(); record.scenes = [];
      try {
        await fixtureReady(page);
        for (const id of ids.slice(1)) {
          const result = await page.evaluate(async id => {
            const a = mount(id, 'a', true), b = mount(id, 'b', false); window.__sceneA = a; window.__sceneB = b;
            const methods = ['play', 'pause', 'resume', 'seek', 'setSpeed', 'cancel', 'dispose'];
            const api = methods.every(key => typeof a[key] === 'function');
            const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
            const run = a.play(), other = b.play(); a.pause(); b.pause(); a.seek(.63); b.seek(.25);
            const paused = run.currentTime; await wait(60); const stable = run.currentTime === paused;
            const progress = run.progress, otherTime = other.currentTime;
            const featured = id === 'stunt', element = document.querySelector(featured ? '#a canvas' : '#a .demo-motion');
            let render;
            if (featured) { const canvas = element, ctx = canvas.getContext('2d'), pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data; const colors = new Set(); for (let i = 0; i < pixels.length; i += Math.max(4, Math.floor(pixels.length / 4000 / 4) * 4)) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]},${pixels[i + 3]}`); render = { width: canvas.width, height: canvas.height, colors: colors.size }; }
            else render = { tracks: document.querySelectorAll('#a .demo-motion').length, transformed: !!element && getComputedStyle(element).transform !== 'none' };
            const previous = run.finished; const replacement = a.play(); const replaced = await previous;
            const isolated = other.status === 'paused' && other.currentTime === otherTime;
            a.pause(); a.seek(.2); const rewind = replacement.progress; a.setSpeed(40); a.resume();
            const finished = await Promise.race([replacement.finished, wait(2500).then(() => ({ status: 'timeout' }))]);
            const transientAfterFinish = document.querySelectorAll('#a .demo-motion,#a [data-tflip-particles]').length;
            const finalRun = a.play(); a.dispose(); a.dispose(); const disposed = await finalRun.finished;
            const sibling = document.querySelector('#a [data-sibling]')?.textContent;
            const independentRoot = !!document.querySelector('#b [data-tflip-gallery],#b .tflip-featured-scene');
            b.cancel(); const cancelled = await other.finished; b.dispose();
            await wait(80);
            return { id, api, stable, progress, render, replaced, isolated, rewind, finished, transientAfterFinish, disposed, sibling, independentRoot, cancelled, roots: document.querySelectorAll('[data-tflip-gallery],.tflip-featured-scene').length, dynamic: document.querySelectorAll('.demo-motion,[data-tflip-particles],[data-tflip-overlay]').length, frames: window.__frames.size };
          }, id);
          assert.ok(result.api && result.stable); assert.ok(Math.abs(result.progress - .63) < .001); assert.ok(result.isolated && result.independentRoot); assert.ok(Math.abs(result.rewind - .2) < .001);
          if (id === 'stunt') assert.ok(result.render.width > 0 && result.render.height > 0 && result.render.colors > 20, `${id} paints actual scene`);
          else assert.ok(result.render.tracks > 0 && result.render.transformed, `${id} applies a real transform`);
          assert.equal(result.replaced.status, 'cancelled'); assert.equal(result.replaced.reason, 'replaced'); assert.equal(result.finished.status, 'finished', JSON.stringify(result)); assert.equal(result.transientAfterFinish, 0); assert.equal(result.disposed.reason, 'disposed'); assert.equal(result.cancelled.status, 'cancelled'); assert.equal(result.sibling, 'Caller-owned A'); assert.equal(result.roots, 0); assert.equal(result.dynamic, 0); assert.equal(result.frames, 0); record.scenes.push(result);
        }
        await save();
      } finally { await context.close(); }
    });

    await t.test('portable featured clock seeks across the exact cut without replacing playback or leaving stale pixels', async () => {
      const { context, page } = await session();
      try {
        await fixtureReady(page);
        const result = await page.evaluate(async () => {
          const scene = mount('stunt'), run = scene.play(); scene.pause();
          const root = document.querySelector('#a .tflip-featured-scene');
          const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d');
          const hash = () => { let value = 2166136261; for (const byte of ctx.getImageData(0, 0, canvas.width, canvas.height).data) value = Math.imul(value ^ byte, 16777619) >>> 0; return value; };
          // Both renderers retain their own backing context while the visible
          // canvas is read back repeatedly, as it would be during screenshot QA.
          const samples = [];
          for (const time of [7999.99, 8000, 8000.01, 10900, 3000, 8000, 7999.99, 10900, 13800]) {
            run.seek(time / 13800);
            samples.push({ requested: time, currentTime: run.currentTime, progress: run.progress, shot: root.dataset.shot, shotTime: Number(root.dataset.shotTime), status: run.status, hash: hash(), frames: window.__frames.size });
          }
          let settled = false; run.finished.then(() => { settled = true; }); await Promise.resolve();
          const previewSettled = settled; run.resume(); const end = await run.finished;
          scene.dispose();
          return { duration: run.duration, samples, previewSettled, end, frames: window.__frames.size, roots: document.querySelectorAll('.tflip-featured-scene').length };
        });
        assert.equal(result.duration, 13800); assert.equal(result.previewSettled, false); assert.equal(result.end.status, 'finished'); assert.equal(result.frames, 0); assert.equal(result.roots, 0);
        for (const sample of result.samples) {
          assert.ok(Math.abs(sample.currentTime - sample.requested) < 1e-8); assert.equal(sample.shot, sample.requested < 8000 ? 'ramp' : 'roadster');
          assert.ok(Math.abs(sample.shotTime - (sample.requested < 8000 ? sample.requested : sample.requested - 8000)) < 1e-8);
          assert.equal(sample.status, 'paused'); assert.equal(sample.frames, 0);
        }
        assert.notEqual(result.samples[0].hash, result.samples[1].hash, 'The cut replaces the complete composition');
        for (const [first, repeated] of [[0, 6], [1, 5], [3, 7]]) assert.equal(result.samples[first].hash, result.samples[repeated].hash, 'Seeking back to either shot reproduces its original pixels');
        record.twoShotClock = result; await save();
      } finally { await context.close(); }
    });

    await t.test('legacy featured mount exports retain the 13.8-second two-shot edit and lifecycle', async () => {
      const { context, page } = await session();
      try {
        await fixtureReady(page);
        const aliases = await page.evaluate(async () => {
          const details = [];
          for (const id of ['roadster', 'ramp']) {
            const scene = mount(id), run = scene.play(); scene.pause(); scene.seek(.7);
            details.push({ id, duration: run.duration, progress: run.progress, canvas: !!document.querySelector('#a canvas') });
            scene.cancel(); const end = await run.finished; details.at(-1).end = end; scene.dispose();
          }
          return details;
        });
        for (const alias of aliases) { assert.equal(alias.duration, 13800); assert.ok(Math.abs(alias.progress - .7) < .001); assert.ok(alias.canvas); assert.equal(alias.end.status, 'cancelled'); }
        record.aliases = aliases; await save();
      } finally { await context.close(); }
    });

    await t.test('standalone reduced motion, invalid arguments, canvas previews and mobile fitting', async () => {
      const { context, page } = await session({ reducedMotion: 'reduce', width: 390 });
      try {
        await fixtureReady(page);
        const reduced = await page.evaluate(async ids => {
          const result = [];
          for (const id of ids) { const scene = mount(id); const run = scene.play(); const end = await run.finished; scene.dispose(); result.push({ id, end }); }
          const invalid = []; for (const id of ['orbit', 'stunt']) { const scene = mount(id); for (const value of [0, -1, NaN, Infinity]) { try { scene.setSpeed(value); invalid.push(false); } catch { invalid.push(true); } } try { scene.seek(NaN); invalid.push(false); } catch { invalid.push(true); } scene.dispose(); }
          return { result, invalid, roots: document.querySelectorAll('[data-tflip-gallery],.tflip-featured-scene').length, frames: window.__frames.size };
        }, ids.slice(1));
        assert.ok(reduced.result.every(item => item.end.status === 'finished')); assert.ok(reduced.invalid.every(Boolean)); assert.equal(reduced.roots, 0); assert.equal(reduced.frames, 0);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        for (const id of ['orbit', 'stunt']) {
          await page.evaluate(id => { window.preview = mount(id); preview.seek(.55); }, id); await frame(page);
          const width = await page.evaluate(() => ({ total: document.documentElement.scrollWidth, viewport: innerWidth })); assert.ok(width.total <= width.viewport + 1);
          const name = `agent-${engine}-standalone-${id}-390.png`; await page.locator('#a').screenshot({ path: path.join(out, name) }); record.screenshots.push(name);
          await page.evaluate(() => preview.dispose());
        }
        record.reducedMotion = reduced; await save();
      } finally { await context.close(); }
    });

    await t.test('late-track rewind, terminal-frame preview, jet-off, and live reduced-motion cleanup', async () => {
      const { context, page } = await session();
      try {
        await fixtureReady(page);
        const details = await page.evaluate(async () => {
          const result = [];
          for (const [id, expected] of [['candy', 5], ['paper', 3]]) {
            const scene = mount(id, 'a', false); const run = scene.play(); scene.pause(); scene.seek(.95);
            await Promise.resolve(); scene.seek(.1);
            const nodes = [...document.querySelectorAll('#a .demo-motion')];
            result.push({ id, expected, count: nodes.length, visible: nodes.every(node => node.style.visibility !== 'hidden'), particles: document.querySelectorAll('[data-tflip-particles]').length, progress: run.progress });
            scene.dispose(); await run.finished;
          }
          for (const id of ['stunt']) { const scene = mount(id); const run = scene.play(); let settled = false; run.finished.then(() => { settled = true; }); scene.seek(1); await Promise.resolve(); const preview = { id, status: run.status, progress: run.progress, settled }; scene.resume(); preview.result = await run.finished; scene.dispose(); result.push(preview); }
          return result;
        });
        for (const item of details.slice(0, 2)) { assert.equal(item.count, item.expected); assert.ok(item.visible); assert.equal(item.particles, 0); assert.ok(Math.abs(item.progress - .1) < .001); }
        for (const item of details.slice(2)) { assert.equal(item.status, 'paused'); assert.equal(item.progress, 1); assert.equal(item.settled, false); assert.equal(item.result.status, 'finished'); }
        const live = [];
        for (const id of ['portal', 'candy', 'stunt']) {
          await page.evaluate(id => { window.liveScene = mount(id); window.liveRun = liveScene.play(); }, id);
          await page.emulateMedia({ reducedMotion: 'reduce' });
          const end = await page.evaluate(() => liveRun.finished); assert.equal(end.status, 'finished');
          await page.evaluate(() => liveScene.dispose()); await frame(page);
          const cleanup = await page.evaluate(() => ({ dynamic: document.querySelectorAll('.demo-motion,[data-tflip-particles],[data-tflip-overlay],.tflip-featured-scene').length, frames: __frames.size })); assert.equal(cleanup.dynamic, 0); assert.equal(cleanup.frames, 0);
          live.push({ id, end, cleanup }); await page.emulateMedia({ reducedMotion: 'no-preference' });
        }
        record.edgeCases = { details, live }; await save();
      } finally { await context.close(); }
    });
    await t.test('no uncaught exceptions or missing nested-path assets', () => { assert.deepEqual(record.errors, []); });
  });
  evidence.completedAt = new Date().toISOString(); evidence.readTotals = { requests: evidence.reads.length, bytes: evidence.reads.reduce((sum, read) => sum + read.bytes, 0), uniquePaths: new Set(evidence.reads.map(read => read.path)).size, note: 'Actual HTTP file reads, including browser reloads. No token count inferred.' }; await save();
});
