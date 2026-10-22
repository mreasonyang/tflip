import { play as playMotion, sequence } from '../../runtime/dom/index.js';
import { createParticles } from '../../runtime/effects/index.js';

// All HTML below is owned artwork, never caller-provided content. No module
// initialization touches the DOM; importing this module during SSR is safe.
const scenes = {
  orbit: {
    number: '01', label: 'Orbital Drop', title: 'Next stop: Saturn.',
    description: 'A little capsule. A very big send-off.',
    tags: ['3D roll', 'Arc flight'], action: 'Launch capsule',
    a11y: 'A capsule rolls along an arc toward Saturn.',
    art: () => `<div class="demo-stars"></div><div class="demo-orbit-guide"></div><div class="demo-planet"><i></i></div><span class="demo-coordinate">SECTOR 07 / 38,400 KM</span>${headline('GO', 'BEYOND.')}<div class="demo-launchpad"></div><div class="demo-idle demo-idle-orbit">${objectArt('capsule')}</div>`,
  },
  portal: {
    number: '02', label: 'Portal Express', title: 'Take the shortcut.',
    description: 'Two portals. One very short delivery route.',
    tags: ['Two-step sequence', 'Portal jump'], action: 'Open portals',
    a11y: 'A parcel travels through two glowing portals.',
    art: () => `<div class="demo-portal-grid"></div><div class="demo-portal demo-portal-a"><i></i></div><div class="demo-portal demo-portal-b"><i></i></div><span class="demo-portal-label demo-portal-label-a">HERE</span><span class="demo-portal-label demo-portal-label-b">THERE</span><span class="demo-coordinate">DISTANCE IS A SUGGESTION.</span><div class="demo-idle demo-idle-portal">${objectArt('parcel')}</div>`,
  },
  vinyl: {
    number: '03', label: 'Vinyl Drop', title: 'Drop into the groove.',
    description: 'Flip it, land it, spin it. Set things in motion.',
    tags: ['Axis switch', 'Chained moves'], action: 'Drop the record',
    a11y: 'A vinyl record flips onto a turntable and spins. No audio.',
    art: () => `${headline('GOOD', 'ROTATIONS.')}<div class="demo-record-sleeve"><span>VOL.<b>03</b></span></div><div class="demo-turntable"><div class="demo-platter"></div><i class="demo-tonearm"></i><i class="demo-table-switch"></i></div><div class="demo-equalizer">${'<i></i>'.repeat(12)}</div><span class="demo-coordinate">SIDE A — ALL MOTION, NO AUDIO</span><div class="demo-idle demo-idle-vinyl">${objectArt('record')}</div>`,
  },
  candy: {
    number: '04', label: 'Candy Gravity', title: 'Gravity takes a break.',
    description: 'Five sweets. Five ways to take flight.',
    tags: ['Multiple objects', 'Separate paths'], action: 'Launch the sweets',
    a11y: 'Five sweets take off together along different paths.',
    art: () => `${headline('SWEET', 'CHAOS.')}<div class="demo-candy-orbit"></div><span class="demo-candy-spark demo-candy-spark-a">✳</span><span class="demo-candy-spark demo-candy-spark-b">✦</span><div class="demo-candy-bowl"></div><span class="demo-coordinate">100% JOY / 0% GRAVITY</span><div class="demo-idle demo-idle-candy">${objectArt('donut')}</div>`,
  },
  arcade: {
    number: '05', label: 'Neon Combo', title: 'Make it a triple.',
    description: 'Charge, leap, repeat. Your tiny arcade awaits.',
    tags: ['Triple jump', 'Landing feedback'], action: 'Start the combo',
    a11y: 'A neon token makes three jumps, counting each landing.',
    art: () => `<div class="demo-arcade-grid"></div><div class="demo-score"><small>COMBO</small><b data-demo-combo>00</b><span>×</span></div><div class="demo-arcade-target demo-arcade-target-a">01</div><div class="demo-arcade-target demo-arcade-target-b">02</div><div class="demo-arcade-target demo-arcade-target-c">03</div><span class="demo-coordinate">PRESS PLAY. BREAK THE ORDINARY.</span><div class="demo-idle demo-idle-arcade">${objectArt('token')}</div>`,
  },
  paper: {
    number: '06', label: 'Paper Squadron', title: 'Fold. Fly. Imagine.',
    description: 'Three paper planes take the scenic route.',
    tags: ['Formation flight', 'Smooth curves'], action: 'Fly the planes',
    a11y: 'Three paper planes fly together along separate smooth curves.',
    art: () => `<div class="demo-paper-rule"></div><div class="demo-paper-sun"></div><div class="demo-paper-cloud demo-paper-cloud-a"></div><div class="demo-paper-cloud demo-paper-cloud-b"></div>${headline('IDEAS', 'TAKE FLIGHT.')}<span class="demo-coordinate">DEPARTURE: ANYWHERE / ARRIVAL: WHAT IF</span><div class="demo-idle demo-idle-paper">${objectArt('plane')}</div>`,
  },
};

