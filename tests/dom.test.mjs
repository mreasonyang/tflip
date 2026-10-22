import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { play, createAnimator, sequence, wrap } from '../dist/dom/index.js';

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function environment(t) {
  const dom = new JSDOM('<!doctype html><body><main><div id="source"><button>Business control</button></div><div id="target"></div></main></body>', { pretendToBeVisual: true });
  const { window } = dom, document = window.document;
  const source = document.querySelector('#source'), target = document.querySelector('#target');
  let sourceX = 20, targetX = 420, now = 0, identifier = 0;
  const frames = new Map();
  Object.defineProperty(window.performance, 'now', { value: () => now });
  window.requestAnimationFrame = fn => { const id = ++identifier; frames.set(id, fn); return id; };
  window.cancelAnimationFrame = id => frames.delete(id);
  source.getBoundingClientRect = () => ({ x: sourceX, y: 40, left: sourceX, top: 40, width: 100, height: 80, right: sourceX + 100, bottom: 120 });
  target.getBoundingClientRect = () => ({ x: targetX, y: 240, left: targetX, top: 240, width: 100, height: 80, right: targetX + 100, bottom: 320 });
  const media = new window.EventTarget(); media.matches = false;
  window.matchMedia = () => media;
  t.after(() => window.close());
  return { window, document, source, target, frames,
    move(x) { sourceX = x; }, moveTarget(x) { targetX = x; },
    visual() { const visual = document.createElement('div'); visual.textContent = 'Decorative'; return visual; },
    reduce(value) { media.matches = value; media.dispatchEvent(new window.Event('change')); },
    async tick(delta) { now += delta; const current = [...frames.values()]; frames.clear(); for (const callback of current) callback(now); await flush(); },
  };
}

