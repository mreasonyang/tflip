import { createStuntScene } from './stunt-scene.js';
import { sample } from '../../runtime/core/index.js';
import { STUNT_DURATION, createStuntSampler } from './stunt-motion.js';

const sampleStunt = createStuntSampler(sample);

// These are mountable Canvas examples, not SDK trajectory presets. Geometry and
// rendering are shared with the Playground; each mount owns only its own clock.
function progressValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('progress must be a finite number');
  return Math.max(0, Math.min(1, value));
}

function speedValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('speed must be a finite number');
  if (value <= 0) throw new RangeError('speed must be greater than zero');
  return value;
}

/**
 * Mount two complete Tflip shots without autoplay: the original 8 s C-ramp
 * action, a direct cut, then the original 5.8 s car-flight action.
 * Load ./style.css once. The container and any existing children stay owned by
 * the caller. Call dispose() during unmount; removal is also observed when the
 * browser provides MutationObserver. Each play() replaces only this instance.
 */
export function mountStunt(container, { jet = true } = {}) {
  return mountScene(container, { jet, name: 'Tflip two-shot demo', kind: 'stunt', duration: STUNT_DURATION,
    createScene: createStuntScene, sampleFrame: sampleStunt });
}

/** @deprecated Use mountStunt. The old Roadster entry now mounts the two-shot edit. */
export function mountRoadster(container, options) {
  return mountStunt(container, options);
}

/** @deprecated Use mountStunt. The old ramp entry now mounts the two-shot edit. */
export function mountRamp(container, options) {
  return mountStunt(container, options);
}

