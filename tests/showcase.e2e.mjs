import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, testEngines } from './helpers/browser.mjs';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// WebKit navigation stalls on 4190 in this local environment; 4191 works in
// both engines and stays independent from browser.e2e.mjs's 4187 server.
const port = 4191;
const base = `http://127.0.0.1:${port}`;
const engines = testEngines('SHOWCASE_ENGINE');
const scenes = [
  { id: 'orbit', objects: 1 },
  { id: 'portal', objects: 1 },
  { id: 'vinyl', objects: 1 },
  { id: 'candy', objects: 5 },
  { id: 'arcade', objects: 1 },
  { id: 'paper', objects: 3 },
];

async function startServer() {
  const server = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(port)], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  server.stderr.on('data', chunk => { diagnostics += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { server.kill(); reject(new Error('Showcase server failed to start')); }, 10000);
    server.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => {
      if (code) { clearTimeout(timer); reject(new Error(`Showcase server exit ${code}: ${diagnostics}`)); }
    });
  });
  return server;
}

test('creative showcase plays, cleans up and respects motion preferences in real browsers', { timeout: 150000 }, async t => {
  await mkdir(`${root}/test-results/tflip-regression/`, { recursive: true });
  const server = await startServer();
  t.after(() => server.kill());
  const versions = {};

  for (const engine of engines) {
    await t.test(engine, { timeout: 70000 }, async t => {
      const browser = await launchBrowser(engine);
      t.after(() => browser.close());
      versions[engine] = browser.version();
      await writeFile(`${root}/test-results/tflip-regression/showcase-browser-versions.json`, JSON.stringify(versions, null, 2) + '\n');

      const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
      });
      page.on('response', response => {
        if (response.status() >= 400 && ['script', 'stylesheet'].includes(response.request().resourceType())) {
          errors.push(`${response.status()} ${response.url()}`);
        }
      });

      async function load(reducedMotion = 'no-preference') {
        await page.emulateMedia({ reducedMotion });
        await page.goto(`${base}/playground/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelectorAll('#showcaseGrid [data-demo-play]').length === 6);
      }

      async function assertClean() {
        assert.equal(await page.locator('#showcaseGrid .demo-motion').count(), 0, 'No temporary moving nodes remain');
        assert.equal(await page.locator('[data-tflip-overlay]').count(), 0, 'No package overlay remains');
        assert.equal(await page.locator('canvas[data-tflip-particles]').count(), 0, 'No effect canvas remains');
        assert.equal(await page.locator('#showcaseGrid [data-playing="true"]').count(), 0, 'No scene remains active');
      }

      async function waitForAllFinished() {
        await page.waitForFunction(() => {
          const cards = [...document.querySelectorAll('#showcaseGrid [data-demo]')];
          return cards.length === 6 && cards.every(card => card.dataset.completed === 'true' && card.dataset.playing === 'false');
        }, null, { timeout: 8000 });
      }

      async function assertFitsViewport() {
        const result = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
          cards: [...document.querySelectorAll('#showcaseGrid [data-demo]')].map(card => {
            const box = card.getBoundingClientRect();
            return { id: card.dataset.demo, left: box.left, right: box.right };
          }),
        }));
        assert.ok(result.document <= result.viewport + 1, `Page width ${result.document} exceeds ${result.viewport}`);
        for (const card of result.cards) {
          assert.ok(card.left >= -1 && card.right <= result.viewport + 1, `${card.id} extends outside viewport: ${JSON.stringify(card)}`);
        }
      }

      await load();
      if (engine === 'brave') {
        await page.screenshot({ path: `${root}/test-results/tflip-regression/redesign-hero-desktop.png` });
        await page.locator('#showcase').screenshot({ path: `${root}/test-results/tflip-regression/redesign-gallery-desktop.png` });
      }
      for (const scene of scenes) {
        await t.test(`${scene.id}: visible motion finishes and removes every temporary object`, async () => {
          const card = page.locator(`[data-demo="${scene.id}"]`);
          const button = card.locator('[data-demo-play]');
          await button.scrollIntoViewIfNeeded();
          // Scroll and hover are layout changes; settle them before starting a
          // playback whose explicit layout policy is to cancel on scroll.
          await button.hover();
          await page.waitForTimeout(250);
          await button.click();
          await page.waitForFunction(id => {
            const card = document.querySelector(`[data-demo="${id}"]`);
            return card?.dataset.playing === 'true' && Number(card.style.getPropertyValue('--demo-progress')) > .02;
          }, scene.id, { timeout: 3000 });
          assert.equal(await card.locator('.demo-motion').count(), scene.objects);
          const before = await card.locator('.demo-motion').evaluateAll(nodes => nodes.map(node => node.style.transform));
          await page.waitForTimeout(120);
          const after = await card.locator('.demo-motion').evaluateAll(nodes => nodes.map(node => node.style.transform));
          assert.ok(before.some(Boolean), `${scene.id} applies a motion transform`);
          assert.notDeepEqual(after, before, `${scene.id} advances rather than displaying a static pose`);
          await page.waitForFunction(id => {
            const card = document.querySelector(`[data-demo="${id}"]`);
            return card?.dataset.playing === 'false' && card.dataset.completed === 'true';
          }, scene.id, { timeout: 7000 });
          assert.match(await card.locator('[data-demo-status]').innerText(), /演示完成/);
          assert.equal(await card.evaluate(node => node.style.getPropertyValue('--demo-progress')), '1');
          if (scene.id === 'arcade') assert.equal(await card.locator('[data-demo-combo]').innerText(), '03');
          await assertClean();
        });
      }

      await t.test('rapid repeated triggers replace all six scenes without stale objects or late restarts', async () => {
        await load();
        const result = await page.evaluate(() => {
          const buttons = [...document.querySelectorAll('#showcaseGrid [data-demo-play]')];
          buttons.forEach(button => button.click());
          const originals = [...document.querySelectorAll('#showcaseGrid .demo-motion')];
          for (let repeat = 0; repeat < 3; repeat++) buttons.forEach(button => button.click());
          return {
            originalsDetached: originals.every(node => !node.isConnected),
            counts: [...document.querySelectorAll('#showcaseGrid [data-demo]')].map(card => ({
              id: card.dataset.demo, objects: card.querySelectorAll('.demo-motion').length,
            })),
          };
        });
        assert.equal(result.originalsDetached, true, 'Replaced objects are detached immediately');
        assert.deepEqual(result.counts, scenes, 'Only the newest set of scene objects survives replacement');
        await waitForAllFinished();
        await assertClean();
        await page.waitForTimeout(250);
        await assertClean();
      });

      await t.test('reduced motion completes every scene with no persistent movement or CSS animation', async () => {
        await load('reduce');
        const start = Date.now();
        await page.locator('#showcaseGrid [data-demo-play]').evaluateAll(buttons => buttons.forEach(button => button.click()));
        await waitForAllFinished();
        assert.ok(Date.now() - start < 2000, 'Reduced motion does not wait through full animation timelines');
        const statuses = await page.locator('#showcaseGrid [data-demo-status]').allTextContents();
        assert.equal(statuses.length, scenes.length);
        assert.ok(statuses.every(status => status === '简化演示完成'));
        await page.waitForTimeout(150);
        await assertClean();
        const running = await page.locator('#showcaseGrid').evaluate(gallery => gallery.getAnimations({ subtree: true })
          .filter(animation => animation.playState === 'running' || animation.playState === 'pending').length);
        assert.equal(running, 0, 'Decorative portal/equalizer animations also stop under reduced motion');
      });

      await t.test('390px mobile gallery fits before, during and after concurrent playback', async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await load();
        if (engine === 'brave') await page.screenshot({ path: `${root}/test-results/tflip-regression/redesign-hero-mobile.png` });
        await assertFitsViewport();
        await page.locator('#showcaseGrid [data-demo-play]').evaluateAll(buttons => buttons.forEach(button => button.click()));
        await page.waitForFunction(() => document.querySelectorAll('#showcaseGrid .demo-motion').length === 12);
        await page.waitForTimeout(120);
        await assertFitsViewport();
        await waitForAllFinished();
        await assertClean();
        await assertFitsViewport();
        await page.screenshot({ path: `${root}/test-results/tflip-regression/${engine}-showcase-mobile.png`, fullPage: true });
        if (engine === 'brave') await page.locator('#showcase').screenshot({ path: `${root}/test-results/tflip-regression/redesign-gallery-mobile.png` });
      });

      assert.deepEqual(errors, [], 'No browser, module, stylesheet or application console errors');
    });
  }
});
