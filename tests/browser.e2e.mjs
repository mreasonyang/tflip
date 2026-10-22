import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, testEngines } from './helpers/browser.mjs';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = 4187;
const base = `http://127.0.0.1:${port}`;

async function startServer() {
  const server = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = '';
  server.stderr.on('data', chunk => { diagnostics += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Static server failed to start')), 10000);
    server.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { if (code) { clearTimeout(timer); reject(new Error(`Static server exit ${code}: ${diagnostics}`)); } });
  });
  return server;
}

test('real browser lifecycle, rendering, accessibility and responsive checks', { timeout: 120000 }, async t => {
  await mkdir(new URL('../test-results/tflip-regression/', import.meta.url), { recursive: true });
  const server = await startServer();
  const versions = {};
  t.after(() => server.kill());
  for (const engine of testEngines('BROWSER_ENGINE')) {
    await t.test(engine, { timeout: 55000 }, async t => {
      const browser = await launchBrowser(engine);
      versions[engine] = browser.version();
      await writeFile(`${root}/test-results/tflip-regression/browser-versions.json`, JSON.stringify(versions, null, 2) + '\n');
      t.after(() => browser.close());
      const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1200, height: 850 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (response.status() >= 400 && ['script', 'stylesheet'].includes(response.request().resourceType())) errors.push(`${response.status()} ${response.url()}`);
      });
      async function reset() {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.goto(`${base}/tests/fixture.html`);
        await page.evaluate(async () => {
          window.motion = await import('/dist/dom/index.js');
          window.particles = (await import('/dist/effects/index.js')).createParticles;
          window.makeVisual = () => {
            const card = document.createElement('div');
            card.className = 'card'; card.innerHTML = '<strong>Tflip</strong>Decorative flight';
            return card;
          };
          window.options = () => ({ from: document.querySelector('#source'), to: document.querySelector('#target'), visual: makeVisual, duration: 220, height: 100, shadow: true, reducedMotion: 'never' });
        });
      }

      await t.test('transfer completes ordered events and cleans generated nodes, focus and originals survive', async () => {
        await reset();
        const result = await page.evaluate(async () => {
          const button = document.querySelector('#business'); button.focus();
          const original = document.body.innerHTML;
          const events = [];
          const p = motion.play({ ...options(), effects: particles({ jet: true, trail: true, seed: 7 }), onStart: () => events.push('start'), onLand: () => events.push('land'), onFinish: () => events.push('finish') });
          const outcome = await p.finished;
          return { outcome, events, status: p.status, unchanged: document.body.innerHTML === original, focus: document.activeElement === button, transform: button.style.transform };
        });
        assert.equal(result.outcome.status, 'finished');
        assert.deepEqual(result.events, ['start', 'land', 'finish']);
        assert.equal(result.unchanged, true);
        assert.equal(result.focus, true);
        assert.equal(result.transform, '');
      });

      await t.test('paused seek renders motion and resumes, cancellation restores wrapper styles', async () => {
        await reset();
        await page.evaluate(() => {
          const wrapper = document.querySelector('#wrapper');
          window.p = motion.play({ element: wrapper, height: 100, duration: 700, autoplay: false, reducedMotion: 'never', shadow: true });
          p.seek(.5);
        });
        const pose = await page.evaluate(() => ({ status: p.status, time: p.currentTime, transform: document.querySelector('#wrapper').style.transform, childTransform: getComputedStyle(document.querySelector('#business')).transform }));
        assert.equal(pose.status, 'paused');
        assert.equal(pose.time, 350);
        assert.notEqual(pose.transform, '');
        assert.notEqual(pose.childTransform, 'none');
        await page.screenshot({ path: `${root}/test-results/tflip-regression/${engine}-in-place.png` });
        const pausedTime = await page.evaluate(() => p.currentTime);
        await page.waitForTimeout(70);
        assert.equal(await page.evaluate(() => p.currentTime), pausedTime);
        const outcome = await page.evaluate(async () => { p.resume(); p.cancel(); return p.finished; });
        assert.equal(outcome.status, 'cancelled');
        assert.equal(await page.locator('#wrapper').getAttribute('style'), null);
      });

      await t.test('replace, ignore and queue settle every handle without overlap', async () => {
        await reset();
        const result = await page.evaluate(async () => {
          const first = motion.play({ ...options(), duration: 400 });
          const ignored = motion.play({ ...options(), repeat: 'ignore' });
          const second = motion.play({ ...options(), repeat: 'replace' });
          const queued = motion.play({ ...options(), repeat: 'queue' });
          const queuedStatus = queued.status;
          const outcomes = await Promise.all([first.finished, second.finished, queued.finished]);
          return { same: first === ignored, queuedStatus, outcomes };
        });
        assert.equal(result.same, true);
        assert.equal(result.queuedStatus, 'queued');
        assert.equal(result.outcomes[0].status, 'cancelled');
        assert.equal(result.outcomes[0].reason, 'replaced');
        assert.deepEqual(result.outcomes.slice(1).map(x => x.status), ['finished', 'finished']);
      });

      await t.test('depth is projected through perspective while preserving the viewport center', async () => {
        await reset();
        await page.evaluate(() => {
          window.p = motion.play({
            from: { x: 400, y: 320, z: 200 }, to: { x: 400, y: 320, z: 200 },
            visual: makeVisual, size: { width: 200, height: 100 }, perspective: 1000,
            height: 0, depth: 0, turns: 0, autoplay: false, reducedMotion: 'never',
          });
        });
        const box = await page.locator('[data-tflip-overlay] .card').boundingBox();
        assert.ok(Math.abs(box.width - 250) < 1, `Projected width ${box.width}`);
        assert.ok(Math.abs(box.x + box.width / 2 - 400) < 1);
        assert.ok(Math.abs(box.y + box.height / 2 - 320) < 1);
        await page.evaluate(() => p.cancel());
      });

      await t.test('reduced motion completes without animated transforms or effects', async () => {
        await reset();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const result = await page.evaluate(async () => {
          let createdEffects = 0;
          const before = document.body.innerHTML;
          const p = motion.play({ ...options(), reducedMotion: 'system', effects: () => { createdEffects++; return { render() {}, dispose() {} }; } });
          const outcome = await p.finished;
          return { outcome, createdEffects, same: document.body.innerHTML === before };
        });
        assert.equal(result.outcome.status, 'finished');
        assert.equal(result.createdEffects, 0);
        assert.equal(result.same, true);
      });

      await t.test('layout change and source detachment cancel and clean', async () => {
        await reset();
        await page.evaluate(() => { window.p = motion.play({ ...options(), duration: 2000 }); });
        await page.waitForTimeout(30);
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        assert.equal((await page.evaluate(() => p.finished)).status, 'cancelled');
        await page.evaluate(() => { window.p = motion.play({ ...options(), duration: 2000 }); });
        await page.waitForTimeout(30);
        await page.evaluate(() => document.querySelector('#source').remove());
        assert.equal((await page.evaluate(() => p.finished)).status, 'cancelled');
        assert.equal(await page.locator('canvas').count(), 0);
      });

      await t.test('sequences support complete, seek and cancellation without subsequent steps', async () => {
        await reset();
        const result = await page.evaluate(async () => {
          const events = [];
          const steps = [0, 1, 2].map(i => ({ ...options(), duration: 90, onStart: () => events.push(i) }));
          const seq = motion.sequence(steps);
          const complete = await seq.finished;
          const next = seq.replay(); next.pause(); next.seek(.6); const progress = next.progress; next.cancel();
          const cancelled = await next.finished;
          return { complete, cancelled, progress, events };
        });
        assert.equal(result.complete.status, 'finished');
        assert.equal(result.cancelled.status, 'cancelled');
        assert.ok(Math.abs(result.progress - .6) < .02);
        assert.deepEqual(result.events.slice(0, 3), [0, 1, 2]);
      });

      await t.test('Playground loads without runtime errors and fits desktop/mobile', async () => {
        await page.goto(`${base}/playground/`);
        await page.waitForFunction(() => document.querySelector('#codePreview')?.textContent.includes('import'));
        assert.ok(await page.locator('button').count() > 5);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.locator('[data-preset="snappy"]').click();
        await page.locator('#playButton').scrollIntoViewIfNeeded();
        await page.waitForTimeout(120); // Settle scrolling before testing default layout:'cancel'.
        await page.locator('#playButton').click();
        await page.waitForTimeout(200);
        assert.ok(await page.locator('[data-tflip-overlay]').count() > 0, await page.locator('#eventLog').innerText());
        await page.screenshot({ path: `${root}/test-results/tflip-regression/${engine}-flight.png` });
        await page.locator('#cancelButton').click();
        await page.waitForTimeout(30);
        assert.equal(await page.locator('[data-tflip-overlay]').count(), 0);
        await page.locator('[data-mode="in-place"]').click();
        await page.locator('#playButton').scrollIntoViewIfNeeded();
        await page.waitForTimeout(120);
        await page.locator('#playButton').click();
        await page.waitForTimeout(150);
        assert.notEqual(await page.locator('#localWrapper').evaluate(node => node.style.transform), '');
        await page.locator('#cancelButton').click();
        await page.locator('#duration').press('Home');
        await page.locator('#playButton').scrollIntoViewIfNeeded();
        await page.waitForTimeout(120);
        for (let run = 0; run < 3; run++) {
          await page.locator('#playButton').click();
          await page.waitForFunction(() => document.querySelector('#playbackStatus')?.textContent === '已完成');
        }
        assert.equal(await page.locator('[data-tflip-overlay]').count(), 0);
        await page.screenshot({ path: `${root}/test-results/tflip-regression/${engine}-playground-desktop.png`, fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.screenshot({ path: `${root}/test-results/tflip-regression/${engine}-playground-mobile.png`, fullPage: true });
        assert.deepEqual(errors, []);
      });
    });
  }
});
