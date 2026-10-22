import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, testEngines } from './helpers/browser.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const host = join(root, 'test-results/consumer-host');
const output = join(root, 'test-results/consumer-regression');
const base = 'http://127.0.0.1:4211';

const describeError = error => ({ name: error?.name ?? 'Error', message: error?.message ?? String(error) });

// A failed t.test() resolves its promise. Record each callback's outcome and
// aggregate child records instead of treating a resolved promise as a pass.
async function recordOutcome(context, record, save, run) {
  let completed = false;
  record.status = 'running';
  record.startedAt = new Date().toISOString();
  context.after(async () => {
    const children = [...Object.values(record.browsers ?? {}), ...(record.checks ?? [])];
    const childFailed = children.some(child => child.status !== 'passed');
    const failed = record.status === 'failed' || !completed || context.signal.aborted || childFailed;
    record.status = failed ? 'failed' : 'passed';
    record.finishedAt = new Date().toISOString();
    if (failed && !record.error) record.error = describeError(context.signal.aborted
      ? context.signal.reason
      : new Error(childFailed ? 'One or more child checks did not pass.' : 'Test did not complete.'));
    await save();
  });
  await save();
  try { await run(); completed = true; }
  catch (error) { record.status = 'failed'; record.error = describeError(error); throw error; }
}

async function reportCleanup(record, save, cleanup) {
  try { await cleanup(); }
  catch (error) {
    record.status = 'failed'; record.error = describeError(error);
    await save();
    throw error;
  }
}

async function startServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json' };
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, base).pathname;
      const file = resolve(host, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)));
      if (!file.startsWith(host + sep)) { response.writeHead(403).end(); return; }
      const content = await readFile(file);
      response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(content);
    } catch { response.writeHead(404).end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4211, '127.0.0.1', resolve); });
  return server;
}

