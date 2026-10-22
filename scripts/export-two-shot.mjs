#!/usr/bin/env node
// Explicit offline capture of a reviewed source revision. This samples the
// public seek control; it is not a real-time playback performance recording.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'test-results');
const viewport = { width: 1440, height: 1300 };
const fps = 30, durationSeconds = 13.8, durationMs = 13800, cutMs = 8000, frameCount = 414;
const cutFrame = 240;
const browserExecutable = process.env.BRAVE_EXECUTABLE || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const ffmpeg = process.env.FFMPEG_EXECUTABLE || 'ffmpeg';
const ffprobe = process.env.FFPROBE_EXECUTABLE || 'ffprobe';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const children = new Set();
let interrupted = false;
let keyframeProgress = 0.79;

function usage() {
  console.log('Usage: node scripts/export-two-shot.mjs [--keyframe 0.79]\n' +
    'Exports test-results/two-shot-video.mp4, two-shot-video.png, and two-shot-video-export.json.\n' +
    'Requires Brave, ffmpeg (libx264), ffprobe, an existing build, and the completed 13.8-second two-shot demo.\n' +
    'Overrides: BRAVE_EXECUTABLE, FFMPEG_EXECUTABLE, FFPROBE_EXECUTABLE.\n' +
    'Uses an ephemeral loopback port; makes no external requests.\n' +
    'This is a deterministic timeline sampling export, not real-time performance recording.');
}
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) { usage(); process.exit(0); }
for (let index = 0; index < args.length; index++) {
  if (args[index] !== '--keyframe' || index + 1 >= args.length) throw new Error(`Unknown/incomplete argument: ${args[index]}`);
  keyframeProgress = Number(args[++index]);
}
assert.ok(Number.isFinite(keyframeProgress) && keyframeProgress >= 0 && keyframeProgress <= 1, '--keyframe must be between 0 and 1');

function checkInterrupted() { if (interrupted) throw new Error('Tflip export interrupted; temporary frames will be removed.'); }
const signal = () => {
  interrupted = true;
  for (const child of children) child.kill('SIGTERM');
};
process.once('SIGINT', signal);
process.once('SIGTERM', signal);