function mountScene(container, { jet, name, kind, duration, createScene, sampleFrame }) {
  const document = container?.ownerDocument;
  const view = document?.defaultView;
  if (container?.nodeType !== 1 || !view || typeof container.appendChild !== 'function') {
    throw new TypeError('container must be an element in a browser document');
  }
  if (typeof jet !== 'boolean') throw new TypeError('jet must be a boolean');
  if (typeof view.requestAnimationFrame !== 'function' || typeof view.cancelAnimationFrame !== 'function') {
    throw new Error('Canvas scene playback requires requestAnimationFrame');
  }

  const root = document.createElement('figure');
  // Legacy classes remain for hosts that scoped their own layout or selectors.
  root.className = `tflip-featured-scene tflip-featured-scene--${kind} vr-featured-scene vr-featured-scene--${kind}`;
  root.dataset.scene = kind;
  const canvas = document.createElement('canvas');
  canvas.className = 'tflip-featured-scene__canvas vr-featured-scene__canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${name} Canvas animation`);
  canvas.textContent = `${name} animation requires Canvas 2D support.`;
  const caption = document.createElement('figcaption');
  caption.className = 'tflip-featured-scene__status vr-featured-scene__status';
  caption.setAttribute('aria-live', 'polite');
  caption.setAttribute('aria-atomic', 'true');
  root.append(canvas, caption);
  container.appendChild(root);

  let scene;
  try { scene = createScene(canvas); }
  catch (error) { root.remove(); throw error; }
  let preference;
  try { preference = view.matchMedia?.('(prefers-reduced-motion: reduce)'); }
  catch { /* A restricted host can omit media-query access. */ }
  let reduced = Boolean(preference?.matches);
  let disposed = false;
  let current;
  let currentTime = reduced ? duration : 0;
  let speed = 1;
  let request = null;
  let frameEpoch = 0;
  let lastTimestamp = null;
  let wasConnected = root.isConnected;
  const cleanup = [];

  const isActive = run => run && (run.status === 'running' || run.status === 'paused');
  const isCurrent = run => !disposed && run === current && isActive(run);
  const clock = () => view.performance.now();

  function status(value) {
    root.dataset.status = value;
    root.dataset.reducedMotion = String(reduced);
    caption.textContent = `${name} Canvas scene: ${value}${reduced ? ' (reduced motion)' : ''}.`;
  }

  function render(time = currentTime) {
    if (disposed) return;
    currentTime = reduced ? duration : Math.max(0, Math.min(duration, time));
    const frame = sampleFrame(currentTime);
    root.dataset.shot = frame.shot;
    root.dataset.shotTime = String(frame.shotTime);
    scene.render({ ...frame, jet: jet && !reduced, reducedMotion: reduced });
  }

  function stopFrame() {
    frameEpoch++;
    if (request !== null) view.cancelAnimationFrame(request);
    request = null;
    lastTimestamp = null;
  }

  function settle(run, result) {
    if (!isActive(run)) return;
    if (run === current) stopFrame();
    run.status = result.status;
    run.resolve(Object.freeze(result));
    if (run === current && !disposed) status(run.status);
  }

  function fail(run, error) {
    settle(run, { status: 'cancelled', reason: 'error', error });
  }

  function finish(run) {
    if (!isCurrent(run)) return;
    run.time = duration;
    try { render(duration); }
    catch (error) { fail(run, error); return; }
    settle(run, { status: 'finished' });
  }

  function schedule(run) {
    if (!isCurrent(run) || run.status !== 'running' || request !== null) return;
    const epoch = ++frameEpoch;
    lastTimestamp ??= clock();
    request = view.requestAnimationFrame(timestamp => {
      if (disposed || epoch !== frameEpoch) return;
      request = null;
      if (!isCurrent(run) || run.status !== 'running') return;
      const elapsed = Math.max(0, timestamp - lastTimestamp);
      lastTimestamp = timestamp;
      run.time = Math.min(duration, run.time + elapsed * run.speed);
      if (run.time >= duration) { finish(run); return; }
      try { render(run.time); }
      catch (error) { fail(run, error); return; }
      schedule(run);
    });
  }

  function pauseRun(run) {
    if (!isCurrent(run) || run.status !== 'running') return;
    stopFrame();
    run.status = 'paused';
    status('paused');
  }

  function resumeRun(run) {
    if (!isCurrent(run) || run.status !== 'paused') return;
    if (reduced || run.time >= duration) { finish(run); return; }
    run.status = 'running';
    lastTimestamp = clock();
    status('running');
    schedule(run);
  }

  function seekRun(run, progress) {
    if (!isCurrent(run)) return;
    if (reduced) { finish(run); return; }
    pauseRun(run);
    run.time = progress * duration;
    try { render(run.time); }
    catch (error) { fail(run, error); }
    // Seeking to 1 previews the last frame. Only resume/natural playback finishes.
  }

  function speedRun(run, value) {
    if (!isCurrent(run)) return;
    // Account for the old rate before changing it. Paused frames remain exact.
    if (run.status === 'running' && lastTimestamp !== null) {
      const now = clock();
      run.time = Math.min(duration, run.time + Math.max(0, now - lastTimestamp) * run.speed);
      lastTimestamp = now;
      if (run.time >= duration) { finish(run); return; }
      try { render(run.time); }
      catch (error) { fail(run, error); return; }
    }
    speed = run.speed = value;
  }

  function cancelRun(run, reason = 'user', reset = true) {
    if (!isCurrent(run)) return;
    settle(run, { status: 'cancelled', reason });
    if (reset) render(reduced ? duration : 0);
  }

  function start(autoplay = true) {
    if (disposed) throw new Error('Cannot play a disposed Canvas scene');
    cancelRun(current, 'replaced', false);
    let resolve;
    const finished = new Promise(done => { resolve = done; });
    const run = { status: autoplay ? 'running' : 'paused', time: 0, speed, resolve };
    const handle = Object.freeze({
      finished,
      get status() { return run.status; },
      get currentTime() { return run.time; },
      get duration() { return duration; },
      get progress() { return run.time / duration; },
      get speed() { return run.speed; },
      pause() { pauseRun(run); },
      resume() { resumeRun(run); },
      seek(progress) { seekRun(run, progressValue(progress)); },
      setSpeed(value) { speedRun(run, speedValue(value)); },
      cancel(reason = 'user') { cancelRun(run, reason); },
      replay() { return start(); },
    });
    run.handle = handle;
    current = run;
    status(run.status);
    if (reduced) finish(run);
    else {
      try { render(0); }
      catch (error) { fail(run, error); return handle; }
      if (autoplay) schedule(run);
    }
    return handle;
  }

  function motionPreference() {
    if (disposed) return;
    reduced = Boolean(preference.matches);
    if (reduced && isActive(current)) finish(current);
    else render();
    status(current?.status ?? 'idle');
  }

  function listen(target, type, listener) {
    target.addEventListener(type, listener);
    cleanup.push(() => target.removeEventListener(type, listener));
  }

  function dispose() {
    if (disposed) return;
    cancelRun(current, 'disposed', false);
    disposed = true;
    stopFrame();
    for (const remove of cleanup.splice(0)) remove();
    try { scene.dispose(); }
    finally { root.remove(); canvas.width = canvas.height = 0; }
  }

  try {
    if (typeof preference?.addEventListener === 'function') listen(preference, 'change', motionPreference);
    else if (typeof preference?.addListener === 'function') {
      preference.addListener(motionPreference);
      cleanup.push(() => preference.removeListener(motionPreference));
    }
    listen(view, 'resize', () => render());
    listen(document, 'visibilitychange', () => { if (document.hidden) pauseRun(current); });
    listen(view, 'pagehide', () => pauseRun(current));
    if (typeof view.ResizeObserver === 'function') {
      const observer = new view.ResizeObserver(() => render());
      observer.observe(canvas);
      cleanup.push(() => observer.disconnect());
    }
    if (typeof view.MutationObserver === 'function') {
      const observer = new view.MutationObserver(() => {
        if (root.parentNode !== container || (wasConnected && !root.isConnected)) dispose();
        else wasConnected ||= root.isConnected;
      });
      observer.observe(document, { childList: true, subtree: true });
      cleanup.push(() => observer.disconnect());
    }
    render();
    status('idle');
  } catch (error) { dispose(); throw error; }

  return Object.freeze({
    get status() { return disposed ? 'disposed' : current?.status ?? 'idle'; },
    get currentTime() { return currentTime; },
    get duration() { return duration; },
    get progress() { return currentTime / duration; },
    get speed() { return speed; },
    play() { return start(); },
    pause() { pauseRun(current); },
    resume() { resumeRun(current); },
    seek(progress) {
      const value = progressValue(progress);
      if (disposed) return;
      if (!isActive(current)) start(false);
      seekRun(current, value);
    },
    setSpeed(value) {
      const next = speedValue(value);
      if (disposed) return;
      speedRun(current, next);
      speed = next;
    },
    cancel() {
      if (disposed) return;
      if (isActive(current)) cancelRun(current);
      else render(reduced ? duration : 0);
    },
    dispose,
  });
}
