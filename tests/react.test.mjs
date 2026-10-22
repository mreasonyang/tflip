import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, StrictMode, useEffect, useLayoutEffect, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { Motion, useMotion } from '../dist/react/index.js';

function browser() {
  const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', {
    pretendToBeVisual: true,
    url: 'https://example.test/',
  });
  const { window } = dom;
  const frames = new Map();
  let nextFrame = 0;
  window.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  window.matchMedia = (media) => {
    const target = new window.EventTarget();
    return Object.assign(target, {
      matches: false,
      media,
      onchange: null,
      addListener: (listener) => target.addEventListener('change', listener),
      removeListener: (listener) => target.removeEventListener('change', listener),
    });
  };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 40, y: 160, width: 120, height: 60, top: 160, right: 160, bottom: 220, left: 40, toJSON() { return this; } };
  };
  const values = {
    window,
    document: window.document,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    getComputedStyle: window.getComputedStyle.bind(window),
    matchMedia: window.matchMedia,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return {
    window,
    frames,
    container: window.document.querySelector('#root'),
    close() {
      window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

async function fixture(options = {}) {
  const env = browser();
  const root = createRoot(env.container);
  let controls;
  let elementRef;
  function Example({ defaults }) {
    const ref = useRef(null);
    elementRef = ref;
    controls = useMotion(ref, defaults);
    return createElement(Motion, { ref, 'data-motion': 'wrapper' },
      createElement('button', { style: { transform: 'rotate(12deg)' } }, 'Business content'));
  }
  await act(async () => { root.render(createElement(Example, { defaults: options })); });
  let unmounted = false;
  return {
    ...env,
    get controls() { return controls; },
    get ref() { return elementRef; },
    async rerender(defaults) {
      await act(async () => { root.render(createElement(Example, { defaults })); });
    },
    async unmount() {
      if (!unmounted) {
        unmounted = true;
        await act(async () => { root.unmount(); });
      }
    },
    async dispose() {
      await this.unmount();
      env.close();
    },
  };
}

test('React import and server render do not require a browser', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  let controls;
  function ServerExample() {
    const ref = useRef(null);
    controls = useMotion(ref, { preset: 'launch' });
    return createElement(Motion, { ref, className: 'wrapper' },
      createElement('span', { style: { transform: 'scale(0.9)' } }, 'Content'));
  }
  assert.equal(renderToStaticMarkup(createElement(ServerExample)),
    '<div class="wrapper"><span style="transform:scale(0.9)">Content</span></div>');
  assert.equal(controls.playback.current, null);
  assert.throws(() => controls.play(), /mounted element ref/);
});

test('Motion keeps live children in place and preserves their transforms', async () => {
  const f = await fixture({ autoplay: false, reducedMotion: 'never' });
  try {
    const child = f.container.querySelector('button');
    const wrapper = f.ref.current;
    const controller = f.controls.play();
    await Promise.resolve();
    controller.seek(0.5);
    assert.equal(child.parentElement, wrapper);
    assert.equal(child.style.transform, 'rotate(12deg)');
    assert.equal(f.controls.playback.current, controller);
    controller.cancel();
    assert.deepEqual(await controller.finished, { status: 'cancelled', reason: 'user' });
    assert.equal(child.parentElement, wrapper);
    assert.equal(child.style.transform, 'rotate(12deg)');
    assert.equal(wrapper.style.transform, '');
  } finally { await f.dispose(); }
});

test('unmount cancels running, queued and replayed controllers and releases animation frames', async () => {
  const f = await fixture({ reducedMotion: 'never', repeat: 'queue' });
  try {
    const controls = f.controls;
    const first = controls.play();
    const supersededQueue = controls.play();
    const replayed = first.replay();
    assert.equal(controls.playback.current, replayed);
    const queued = controls.play();
    await Promise.resolve();
    for (const playback of [first, supersededQueue]) {
      assert.deepEqual(await playback.finished, { status: 'cancelled', reason: 'replaced' });
    }
    assert.equal(queued.status, 'queued');
    assert.equal(replayed.status, 'running');
    await f.unmount();
    for (const playback of [queued, replayed]) {
      assert.deepEqual(await playback.finished, { status: 'cancelled', reason: 'disposed' });
    }
    assert.equal(controls.playback.current, null);
    assert.equal(f.frames.size, 0);
    assert.throws(() => controls.play(), /unmounted/);
    assert.throws(() => first.replay(), /unmounted/);
  } finally { await f.dispose(); }
});

test('defaults update for new runs without changing the control object', async () => {
  const f = await fixture({ duration: 1100, autoplay: false, reducedMotion: 'never' });
  try {
    const controls = f.controls;
    const first = controls.play();
    assert.equal(first.duration, 1100);
    await f.rerender({ duration: 2200, autoplay: false, reducedMotion: 'never' });
    assert.equal(f.controls, controls);
    assert.equal(first.duration, 1100);
    const second = controls.play();
    assert.equal(second.duration, 2200);
    assert.equal((await first.finished).reason, 'replaced');
    controls.cancel();
    assert.equal((await second.finished).status, 'cancelled');
  } finally { await f.dispose(); }
});

test('ignore returns the same owned controller and cancellation remains observable', async () => {
  const f = await fixture({ autoplay: false, reducedMotion: 'never', repeat: 'ignore' });
  try {
    const first = f.controls.play();
    assert.equal(f.controls.play(), first);
    let eventPlayback;
    first.on('cancel', (event) => { eventPlayback = event.playback; });
    f.controls.cancel('example');
    assert.equal(eventPlayback, first);
    assert.deepEqual(await first.finished, { status: 'cancelled', reason: 'example' });
  } finally { await f.dispose(); }
});

test('transfer owns only the fresh visual and removes it when the hook unmounts', async () => {
  const f = await fixture({ autoplay: false, reducedMotion: 'never' });
  try {
    const child = f.container.querySelector('button');
    const originalParent = child.parentElement;
    const visual = f.window.document.createElement('div');
    visual.textContent = 'Decorative copy';
    const controller = f.controls.play({
      mode: 'transfer',
      to: { x: 400, y: 200 },
      visual: () => visual,
    });
    await Promise.resolve();
    assert.equal(child.parentElement, originalParent);
    assert.equal(visual.isConnected, true);
    assert.equal(visual.parentElement.getAttribute('aria-hidden'), 'true');
    await f.unmount();
    assert.equal(visual.isConnected, false);
    assert.equal((await controller.finished).reason, 'disposed');
  } finally { await f.dispose(); }
});

test('event callbacks receive owned controllers; replay stays under React cleanup', async () => {
  let replayed;
  const f = await fixture({
    autoplay: false,
    reducedMotion: 'never',
    repeat: 'queue',
    onStart: (event) => { if (!replayed) replayed = event.playback.replay(); },
  });
  try {
    const first = f.controls.play();
    first.resume();
    await Promise.resolve();
    assert.ok(replayed);
    assert.equal((await first.finished).reason, 'replaced');
    assert.equal(replayed.status, 'running');
    await f.unmount();
    assert.equal((await replayed.finished).reason, 'disposed');
  } finally { await f.dispose(); }
});

for (const operation of ['play', 'replay']) {
test(`reentrant unmount during ${operation} replacement cancels the incoming controller`, async () => {
  const env = browser();
  const root = createRoot(env.container);
  // The hook can animate a dedicated wrapper managed by a longer-lived parent.
  // Keep it connected so detachment cannot accidentally mask missed ownership cleanup.
  const wrapper = env.window.document.createElement('div');
  env.window.document.body.append(wrapper);
  const ref = { current: wrapper };
  let controls;
  let incoming;
  let unmounted = false;
  function Owner() {
    controls = useMotion(ref, {
      reducedMotion: 'never',
      onCancel: () => {
        unmounted = true;
        flushSync(() => root.unmount());
      },
    });
    return null;
  }
  try {
    await act(async () => { root.render(createElement(Owner)); });
    const first = controls.play();
    await Promise.resolve();
    await act(async () => { incoming = operation === 'play' ? controls.play() : first.replay(); });
    assert.equal(unmounted, true);
    assert.equal(wrapper.isConnected, true);
    assert.equal(incoming.status, 'cancelled');
    assert.deepEqual(await incoming.finished, { status: 'cancelled', reason: 'disposed' });
    assert.equal(controls.playback.current, null);
    assert.equal(env.frames.size, 0);
    assert.equal(wrapper.style.transform, '');
  } finally {
    incoming?.cancel();
    if (!unmounted) await act(async () => root.unmount());
    env.close();
  }
});
}

for (const [effectName, useStartEffect] of [['passive', useEffect], ['layout', useLayoutEffect]]) {
test(`StrictMode ${effectName} effect replay cancels the first run and permits the mounted run`, async () => {
  const env = browser();
  const root = createRoot(env.container);
  const runs = [];
  let cancelCallbacks = 0;
  function Example() {
    const ref = useRef(null);
    const motion = useMotion(ref, {
      autoplay: false,
      reducedMotion: 'never',
      onCancel: () => { cancelCallbacks++; },
    });
    useStartEffect(() => { runs.push(motion.play()); }, [motion]);
    return createElement(Motion, { ref }, 'StrictMode');
  }
  try {
    await act(async () => { root.render(createElement(StrictMode, null, createElement(Example))); });
    assert.equal(runs.length, 2);
    assert.equal((await runs[0].finished).reason, 'disposed');
    assert.equal(runs[1].status, 'paused');
    await act(async () => { root.unmount(); });
    assert.equal((await runs[1].finished).reason, 'disposed');
    assert.equal(cancelCallbacks, 0, 'cleanup must not invoke callbacks that can update unmounted components');
    assert.equal(env.frames.size, 0);
  } finally { env.close(); }
});
}
