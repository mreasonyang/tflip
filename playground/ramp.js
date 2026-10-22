import { play } from '../dist/dom/index.js';
import { RAMP_DURATION, sampleRamp } from './ramp-motion.js';
import { createRampScene } from './ramp-scene.js';
import { t, onLanguageChange } from './i18n.js';

const $ = id => document.getElementById(id);
const scene = createRampScene($('rampCanvas'));
const preference = matchMedia('(prefers-reduced-motion: reduce)');
let playback;
let generation = 0;
let time = 0;
let disposed = false;
let statusKey = 'featured.ramp.status.ready';

function setStatus(key) {
  statusKey = key;
  $('rampStatus').textContent = t(key);
}

function frameText(frame = sampleRamp(time)) {
  const times = { current: (time / 1000).toFixed(2), total: (RAMP_DURATION / 1000).toFixed(2) };
  const phase = frame.phase === 'flight' ? (frame.phaseProgress < .69 ? 'flightRoll' : 'flightDescent') : frame.phase;
  $('rampTime').textContent = t('featured.time', times);
  $('rampSeek').setAttribute('aria-valuetext', t('featured.time.a11y', times));
  $('rampPhase').textContent = t(`featured.ramp.phase.${phase}`);
}

function controlText() {
  const action = playback?.status === 'paused' ? 'resume' : 'pause';
  $('rampPause').textContent = t(`featured.${action}`);
  $('rampPause').setAttribute('aria-label', t(`featured.ramp.${action}.a11y`));
}

function motionNote() {
  $('rampMotionNote').textContent = t(preference.matches ? 'featured.motion.reduced' : 'featured.ramp.motion.default');
}

onLanguageChange(() => {
  if (disposed) return;
  setStatus(statusKey);
  frameText();
  controlText();
  motionNote();
});

function render(nextTime = time) {
  if (disposed) return;
  time = Math.min(RAMP_DURATION, Math.max(0, nextTime));
  const frame = sampleRamp(time);
  scene.render({ ...frame, jet: $('rampJet').checked && !preference.matches, reducedMotion: preference.matches });
  $('rampSeek').value = String(Math.round(time / RAMP_DURATION * 1000));
  frameText(frame);
}

function controls() {
  const active = playback && !['finished', 'cancelled'].includes(playback.status);
  const paused = playback?.status === 'paused';
  $('rampPause').disabled = !active;
  $('rampCancel').disabled = !active;
  controlText();
  $('rampStage').dataset.playing = String(Boolean(active && !paused));
}

function stop(key = 'featured.ramp.status.stopped') {
  generation++;
  playback?.cancel('user');
  playback = undefined;
  setStatus(key);
  controls();
}

function start(autoplay = true) {
  stop();
  if (preference.matches) {
    render(RAMP_DURATION);
    setStatus('featured.status.reducedFinished');
    return;
  }
  const token = generation;
  // The existing public Playback owns the only clock. The ramp sampler maps
  // its nominal milliseconds onto the road surface and the airborne segment.
  playback = play({
    element: $('rampDriver'), mode: 'in-place', from: { x: 0, y: 0 }, to: { x: 1, y: 0 },
    duration: RAMP_DURATION, height: 0, depth: 0, turns: 0, bounce: 0,
    phases: { anticipation: 0, launch: 1, roll: 0, descent: 0, settle: 0 },
    shadow: false, layout: 'freeze', reducedMotion: 'system', repeat: 'replace',
    speed: Number($('rampSpeed').value), autoplay,
    onUpdate(event) { if (generation === token) render(event.playback.currentTime); },
  });
  render(0);
  setStatus(autoplay ? 'featured.ramp.status.playing' : 'featured.status.paused');
  playback.finished.then(result => {
    if (generation !== token || disposed) return;
    // A reduced-motion completion can settle without a final update event.
    // Paint the terminal pose before exposing the completed control state.
    if (result.status === 'finished') render(RAMP_DURATION);
    setStatus(result.status === 'finished' ? 'featured.ramp.status.finished' : 'featured.ramp.status.cancelled');
    controls();
  });
  queueMicrotask(controls);
}

$('rampPlay').addEventListener('click', () => start());
$('rampHeroPlay').addEventListener('click', () => start());
$('rampPause').addEventListener('click', () => {
  if (!playback) return;
  if (playback.status === 'paused') {
    playback.resume();
    setStatus('featured.ramp.status.playing');
  } else {
    playback.pause();
    setStatus('featured.status.paused');
  }
  controls();
});
$('rampCancel').addEventListener('click', () => { stop(); render(0); });
$('rampSeek').addEventListener('input', event => {
  const progress = Number(event.target.value) / 1000;
  if (preference.matches) {
    render(RAMP_DURATION);
    setStatus('featured.status.reduced');
    return;
  }
  if (!playback || ['finished', 'cancelled'].includes(playback.status)) start(false);
  playback.pause();
  playback.seek(progress);
  render(progress * RAMP_DURATION);
  setStatus('featured.status.paused');
  controls();
});
$('rampJet').addEventListener('change', () => render());
for (const event of ['input', 'change']) $('rampSpeed').addEventListener(event, () => playback?.setSpeed(Number($('rampSpeed').value)));

function motionPreference() {
  motionNote();
  if (preference.matches) { stop('featured.status.reduced'); render(RAMP_DURATION); }
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
    controls();
  }
});
window.addEventListener('pagehide', () => { stop(); disposed = true; scene.dispose(); }, { once: true });
motionPreference();
setStatus(statusKey);
controls();
