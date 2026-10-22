import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { play } from '@tflip/motion';
import { createParticles } from '@tflip/motion/effects';
import { Motion, useMotion } from '@tflip/motion/react';

const frames = new Set();
const nativeFrame = window.requestAnimationFrame.bind(window);
const nativeCancel = window.cancelAnimationFrame.bind(window);
window.requestAnimationFrame = callback => {
  const id = nativeFrame(time => { frames.delete(id); callback(time); });
  frames.add(id); return id;
};
window.cancelAnimationFrame = id => { frames.delete(id); nativeCancel(id); };

const wrapper = document.querySelector('#vanilla-wrapper');
const business = document.querySelector('#vanilla-business');
const target = document.querySelector('#vanilla-target');
const parent = business.parentElement;
const runs = [];
const landOutcomes = [];
let effectCreated = 0, effectDisposed = 0, strictMounts = 0, hookCallbacks = 0;
let vanillaCount = 0, reactControls, reactRoot, reactWrapper, reactBusiness, reactParent;
let detachResult, invalidSignalResult;
const reducedMotion = () => document.querySelector('#force-reduced').checked ? 'always' : 'system';
const particles = createParticles({ density: .5, seed: 27 });
const effect = context => {
  const instance = particles(context); effectCreated++;
  return { render: frame => instance.render(frame), dispose() { effectDisposed++; instance.dispose(); } };
};
const latest = family => runs.findLast(run => run.family === family)?.controller;
const current = family => runs.findLast(run => run.family === family && ['running', 'paused'].includes(run.controller.status))?.controller ?? latest(family);
const rect = node => {
  if (!node?.isConnected) return null;
  const box = node.getBoundingClientRect();
  return { x: box.x, y: box.y, width: box.width, height: box.height, centerX: box.x + box.width / 2, centerY: box.y + box.height / 2 };
};
function snapshot() {
  return {
    runs: runs.map(({ family, label, controller, events, result }) => ({ family, label, status: controller.status, progress: controller.progress, currentTime: controller.currentTime, duration: controller.duration, events, result })),
    frames: frames.size, overlays: document.querySelectorAll('[data-tflip-overlay]').length,
    canvases: document.querySelectorAll('[data-tflip-particles]').length,
    effectCreated, effectDisposed, liveEffects: effectCreated - effectDisposed,
    strictMounts, hookCallbacks, landOutcomes, detachResult, invalidSignalResult,
    vanilla: { sameBusinessNode: document.querySelector('#vanilla-business') === business, sameParent: business.parentElement === parent,
      childTransform: business.style.transform, wrapperStyle: wrapper.getAttribute('style'), count: vanillaCount, rect: rect(wrapper) },
    react: { mounted: !!reactControls, sameBusinessNode: !!reactBusiness && document.querySelector('#react-business') === reactBusiness,
      sameParent: !!reactBusiness && reactBusiness.parentElement === reactParent, childTransform: reactBusiness?.style.transform,
      wrapperStyle: reactWrapper?.getAttribute('style'), rect: rect(reactWrapper), count: document.querySelector('#react-count')?.textContent },
    activeElement: document.activeElement?.id,
  };
}
function status() {
  const state = snapshot();
  document.querySelector('#status').textContent = [
    `播放 ${runs.length} 次 · StrictMode effect 执行 ${strictMounts} 次`,
    `待执行帧 ${state.frames} · 装饰层 ${state.overlays} · 画布 ${state.canvases} · 未释放效果 ${state.liveEffects}`,
    ...state.runs.slice(-3).map(run => `${run.label}: ${run.status} · ${Math.round(run.progress * 100)}%${run.result?.reason ? ` (${run.result.reason})` : ''}`),
  ].join('\n');
}
function track(family, label, controller) {
  const entry = { family, label, controller, events: [], result: null };
  runs.push(entry);
  for (const type of ['start', 'land', 'finish', 'cancel']) controller.on(type, event => {
    entry.events.push(event.type); status();
  });
  void controller.finished.then(result => { entry.result = result; status(); });
  status(); return controller;
}
function playVanilla(overrides = {}, label = '原生播放') {
  return track('vanilla', label, play({ element: wrapper, duration: 650, height: 78, depth: 26, effects: effect, shadow: true,
    reducedMotion: reducedMotion(), ...overrides }));
}
function cancelVanilla() {
  for (const run of runs.filter(run => run.family === 'vanilla')) run.controller.cancel();
  status();
}
function transfer() {
  return playVanilla({ from: wrapper, to: target, size: { width: 158, height: 62 }, visual: () => {
    const node = document.createElement('div'); node.className = 'visual'; node.textContent = '装饰副本'; return node;
  } }, '装饰转移');
}
function landing(action) {
  const run = playVanilla({ duration: 1200, autoplay: false, onLand: event => {
    if (action === 'seek') event.playback.seek(.5);
    else event.playback.pause();
    queueMicrotask(() => { landOutcomes.push({ action, status: event.playback.status, progress: event.playback.progress }); status(); });
  } }, `落地 ${action}`);
  run.seek(1); run.resume(); return run;
}
function detachQueuedTarget() {
  cancelVanilla();
  playVanilla({ autoplay: false }, '等待中的前项');
  const queued = playVanilla({ to: target, repeat: 'queue' }, '目标移除的排队项');
  queueMicrotask(() => target.remove());
  void queued.finished.then(result => { detachResult = result; status(); });
}
function invalidSignalCheck() {
  const before = snapshot(); let message;
  try { play({ element: wrapper, signal: { aborted: false } }); }
  catch (error) { message = error.message; }
  queueMicrotask(() => {
    const after = snapshot();
    invalidSignalResult = { message, framesBefore: before.frames, framesAfter: after.frames, overlaysBefore: before.overlays, overlaysAfter: after.overlays,
      runsUnchanged: before.runs.length === after.runs.length, wrapperUnchanged: before.vanilla.wrapperStyle === after.vanilla.wrapperStyle };
    status();
  });
}