function headline(first, second) {
  return `<span class="demo-stage-word">${first}<br>${second}</span>`;
}

function objectArt(kind, variant = 0) {
  const parts = {
    capsule: '<i class="demo-capsule-window"></i><i class="demo-capsule-fin"></i><b>V.</b>',
    parcel: '<i></i><b>↗</b><span>EXPRESS</span>',
    record: '<i></i><b>A</b>', donut: '<i></i>', sweet: '<i></i>',
    token: '<b>✦</b>', plane: '<i></i><b></b>',
  };
  return `<div class="demo-object demo-object-${kind} demo-variant-${variant}" aria-hidden="true">${parts[kind]}</div>`;
}

const terminal = status => status === 'finished' || status === 'cancelled';
const clampProgress = value => {
  if (!Number.isFinite(value)) throw new RangeError('progress must be a finite number');
  return Math.max(0, Math.min(1, value));
};
const checkSpeed = value => {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('speed must be finite and greater than zero');
  return value;
};

/**
 * Mount one independently controlled scene. Link ./style.css separately.
 *
 * play() replaces the previous run and immediately returns a run handle with
 * { finished, status, progress, currentTime, duration, pause, resume, seek,
 *   setSpeed, cancel }. finished resolves (never rejects) to {status:'finished',
 * reducedMotion:boolean} or {status:'cancelled',reason,error?}. These results
 * describe animation playback, never application/business success.
 *
 * seek(0..1) addresses the scene's longest nominal timeline, not the average
 * progress of its objects. It preserves running/paused state. Instance seek
 * while idle/terminal creates a paused preview; a terminal run handle is inert.
 * A seek rebuilds only this run's library controllers, so previously completed
 * short tracks can be rewound. setSpeed persists for future runs. Jet checkbox
 * changes preserve current time/state. Scroll/resize cancels viewport anchors.
 *
 * dispose() is idempotent and removes only the mounted root and its resources.
 * Call it when unmounting the host. Other instance methods except cancel throw
 * after disposal. There is no private animation clock: runtime play/sequence
 * owns rAF, effect sampling, reduced motion, and controller cleanup.
 */
