import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, testEngines } from './helpers/browser.mjs';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { STUNT_DURATION, STUNT_CUT } from '../playground/stunt-motion.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.STUNT_PORT ?? 4198), base = `http://127.0.0.1:${port}`;
const results = `${root}/test-results/two-shot`;
const engines = testEngines('STUNT_ENGINE');
const softwareCanvasOnly = process.env.STUNT_SOFTWARE_CANVAS_ONLY === '1';
const sourceFiles = ['playground/stunt-motion.js', 'playground/stunt-scene.js', 'playground/stunt.js', 'playground/stunt.css', 'playground/index.html', 'playground/roadster-geometry.js', 'playground/ramp-motion.js', 'playground/ramp-scene.js', 'playground/roadster-motion.js', 'playground/roadster-scene.js', 'tests/stunt.e2e.mjs', 'tests/helpers/browser.mjs'];
const evidence = { startedAt: new Date().toISOString(), sources: {}, timeline: { duration: STUNT_DURATION, cut: STUNT_CUT, order: ['ramp', 'roadster'] }, engines: {} };
const keyframes = [['ramp-approach', 0], ['ramp-climb', 3000], ['ramp-inverted', 4400], ['ramp-recovery', 5500], ['ramp-landed', 7900], ['before-cut', 7999.99], ['cut', 8000], ['after-cut', 8000.01], ['roadster-approach', 8600], ['roadster-jump', 10000], ['roadster-roll', 10900], ['roadster-descent', 12400], ['roadster-rollout', 13400], ['completed', 13800]];
async function hashes() { const result = {}; for (const file of sourceFiles) result[file] = createHash('sha256').update(await readFile(`${root}/${file}`)).digest('hex'); return result; }
async function save() { await writeFile(`${results}/stunt-evidence.json`, JSON.stringify(evidence, null, 2) + '\n'); }
async function server() {
  const child = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }); let diagnostics = '';
  child.stderr.on('data', data => { diagnostics += data; });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => { child.kill(); reject(new Error('Stunt server startup timeout')); }, 10000); child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', code => { if (code) { clearTimeout(timer); reject(new Error(diagnostics)); } }); });
  return child;
}
async function settled(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function click(page, selector) { await page.locator(selector).evaluate(node => node.click()); }
async function value(page, selector, next, event = 'change') { await page.locator(selector).evaluate((node, { next, event }) => { if (typeof next === 'boolean') node.checked = next; else node.value = String(next); node.dispatchEvent(new Event(event, { bubbles: true })); }, { next, event }); }
async function seek(page, milliseconds) { await value(page, '#stuntSeek', milliseconds / STUNT_DURATION * 1000, 'input'); await settled(page); }
async function snapshot(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#stuntCanvas'), ctx = canvas.getContext('2d'), pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261; const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) { for (let c = 0; c < 4; c++) hash = Math.imul(hash ^ pixels[i + c], 16777619) >>> 0; if (i % 400 === 0) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`); }
    return { progress: Number(document.querySelector('#stuntSeek').value), state: document.querySelector('#stuntStage').dataset.state, phase: document.querySelector('#stuntStage').dataset.phase, shot: document.querySelector('#stuntStage').dataset.shot, playing: document.querySelector('#stuntStage').dataset.playing, hash, colors: colors.size, width: canvas.width, height: canvas.height, frames: window.__stuntFrames.size };
  });
}


