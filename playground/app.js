import { play, sequence } from '../dist/dom/index.js';
import { createParticles } from '../dist/effects/index.js';
import { normalizeOptions } from '../dist/core/index.js';
import { t, onLanguageChange, translateDOM } from './i18n.js';
import { createCodeExample } from './code-example.js';

const $ = (id) => document.getElementById(id);
const phases = ['anticipation', 'launch', 'roll', 'descent', 'settle'];
const knownReasons = new Set(['user', 'replaced', 'disposed', 'detached', 'layout', 'error', 'aborted', 'mode-change', 'reset', 'sequence-start']);
const activeRuns = new Set();
const knownRuns = new WeakSet();
const runPhases = new WeakMap();
const logEntries = [];
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let mode = 'transfer';
let preset = 'launch';
let current = null;
let runCount = 0;
let copiedConfig = '';
let currentKind = 'single';
let disposed = false;
let visibleError = null;
let copyMessage = phrase('lab.copy.ready');

// Keep semantic messages, including nested parameters, so existing UI and log
// entries can be translated without replaying any animation or event.
function phrase(key, params = {}) { return { key, params }; }

function renderPhrase(message) {
  const params = Object.fromEntries(Object.entries(message.params).map(([key, value]) => [
    key, value && typeof value === 'object' && 'key' in value ? renderPhrase(value) : value,
  ]));
  return t(message.key, params);
}

class LabError extends Error {
  constructor(key, params = {}) {
    super(key);
    this.messageDescriptor = phrase(key, params);
  }
}

function renderError() {
  $('errorMessage').textContent = visibleError ? renderPhrase(visibleError) : '';
  $('errorMessage').hidden = !visibleError;
}

function showError(error) {
  visibleError = error instanceof LabError ? error.messageDescriptor : phrase('lab.error.technical', {
    detail: error instanceof Error ? error.message : String(error),
  });
  renderError();
}

function clearError() {
  visibleError = null;
  renderError();
}

function numberValue(id) {
  const input = $(id);
  const number = Number(input.value);
  if (!input.value.trim() || !Number.isFinite(number) || !input.checkValidity()) {
    throw new LabError('lab.error.numberRange', { field: phrase(`lab.field.${id}`) });
  }
  return number;
}

function readSettings() {
  let path;
  try { path = JSON.parse($('waypoints').value || '[]'); }
  catch { throw new LabError('lab.error.pathJSON'); }
  if (!Array.isArray(path) || path.length > 50 || path.some((point) => !point || typeof point !== 'object' || !Number.isFinite(point.x) || !Number.isFinite(point.y) || (point.z !== undefined && !Number.isFinite(point.z)))) {
    throw new LabError('lab.error.pathPoints');
  }
  const options = {
    preset,
    height: numberValue('height'),
    duration: numberValue('duration'),
    turns: numberValue('turns'),
    direction: Number($('direction').value),
    axis: $('axis').value,
    bounce: numberValue('bounce'),
    depth: numberValue('depth'),
    path: path.map(({ x, y, z }) => z === undefined ? { x, y } : { x, y, z }),
    pathMode: $('pathMode').value,
    phases: Object.fromEntries(phases.map((phase) => [phase, numberValue(phase)])),
    speed: numberValue('speed'),
    perspective: numberValue('perspective'),
    repeat: $('repeat').value,
    layout: $('layout').value,
    reducedMotion: $('reducedMotion').value,
    shadow: $('shadow').checked,
    backface: $('backface').value,
  };
  if (options.phases.launch + options.phases.roll + options.phases.descent <= 0) {
    throw new LabError('lab.error.flightPhases');
  }
  normalizeOptions(options); // Validate with the same rules used by the package.
  return options;
}