test('independently installed package works in Vanilla and React StrictMode hosts', { timeout: 300000 }, async t => {
  await mkdir(output, { recursive: true });
  const results = { runId: randomUUID(), status: 'running', browsers: {},
    physicalMobile: 'not tested; mobile viewport is desktop browser emulation' };
  let writing = Promise.resolve();
  const save = () => {
    const content = JSON.stringify(results, null, 2) + '\n';
    writing = writing.then(() => writeFile(join(output, 'verification.json'), content));
    return writing;
  };
  // Overwrite an earlier receipt before building, validating, or launching.
  await recordOutcome(t, results, save, async () => {
    const engines = testEngines('CONSUMER_ENGINE');
    results.selectedEngines = engines;
    results.browsers = Object.fromEntries(engines.map(engine => [engine, { status: 'not-run', checks: [] }]));
    await save();
    execFileSync(process.execPath, ['scripts/build-consumer-fixture.mjs'], { cwd: root, stdio: 'inherit', timeout: 240000 });
    const evidence = JSON.parse(await readFile(join(host, 'fixture-evidence.json'), 'utf8'));
    assert.equal(evidence.typecheck, 'passed'); assert.equal(evidence.ssr.status, 'passed');
    assert.ok(Object.values(evidence.resolutions).every(path => path.startsWith('node_modules/')));
    Object.assign(results, { package: evidence.package, installedVersions: evidence.installedVersions,
      ssr: evidence.ssr.status, typecheck: evidence.typecheck, browserBundleSha256: evidence.browserBundleSha256 });
    await save();
    const server = await startServer();
    t.after(() => reportCleanup(results, save, () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));

    for (const engine of engines) {
      await t.test(engine, { timeout: 90000 }, async t => {
        const record = results.browsers[engine];
        await recordOutcome(t, record, save, async () => {
          const browser = await launchBrowser(engine);
          record.version = browser.version();
          t.after(() => reportCleanup(record, save, () => browser.close()));
          const page = await browser.newPage({ viewport: { width: 1240, height: 1200 }, locale: 'zh-CN' });
          const errors = [];
          record.runtimeErrors = errors;
          page.on('pageerror', error => errors.push(error.message));
          page.on('response', response => {
            if (response.status() >= 400 && ['script', 'stylesheet'].includes(response.request().resourceType())) errors.push(`${response.status()} ${response.url()}`);
          });
          const check = async () => page.evaluate(() => consumer.snapshot());
          const clean = async () => page.waitForFunction(() => {
            const state = consumer.snapshot(); return state.frames === 0 && state.overlays === 0 && state.canvases === 0 && state.liveEffects === 0;
          });
          const open = async (keepMount = false) => {
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            await page.goto(base);
            await page.waitForFunction(() => window.consumer?.snapshot().strictMounts === 2 && consumer.snapshot().react.mounted);
            if (!keepMount) { await page.locator('#react-cancel').click(); await clean(); }
          };
          const waitFinished = async family => page.waitForFunction(family => consumer.latest(family)?.status === 'finished', family);
          const checkTest = (name, run) => {
            const check = { name, status: 'not-run' };
            record.checks.push(check);
            return t.test(name, async context => recordOutcome(context, check, save, run));
          };

          await checkTest('StrictMode repeats mount effects and retains the real business node', async () => {
            await open(true);
            const state = await check();
            assert.equal(state.runs[0].result?.reason, 'disposed'); assert.equal(state.runs[1].status, 'paused');
            assert.equal(state.react.sameBusinessNode, true); assert.equal(state.react.sameParent, true);
            assert.equal(state.react.childTransform, 'rotate(3deg)');
            await page.locator('#react-business').click();
            assert.equal((await check()).react.count, '1');
            await page.locator('#react-cancel').click(); await clean();
          });

          await checkTest('Vanilla buttons pause, seek, resume and repeatedly finish without changing business DOM', async () => {
            await open();
            const initial = (await check()).vanilla.rect;
            await page.locator('#vanilla-play').click();
            await page.waitForFunction(() => consumer.latest('vanilla')?.currentTime > 30);
            await page.locator('#vanilla-pause').click();
            await page.evaluate(() => consumer.latest('vanilla').seek(.5));
            const paused = await check();
            assert.equal(paused.runs.at(-1).status, 'paused'); assert.equal(paused.frames, 0);
            assert.ok(Math.abs(paused.vanilla.rect.centerY - initial.centerY) > 20, 'Real DOM bounds must move during the sampled pose');
            await page.waitForTimeout(100);
            assert.equal((await check()).runs.at(-1).currentTime, paused.runs.at(-1).currentTime);
            await page.screenshot({ path: join(output, `${engine}-consumer-paused.png`), fullPage: true });
            await page.locator('#vanilla-resume').click(); await waitFinished('vanilla'); await clean();
            for (let i = 0; i < 3; i++) { await page.locator('#vanilla-play').click(); await waitFinished('vanilla'); await clean(); }
            await page.locator('#vanilla-business').click();
            const state = await check();
            assert.equal(state.vanilla.sameBusinessNode, true); assert.equal(state.vanilla.sameParent, true);
            assert.equal(state.vanilla.childTransform, 'rotate(-3deg)'); assert.equal(state.vanilla.wrapperStyle, null);
            assert.equal(state.vanilla.count, 1); assert.ok(Math.abs(state.vanilla.rect.centerY - initial.centerY) < .1);
            assert.equal(state.effectCreated, state.effectDisposed);
          });

          await checkTest('transfer decoration uses real anchors and queue controls do not overlap effects', async () => {
            await open();
            await page.locator('#vanilla-transfer').click();
            await page.locator('#vanilla-pause').click();
            await page.evaluate(() => { consumer.latest('vanilla').seek(.5); document.querySelector('#vanilla-business').focus(); });
            const visual = await page.locator('[data-tflip-overlay] .visual').boundingBox();
            const source = await page.locator('#vanilla-wrapper').boundingBox();
            const target = await page.locator('#vanilla-target').boundingBox();
            assert.ok(visual && source && target);
            assert.ok(visual.x + visual.width / 2 > source.x + source.width / 2);
            assert.ok(visual.x + visual.width / 2 < target.x + target.width / 2);
            assert.equal((await check()).activeElement, 'vanilla-business');
            assert.equal((await check()).vanilla.sameParent, true);
            await page.locator('#vanilla-queue').click();
            const queued = await check();
            assert.equal(queued.runs.at(-1).status, 'queued'); assert.equal(queued.liveEffects, 1);
            await page.locator('#vanilla-resume').click(); await waitFinished('vanilla'); await clean();
            assert.equal((await check()).runs.filter(run => run.family === 'vanilla').every(run => run.result.status === 'finished'), true);
          });

          await checkTest('published package preserves landing controls and cancels detached queued targets', async () => {
            await open(); await page.locator('summary').click();
            await page.locator('#land-seek').click();
            await page.waitForFunction(() => consumer.snapshot().landOutcomes.length === 1);
            assert.deepEqual((await check()).landOutcomes[0], { action: 'seek', status: 'running', progress: .5 });
            await waitFinished('vanilla'); await clean();
            await page.locator('#land-pause').click();
            await page.waitForFunction(() => consumer.snapshot().landOutcomes.length === 2);
            assert.deepEqual((await check()).landOutcomes[1], { action: 'pause', status: 'paused', progress: 1 });
            await page.locator('#vanilla-resume').click(); await waitFinished('vanilla'); await clean();
            await page.locator('#queue-detach').click();
            await page.waitForFunction(() => !!consumer.snapshot().detachResult);
            assert.deepEqual((await check()).detachResult, { status: 'cancelled', reason: 'detached' });
            assert.equal((await check()).runs.at(-2).status, 'paused');
            await page.locator('#vanilla-cancel').click(); await clean();
            await page.locator('#invalid-signal').click();
            await page.waitForFunction(() => !!consumer.snapshot().invalidSignalResult);
            const invalid = (await check()).invalidSignalResult;
            assert.match(invalid.message, /AbortSignal/);
            assert.equal(invalid.framesBefore, 0); assert.equal(invalid.framesAfter, 0);
            assert.equal(invalid.overlaysAfter, 0); assert.equal(invalid.runsUnchanged, true); assert.equal(invalid.wrapperUnchanged, true);
          });

          await checkTest('React owns queued and replayed runs through unmount, suppresses callbacks and remounts cleanly', async () => {
            await open();
            await page.locator('#react-play').click(); await page.locator('#react-pause').click();
            await page.locator('#react-business').click();
            assert.equal((await check()).react.sameBusinessNode, true); assert.equal((await check()).react.count, '1');
            await page.locator('#react-queue').click(); await page.locator('#react-replay').click(); await page.locator('#react-queue').click();
            const before = await check(); assert.equal(before.runs.at(-1).status, 'queued');
            await page.locator('#react-unmount').click(); await clean();
            await page.waitForTimeout(80);
            const unmounted = await check();
            assert.equal(unmounted.react.mounted, false); assert.equal(unmounted.hookCallbacks, before.hookCallbacks);
            assert.equal(unmounted.runs.filter(run => run.family === 'react').every(run => ['finished', 'cancelled'].includes(run.status)), true);
            assert.equal(unmounted.runs.at(-1).result.reason, 'disposed');
            await page.locator('#react-mount').click();
            await page.waitForFunction(() => consumer.snapshot().strictMounts === 4);
            await page.locator('#react-play').click(); await waitFinished('react'); await clean();
            assert.equal((await check()).react.sameParent, true);
          });

          await checkTest('system reduced motion completes both consumers and releases paused effects when changed', async () => {
            await open(); const before = (await check()).effectCreated;
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.locator('#vanilla-play').click(); await waitFinished('vanilla');
            await page.locator('#react-play').click(); await waitFinished('react'); await clean();
            assert.equal((await check()).effectCreated, before);
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            await page.locator('#react-play').click(); await page.locator('#react-pause').click();
            assert.equal((await check()).liveEffects, 1);
            await page.emulateMedia({ reducedMotion: 'reduce' }); await waitFinished('react'); await clean();
            assert.equal((await check()).runs.at(-1).progress, 1);
          });

          await checkTest('consumer host fits a narrow viewport without presenting it as physical-device evidence', async () => {
            await open(); await page.setViewportSize({ width: 390, height: 844 });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
            await page.screenshot({ path: join(output, `${engine}-consumer-narrow.png`), fullPage: true });
          });
          assert.deepEqual(errors, []);
          record.finalState = await check();
        });
      });
    }
  });
});