test('SSR imports are side-effect free and calls explain browser requirement', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {play} from './dist/dom/index.js'; try { play({}); process.exit(1); } catch (e) { if (!e.message.includes('browser Document')) throw e; }`], { encoding: 'utf8', cwd: new URL('..', import.meta.url) });
  assert.equal(result.status, 0, result.stderr);
});

test('play returns before events; actual elapsed time, pause, seek and resume settle and restore', async t => {
  const env = environment(t), events = [];
  env.source.style.transform = 'rotate(5deg)'; env.source.style.color = 'red';
  const before = env.source.getAttribute('style');
  const run = play({ element: env.source, duration: 1000, onStart: () => events.push('start'), onLand: () => events.push('land'), onFinish: () => events.push('finish') });
  assert.deepEqual(events, []); assert.equal(run.status, 'queued');
  await flush(); assert.equal(run.status, 'running'); assert.deepEqual(events, ['start']);
  await env.tick(200); assert.equal(run.currentTime, 200);
  run.pause(); assert.equal(env.frames.size, 0); await env.tick(500); assert.equal(run.currentTime, 200);
  run.seek(.6); assert.equal(run.progress, .6); assert.equal(run.status, 'paused');
  run.setSpeed(2); run.resume(); await env.tick(200);
  assert.deepEqual(await run.finished, { status: 'finished' });
  assert.deepEqual(events, ['start', 'land', 'finish']);
  assert.equal(env.source.getAttribute('style'), before); assert.equal(env.frames.size, 0);
});

test('cancel restores styles, preserves unrelated caller changes and resolves exactly once', async t => {
  const env = environment(t); let cancels = 0;
  const run = play({ element: env.source, onCancel: () => { cancels++; assert.equal(env.frames.size, 0); } });
  await flush(); env.source.style.color = 'blue'; run.cancel('testing'); run.cancel('again');
  assert.deepEqual(await run.finished, { status: 'cancelled', reason: 'testing' });
  assert.equal(env.source.style.transform, ''); assert.equal(env.source.style.color, 'blue'); assert.equal(cancels, 1);
  const plain = play({ element: env.target }); await flush(); plain.cancel(); await plain.finished;
  assert.equal(env.target.hasAttribute('style'), false);
});

test('transfer owns detached decoration without reparenting or stealing business focus', async t => {
  const env = environment(t), originalParent = env.source.parentNode, button = env.source.firstElementChild;
  button.focus(); const visual = env.visual();
  const run = play({ from: env.source, to: env.target, visual: () => visual, size: { width: 100, height: 80 }, duration: 100 });
  await flush(); const overlay = env.document.querySelector('[data-tflip-overlay]');
  assert.equal(env.source.parentNode, originalParent); assert.equal(env.document.activeElement, button);
  assert.equal(overlay.getAttribute('aria-hidden'), 'true'); assert.equal(overlay.hasAttribute('inert'), true);
  assert.equal(visual.parentNode, overlay); assert.equal(visual.style.width, '100px');
  await env.tick(100); await run.finished;
  assert.equal(env.document.querySelector('[data-tflip-overlay]'), null); assert.equal(env.document.activeElement, button);
});

test('transfer rejects live nodes and invalid configuration synchronously', t => {
  const env = environment(t);
  assert.throws(() => play({ from: env.source, visual: () => env.target }), /fresh detached/);
  assert.throws(() => play({ element: env.source, speed: 0 }), /speed/);
  assert.throws(() => play({ element: env.source, duration: -1 }), /duration/);
  assert.throws(() => play({ element: env.source, perspective: NaN }), /perspective/);
  assert.throws(() => play({ element: env.source, mode: 'transfer' }), /visual/);
  assert.equal(env.frames.size, 0);
});

test('invalid signals fail before creating visuals, replacing a run or scheduling work', async t => {
  const env = environment(t); let visuals = 0, effects = 0, cancellations = 0;
  const active = play({ element: env.source, autoplay: false, onCancel: () => cancellations++ });
  await flush();
  const before = env.source.getAttribute('style');
  for (const signal of [null, false, 1, {}, { aborted: false }, { aborted: false, addEventListener() {} }]) {
    assert.throws(() => play({ element: env.source, signal, visual: () => { visuals++; return env.visual(); },
      effects: () => { effects++; return { render() {}, dispose() {} }; } }), /AbortSignal/);
  }
  await flush();
  assert.equal(active.status, 'paused'); assert.equal(cancellations, 0);
  assert.equal(visuals, 0); assert.equal(effects, 0); assert.equal(env.frames.size, 0);
  assert.equal(env.source.getAttribute('style'), before);
  assert.equal(env.document.querySelector('[data-tflip-overlay]'), null);
  active.cancel();
});

test('a signal subscription failure rolls back its listener and leaves the existing lane intact', async t => {
  const env = environment(t), registered = new Set();
  const active = play({ element: env.source, autoplay: false }); await flush();
  const signal = {
    aborted: false,
    addEventListener(_type, listener) { registered.add(listener); throw Error('cannot subscribe'); },
    removeEventListener(_type, listener) { registered.delete(listener); },
  };
  assert.throws(() => play({ element: env.source, signal }), /cannot subscribe/);
  await flush(); assert.equal(registered.size, 0); assert.equal(active.status, 'paused'); assert.equal(env.frames.size, 0);
  assert.equal(play({ element: env.source, repeat: 'ignore' }), active);
  active.cancel();
});

test('native signals from the document and another realm cancel before and after activation', async t => {
  const env = environment(t);
  for (const Controller of [AbortController, env.window.AbortController]) {
    const pending = new Controller();
    const run = play({ element: env.source, signal: pending.signal, autoplay: false });
    await flush(); pending.abort(); assert.deepEqual(await run.finished, { status: 'cancelled', reason: 'aborted' });
    const aborted = new Controller(); aborted.abort();
    const skipped = play({ element: env.source, signal: aborted.signal });
    assert.equal(skipped.status, 'cancelled');
    assert.deepEqual(await skipped.finished, { status: 'cancelled', reason: 'aborted' });
  }
  assert.equal(env.frames.size, 0); assert.equal(env.source.hasAttribute('style'), false);
});

test('replace, ignore and queue preserve identity, order and cleanup', async t => {
  const env = environment(t), starts = [];
  const one = play({ element: env.source, duration: 100, onStart: () => starts.push(1) });
  const ignored = play({ element: env.source, repeat: 'ignore', visual: () => { throw Error('must not call'); } });
  assert.equal(ignored, one);
  const two = play({ element: env.source, duration: 100, repeat: 'queue', onStart: () => starts.push(2) });
  const three = play({ element: env.source, duration: 100, repeat: 'queue', onStart: () => starts.push(3) });
  assert.equal(two.status, 'queued'); three.cancel();
  await flush(); assert.deepEqual(starts, [1]);
  await env.tick(100); assert.deepEqual(starts, [1, 2]); assert.equal(two.status, 'running');
  const replacement = play({ element: env.source, duration: 50 });
  assert.deepEqual(await two.finished, { status: 'cancelled', reason: 'replaced' });
  await flush(); await env.tick(50); await replacement.finished;
  assert.equal(env.frames.size, 0); assert.equal(env.source.hasAttribute('style'), false);
});

test('cancelled queued runs never create effects or start', async t => {
  const env = environment(t); let creates = 0, starts = 0;
  const active = play({ element: env.source, duration: 100 });
  const queued = play({ element: env.source, repeat: 'queue', effects: () => { creates++; return { render() {}, dispose() {} }; }, onStart: () => starts++ });
  queued.cancel(); await flush(); await env.tick(100); await active.finished;
  assert.equal(creates, 0); assert.equal(starts, 0); assert.equal(env.frames.size, 0);
});

test('replacement callbacks can reenter without resurrecting the superseded run', async t => {
  const env = environment(t); let winner;
  const one = play({ element: env.source, onCancel: () => { winner = play({ element: env.source, duration: 100 }); } });
  await flush(); const superseded = play({ element: env.source, duration: 100 });
  assert.equal((await one.finished).reason, 'replaced'); assert.equal((await superseded.finished).reason, 'replaced');
  await flush(); assert.equal(winner.status, 'running'); assert.equal(env.frames.size, 1);
  await env.tick(100); await winner.finished; assert.equal(env.frames.size, 0);
});

test('reentrant update pause/resume and seek maintain only one animation frame', async t => {
  const env = environment(t); let once = false;
  const run = play({ element: env.source, duration: 100, onUpdate: event => {
    if (!once) { once = true; event.playback.pause(); event.playback.seek(.5); event.playback.resume(); }
  } });
  await flush(); await env.tick(10); assert.equal(env.frames.size, 1); assert.equal(run.progress, .5);
  await env.tick(50); await run.finished; assert.equal(env.frames.size, 0);
});

test('effects share timeline samples and dispose before finished; errors cancel safely', async t => {
  const env = environment(t), samples = []; let disposed = 0, overlay;
  const run = play({ element: env.source, duration: 100, effects: context => {
    overlay = context.container;
    return { render(frame) { samples.push([frame.time, frame.sample(frame.time).x, frame.pose.x]); }, dispose() { disposed++; } };
  } });
  await flush(); await env.tick(100); await run.finished;
  assert.equal(disposed, 1); assert.equal(overlay.isConnected, false); assert.ok(samples.length >= 2);
  for (const [, a, b] of samples) assert.equal(a, b);
  const failed = play({ element: env.source, effects: [() => ({ render() {}, dispose() { disposed++; } }), () => { throw Error('bad effect'); }] });
  await flush(); const result = await failed.finished;
  assert.equal(result.status, 'cancelled'); assert.equal(result.reason, 'error'); assert.equal(result.error.message, 'bad effect');
  assert.equal(disposed, 2); assert.equal(env.frames.size, 0); assert.equal(env.document.querySelector('[data-tflip-overlay]'), null);
});

test('reduced motion completes in a microtask without visual or effects resources', async t => {
  const env = environment(t), events = []; let effects = 0;
  env.reduce(true);
  const run = play({ from: env.source, visual: env.visual, effects: () => { effects++; return { render() {}, dispose() {} }; },
    onStart: () => events.push('start'), onLand: () => events.push('land'), onFinish: () => events.push('finish') });
  assert.deepEqual(events, []); await flush(); assert.deepEqual(await run.finished, { status: 'finished' });
  assert.deepEqual(events, ['start', 'land', 'finish']); assert.equal(effects, 0); assert.equal(env.frames.size, 0);
  assert.equal(env.document.querySelector('[data-tflip-overlay]'), null);
});

test('system reduced-motion changes immediately settle and release paused resources', async t => {
  const env = environment(t); let disposed = 0;
  const run = play({ element: env.source, effects: () => ({ render() {}, dispose() { disposed++; } }) });
  await flush(); run.pause(); env.reduce(true);
  assert.equal((await run.finished).status, 'finished'); assert.equal(disposed, 1); assert.equal(env.frames.size, 0);
});

test('seek to end neither lands nor finishes until resumed; replay has a new promise', async t => {
  const env = environment(t); let lands = 0;
  const run = play({ element: env.source, duration: 100, autoplay: false, onLand: () => lands++ });
  await flush(); run.seek(5); assert.equal(run.progress, 1); assert.equal(run.status, 'paused'); assert.equal(lands, 0);
  run.resume(); await env.tick(1); await run.finished; assert.equal(lands, 1);
  const replay = run.replay(); assert.notEqual(replay, run); assert.notEqual(replay.finished, run.finished);
  await flush(); replay.cancel(); await replay.finished;
});

for (const seekToEnd of [false, true]) for (const action of ['seek', 'pause']) {
  test(`onLand ${action} remains effective ${seekToEnd ? 'after seeking to the end' : 'during natural playback'}`, async t => {
    const env = environment(t), events = []; let settled = false;
    const run = play({ element: env.source, duration: 100, autoplay: false, onLand: event => {
      events.push('land');
      if (action === 'seek') event.playback.seek(.5);
      else event.playback.pause();
    }, onFinish: () => events.push('finish') });
    void run.finished.then(() => { settled = true; });
    await flush(); if (seekToEnd) run.seek(1);
    run.resume(); await env.tick(100);
    assert.equal(settled, false); assert.deepEqual(events, ['land']);
    assert.equal(run.status, action === 'seek' ? 'running' : 'paused');
    assert.equal(run.currentTime, action === 'seek' ? 50 : 100);
    assert.equal(env.frames.size, action === 'seek' ? 1 : 0);
    if (action === 'pause') run.resume();
    await env.tick(50); assert.deepEqual(await run.finished, { status: 'finished' });
    assert.equal(run.progress, 1); assert.deepEqual(events, ['land', 'finish']);
    assert.equal(env.frames.size, 0); assert.equal(env.source.hasAttribute('style'), false);
  });
}

test('reduced motion still settles at the endpoint when landing callbacks seek or pause', async t => {
  const env = environment(t); let disposed = 0;
  const run = play({ element: env.source, effects: () => ({ render() {}, dispose() { disposed++; } }),
    onLand: event => { event.playback.seek(.5); event.playback.pause(); } });
  await flush(); run.pause(); env.reduce(true);
  assert.deepEqual(await run.finished, { status: 'finished' });
  assert.equal(run.currentTime, run.duration); assert.equal(run.progress, 1);
  assert.equal(disposed, 1); assert.equal(env.frames.size, 0);
  assert.equal(env.document.querySelector('[data-tflip-overlay]'), null);
});

test('onLand cancellation wins over finishing, and callback errors settle', async t => {
  const env = environment(t);
  const cancelled = play({ element: env.source, reducedMotion: 'always', onLand: event => event.playback.cancel('landing decision') });
  await flush(); assert.deepEqual(await cancelled.finished, { status: 'cancelled', reason: 'landing decision' });
  const errored = play({ element: env.source, onStart: () => { throw Error('callback'); } });
  await flush(); assert.equal((await errored.finished).reason, 'error'); assert.equal(env.frames.size, 0);
});

test('layout cancellation, freeze and follow have distinct coordinate policies', async t => {
  const env = environment(t);
  const cancelled = play({ element: env.source }); await flush(); env.window.dispatchEvent(new env.window.Event('resize'));
  assert.equal((await cancelled.finished).reason, 'layout');
  const frozen = play({ from: env.source, to: env.target, visual: env.visual, duration: 100, layout: 'freeze', autoplay: false });
  await flush(); frozen.seek(1); const before = env.document.querySelector('[data-tflip-overlay]').lastElementChild.style.transform;
  env.moveTarget(600); env.window.dispatchEvent(new env.window.Event('resize')); frozen.seek(1);
  assert.equal(env.document.querySelector('[data-tflip-overlay]').lastElementChild.style.transform, before); frozen.cancel();
  const followed = play({ from: env.source, to: env.target, visual: env.visual, duration: 100, layout: 'follow', autoplay: false });
  await flush(); followed.seek(1); env.moveTarget(900); env.window.dispatchEvent(new env.window.Event('resize'));
  assert.match(env.document.querySelector('[data-tflip-overlay]').lastElementChild.style.transform, /950px/); followed.cancel();
});

test('detachment cancels paused motion and abort cancels queued motion', async t => {
  const env = environment(t), abort = new AbortController();
  const run = play({ element: env.source, autoplay: false });
  const queued = play({ element: env.source, repeat: 'queue', signal: abort.signal });
  abort.abort(); assert.equal((await queued.finished).reason, 'aborted');
  await flush(); env.source.remove(); await flush(); assert.equal((await run.finished).reason, 'detached');
  assert.equal(env.frames.size, 0);
});

for (const anchor of ['from', 'to']) {
  test(`a detached queued ${anchor} anchor cancels immediately without waiting for a paused lane`, async t => {
    const env = environment(t), observers = new Set(); let starts = 0, effects = 0;
    const NativeObserver = env.window.MutationObserver;
    env.window.MutationObserver = class extends NativeObserver {
      observe(...args) { super.observe(...args); observers.add(this); }
      disconnect() { super.disconnect(); observers.delete(this); }
    };
    const active = play({ element: env.source, duration: 100, autoplay: false });
    const queued = play({ element: env.source, [anchor]: env.target, repeat: 'queue', onStart: () => starts++,
      effects: () => { effects++; return { render() {}, dispose() {} }; } });
    const following = play({ element: env.source, duration: 50, repeat: 'queue' });
    await flush(); assert.equal(observers.size, 3);
    env.target.remove(); await flush();
    assert.equal(queued.status, 'cancelled');
    assert.deepEqual(await queued.finished, { status: 'cancelled', reason: 'detached' });
    assert.equal(active.status, 'paused'); assert.equal(following.status, 'queued');
    assert.equal(starts, 0); assert.equal(effects, 0); assert.equal(env.frames.size, 0); assert.equal(observers.size, 2);
    active.resume(); await env.tick(100); assert.equal(following.status, 'running');
    await env.tick(50); assert.deepEqual(await following.finished, { status: 'finished' });
    assert.equal(observers.size, 0); assert.equal(env.frames.size, 0);
    assert.equal(env.source.hasAttribute('style'), false);
  });
}

test('visibility suspension excludes hidden time from elapsed playback', async t => {
  const env = environment(t); let hidden = false;
  Object.defineProperty(env.document, 'hidden', { configurable: true, get: () => hidden });
  const run = play({ element: env.source, duration: 100 }); await flush(); await env.tick(20);
  hidden = true; env.document.dispatchEvent(new env.window.Event('visibilitychange')); assert.equal(env.frames.size, 0);
  await env.tick(1000); assert.equal(run.currentTime, 20);
  hidden = false; env.document.dispatchEvent(new env.window.Event('visibilitychange')); await env.tick(80);
  assert.equal((await run.finished).status, 'finished');
});

test('animator cancellation owns queued runs and disposed animators reject reuse', async t => {
  const env = environment(t), animator = createAnimator({ element: env.source });
  const one = animator.play(), two = animator.play({ repeat: 'queue' });
  await flush(); animator.dispose();
  assert.equal((await one.finished).reason, 'disposed'); assert.equal((await two.finished).reason, 'disposed');
  await flush(); assert.equal(env.frames.size, 0); assert.throws(() => animator.play(), /disposed/);
});

test('animator owns replay descendants including those created through event controllers', async t => {
  const env = environment(t); let replay;
  const animator = createAnimator({ element: env.source, duration: 100, onFinish: event => { replay = event.playback.replay(); } });
  const original = animator.play();
  assert.equal(animator.play({ repeat: 'ignore' }), original);
  await flush(); await env.tick(100); assert.equal(original.status, 'finished'); assert.equal(replay.status, 'running');
  animator.dispose(); assert.equal((await replay.finished).reason, 'disposed'); assert.equal(env.frames.size, 0);
  assert.throws(() => original.replay(), /disposed/);
});

test('explicit vanilla wrap restores order and cancels wrapper animation', async t => {
  const env = environment(t), parent = env.source.parentNode, before = [...parent.children];
  const wrapper = wrap(env.source); assert.equal(env.source.parentNode, wrapper.element);
  const run = play({ element: wrapper.element }); await flush(); wrapper.dispose(); wrapper.dispose();
  assert.equal((await run.finished).reason, 'disposed'); assert.deepEqual([...parent.children], before); assert.equal(env.frames.size, 0);
});

test('sequence uses aggregate time, forwards land per step and cleans every step', async t => {
  const env = environment(t), events = [];
  const run = sequence([{ element: env.source, duration: 100 }, { element: env.source, duration: 200 }]);
  for (const type of ['start', 'land', 'finish']) run.on(type, () => events.push(type));
  await flush(); await env.tick(100); assert.equal(run.currentTime, 100); assert.equal(run.duration, 300);
  await env.tick(100); assert.equal(run.currentTime, 200);
  run.pause(); await env.tick(100); assert.equal(run.currentTime, 200); run.resume(); await env.tick(100);
  assert.equal((await run.finished).status, 'finished'); assert.deepEqual(events, ['start', 'land', 'land', 'finish']);
  assert.equal(env.frames.size, 0); assert.equal(env.source.hasAttribute('style'), false);
});

test('sequence seeks across steps without skipped lifecycle events and resumes at correct point', async t => {
  const env = environment(t), started = [], cancelled = [];
  const run = sequence([
    { element: env.source, duration: 100, autoplay: false, onStart: () => started.push(1), onCancel: () => cancelled.push(1) },
    { element: env.source, duration: 300, onStart: () => started.push(2) },
  ]);
  await flush(); run.seek(.75); await flush(); assert.equal(run.currentTime, 300); assert.equal(run.status, 'paused');
  assert.deepEqual(started, []); assert.deepEqual(cancelled, []);
  run.resume(); await env.tick(100); assert.equal((await run.finished).status, 'finished'); assert.deepEqual(started, [2]);
  assert.equal(env.frames.size, 0);
});

test('sequence cancel prevents subsequent steps and replay returns a new sequence', async t => {
  const env = environment(t); let second = 0;
  const run = sequence([{ element: env.source, duration: 100 }, { element: env.source, duration: 100, onStart: () => second++ }]);
  await flush(); run.cancel(); await env.tick(1000);
  assert.equal((await run.finished).status, 'cancelled'); assert.equal(second, 0); assert.equal(env.frames.size, 0);
  const replay = run.replay(); assert.notEqual(replay.finished, run.finished); await flush(); replay.cancel(); await replay.finished;
});

test('sequence remains paused between steps if a completion callback pauses it', async t => {
  const env = environment(t); let run;
  run = sequence([{ element: env.source, duration: 100, onFinish: () => run.pause() }, { element: env.source, duration: 100 }]);
  await flush(); await env.tick(100); assert.equal(run.status, 'paused'); assert.equal(env.frames.size, 0);
  run.resume(); await env.tick(100); assert.equal((await run.finished).status, 'finished');
});

test('paused and queued seeking never charges waiting time on subsequent resume', async t => {
  const env = environment(t);
  const paused = play({ element: env.source, duration: 1000, autoplay: false });
  await flush(); paused.seek(.2); await env.tick(5000); paused.resume(); await env.tick(16);
  assert.equal(paused.currentTime, 216); paused.cancel();
  const active = play({ element: env.source, duration: 5000 });
  const queued = play({ element: env.source, duration: 1000, repeat: 'queue' });
  queued.seek(.2); await flush(); await env.tick(5000); await active.finished; await env.tick(16);
  assert.equal(queued.currentTime, 216); queued.cancel();
  const timeline = sequence([{ element: env.source, duration: 1000, autoplay: false }]);
  await flush(); timeline.seek(.2); await env.tick(5000); timeline.resume(); await env.tick(16);
  assert.equal(timeline.currentTime, 216); timeline.cancel();
});

test('a seek from onUpdate does not land or finish in the same tick', async t => {
  const env = environment(t), events = []; let once = false;
  const run = play({ element: env.source, duration: 1000, onUpdate: event => {
    if (!once) { once = true; event.playback.seek(1); }
  }, onLand: () => events.push('land'), onFinish: () => events.push('finish') });
  await flush(); await env.tick(16); assert.equal(run.progress, 1); assert.equal(run.status, 'running'); assert.deepEqual(events, []);
  await env.tick(16); assert.equal((await run.finished).status, 'finished'); assert.deepEqual(events, ['land', 'finish']);
});

test('animator disposal during replacement cancels the not-yet-returned new controller', async t => {
  const env = environment(t), animator = createAnimator({ element: env.source });
  animator.play({ onCancel: () => animator.dispose() }); await flush();
  const incoming = animator.play(); await flush();
  assert.equal((await incoming.finished).reason, 'disposed'); assert.equal(env.frames.size, 0); assert.equal(env.source.hasAttribute('style'), false);
});

test('sequence cancellation during replacement cannot leak the incoming child', async t => {
  const env = environment(t); let timeline;
  const external = play({ element: env.target, onCancel: () => timeline.cancel('during setup') });
  timeline = sequence([{ element: env.source, duration: 100 }, { element: env.target, duration: 100 }]);
  await flush(); await env.tick(100);
  assert.equal((await external.finished).reason, 'replaced'); assert.equal((await timeline.finished).reason, 'during setup');
  assert.equal(env.frames.size, 0); assert.equal(env.target.hasAttribute('style'), false);
});

test('sequence repeat ignore joins the current position without a silent rewind', async t => {
  const env = environment(t);
  const external = play({ element: env.source, duration: 1000 }); await flush(); await env.tick(400);
  const timeline = sequence([{ element: env.source, duration: 500, repeat: 'ignore' }]);
  assert.equal(external.currentTime, 400); await flush(); assert.equal(timeline.currentTime, 400); assert.equal(timeline.duration, 1000);
  await env.tick(600); assert.equal((await timeline.finished).status, 'finished'); assert.equal(env.frames.size, 0);
});

test('explicit sequence cancellation notifies the current step once', async t => {
  const env = environment(t), cancelled = [];
  const timeline = sequence([{ element: env.source, onCancel: event => { cancelled.push(event.result.reason); timeline.cancel(); } }]);
  await flush(); timeline.cancel('explicit'); assert.equal((await timeline.finished).reason, 'explicit'); assert.deepEqual(cancelled, ['explicit']);
});

test('replay always creates a new controller and promise despite an ignore policy', async t => {
  const env = environment(t);
  const run = play({ element: env.source, repeat: 'ignore', duration: 100 }); await flush();
  const replay = run.replay(); assert.notEqual(replay, run); assert.notEqual(replay.finished, run.finished);
  assert.equal((await run.finished).reason, 'replaced'); await flush(); replay.cancel();
  const timeline = sequence([{ element: env.source, repeat: 'ignore', duration: 100 }]); await flush();
  const next = timeline.replay(); assert.notEqual(timeline.finished, next.finished); await flush();
  assert.equal((await timeline.finished).reason, 'replaced'); next.cancel(); assert.equal(env.frames.size, 0);
});