// A newly created decorative node: never clone or move application-owned content.
function makeVisual(returning = false) {
  const card = document.createElement('div');
  card.className = `motion-card motion-visual${returning ? ' return-card' : ''}`;
  card.setAttribute('aria-hidden', 'true');
  card.dataset.labVisual = returning ? 'return' : 'idea';
  const kind = returning ? 'return' : 'idea';
  card.innerHTML = `<div class="card-top"><span class="card-mark">${returning ? '↙' : '↗'}</span><span class="card-type" data-i18n="lab.card.${kind}Type"></span><span class="card-spark">✳</span></div><div class="card-title" data-i18n="lab.card.${kind}Title"></div><div class="card-bottom"><span><i></i><span data-i18n="lab.card.${kind}Status"></span></span><b>${returning ? '02' : '01'}</b></div>`;
  translateDOM(card);
  return card;
}

function particleOptions() {
  return {
    jet: $('jet').checked, trail: $('trail').checked, color: '#ffaf76',
    density: 1.2, intensity: 1.5, seed: 17,
    emitter: { offset: { x: 0, y: $('sourceAnchor').getBoundingClientRect().height / 2 + 6 }, direction: { x: 0, y: 1 } },
  };
}

function readAnchors(reverse = false) {
  const points = $('anchorMode').value === 'points';
  const from = points ? { x: numberValue('fromX'), y: numberValue('fromY') } : $('sourceAnchor');
  const to = points ? { x: numberValue('toX'), y: numberValue('toY') } : $('targetAnchor');
  return reverse ? { from: to, to: from } : { from, to };
}

/** Read a serializable integration snapshot without starting or changing playback. */
export function getAgentLabConfig() {
  const motion = readSettings();
  let anchors = { kind: 'wrapper', wrapper: '[data-motion-wrapper]' };
  if (mode === 'transfer') {
    if ($('anchorMode').value === 'points') {
      anchors = {
        kind: 'viewport',
        from: { x: numberValue('fromX'), y: numberValue('fromY') },
        to: { x: numberValue('toX'), y: numberValue('toY') },
        wrapper: '[data-motion-wrapper]',
      };
    } else if ($('anchorMode').value === 'elements') {
      anchors = { kind: 'selectors', from: '#source', to: '#target', wrapper: '[data-motion-wrapper]' };
    } else {
      throw new LabError('lab.error.technical', { detail: 'Unknown anchor mode' });
    }
  }
  return { mode, motion, anchors, size: { width: 176, height: 116 }, effects: particleOptions() };
}