export function mountGalleryDemo(container, id, { jet = true } = {}) {
  const doc = container?.ownerDocument;
  const win = doc?.defaultView;
  if (!win || !(container instanceof win.HTMLElement)) throw new TypeError('container must be an HTMLElement with a browser Document');
  if (typeof id !== 'string' || !Object.hasOwn(scenes, id)) throw new RangeError('id must be orbit, portal, vinyl, candy, arcade, or paper');
  if (typeof jet !== 'boolean') throw new TypeError('jet must be a boolean');
  const scene = scenes[id];
  const root = doc.createElement('article');
  root.className = `demo-card demo-card-${id}`;
  root.dataset.tflipGallery = id;
  // Compatibility with existing embeds that use the original data attribute.
  root.dataset.vectorGallery = id;
  root.dataset.demo = id;
  root.dataset.state = 'idle';
  root.dataset.playing = 'false';
  root.dataset.progress = '0';
  root.dataset.completed = 'false';
  root.innerHTML = `
    <div class="demo-stage" role="img" aria-label="${scene.a11y}">
      <div class="demo-stage-art" aria-hidden="true">${scene.art()}</div>
      <span class="demo-number" aria-hidden="true">${scene.number}</span>
      <div class="demo-progress" aria-hidden="true"><i></i></div>
    </div>
    <div class="demo-info">
      <p class="demo-eyebrow">${scene.label}</p><h3>${scene.title}</h3>
      <p class="demo-description">${scene.description}</p>
      <div class="demo-options"><div class="demo-tags">${scene.tags.map(tag => `<span>${tag}</span>`).join('')}</div>
        <label class="demo-effect-toggle"><input type="checkbox" data-demo-jet aria-label="${scene.label} jet effects">Jets</label>
      </div>
      <div class="demo-actions"><button class="demo-play" type="button" data-demo-play aria-label="${scene.action}"><span class="demo-play-icon" aria-hidden="true">↗</span><span>${scene.action}</span></button>
        <span class="demo-status" data-demo-status role="status" aria-live="polite">Ready to play</span>
      </div>
    </div>`;
  container.append(root);
  const stage = root.querySelector('.demo-stage');
  const statusNode = root.querySelector('[data-demo-status]');
  const jetInput = root.querySelector('[data-demo-jet]');
  const playButton = root.querySelector('[data-demo-play]');
  const combo = root.querySelector('[data-demo-combo]');
  const equalizer = [...root.querySelectorAll('.demo-equalizer i')];
  jetInput.checked = jet;
  let active;
  let disposed = false;
  let speed = 1;
  const cleanups = [];
  const motionPreference = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const ensureMounted = () => { if (disposed) throw new Error('Gallery demo has been disposed'); };
  const reduced = () => !!motionPreference?.matches;

  function currentTime(run) {
    if (!terminal(run.status) && run.handles.length) run.time = Math.max(...run.handles.map(handle => handle.currentTime));
    return run.time;
  }

  function update(run) {
    if (active !== run || disposed) return;
    const time = currentTime(run);
    const progress = Math.min(1, time / run.duration);
    root.dataset.state = run.status;
    root.dataset.playing = String(!terminal(run.status));
    root.dataset.completed = String(run.status === 'finished');
    root.dataset.progress = String(progress);
    root.style.setProperty('--demo-progress', String(progress));
    root.style.setProperty('--gallery-pulse', String(1 + Math.sin(progress * Math.PI * 8) ** 2 * 0.6));
    equalizer.forEach((bar, index) => { bar.style.height = `${4 + Math.sin(progress * Math.PI * 14 + index * 1.7) ** 2 * 16}px`; });
    // Arcade uses explicit snappy phase weights, with landing at 82% of each
    // step. Deriving the count from time makes backward seeks deterministic.
    if (combo) combo.textContent = String([820, 1000 + 1120 * 0.82, 2120 + 1240 * 0.82].filter(landing => time >= landing).length).padStart(2, '0');
    const labels = { running: 'Playing · tap to replay', paused: 'Paused · ready to resume', finished: run.reduced ? 'Reduced-motion demo done' : 'Done · go again', cancelled: 'Stopped · ready to replay' };
    statusNode.textContent = labels[run.status];
  }

  function releaseHandles(run, reason) {
    run.version++;
    for (const off of run.subscriptions.splice(0)) off();
    for (const handle of run.handles.splice(0)) handle.cancel(reason);
  }

  function settle(run, result) {
    if (terminal(run.status)) return;
    currentTime(run);
    run.status = result.status;
    if (result.status === 'finished') { run.time = run.duration; run.reduced = !!result.reducedMotion; }
    releaseHandles(run, result.status === 'finished' ? 'gallery-finished' : result.reason);
    for (const track of run.tracks) track.node.remove();
    update(run);
    run.resolve(result);
  }

  function buildHandles(run, time, running) {
    releaseHandles(run, 'gallery-seek');
    run.time = time;
    run.status = running ? 'running' : 'paused';
    const version = run.version;
    for (const track of run.tracks) {
      track.node.style.visibility = '';
      const steps = track.steps.map(options => ({ ...options, autoplay: false }));
      const handle = steps.length === 1 ? playMotion(steps[0]) : sequence(steps);
      run.handles.push(handle);
      handle.setSpeed(run.speed);
      handle.seek(Math.min(1, time / handle.duration));
      run.subscriptions.push(handle.on('update', () => update(run)));
      run.subscriptions.push(handle.on('finish', () => { track.node.style.visibility = 'hidden'; }));
      void handle.finished.then(result => {
        if (run.version !== version || terminal(run.status)) return;
        if (result.status === 'cancelled') settle(run, result);
      });
    }
    const handles = [...run.handles];
    void Promise.all(handles.map(handle => handle.finished)).then(results => {
      if (run.version !== version || terminal(run.status)) return;
      if (results.every(result => result.status === 'finished')) settle(run, { status: 'finished', reducedMotion: reduced() });
    });
    if (running) for (const handle of handles) handle.resume();
    update(run);
    // The runtime also observes system preference changes for an active run.
    // An initial paused preview obeys reduce immediately instead of showing a
    // frozen full-motion frame that would bypass the preference.
    if (reduced()) queueMicrotask(() => {
      if (run.version === version && !terminal(run.status)) settle(run, { status: 'finished', reducedMotion: true });
    });
  }

  function start(running = true, progress = 0) {
    ensureMounted();
    if (!root.isConnected) throw new Error('Connect the gallery container before playback');
    const box = stage.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) throw new Error('Gallery stage must be visible and have a nonzero size; link style.css');
    if (active && !terminal(active.status)) settle(active, { status: 'cancelled', reason: 'replaced' });
    const run = { status: running ? 'running' : 'paused', time: 0, duration: 0, speed, version: 0, tracks: [], handles: [], subscriptions: [], reduced: false };
    const finished = new Promise(resolve => { run.resolve = resolve; });
    active = run;
    const point = (x, y) => ({ x: box.left + box.width * x, y: box.top + box.height * y });
    const make = (kind, x, y, size = 58, variant = 0) => {
      const node = doc.createElement('div');
      node.className = 'demo-motion';
      node.setAttribute('aria-hidden', 'true');
      Object.assign(node.style, { left: `${box.width * x - size / 2}px`, top: `${box.height * y - size / 2}px`, width: `${size}px`, height: `${size}px` });
      node.innerHTML = objectArt(kind, variant);
      stage.append(node);
      const track = { node, steps: [] };
      run.tracks.push(track);
      return track;
    };
    const options = (track, from, to, extra = {}) => {
      const size = Number.parseFloat(track.node.style.width);
      const colors = { orbit: '#91caff', portal: '#d0a1ff', vinyl: '#ffe0a8', candy: '#fff2cf', arcade: '#d6b3ff', paper: '#6f8ee8' };
      return {
        element: track.node, from: point(...from), to: point(...to),
        duration: 2100, height: 62, turns: 1, axis: 'y', bounce: 0.16,
        preset: 'launch', layout: 'cancel', repeat: 'replace', reducedMotion: 'system',
        // Factory reads this instance's checkbox when a controller is mounted,
        // allowing a jet change to rebuild at the same timeline position.
        effects: context => jetInput.checked ? createParticles({
          jet: true, trail: true, color: colors[id], density: 1.4, intensity: 2.1,
          seed: Number(scene.number) * 17 + Math.round(size), clip: stage,
          emitter: {
            offset: id === 'paper' ? { x: -size * 0.36, y: size * 0.08 } : { x: 0, y: size * 0.5 + 3 },
            direction: id === 'paper' ? { x: -0.95, y: 0.3 } : { x: 0, y: 1 }, rotate: true,
          },
        })(context) : { render() {}, dispose() {} },
        ...extra,
      };
    };

    try {
      if (id === 'orbit') {
        const ship = make('capsule', 0.16, 0.72, 62);
        ship.steps = [options(ship, [0.16, 0.72], [0.78, 0.55], { duration: 2800, turns: 2, height: 72, depth: 28, path: [point(0.38, 0.68), point(0.59, 0.54)], pathMode: 'smooth' })];
      } else if (id === 'portal') {
        const parcel = make('parcel', 0.14, 0.71, 52);
        parcel.steps = [
          options(parcel, [0.14, 0.71], [0.29, 0.52], { duration: 1400, height: 40, turns: 1, axis: 'x', bounce: 0 }),
          options(parcel, [0.71, 0.52], [0.86, 0.71], { duration: 1500, height: 58, turns: 1, axis: 'y', direction: -1, bounce: 0.2 }),
        ];
      } else if (id === 'vinyl') {
        const record = make('record', 0.23, 0.64, 98);
        record.steps = [
          options(record, [0.23, 0.64], [0.73, 0.56], { duration: 1900, height: 65, axis: 'x', turns: 1, bounce: 0.06, preset: 'gentle' }),
          options(record, [0.73, 0.56], [0.73, 0.56], { duration: 1500, height: 0, axis: 'z', turns: 2, bounce: 0, preset: 'float' }),
        ];
      } else if (id === 'candy') {
        for (let i = 0; i < 5; i++) {
          const from = [0.34 + i * 0.08, 0.74], to = [0.14 + i * 0.18, 0.75 - (i % 2) * 0.09];
          const sweet = make(i % 2 === 0 ? 'donut' : 'sweet', ...from, 42 + (i % 2) * 6, i);
          sweet.steps = [options(sweet, from, to, { duration: 1800 + i * 180, height: 66 + (i % 3) * 20, turns: 1 + i % 2, direction: i % 2 ? -1 : 1, axis: ['z', 'y', 'x'][i % 3], bounce: 0.3, preset: 'snappy' })];
        }
      } else if (id === 'arcade') {
        const token = make('token', 0.14, 0.73, 48), stops = [[0.14, 0.73], [0.38, 0.68], [0.73, 0.4], [0.82, 0.73]];
        token.steps = stops.slice(1).map((to, index) => options(token, stops[index], to, {
          duration: 1000 + index * 120, height: index === 1 ? 32 : 56,
          axis: index === 1 ? 'y' : 'z', turns: index === 1 ? 2 : 1, direction: index === 1 ? -1 : 1,
          bounce: 0.16, preset: 'snappy', phases: { anticipation: 0.1, launch: 0.22, roll: 0.3, descent: 0.2, settle: 0.18 },
        }));
      } else if (id === 'paper') {
        for (let i = 0; i < 3; i++) {
          const from = [0.14, 0.6 + i * 0.09], to = [0.82 - i * 0.07, 0.32 + i * 0.16];
          const plane = make('plane', ...from, 64 - i * 8, i);
          plane.steps = [options(plane, from, to, { duration: 2400 + i * 260, height: 20 + i * 9, axis: 'x', turns: i === 1 ? 1 : 0, direction: -1, bounce: 0, preset: 'float', path: [point(0.4, 0.55 + i * 0.08), point(0.61, 0.42 + i * 0.1)], pathMode: 'smooth' })];
        }
      }
      run.duration = Math.max(...run.tracks.map(track => track.steps.reduce((sum, step) => sum + step.duration, 0)));
      run.control = {
        finished,
        get status() { return run.status; },
        get duration() { return run.duration; },
        get currentTime() { return currentTime(run); },
        get progress() { return run.duration ? currentTime(run) / run.duration : 0; },
        pause() {
          if (terminal(run.status)) return;
          for (const handle of run.handles) handle.pause();
          run.status = 'paused'; update(run);
        },
        resume() {
          if (terminal(run.status)) return;
          run.status = 'running';
          for (const handle of run.handles) handle.resume();
          update(run);
        },
        seek(value) {
          const progress = clampProgress(value);
          if (terminal(run.status)) return;
          try { buildHandles(run, progress * run.duration, run.status === 'running'); }
          catch (error) { settle(run, { status: 'cancelled', reason: 'error', error }); }
        },
        setSpeed(value) {
          checkSpeed(value);
          if (terminal(run.status)) return;
          run.speed = value;
          speed = value;
          for (const handle of run.handles) handle.setSpeed(value);
        },
        cancel(reason = 'user') { settle(run, { status: 'cancelled', reason }); },
      };
      buildHandles(run, progress * run.duration, running);
    } catch (error) {
      settle(run, { status: 'cancelled', reason: 'error', error });
      throw error;
    }
    return run.control;
  }

  const api = {
    play() { return start(); },
    pause() { ensureMounted(); active?.control.pause(); },
    resume() { ensureMounted(); active?.control.resume(); },
    seek(value) {
      ensureMounted(); const progress = clampProgress(value);
      if (!active || terminal(active.status)) return start(false, progress);
      active.control.seek(progress); return active.control;
    },
    setSpeed(value) { ensureMounted(); speed = checkSpeed(value); active?.control.setSpeed(value); },
    cancel() { active?.control.cancel('user'); },
    dispose() {
      if (disposed) return;
      active?.control.cancel('disposed');
      disposed = true;
      for (const cleanup of cleanups.splice(0)) cleanup();
      root.remove();
    },
  };
  function listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  }
  const cancel = reason => { if (active && !terminal(active.status)) active.control.cancel(reason); };
  listen(playButton, 'click', () => { try { api.play(); } catch { statusNode.textContent = 'Could not play. Check the container size.'; } });
  listen(jetInput, 'change', () => {
    if (active && !terminal(active.status)) active.control.seek(active.control.progress);
    else statusNode.textContent = jetInput.checked ? 'Jets on · ready to play' : 'Jets off · ready to play';
  });
  listen(win, 'resize', () => cancel('layout'), { passive: true });
  listen(doc, 'scroll', () => cancel('layout'), { capture: true, passive: true });
  listen(win, 'pagehide', () => cancel('pagehide'));
  listen(doc, 'visibilitychange', () => { if (doc.hidden) cancel('hidden'); });
  // Settle the entire sequence together, including paused future steps that
  // have not mounted a runtime controller yet.
  const preferenceChanged = () => {
    if (reduced() && active && !terminal(active.status)) settle(active, { status: 'finished', reducedMotion: true });
  };
  if (motionPreference?.addEventListener) listen(motionPreference, 'change', preferenceChanged);
  else if (motionPreference?.addListener) {
    motionPreference.addListener(preferenceChanged);
    cleanups.push(() => motionPreference.removeListener(preferenceChanged));
  }
  return api;
}