// Compare the composed canvas with a fresh original renderer. This catches both
// an incorrect cut/local clock and leaked canvas state from the previous shot.
async function compareOriginal(page, milliseconds) {
  await seek(page, milliseconds);
  return page.evaluate(async requestedTime => {
    const canvas = document.querySelector('#stuntCanvas'), context = canvas.getContext('2d');
    for (let i = 0; i < 6; i++) context.getImageData(0, 0, canvas.width, canvas.height);
    document.querySelector('#stuntJet').dispatchEvent(new Event('change'));
    const stage = document.querySelector('#stuntStage');
    const time = Number(stage.dataset.shotTime) + (stage.dataset.shot === 'roadster' ? 8000 : 0);
    const shot = requestedTime < 8000 ? 'ramp' : 'roadster', local = shot === 'ramp' ? time : time - 8000;
    const { sample } = await import('/dist/core/index.js');
    const { sampleRamp } = await import('/playground/ramp-motion.js');
    const { createRampScene } = await import('/playground/ramp-scene.js');
    const { createRoadsterScene } = await import('/playground/roadster-scene.js');
    const parts = [
      { name: 'approach', offset: 0, duration: 1200, from: { x: -13, y: 0 }, to: { x: -8, y: 0 }, height: 0, turns: 0, phases: { anticipation: 0, launch: 1, roll: 0, descent: 0, settle: 0 } },
      { name: 'jump', offset: 1200, duration: 3600, from: { x: -8, y: 0 }, to: { x: 8, y: 0 }, height: 4.8, turns: 1, phases: { anticipation: .04, launch: .17, roll: .54, descent: .17, settle: .08 } },
      { name: 'rollout', offset: 4800, duration: 1000, from: { x: 8, y: 0 }, to: { x: 13, y: 0 }, height: 0, turns: 0, phases: { anticipation: 0, launch: 1, roll: 0, descent: 0, settle: 0 } },
    ];
    const part = parts.find(part => local < part.offset + part.duration) ?? parts.at(-1), segmentTime = Math.max(0, Math.min(part.duration, local - part.offset));
    const original = shot === 'ramp' ? sampleRamp(local) : { pose: sample(segmentTime, { ...part, axis: 'x', direction: 1, depth: 0, bounce: .035 }), time: local, duration: 5800, progress: local / 5800, segment: part.name, segmentProgress: segmentTime / part.duration };
    const bounds = canvas.getBoundingClientRect(), reference = document.createElement('canvas');
    reference.style.cssText = `position:fixed;left:-9999px;top:0;width:${bounds.width}px;height:${bounds.height}px`; document.body.append(reference);
    const renderer = shot === 'ramp' ? createRampScene(reference) : createRoadsterScene(reference);
    const frame = { ...original, jet: document.querySelector('#stuntJet').checked, reducedMotion: false };
    renderer.render(frame); const ref = reference.getContext('2d');
    const actual = context.getImageData(0, 0, canvas.width, canvas.height).data, expected = ref.getImageData(0, 0, reference.width, reference.height).data;
    let differentChannels = 0, maximumDelta = 0, actualHash = 2166136261, expectedHash = 2166136261;
    for (let i = 0; i < actual.length; i++) { const delta = Math.abs(actual[i] - expected[i]); if (delta) differentChannels++; maximumDelta = Math.max(maximumDelta, delta); actualHash = Math.imul(actualHash ^ actual[i], 16777619) >>> 0; expectedHash = Math.imul(expectedHash ^ expected[i], 16777619) >>> 0; }
    const result = { time, localTime: local, expectedShot: shot, actualShot: document.querySelector('#stuntStage').dataset.shot, dimensionsMatch: canvas.width === reference.width && canvas.height === reference.height, differentChannels, maximumDelta, actualHash, expectedHash };
    renderer.dispose(); reference.remove(); return result;
  }, milliseconds);
}

