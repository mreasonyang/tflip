import { sequence } from '../dist/dom/index.js';
import { sample } from '../dist/core/index.js';
import { createRoadsterScene } from './roadster-scene.js';
import { t, onLanguageChange } from './i18n.js';

const $ = id => document.getElementById(id);
const stage = $('roadsterStage');
const scene = createRoadsterScene($('roadsterCanvas'));
const driver = $('roadsterDriver');
const preference = matchMedia('(prefers-reduced-motion: reduce)');
const segments = [
  { name: 'approach', offset: 0, duration: 1200, from: { x: -13, y: 0 }, to: { x: -8, y: 0 }, height: 0, turns: 0, phases: { anticipation: 0, launch: 1, roll: 0, descent: 0, settle: 0 } },
  { name: 'jump', offset: 1200, duration: 3600, from: { x: -8, y: 0 }, to: { x: 8, y: 0 }, height: 4.8, turns: 1, phases: { anticipation: 0.04, launch: 0.17, roll: 0.54, descent: 0.17, settle: 0.08 } },
  { name: 'rollout', offset: 4800, duration: 1000, from: { x: 8, y: 0 }, to: { x: 13, y: 0 }, height: 0, turns: 0, phases: { anticipation: 0, launch: 1, roll: 0, descent: 0, settle: 0 } },
];
const duration = 5800;
let playback;
let generation = 0;
let disposed = false;
let frame = frameAt(0);
let statusKey = 'featured.roadster.status.ready';

function setStatus(key) {
  statusKey = key;
  $('roadsterStatus').textContent = t(key);
}

function frameText() {
  const times = { current: (frame.time / 1000).toFixed(2), total: (duration / 1000).toFixed(2) };
  $('roadsterTime').textContent = t('featured.time', times);
  $('roadsterSeek').setAttribute('aria-valuetext', t('featured.time.a11y', times));
  $('roadsterPhase').textContent = t(`featured.roadster.phase.${frame.segment}`);
}

function controlText() {
  const action = playback?.status === 'paused' ? 'resume' : 'pause';
  $('roadsterPause').textContent = t(`featured.${action}`);
  $('roadsterPause').setAttribute('aria-label', t(`featured.roadster.${action}.a11y`));
}

function motionNote() {
  $('roadsterMotionNote').textContent = t(preference.matches ? 'featured.motion.reduced' : 'featured.roadster.motion.default');
}

onLanguageChange(() => {
  if (disposed) return;
  setStatus(statusKey);
  frameText();
  controlText();
  motionNote();
});

function frameAt(time) {
  const segment = segments.find(part => time < part.offset + part.duration) ?? segments.at(-1);
  const local = Math.max(0, Math.min(segment.duration, time - segment.offset));
  return { pose: sample(local, { ...segment, axis: 'x', direction: 1, depth: 0, bounce: 0.035 }), time, duration, progress: time / duration, segment: segment.name, segmentProgress: local / segment.duration };
}

function render(next = frame) {
  if (disposed) return;
  frame = next;
  scene.render({ ...frame, reducedMotion: preference.matches, jet: $('roadsterJet').checked && !preference.matches });
  $('roadsterSeek').value = String(Math.round(frame.progress * 1000));
  frameText();
}

function updateControls() {
  const active = playback && !['finished', 'cancelled'].includes(playback.status);
  $('roadsterPause').disabled = !active;
  $('roadsterCancel').disabled = !active;
  const paused = playback?.status === 'paused';
  controlText();
  stage.dataset.playing = String(Boolean(active && !paused));
}

function stop(key = 'featured.roadster.status.stopped') {
  generation++;
  playback?.cancel('user');
  playback = undefined;
  setStatus(key);
  updateControls();
}

function start(autoplay = true) {
  stop();
  const token = generation;
  if (preference.matches) {
    render(frameAt(duration));
    setStatus('featured.status.reducedFinished');
    return;
  }
  playback = sequence(segments.map((segment, index) => ({
    ...segment, element: driver, mode: 'in-place', axis: 'x', direction: 1,
    bounce: 0.035, depth: 0, shadow: false, layout: 'freeze', repeat: 'replace',
    reducedMotion: 'system', autoplay: index === 0 ? autoplay : true,
    onUpdate(event) {
      if (token !== generation) return;
      const time = segment.offset + event.playback.currentTime;
      render({ pose: event.pose, time, duration, progress: time / duration, segment: segment.name, segmentProgress: event.progress });
    },
  })));
  playback.setSpeed(Number($('roadsterSpeed').value));
  render(frameAt(0));
  setStatus(autoplay ? 'featured.roadster.status.playing' : 'featured.status.paused');
  const current = playback;
  current.finished.then(result => {
    if (token !== generation || disposed) return;
    setStatus(result.status === 'finished' ? 'featured.roadster.status.finished' : 'featured.roadster.status.cancelled');
    updateControls();
  });
  queueMicrotask(updateControls);
}

$('roadsterPlay').addEventListener('click', () => start());
$('roadsterHeroPlay').addEventListener('click', () => start());
$('roadsterPause').addEventListener('click', () => {
  if (!playback) return;
  if (playback.status === 'paused') {
    playback.resume();
    setStatus('featured.roadster.status.playing');
  } else {
    playback.pause();
    setStatus('featured.status.paused');
  }
  updateControls();
});
$('roadsterCancel').addEventListener('click', () => {
  stop();
  render(frameAt(0));
});
$('roadsterSeek').addEventListener('input', event => {
  const progress = Number(event.target.value) / 1000;
  if (preference.matches) {
    render(frameAt(duration));
    setStatus('featured.status.reduced');
    return;
  }
  if (!playback || ['finished', 'cancelled'].includes(playback.status)) start(false);
  playback.pause();
  playback.seek(progress);
  // The library activates new sequence steps in a microtask. The pure sampler
  // draws the same pose immediately, including seeks crossing a step boundary.
  render(frameAt(progress * duration));
  setStatus('featured.status.paused');
  updateControls();
});
$('roadsterSpeed').addEventListener('input', event => playback?.setSpeed(Number(event.target.value)));
$('roadsterSpeed').addEventListener('change', event => playback?.setSpeed(Number(event.target.value)));
$('roadsterJet').addEventListener('change', () => render());

function motionPreference() {
  motionNote();
  if (preference.matches) { stop('featured.status.reduced'); render(frameAt(duration)); }
  else render();
}
preference.addEventListener('change', motionPreference);
window.addEventListener('resize', () => {
  if (playback && !['finished', 'cancelled'].includes(playback.status)) stop('featured.status.resized');
  render();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playback?.status === 'running') {
    playback.pause();
    setStatus('featured.status.hidden');
    updateControls();
  }
});
window.addEventListener('pagehide', () => { stop(); disposed = true; scene.dispose(); }, { once: true });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
motionPreference();
setStatus(statusKey);
updateControls();
