import { play } from '../dist/dom/index.js';
import { sample } from '../dist/core/index.js';
import { STUNT_DURATION, STUNT_CUT, createStuntSampler } from './stunt-motion.js';
import { createStuntScene } from './stunt-scene.js';
import { t, onLanguageChange } from './i18n.js';

const $ = id => document.getElementById(id);
const sampleStunt = createStuntSampler(sample);
const scene = createStuntScene($('stuntCanvas'));
$('stunt').style.setProperty('--stunt-cut-progress', `${STUNT_CUT / STUNT_DURATION * 100}%`);
const preference = matchMedia('(prefers-reduced-motion: reduce)');
const lifecycle = new AbortController();
const { signal } = lifecycle;
let playback;
let generation = 0;
let time = 0;
let disposed = false;
let statusKey = 'featured.stunt.status.ready';

function setStatus(key) {
  statusKey = key;
  $('stuntStatus').textContent = t(key);
}

function frameText(frame = sampleStunt(time)) {
  const times = { current: (time / 1000).toFixed(2), total: (STUNT_DURATION / 1000).toFixed(2) };
  $('stuntTime').textContent = t('featured.time', times);
  $('stuntSeek').setAttribute('aria-valuetext', t('featured.time.a11y', times));
  const localPhase = frame.shot === 'ramp' && frame.phase === 'flight'
    ? (frame.sceneFrame.phaseProgress < .69 ? 'flightRoll' : 'flightDescent') : frame.phase;
  $('stuntPhase').textContent = t('featured.stunt.phase.label', {
    shot: t(`featured.stunt.shot.${frame.shot}`), phase: t(`featured.${frame.shot}.phase.${localPhase}`),
  });
  $('stuntStage').dataset.phase = frame.phase;
  $('stuntStage').dataset.shot = frame.shot;
  $('stuntStage').dataset.shotTime = String(frame.shotTime);
}

function controlText() {
  const action = playback?.status === 'paused' ? 'resume' : 'pause';
  $('stuntPause').textContent = t(`featured.${action}`);
  $('stuntPause').setAttribute('aria-label', t(`featured.stunt.${action}.a11y`));
}

function motionNote() {
  $('stuntMotionNote').textContent = t(preference.matches ? 'featured.motion.reduced' : 'featured.stunt.motion.default');
}

const unsubscribeLanguage = onLanguageChange(() => {
  if (disposed) return;
  setStatus(statusKey);
  frameText();
  controlText();
  motionNote();
});

function render(nextTime = time) {
  if (disposed) return;
  time = Math.min(STUNT_DURATION, Math.max(0, nextTime));
  const frame = sampleStunt(time);
  scene.render({ ...frame, jet: $('stuntJet').checked && !preference.matches, reducedMotion: preference.matches });
  $('stuntSeek').value = String(time / STUNT_DURATION * 1000);
  frameText(frame);
}

function controls() {
  const active = playback && !['finished', 'cancelled'].includes(playback.status);
  $('stuntPause').disabled = !active;
  $('stuntCancel').disabled = !active;
  controlText();
  $('stuntStage').dataset.playing = String(Boolean(active && playback.status !== 'paused'));
  $('stuntStage').dataset.state = playback?.status ?? 'idle';
}

function stop(key = 'featured.stunt.status.stopped') {
  generation++;
  playback?.cancel('user');
  playback = undefined;
  setStatus(key);
  controls();
}

function start(autoplay = true) {
  stop();
  if (preference.matches) {
    render(STUNT_DURATION);
    setStatus('featured.status.reducedFinished');
    return;
  }
  const token = generation;
  // One public Playback owns the edit timeline. At 8 seconds the sampler
  // switches to the second shot's local zero; neither renderer owns a clock.
  playback = play({
    element: $('stuntDriver'), mode: 'in-place', from: { x: 0, y: 0 }, to: { x: 1, y: 0 },
    duration: STUNT_DURATION, height: 0, depth: 0, turns: 0, bounce: 0,
    phases: { anticipation: 0, launch: 1, roll: 0, descent: 0, settle: 0 },
    shadow: false, layout: 'freeze', reducedMotion: 'system', repeat: 'replace',
    speed: Number($('stuntSpeed').value), autoplay,
    onUpdate(event) { if (generation === token) render(event.playback.currentTime); },
  });
  render(0);
  setStatus(autoplay ? 'featured.stunt.status.playing' : 'featured.status.paused');
  playback.finished.then(result => {
    if (generation !== token || disposed) return;
    if (result.status === 'finished') render(STUNT_DURATION);
    setStatus(result.status === 'finished' ? 'featured.stunt.status.finished' : 'featured.stunt.status.cancelled');
    controls();
  });
  queueMicrotask(() => { if (!disposed) controls(); });
}

$('stuntPlay').addEventListener('click', () => start(), { signal });
$('stuntHeroPlay').addEventListener('click', () => start(), { signal });
$('stuntPause').addEventListener('click', () => {
  if (!playback) return;
  if (playback.status === 'paused') {
    playback.resume();
    setStatus('featured.stunt.status.playing');
  } else {
    playback.pause();
    setStatus('featured.status.paused');
  }
  controls();
}, { signal });
$('stuntCancel').addEventListener('click', () => {
  stop();
  render(preference.matches ? STUNT_DURATION : 0);
}, { signal });
$('stuntSeek').addEventListener('input', event => {
  const requestedTime = Number(event.target.value) / 1000 * STUNT_DURATION;
  // Range values are serialized as decimal strings. Restore only rounding
  // noise at the cut so an exact 8 s seek selects shot two in every browser.
  const seekTime = Math.abs(requestedTime - STUNT_CUT) < 1e-8 ? STUNT_CUT : requestedTime;
  const progress = seekTime / STUNT_DURATION;
  if (preference.matches) {
    render(STUNT_DURATION);
    setStatus('featured.status.reduced');
    return;
  }
  if (!playback || ['finished', 'cancelled'].includes(playback.status)) start(false);
  playback.pause();
  playback.seek(progress);
  render(seekTime);
  setStatus('featured.status.paused');
  controls();
}, { signal });
$('stuntJet').addEventListener('change', () => render(), { signal });
for (const event of ['input', 'change']) $('stuntSpeed').addEventListener(event, () => {
  playback?.setSpeed(Number($('stuntSpeed').value));
}, { signal });

function motionPreference() {
  motionNote();
  if (preference.matches) { stop('featured.status.reduced'); render(STUNT_DURATION); }
  else render();
}
preference.addEventListener('change', motionPreference, { signal });
// Rendering remeasures the canvas without resetting the shared timeline.
window.addEventListener('resize', () => render(), { signal });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playback?.status === 'running') {
    playback.pause();
    setStatus('featured.status.hidden');
    controls();
  }
}, { signal });

function migrateSceneHash() {
  if (!['#roadster', '#ramp'].includes(location.hash)) return;
  history.replaceState(history.state, '', '#stunt');
  $('stunt').scrollIntoView({ behavior: 'instant', block: 'start' });
}
window.addEventListener('hashchange', migrateSceneHash, { signal });
window.addEventListener('pagehide', () => {
  stop();
  disposed = true;
  lifecycle.abort();
  unsubscribeLanguage();
  scene.dispose();
}, { once: true, signal });

motionPreference();
setStatus(statusKey);
controls();
migrateSceneHash();