test('Tflip two-shot edit, original-camera cuts and browser controls', { timeout: 240000 }, async t => {
  await mkdir(results, { recursive: true }); evidence.sources = await hashes(); const host = await server(); t.after(() => host.kill()); t.after(save);
  for (const engine of softwareCanvasOnly ? [] : engines) await t.test(engine, { timeout: 115000 }, async t => {
    const browser = await launchBrowser(engine); t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', reducedMotion: 'no-preference' }); t.after(() => context.close());
    await context.addInitScript(() => { const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window); window.__stuntFrames = new Set(); window.requestAnimationFrame = fn => { const id = request(time => { window.__stuntFrames.delete(id); fn(time); }); window.__stuntFrames.add(id); return id; }; window.cancelAnimationFrame = id => { window.__stuntFrames.delete(id); cancel(id); }; });
    const page = await context.newPage(); page.setDefaultTimeout(10000); const record = evidence.engines[engine] = { version: browser.version(), errors: [], keyframes: [] };
    page.on('pageerror', error => record.errors.push(error.message)); page.on('response', response => { if (response.status() >= 400 && ['script', 'stylesheet'].includes(response.request().resourceType())) record.errors.push(`${response.status()} ${response.url()}`); });
    async function load(hash = '') { await page.goto(`${base}/playground/${hash}`, { waitUntil: 'load' }); await page.waitForFunction(() => document.querySelector('#stuntStage')?.dataset.phase && !document.documentElement.classList.contains('i18n-pending')); await page.evaluate(() => document.fonts.ready); await settled(page); }
    await load();
    await t.test('brand, one top feature, default jets and old hash compatibility', async () => {
      assert.match(await page.title(), /Tflip/); assert.equal(await page.locator('#stunt').count(), 1); assert.equal(await page.locator('#roadsterStage,#rampStage').count(), 0);
      assert.equal(await page.locator('#stuntJet').isChecked(), true);
      const positions = await page.evaluate(() => ({ feature: document.querySelector('#stunt').getBoundingClientRect().top, gallery: document.querySelector('#showcaseGrid').getBoundingClientRect().top })); assert.ok(positions.feature < positions.gallery);
      for (const alias of ['roadster', 'ramp']) { await load(`#${alias}`); assert.equal(new URL(page.url()).hash, '#stunt'); }
      record.compatibility = { aliases: ['roadster', 'ramp'], featureCount: 1, defaultJet: true }; await save();
    });
    await t.test('pause, seek, visible jet toggle, speed, resume, replay, cancel and finish', async () => {
      await load(); await click(page, '#stuntPlay'); await page.waitForFunction(() => Number(document.querySelector('#stuntSeek').value) > 12); await click(page, '#stuntPause'); await seek(page, 5508);
      await page.locator('#stuntCanvas').evaluate(canvas => { for (let i = 0; i < 6; i++) canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height); document.querySelector('#stuntJet').dispatchEvent(new Event('change')); });
      const paused = await snapshot(page); await page.waitForTimeout(100); assert.deepEqual(await snapshot(page), paused); assert.ok(paused.colors > 20 && paused.width > 100 && paused.height > 100); assert.equal(paused.state, 'paused');
      await value(page, '#stuntJet', false); const off = await snapshot(page); assert.notEqual(off.hash, paused.hash); assert.equal(off.progress, paused.progress); await value(page, '#stuntJet', true); assert.equal((await snapshot(page)).hash, paused.hash);
      await value(page, '#stuntSpeed', .35); await click(page, '#stuntPause'); const start = await snapshot(page); await page.waitForTimeout(240); const slow = await snapshot(page); const slowAdvance = slow.progress - start.progress; assert.ok(slowAdvance > 2 && slowAdvance < 18, `0.35x progress ${slowAdvance}`);
      await value(page, '#stuntSpeed', 2); const fastStart = await snapshot(page); await page.waitForTimeout(240); const fast = await snapshot(page); assert.ok(fast.progress - fastStart.progress > slowAdvance * 2);
      await click(page, '#stuntPlay'); assert.ok((await snapshot(page)).progress < 50, 'Replay restarts the same timeline'); await click(page, '#stuntCancel'); await settled(page); const cancelled = await snapshot(page); assert.equal(cancelled.progress, 0); assert.equal(cancelled.playing, 'false'); assert.equal(cancelled.frames, 0);
      await seek(page, STUNT_DURATION - 120); await click(page, '#stuntPause'); await page.waitForFunction(() => document.querySelector('#stuntSeek').value === '1000' && document.querySelector('#stuntStage').dataset.playing === 'false'); const completed = await snapshot(page); assert.equal(completed.shot, 'roadster'); assert.equal(completed.frames, 0); assert.equal(await page.locator('#stuntPause').isDisabled(), true);
      record.controls = { paused, jetOff: off, slowAdvance, fastAdvance: fast.progress - fastStart.progress, cancelled, completed }; await save();
    });
    await t.test('both complete shots remain visible on desktop and mobile and seek deterministically', async () => {
      await value(page, '#stuntSpeed', 1);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await settled(page);
        const shots = width === 1440 ? keyframes : keyframes.filter(([, time]) => [3000, 5500, 7900, 8000, 10900, 13400, 13800].includes(time));
        const hashes = new Set();
        for (const [name, time] of shots) {
          await seek(page, time); const state = await snapshot(page); assert.ok(state.colors > 20); hashes.add(state.hash);
          const bounds = await page.evaluate(() => { const r = document.querySelector('#stuntStage').getBoundingClientRect(); return { left: r.left, right: r.right, documentWidth: document.documentElement.scrollWidth, viewport: innerWidth }; }); assert.ok(bounds.left >= -1 && bounds.right <= width + 1 && bounds.documentWidth <= width + 1);
          const filename = `stunt-${engine}-${width}-${name}.png`; await page.locator('#stuntStage').screenshot({ path: `${results}/${filename}` }); record.keyframes.push({ width, name, time, filename, state, bounds });
        }
        assert.ok(hashes.size >= Math.min(6, shots.length), 'Both shots produce distinct poses; adjacent cut samples may rasterize identically');
        await seek(page, 10900); const first = await snapshot(page); await seek(page, 3000); await seek(page, 10900); assert.equal((await snapshot(page)).hash, first.hash, 'Backward seeks across the cut reproduce the original shot, camera and particles');
      }
      await save();
    });
    await t.test('hard-cut boundary and backward seeks match each independent original renderer pixel-for-pixel', async () => {
      await value(page, '#stuntJet', true); record.originalRenderComparisons = [];
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await settled(page);
        for (const time of [7999.99, 8000, 8000.01, 10900, 3000, 8000, 7999.99, 13800]) {
          const comparison = await compareOriginal(page, time);
          assert.equal(comparison.actualShot, comparison.expectedShot, JSON.stringify(comparison)); assert.ok(comparison.dimensionsMatch);
          assert.equal(comparison.differentChannels, 0, JSON.stringify(comparison));
          record.originalRenderComparisons.push({ width, requestedTime: time, ...comparison });
        }
        const first = record.originalRenderComparisons.at(-8), cut = record.originalRenderComparisons.at(-7);
        assert.notEqual(first.actualHash, cut.actualHash, 'A direct visible cut replaces the first shot at 8 s');
      }
      await save();
    });
    await t.test('live and initial reduced motion settle to the final scene without scheduled animation', async () => {
      await page.setViewportSize({ width: 1440, height: 1000 }); await click(page, '#stuntPlay'); await page.waitForFunction(() => document.querySelector('#stuntStage').dataset.playing === 'true'); await page.emulateMedia({ reducedMotion: 'reduce' }); await settled(page);
      await page.locator('#stuntCanvas').evaluate(canvas => { for (let i = 0; i < 6; i++) canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height); document.querySelector('#stuntJet').dispatchEvent(new Event('change')); });
      const live = await snapshot(page); assert.equal(live.progress, 1000); assert.equal(live.shot, 'roadster'); assert.equal(live.frames, 0); assert.equal(live.playing, 'false');
      await value(page, '#stuntJet', false); assert.equal((await snapshot(page)).hash, live.hash, 'Reduced motion disables plume effects'); await value(page, '#stuntJet', true); assert.equal((await snapshot(page)).hash, live.hash);
      await load(); await click(page, '#stuntPlay'); const initial = await snapshot(page); assert.equal(initial.progress, 1000); assert.equal(initial.shot, 'roadster'); assert.equal(initial.frames, 0); await seek(page, 3000); assert.equal((await snapshot(page)).progress, 1000);
      record.reducedMotion = { live, initial }; await save();
    });
    await t.test('teardown cancels the clock and releases the wrapper', async () => {
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await load(); const initialStyle = await page.locator('#stuntDriver').getAttribute('style'); await click(page, '#stuntPlay'); await page.waitForFunction(() => document.querySelector('#stuntStage').dataset.playing === 'true'); await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await settled(page);
      assert.equal(await page.evaluate(() => __stuntFrames.size), 0); assert.equal(await page.locator('#stuntDriver').getAttribute('style'), initialStyle); assert.equal(await page.locator('[data-tflip-particles],[data-tflip-overlay]').count(), 0);
      record.teardown = { frames: 0, driverRestored: true, transientNodes: 0 }; assert.deepEqual(record.errors, []); await save();
    });
  });
  if (engines.includes('brave')) await t.test('Brave software Canvas reproduces exact frames after arbitrary seeks', { timeout: 45000 }, async t => {
    // Linux headless Canvas exposed history-dependent pixels that the macOS
    // accelerated backend did not. Exercise that backend on every Brave host.
    const browser = await launchBrowser('brave', { softwareCanvas: true }); t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' }); t.after(() => context.close());
    const page = await context.newPage();
    const record = evidence.softwareCanvas = { version: browser.version(), errors: [], originalRenderComparisons: [], repeatedFrames: [] };
    page.on('pageerror', error => record.errors.push(error.message));
    await page.goto(`${base}/playground/`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#stuntStage')?.dataset.phase && !document.documentElement.classList.contains('i18n-pending'));
    await page.evaluate(() => document.fonts.ready);
    record.readbackCalibration = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
      const context = canvas.getContext('2d'), expected = context.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < expected.data.length; i += 4) { expected.data[i] = i % 251; expected.data[i + 1] = (i * 3) % 251; expected.data[i + 2] = (i * 7) % 251; expected.data[i + 3] = 255; }
      context.putImageData(expected, 0, 0);
      const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let differentChannels = 0;
      for (let i = 0; i < actual.length; i++) if (actual[i] !== expected.data[i]) differentChannels++;
      return { channels: actual.length, differentChannels };
    });
    assert.equal(record.readbackCalibration.differentChannels, 0, 'The isolated pixel profile must disable Brave readback farbling');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await settled(page);
      for (const time of [8000, 10900, 8000, 7999.99, 10900, 3000, 8000, 13800]) {
        const comparison = await compareOriginal(page, time);
        record.originalRenderComparisons.push({ width, requestedTime: time, ...comparison });
        assert.equal(comparison.actualShot, comparison.expectedShot, JSON.stringify(comparison)); assert.ok(comparison.dimensionsMatch);
        assert.equal(comparison.differentChannels, 0, JSON.stringify(comparison));
      }
      // The compatibility branch must preserve the same determinism on Canvas
      // implementations without reset(), not just on current browser engines.
      const resetDescriptor = await page.evaluateHandle(() => Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'reset'));
      try {
        for (const fallback of [false, true]) {
          if (fallback) await page.evaluate(() => Object.defineProperty(CanvasRenderingContext2D.prototype, 'reset', { configurable: true, writable: true, value: undefined }));
          // Disable the method for all internal scene buffers and fresh references.
          assert.equal(await page.evaluate(() => typeof CanvasRenderingContext2D.prototype.reset === 'undefined'), fallback);
          await seek(page, 8000); const first = await compareOriginal(page, 8000);
          await seek(page, 10900); const repeated = await compareOriginal(page, 8000);
          record.repeatedFrames.push({ width, fallback, firstHash: first.actualHash, repeatedHash: repeated.actualHash });
          assert.equal(repeated.actualHash, first.actualHash, `History-independent pixels at ${width}px, reset fallback=${fallback}`);
          assert.equal(repeated.differentChannels, 0, JSON.stringify(repeated));
        }
      } finally {
        await page.evaluate(descriptor => Object.defineProperty(CanvasRenderingContext2D.prototype, 'reset', descriptor), resetDescriptor);
        await resetDescriptor.dispose();
      }
    }
    assert.deepEqual(record.errors, []); await save();
  });
  evidence.completedAt = new Date().toISOString(); assert.deepEqual(await hashes(), evidence.sources, 'Evidence must cover a frozen source version'); await save();
});