async function program(executable, arguments_, timeoutMs = 60000) {
  checkInterrupted();
  return new Promise((resolveProgram, reject) => {
    const child = spawn(executable, arguments_, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-100000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    child.once('error', error => { clearTimeout(timeout); children.delete(child); reject(error); });
    child.once('close', code => {
      clearTimeout(timeout); children.delete(child);
      if (code === 0) resolveProgram(stdout);
      else reject(new Error(`${executable} failed (${code ?? 'signal'}): ${stderr || 'no stderr'}`));
    });
  });
}

// Bind output to the entire page/module/style graph, including its built SDK.
// This deliberately covers more than the visible feature: shared theme,
// translations, and Agent catalog can also affect the captured page.
async function sourceSnapshot() {
  const found = new Map();
  async function visit(file) {
    file = resolve(file);
    assert.ok(file.startsWith(root + sep), `Source escaped project root: ${file}`);
    if ((await stat(file)).isDirectory()) {
      for (const entry of await readdir(file, { withFileTypes: true })) {
        if (entry.isDirectory() || /\.(?:html|css|m?js|json)$/.test(entry.name)) await visit(resolve(file, entry.name));
      }
      return;
    }
    found.set(relative(root, file).split(sep).join('/'), sha(await readFile(file)));
  }
  for (const file of ['playground', 'dist', 'agent/catalog.json', 'scripts/export-two-shot.mjs', 'package.json', 'package-lock.json']) {
    await visit(resolve(root, file));
  }
  const files = Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b)));
  return { sha256: sha(JSON.stringify(files)), files };
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const servedFiles = new Map();
async function startServer() {
  const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let file = resolve(root, `.${path === '/' ? '/playground/' : path}`);
      if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      const bytes = await readFile(file);
      const name = relative(root, file).split(sep).join('/');
      const hash = sha(bytes);
      if (servedFiles.has(name)) assert.equal(servedFiles.get(name), hash, `Served file changed: ${name}`);
      servedFiles.set(name, hash);
      response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(404).end('Not found'); }
  });
  await new Promise((ready, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ready); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function seek(page, progress) {
  checkInterrupted();
  const value = progress * 1000;
  const sampled = await page.locator('#stuntSeek').evaluate((input, value) => {
    if (Number(input.min) !== 0 || Number(input.max) !== 1000) throw new Error('Expected #stuntSeek range 0..1000');
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return Number(input.value);
  }, value);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  assert.equal(await page.locator('#stuntStage').getAttribute('data-playing'), 'false', 'Timeline export must stay paused');
  assert.ok(Math.abs(sampled - value) < 1e-8, 'Timeline did not accept the unquantized sample');
  const timelineMs = sampled / 1000 * durationMs;
  const shot = await page.locator('#stuntStage').getAttribute('data-shot');
  const phase = await page.locator('#stuntStage').getAttribute('data-phase');
  const expectedShot = progress * durationMs < cutMs ? 'ramp' : 'roadster';
  assert.equal(shot, expectedShot, `Wrong shot at ${timelineMs}ms`);
  return { sliderValue: sampled, progress: sampled / 1000, timelineMs, shot, phase };
}

function pngDimensions(bytes) {
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', 'Screenshot must be PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function verifyFastStart(bytes) {
  const boxes = [];
  for (let offset = 0; offset + 8 <= bytes.length;) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (size === 1) size = Number(bytes.readBigUInt64BE(offset + 8));
    if (size === 0) size = bytes.length - offset;
    assert.ok(size >= 8 && offset + size <= bytes.length, 'Malformed MP4 top-level box');
    boxes.push(type); offset += size;
  }
  assert.ok(boxes.indexOf('moov') >= 0 && boxes.indexOf('moov') < boxes.indexOf('mdat'), 'MP4 must have faststart metadata before media data');
  return boxes;
}

let browser, server, temporary;
try {
  const sources = await sourceSnapshot();
  const encoderVersion = (await program(ffmpeg, ['-version'])).split('\n')[0];
  await program(ffprobe, ['-version']);
  await mkdir(output, { recursive: true });
  temporary = await mkdtemp(resolve(output, '.two-shot-video-'));
  const local = await startServer();
  server = local.server;
  const base = local.base;
  browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'UTC', colorScheme: 'dark', reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Source capture never fetches external source videos, fonts, or services.
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(`${base}/playground/`, { waitUntil: 'networkidle' });
  await page.locator('#stunt').waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready);
  const timeline = await page.evaluate(async () => { const m = await import('/playground/stunt-motion.js'); return { duration: m.STUNT_DURATION, cut: m.STUNT_CUT }; });
  assert.deepEqual(timeline, { duration: durationMs, cut: cutMs }, 'This export expects the 8s ramp / 5.8s Roadster edit');
  assert.equal(await page.locator('#stuntSeek').getAttribute('step'), 'any', 'Subframe cut verification requires an unquantized UI slider');
  assert.equal(await page.locator('#stuntJet').isChecked(), true, 'Stunt jets must default to enabled');
  assert.match(await page.title(), /Tflip/, 'The source page must use Tflip branding');
  await page.addStyleTag({ content: 'html{scroll-behavior:auto!important} #stunt,#stunt *{transition:none!important;animation:none!important}' });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.mouse.move(0, 0);
  await seek(page, 0);
  const bounds = await page.evaluate(() => {
    const feature = document.querySelector('#stunt').getBoundingClientRect();
    const header = document.querySelector('.site-header').getBoundingClientRect();
    const box = rect => ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    return { feature: box(feature), header: box(header), wordmark: document.querySelector('.wordmark')?.textContent.trim() };
  });
  assert.match(bounds.wordmark, /Tflip/, 'The captured header must include Tflip');
  // Leave breathing room for the rotated brand symbol beyond its layout box.
  const padding = 8;
  const x = Math.max(0, Math.floor(Math.min(bounds.feature.x, bounds.header.x)) - padding);
  const y = Math.max(0, Math.floor(Math.min(bounds.feature.y, bounds.header.y)));
  const right = Math.min(viewport.width, Math.max(bounds.feature.x + bounds.feature.width, bounds.header.x + bounds.header.width) + padding);
  const bottom = Math.max(bounds.feature.y + bounds.feature.height, bounds.header.y + bounds.header.height);
  const clip = { x, y, width: Math.ceil((right - x) / 2) * 2, height: Math.ceil((bottom - y) / 2) * 2 };
  assert.ok(clip.width % 2 === 0 && clip.height % 2 === 0, 'H.264 crop dimensions must be even');
  assert.ok(clip.x + clip.width <= viewport.width && clip.y + clip.height <= viewport.height, 'Header and entire feature must fit the fixed viewport');
  // Fixed-viewport capture avoids triggering the demo's resize cancellation.
  const screenshot = () => page.screenshot({ type: 'png', clip, animations: 'disabled', caret: 'hide', scale: 'css' });
  const keyframe = await seek(page, keyframeProgress);
  const preview = await screenshot();
  assert.deepEqual(pngDimensions(preview), { width: clip.width, height: clip.height });
  await seek(page, 0.18);
  await seek(page, keyframeProgress);
  assert.equal(sha(await screenshot()), sha(preview), 'Keyframe changed after an out-of-order seek');
  await writeFile(resolve(temporary, 'two-shot-video.png'), preview);

  const frames = [];
  const keyframes = [];
  const cutBoundary = [];
  // These probes establish that the cut is a direct switch, including seeks in
  // reverse. The timeline deliberately has no blended or shared-world frames.
  for (const [label, milliseconds] of [['before', cutMs - .001], ['at', cutMs], ['after', cutMs + .001]]) {
    const sample = await seek(page, milliseconds / durationMs);
    const bytes = await screenshot();
    const name = `two-shot-video-cut-${label}.png`;
    await writeFile(resolve(temporary, name), bytes);
    cutBoundary.push({ label, requestedTimeMs: milliseconds, ...sample, path: `test-results/${name}`, sha256: sha(bytes) });
  }
  assert.notEqual(cutBoundary[0].sha256, cutBoundary[1].sha256, 'Cut must replace the full scene');
  await seek(page, (cutMs - .001) / durationMs);
  assert.equal(sha(await screenshot()), cutBoundary[0].sha256, 'Reverse seek across cut must reproduce the first shot');
  await seek(page, cutMs / durationMs);
  assert.equal(sha(await screenshot()), cutBoundary[1].sha256, 'Forward seek across cut must reproduce the second shot');
  const keyframeIndices = new Set([0, 90, 141, 180, 239, 240, 270, 306, 360, 413]);
  for (let index = 0; index < frameCount; index++) {
    // The direct cut lands exactly on video frame 240 at 8.000 seconds. Pin
    // only the last frame to the terminal pose so the final landing is visible.
    const timelineMs = index === frameCount - 1 ? durationMs : index * 1000 / fps;
    const sample = await seek(page, timelineMs / durationMs);
    const bytes = await screenshot();
    assert.deepEqual(pngDimensions(bytes), { width: clip.width, height: clip.height }, `Frame ${index} changed crop size`);
    await writeFile(resolve(temporary, `frame-${String(index).padStart(4, '0')}.png`), bytes);
    frames.push({ index, ...sample, sha256: sha(bytes) });
    if (keyframeIndices.has(index)) {
      const name = `two-shot-video-keyframe-${String(index).padStart(3, '0')}.png`;
      await writeFile(resolve(temporary, name), bytes);
      keyframes.push({ path: `test-results/${name}`, index, ...sample, sha256: sha(bytes) });
    }
    if ((index + 1) % fps === 0) console.log(`Tflip samples: ${index + 1}/${frameCount}`);
  }
  assert.equal(frames[cutFrame - 1].shot, 'ramp');
  assert.equal(frames[cutFrame].shot, 'roadster');
  assert.ok(Math.abs(frames[cutFrame].timelineMs - cutMs) < 1e-7);
  assert.equal(frames.at(-1).timelineMs, durationMs);
  assert.deepEqual(errors, [], 'Browser errors must be resolved before final export');
  assert.equal((await sourceSnapshot()).sha256, sources.sha256, 'Sources changed during export; review and rerun final revision');
  for (const [file, hash] of servedFiles) assert.equal(hash, sources.files[file], `Served resource not covered by source snapshot: ${file}`);

  const video = resolve(temporary, 'two-shot-video.mp4');
  await program(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps),
    '-i', resolve(temporary, 'frame-%04d.png'), '-frames:v', String(frameCount),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', video]);
  const probe = JSON.parse(await program(ffprobe, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_frames:format=duration', '-of', 'json', video]));
  const stream = probe.streams[0];
  assert.equal(stream.codec_name, 'h264');
  assert.equal(stream.pix_fmt, 'yuv420p');
  assert.equal(stream.r_frame_rate, `${fps}/1`);
  assert.equal(Number(stream.nb_frames), frameCount);
  assert.equal(stream.width, clip.width);
  assert.equal(stream.height, clip.height);
  assert.ok(Math.abs(Number(probe.format.duration) - durationSeconds) < 0.001);
  assert.equal((await sourceSnapshot()).sha256, sources.sha256, 'Sources changed during encoding; final artifacts were not replaced');

  await program(ffmpeg, ['-v', 'error', '-xerror', '-i', video, '-f', 'null', '-']);
  assert.equal((await sourceSnapshot()).sha256, sources.sha256, 'Sources changed during full decode verification');
  const videoBytes = await readFile(video);
  const mp4Boxes = verifyFastStart(videoBytes);
  const metadata = {
    schemaVersion: 1, createdAt: new Date().toISOString(), product: 'Tflip',
    exportKind: 'deterministic-timeline-sampling',
    description: 'Timeline sampling export, not real-time performance recording. Frames are independently sought through #stuntSeek. Capture wall time does not measure playback frame rate.',
    sourceSHA: sources.sha256, sourceFilesSHA256: sources.files,
    servedFilesSHA256: Object.fromEntries([...servedFiles].sort(([a], [b]) => a.localeCompare(b))),
    browser: { engine: 'Brave / Playwright Chromium', executable: browserExecutable, version: browser.version(), viewport, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'UTC' },
    encoder: encoderVersion, fps, durationSeconds, frameCount,
    sampling: { method: '30fps timeline samples without slider quantization; final frame pinned to terminal pose', firstTimelineMs: 0, lastTimelineMs: durationMs, timelineDurationMs: durationMs, nominalVideoFrameDurationMs: 1000 / fps, terminalFrameNote: 'The final frame advances 66.6667ms from its predecessor instead of 33.3333ms; output still contains exactly 414 frames at 30fps.', cutTimeMs: cutMs, cutFrame, cutVideoTimeMs: cutFrame * 1000 / fps },
    edit: { shots: [{ id: 'ramp', durationMs: 8000 }, { id: 'roadster', durationMs: 5800 }], transition: 'direct-cut', independentWorlds: true, boundaryProbes: cutBoundary, reverseAndForwardSeekVerified: true },
    capture: { selectors: ['.site-header', '#stunt'], includes: ['Tflip header', 'heading', 'scene', 'controls', 'caption'], coordinateSpace: 'viewport CSS pixels', bounds, evenCropRect: clip, jetEnabled: true, reducedMotion: 'no-preference', colorScheme: 'dark', cssAnimationsDisabledForCapture: true },
    keyframe: { requestedProgress: keyframeProgress, ...keyframe, deterministicRepeatVerified: true },
    artifacts: {
      screenshot: { path: 'test-results/two-shot-video.png', sha256: sha(preview), bytes: preview.length, ...pngDimensions(preview) },
      video: { path: 'test-results/two-shot-video.mp4', sha256: sha(videoBytes), bytes: videoBytes.length, codec: stream.codec_name, pixelFormat: stream.pix_fmt, width: stream.width, height: stream.height, fps, durationSeconds, frameCount, faststart: true, mp4Boxes, fullDecodeVerified: true },
      keyframes, cutBoundary,
    }, frames,
  };
  await writeFile(resolve(temporary, 'two-shot-video-export.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  // Publish the hash receipt last so a failed export cannot advertise a new
  // complete set before its media and evidence are in place. Each rename is
  // atomic, but readers must verify receipt hashes rather than assume a
  // multi-file filesystem transaction.
  for (const name of ['two-shot-video.png', 'two-shot-video.mp4', ...keyframes.map(item => item.path.slice('test-results/'.length)), ...cutBoundary.map(item => item.path.slice('test-results/'.length)), 'two-shot-video-export.json']) {
    await rename(resolve(temporary, name), resolve(output, name));
  }
  console.log(`Exported ${frameCount} timeline samples, H.264 ${fps} fps / ${durationSeconds} s, ${clip.width}×${clip.height}.\nSource SHA256: ${sources.sha256}\nOutputs: test-results/two-shot-video.{png,mp4}, test-results/two-shot-video-export.json`);
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = interrupted ? 130 : 1;
} finally {
  await browser?.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  for (const child of children) child.kill('SIGTERM');
  if (temporary) await rm(temporary, { recursive: true, force: true });
  process.removeListener('SIGINT', signal);
  process.removeListener('SIGTERM', signal);
}