business.addEventListener('click', () => { vanillaCount++; document.querySelector('#vanilla-count').textContent = vanillaCount; });
document.querySelector('#vanilla-play').addEventListener('click', () => playVanilla());
document.querySelector('#vanilla-transfer').addEventListener('click', transfer);
document.querySelector('#vanilla-pause').addEventListener('click', () => { current('vanilla')?.pause(); status(); });
document.querySelector('#vanilla-resume').addEventListener('click', () => { current('vanilla')?.resume(); status(); });
document.querySelector('#vanilla-queue').addEventListener('click', () => playVanilla({ repeat: 'queue' }, '原生排队'));
document.querySelector('#vanilla-cancel').addEventListener('click', cancelVanilla);
document.querySelector('#land-seek').addEventListener('click', () => landing('seek'));
document.querySelector('#land-pause').addEventListener('click', () => landing('pause'));
document.querySelector('#queue-detach').addEventListener('click', detachQueuedTarget);
document.querySelector('#invalid-signal').addEventListener('click', invalidSignalCheck);

function ReactConsumer() {
  const ref = useRef(null);
  const [count, setCount] = useState(0);
  const controls = useMotion(ref, { duration: 650, height: 72, shadow: true, effects: effect,
    onStart: () => hookCallbacks++, onLand: () => hookCallbacks++, onFinish: () => hookCallbacks++, onCancel: () => hookCallbacks++ });
  useLayoutEffect(() => {
    reactControls = controls; reactWrapper = ref.current; reactBusiness = document.querySelector('#react-business'); reactParent = reactBusiness.parentElement;
    return () => { reactControls = undefined; };
  }, [controls]);
  useEffect(() => {
    strictMounts++;
    track('react', `StrictMode 挂载 ${strictMounts}`, controls.play({ autoplay: false, reducedMotion: reducedMotion() }));
  }, [controls]);
  const start = (overrides = {}, label = 'React 播放') => track('react', label, controls.play({ reducedMotion: reducedMotion(), ...overrides }));
  return <>
    <div className="stage"><Motion ref={ref} id="react-wrapper" className="motion-wrapper"><button id="react-business" className="business" style={{ transform: 'rotate(3deg)' }} onClick={() => setCount(value => value + 1)}>业务操作 <span id="react-count">{count}</span></button></Motion><span className="target">React 保留子节点</span></div>
    <div className="controls"><button id="react-play" onClick={() => start()}>播放</button><button id="react-pause" onClick={() => { current('react')?.pause(); status(); }}>暂停</button><button id="react-resume" onClick={() => { current('react')?.resume(); status(); }}>继续</button><button id="react-queue" onClick={() => start({ repeat: 'queue' }, 'React 排队')}>排队</button><button id="react-replay" onClick={() => controls.playback.current && track('react', 'React 重播', controls.playback.current.replay())}>重播</button><button id="react-cancel" onClick={() => { controls.cancel(); status(); }}>取消全部</button></div>
  </>;
}
function mountReact() {
  if (reactRoot) return;
  reactRoot = createRoot(document.querySelector('#react-root'));
  reactRoot.render(<StrictMode><ReactConsumer /></StrictMode>);
}
function unmountReact() { reactRoot?.unmount(); reactRoot = undefined; status(); }
document.querySelector('#react-mount').addEventListener('click', mountReact);
document.querySelector('#react-unmount').addEventListener('click', unmountReact);
const preference = matchMedia('(prefers-reduced-motion: reduce)');
const describePreference = () => { document.querySelector('#system-preference').textContent = `系统减少动态效果：${preference.matches ? '开启' : '关闭'}`; };
preference.addEventListener('change', describePreference); describePreference();
window.consumer = { snapshot, latest, playVanilla, transfer, landing, cancelVanilla, detachQueuedTarget, invalidSignalCheck, mountReact, unmountReact };
mountReact(); status();