function centerOf(anchor) {
  if (!(anchor instanceof Element)) return anchor;
  const rect = anchor.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function measureAnchors() {
  for (const [prefix, anchor] of [['from', $('sourceAnchor')], ['to', $('targetAnchor')]]) {
    const point = centerOf(anchor);
    $(`${prefix}X`).value = String(Math.round(point.x));
    $(`${prefix}Y`).value = String(Math.round(point.y));
  }
}

function motionOptions({ reverse = false, autoplay = true, forceTransfer = false } = {}) {
  const settings = readSettings();
  const effects = particleOptions();
  const options = {
    ...settings,
    autoplay,
    ...(effects.jet || effects.trail ? { effects: createParticles(effects) } : {}),
  };
  if (mode === 'in-place' && !forceTransfer) {
    return { ...options, element: $('localWrapper'), mode: 'in-place' };
  }
  const rect = $('sourceAnchor').getBoundingClientRect();
  return {
    ...options,
    mode: 'transfer',
    ...($('anchorMode').value === 'points' ? { element: $('localWrapper') } : {}),
    ...readAnchors(reverse),
    visual: () => makeVisual(reverse),
    size: { width: rect.width, height: rect.height },
    direction: reverse ? -settings.direction : settings.direction,
    path: reverse ? [...settings.path].reverse() : settings.path,
  };
}

function renderLogEntry(entry) {
  entry.name.textContent = t(`lab.event.${entry.type}`);
  entry.detail.textContent = renderPhrase(entry.message);
}

function logEvent(type, key, params = {}) {
  const list = $('eventLog');
  list.querySelector('.empty-log')?.remove();
  const li = document.createElement('li');
  const timestamp = document.createElement('time');
  timestamp.dateTime = new Date().toISOString();
  timestamp.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const name = document.createElement('span');
  name.className = `event-name ${type}`;
  const detail = document.createElement('span');
  detail.className = 'event-description';
  const entry = { type, message: phrase(key, params), name, detail };
  renderLogEntry(entry);
  li.append(timestamp, name, detail);
  // Keep recent events visible without scrolling: a synthetic log scroll would
  // otherwise trigger the package's intentional layout='cancel' policy.
  list.prepend(li);
  logEntries.unshift(entry);
  while (list.children.length > 30) { list.lastElementChild.remove(); logEntries.pop(); }
}

function renderPlaybackText(controller) {
  const terminal = controller.status === 'finished' || controller.status === 'cancelled';
  const phase = runPhases.get(controller);
  $('playbackStatus').textContent = t(`lab.status.${controller.status}`);
  $('phaseValue').textContent = controller.status === 'queued' ? t('lab.playback.waiting')
    : terminal ? t(controller.status === 'finished' ? 'lab.playback.finishedHint' : 'lab.playback.cancelledHint')
    : phase ? t(`lab.phase.${phase}`)
    : currentKind === 'sequence' ? t('lab.kind.sequence') : '';
  $('pauseButton').setAttribute('aria-label', t(controller.status === 'paused' ? 'lab.a11y.resume' : 'lab.a11y.pause'));
}

function updatePlayback(controller, phase) {
  if (disposed || current !== controller) return;
  if (phase) runPhases.set(controller, phase);
  const terminal = controller.status === 'finished' || controller.status === 'cancelled';
  const progress = Math.round(controller.progress * 100);
  $('progress').value = String(Math.round(controller.progress * 1000));
  $('progressValue').textContent = `${progress}%`;
  $('timeValue').textContent = `${(controller.currentTime / 1000).toFixed(2)} / ${(controller.duration / 1000).toFixed(2)} s`;
  renderPlaybackText(controller);
  $('statusDot').className = `status-dot ${controller.status}`;
  $('pauseButton').disabled = terminal || controller.status === 'queued';
  $('cancelButton').disabled = terminal;
  $('replayButton').disabled = false;
  $('pauseButton').textContent = controller.status === 'paused' ? '▷' : 'Ⅱ';
}

function attach(controller, kind = 'single') {
  current = controller;
  currentKind = kind;
  if (knownRuns.has(controller)) {
    logEvent('ignore', 'lab.log.ignore');
    updatePlayback(controller);
    return controller;
  }
  knownRuns.add(controller);
  activeRuns.add(controller);
  const run = phrase('lab.log.runName', {
    number: String(++runCount).padStart(2, '0'),
    kind: phrase(kind === 'sequence' ? 'lab.kind.sequence' : mode === 'in-place' ? 'lab.kind.inPlace' : 'lab.kind.transfer'),
  });
  const unsubscribe = [];
  for (const type of ['start', 'land', 'finish', 'cancel']) {
    unsubscribe.push(controller.on(type, (event) => {
      const reason = event.result?.reason;
      logEvent(type, `lab.log.${type}`, {
        run,
        reason: knownReasons.has(reason) ? phrase(`lab.reason.${reason}`) : reason || phrase('lab.reason.cancelled'),
      });
      updatePlayback(controller, event.pose?.phase);
      if (event.result?.error) showError(event.result.error);
    }));
  }
  unsubscribe.push(controller.on('update', (event) => updatePlayback(controller, event.pose?.phase)));
  controller.finished.then((result) => {
    activeRuns.delete(controller);
    unsubscribe.forEach((stop) => stop());
    updatePlayback(controller);
    if (result.status === 'cancelled' && result.error) showError(result.error);
  });
  updatePlayback(controller);
  queueMicrotask(() => updatePlayback(controller));
  return controller;
}

function cancelAll(reason) {
  for (const controller of [...activeRuns]) controller.cancel(reason);
}

function run(autoplay = true) {
  try {
    clearError();
    const controller = play(motionOptions({ autoplay }));
    attach(controller);
    updateConfig();
    return controller;
  } catch (error) { showError(error); return null; }
}

function renderModeText() {
  $('modeDescription').textContent = t(mode === 'in-place' ? 'lab.mode.inPlace' : 'lab.mode.transfer');
}

function selectMode(nextMode) {
  if (mode === nextMode) return;
  cancelAll('mode-change');
  mode = nextMode;
  $('stage').classList.toggle('in-place', mode === 'in-place');
  for (const button of document.querySelectorAll('[data-mode]')) {
    const selected = button.dataset.mode === mode;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  renderModeText();
  current = null;
  resetTransport();
  updateConfig();
}

function applyPreset(name) {
  preset = name;
  const options = normalizeOptions({ preset: name });
  for (const key of ['height', 'duration', 'turns', 'direction', 'axis', 'bounce', 'depth', 'pathMode']) $(key).value = String(options[key]);
  for (const phase of phases) $(phase).value = String(Math.round(options.phases[phase] * 1000) / 10);
  for (const button of document.querySelectorAll('[data-preset]')) {
    const selected = button.dataset.preset === name;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  updateReadouts();
  updateConfig();
}

function updateReadouts() {
  $('heightOutput').textContent = `${$('height').value} px`;
  $('durationOutput').textContent = `${(Number($('duration').value) / 1000).toFixed(2)} s`;
  $('speedOutput').textContent = `${Number($('speed').value).toFixed(2)}×`;
  for (const button of document.querySelectorAll('[data-speed]')) button.classList.toggle('selected', Number(button.dataset.speed) === Number($('speed').value));
  if (!current) $('timeValue').textContent = `0.00 / ${(Number($('duration').value) / 1000).toFixed(2)} s`;
}

function renderIdleText() {
  $('playbackStatus').textContent = t('lab.status.ready');
  $('phaseValue').textContent = t('lab.playback.readyHint');
  $('pauseButton').setAttribute('aria-label', t('lab.a11y.pause'));
}

function resetTransport() {
  $('progress').value = '0';
  $('progressValue').textContent = '0%';
  renderIdleText();
  $('statusDot').className = 'status-dot';
  $('pauseButton').disabled = true;
  $('pauseButton').textContent = 'Ⅱ';
  $('replayButton').disabled = true;
  $('cancelButton').disabled = true;
  updateReadouts();
}

function updateConfig({ preserveError = false } = {}) {
  try {
    copiedConfig = createCodeExample(getAgentLabConfig(), t);
    $('codePreview').textContent = copiedConfig;
    $('copyButton').disabled = false;
    if (!preserveError) clearError();
  } catch (error) {
    $('copyButton').disabled = true;
    showError(error);
  }
}

function updatePreference() {
  $('systemMotion').textContent = t(motionPreference.matches ? 'lab.preference.reduced' : 'lab.preference.full');
}

for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => selectMode(button.dataset.mode));
for (const button of document.querySelectorAll('[data-preset]')) button.addEventListener('click', () => applyPreset(button.dataset.preset));
$('settingsForm').addEventListener('submit', (event) => event.preventDefault());
$('settingsForm').addEventListener('input', (event) => {
  if (event.target.id === 'anchorMode') {
    $('coordinateFields').hidden = $('anchorMode').value !== 'points';
    if ($('anchorMode').value === 'points') measureAnchors();
  }
  updateReadouts();
  updateConfig();
  if (event.target.id === 'speed' && current) {
    try { current.setSpeed(numberValue('speed')); updatePlayback(current); }
    catch (error) { showError(error); }
  }
});
$('settingsForm').addEventListener('change', updateConfig);
for (const button of document.querySelectorAll('[data-speed]')) button.addEventListener('click', () => {
  $('speed').value = button.dataset.speed;
  $('speed').dispatchEvent(new Event('input', { bubbles: true }));
});
$('playButton').addEventListener('click', () => run());
$('pauseButton').addEventListener('click', () => {
  if (!current) return;
  if (current.status === 'paused') { current.resume(); logEvent('resume', 'lab.log.resume'); }
  else { current.pause(); logEvent('pause', 'lab.log.pause'); }
  updatePlayback(current);
});
$('cancelButton').addEventListener('click', () => { current?.cancel(); if (current) updatePlayback(current); });
$('replayButton').addEventListener('click', () => {
  if (!current) return;
  try { clearError(); attach(current.replay(), currentKind); }
  catch (error) { showError(error); }
});
$('progress').addEventListener('input', () => {
  const progress = Number($('progress').value) / 1000;
  let controller = current;
  if (!controller || controller.status === 'finished' || controller.status === 'cancelled') controller = run(false);
  if (!controller) return;
  controller.pause();
  // Newly created controllers initialize in a microtask before preview seeking.
  queueMicrotask(() => {
    if (current !== controller) return;
    try { controller.seek(progress); updatePlayback(controller); }
    catch (error) { showError(error); }
  });
});
$('sequenceButton').addEventListener('click', () => {
  try {
    clearError();
    selectMode('transfer');
    const first = motionOptions({ forceTransfer: true });
    const second = motionOptions({ reverse: true, forceTransfer: true });
    cancelAll('sequence-start');
    attach(sequence([first, second]), 'sequence');
    logEvent('sequence', 'lab.log.sequence');
  } catch (error) { showError(error); }
});
$('waypointButton').addEventListener('click', () => {
  try {
    const anchors = mode === 'in-place' ? { from: $('sourceAnchor'), to: $('sourceAnchor') } : readAnchors();
    const source = centerOf(anchors.from);
    const target = centerOf(anchors.to);
    $('waypoints').value = JSON.stringify([{ x: Math.round((source.x + target.x) / 2), y: Math.round((source.y + target.y) / 2 - 35), z: 20 }], null, 2);
    updateConfig();
  } catch (error) { showError(error); }
});
$('measureAnchors').addEventListener('click', () => { measureAnchors(); updateConfig(); });
$('resetButton').addEventListener('click', () => {
  cancelAll('reset');
  current = null;
  $('settingsForm').reset();
  $('coordinateFields').hidden = true;
  selectMode('transfer');
  applyPreset('launch');
  resetTransport();
  clearError();
  logEvent('reset', 'lab.log.reset');
});
$('clearLog').addEventListener('click', () => { $('eventLog').replaceChildren(); logEntries.length = 0; });
$('copyButton').addEventListener('click', async () => {
  try {
    updateConfig();
    if ($('copyButton').disabled) return;
    await navigator.clipboard.writeText(copiedConfig);
    copyMessage = phrase('lab.copy.success');
    $('copyStatus').textContent = renderPhrase(copyMessage);
  } catch {
    copyMessage = phrase('lab.copy.denied');
    $('copyStatus').textContent = renderPhrase(copyMessage);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents($('codePreview'));
    selection?.removeAllRanges();
    selection?.addRange(range);
    $('codePreview').parentElement.focus();
  }
});

function translateLab() {
  renderModeText();
  if (current) renderPlaybackText(current);
  else renderIdleText();
  updatePreference();
  logEntries.forEach(renderLogEntry);
  // Translate only leaf text in existing visuals. Their nodes, transforms, and
  // ownership remain untouched, including a currently flying transfer card.
  document.querySelectorAll('[data-lab-visual]').forEach((card) => translateDOM(card));
  $('copyStatus').textContent = renderPhrase(copyMessage);
  updateConfig({ preserveError: true });
  renderError();
}

onLanguageChange(translateLab);

// Page teardown is owned by the application, not by the animation package.
window.addEventListener('pagehide', () => {
  disposed = true;
  cancelAll('disposed');
  motionPreference.removeEventListener('change', updatePreference);
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  disposed = false;
  motionPreference.addEventListener('change', updatePreference);
  updatePreference();
  if (current) updatePlayback(current);
  translateLab();
});
motionPreference.addEventListener('change', updatePreference);
applyPreset('launch');
resetTransport();
updatePreference();
renderModeText();
$('copyStatus').textContent = renderPhrase(copyMessage);
