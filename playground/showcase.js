import { play, sequence } from '../dist/dom/index.js';
import { createParticles } from '../dist/effects/index.js';
import { t, onLanguageChange, translateDOM } from './i18n.js';

// Each scene owns its decorative nodes and playback handles. Business DOM is
// never moved, and every moving object is clipped by its own miniature stage.
const gallery = document.querySelector('#showcaseGrid');
const escapeText = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const text = (key, tag = 'span', className = '') => `<${tag}${className ? ` class="${className}"` : ''} data-i18n="showcase.${key}">${escapeText(t(`showcase.${key}`))}</${tag}>`;
const headline = scene => `<span class="demo-stage-word">${text(`${scene}.art.line1`)}<br>${text(`${scene}.art.line2`)}</span>`;
const scenes = [
  {
    id: 'orbit', number: '01',
    art: `<div class="demo-stars"></div><div class="demo-orbit-guide"></div><div class="demo-planet"><i></i></div>${text('orbit.art.coordinate', 'span', 'demo-coordinate')}${headline('orbit')}<div class="demo-launchpad"></div><div class="demo-idle demo-idle-orbit">${objectArt('capsule')}</div>`,
  },
  {
    id: 'portal', number: '02',
    art: `<div class="demo-portal-grid"></div><div class="demo-portal demo-portal-a"><i></i></div><div class="demo-portal demo-portal-b"><i></i></div>${text('portal.art.here', 'span', 'demo-portal-label demo-portal-label-a')}${text('portal.art.there', 'span', 'demo-portal-label demo-portal-label-b')}${text('portal.art.coordinate', 'span', 'demo-coordinate')}<div class="demo-idle demo-idle-portal">${objectArt('parcel')}</div>`,
  },
  {
    id: 'vinyl', number: '03',
    art: `${headline('vinyl')}<div class="demo-record-sleeve"><span><i style="font-style:normal" data-i18n="showcase.vinyl.art.volume">${escapeText(t('showcase.vinyl.art.volume'))}</i><b>03</b></span></div><div class="demo-turntable"><div class="demo-platter"></div><i class="demo-tonearm"></i><i class="demo-table-switch"></i></div><div class="demo-equalizer">${'<i></i>'.repeat(12)}</div>${text('vinyl.art.coordinate', 'span', 'demo-coordinate')}<div class="demo-idle demo-idle-vinyl">${objectArt('record')}</div>`,
  },
  {
    id: 'candy', number: '04',
    art: `${headline('candy')}<div class="demo-candy-orbit"></div><span class="demo-candy-spark demo-candy-spark-a">✳</span><span class="demo-candy-spark demo-candy-spark-b">✦</span><div class="demo-candy-bowl"></div>${text('candy.art.coordinate', 'span', 'demo-coordinate')}<div class="demo-idle demo-idle-candy">${objectArt('donut')}</div>`,
  },
  {
    id: 'arcade', number: '05',
    art: `<div class="demo-arcade-grid"></div><div class="demo-score">${text('arcade.art.combo', 'small')}<b data-demo-combo>00</b><span>×</span></div><div class="demo-arcade-target demo-arcade-target-a">01</div><div class="demo-arcade-target demo-arcade-target-b">02</div><div class="demo-arcade-target demo-arcade-target-c">03</div>${text('arcade.art.coordinate', 'span', 'demo-coordinate')}<div class="demo-idle demo-idle-arcade">${objectArt('token')}</div>`,
  },
  {
    id: 'paper', number: '06',
    art: `<div class="demo-paper-rule"></div><div class="demo-paper-sun"></div><div class="demo-paper-cloud demo-paper-cloud-a"></div><div class="demo-paper-cloud demo-paper-cloud-b"></div>${headline('paper')}${text('paper.art.coordinate', 'span', 'demo-coordinate')}<div class="demo-idle demo-idle-paper">${objectArt('plane')}</div>`,
  },
];

function objectArt(kind, variant = 0) {
  const art = {
    capsule: '<i class="demo-capsule-window"></i><i class="demo-capsule-fin"></i><b>V.</b>',
    parcel: `<i></i><b>↗</b>${text('object.express')}`,
    record: '<i></i><b>A</b>',
    donut: '<i></i>',
    sweet: '<i></i>',
    token: '<b>✦</b>',
    plane: '<i></i><b></b>',
  };
  return `<div class="demo-object demo-object-${kind} demo-variant-${variant}" aria-hidden="true">${art[kind]}</div>`;
}

if (gallery) {
  gallery.classList.add('showcase-grid');
  gallery.innerHTML = scenes.map(scene => `
    <article class="demo-card demo-card-${scene.id}" data-demo="${scene.id}" data-playing="false">
      <div class="demo-stage" role="img" data-i18n-aria-label="showcase.${scene.id}.a11y.stage" aria-label="${escapeText(t(`showcase.${scene.id}.a11y.stage`))}">
        <div class="demo-stage-art" aria-hidden="true">${scene.art}</div>
        <span class="demo-number" aria-hidden="true">${scene.number}</span>
        <div class="demo-progress" aria-hidden="true"><i></i></div>
      </div>
      <div class="demo-info">
        ${text(`${scene.id}.label`, 'p', 'demo-eyebrow')}
        ${text(`${scene.id}.title`, 'h3')}
        ${text(`${scene.id}.description`, 'p', 'demo-description')}
        <div class="demo-options"><div class="demo-tags">${text(`${scene.id}.tag1`)}${text(`${scene.id}.tag2`)}</div><label class="demo-effect-toggle"><input type="checkbox" data-demo-jet checked data-i18n-aria-label="showcase.${scene.id}.a11y.jet" aria-label="${escapeText(t(`showcase.${scene.id}.a11y.jet`))}">${text('control.jet')}</label></div>
        <div class="demo-actions">
          <button class="demo-play" type="button" data-demo-play="${scene.id}" data-i18n-aria-label="showcase.${scene.id}.action" aria-label="${escapeText(t(`showcase.${scene.id}.action`))}"><span class="demo-play-icon" aria-hidden="true">↗</span>${text(`${scene.id}.action`)}</button>
          <span class="demo-status" data-demo-status data-i18n="showcase.status.idle" role="status" aria-live="polite">${escapeText(t('showcase.status.idle'))}</span>
        </div>
      </div>
    </article>
  `).join('');

  const active = new Map();
  const setStatus = (card, status) => {
    const node = card.querySelector('[data-demo-status]');
    node.dataset.i18n = `showcase.status.${status}`;
    node.textContent = t(node.dataset.i18n);
  };
  // Translate only text leaves/attributes, including any currently flying
  // parcel. Never recreate cards, stages, motion nodes, playback, or counters.
  translateDOM(gallery);
  onLanguageChange(() => translateDOM(gallery));

  function cancelScene(card, reason = 'user') {
    const session = active.get(card);
    if (!session) return;
    active.delete(card);
    for (const playback of session.playbacks) playback.cancel(reason);
    for (const node of session.nodes) node.remove();
    card.dataset.playing = 'false';
    card.style.setProperty('--demo-progress', '0');
    setStatus(card, reason === 'replaced' ? 'restarting' : 'stopped');
  }

  async function runScene(card, scene) {
    cancelScene(card, 'replaced');
    const stage = card.querySelector('.demo-stage');
    const box = stage.getBoundingClientRect();
    const session = { playbacks: [], nodes: [], progress: [] };
    active.set(card, session);
    card.dataset.playing = 'true';
    card.dataset.completed = 'false';
    setStatus(card, 'playing');
    const combo = card.querySelector('[data-demo-combo]');
    if (combo) combo.textContent = '00';

    // Scene coordinates are fractions of this stage. Low jump heights keep the
    // full path inside it even on a narrow phone, and overflow clips all artwork.
    const point = (x, y) => ({ x: box.left + box.width * x, y: box.top + box.height * y });
    const make = (kind, x, y, size = 58, variant = 0) => {
      const node = document.createElement('div');
      node.className = 'demo-motion';
      node.setAttribute('aria-hidden', 'true');
      Object.assign(node.style, { left: `${box.width * x - size / 2}px`, top: `${box.height * y - size / 2}px`, width: `${size}px`, height: `${size}px` });
      node.innerHTML = objectArt(kind, variant);
      stage.append(node);
      session.nodes.push(node);
      return node;
    };
    const options = (element, from, to, extra = {}) => {
      const size = Number.parseFloat(element.style.width);
      const paper = scene.id === 'paper';
      const colors = { orbit: '#91caff', portal: '#d0a1ff', vinyl: '#ffe0a8', candy: '#fff2cf', arcade: '#d6b3ff', paper: '#6f8ee8' };
      return {
        element, from: point(...from), to: point(...to),
        duration: 2100, height: 62, turns: 1, axis: 'y', bounce: 0.16,
        preset: 'launch', layout: 'cancel', reducedMotion: 'system',
        ...(card.querySelector('[data-demo-jet]').checked ? {
          effects: createParticles({
            jet: true, trail: true, color: colors[scene.id], density: 1.4, intensity: 2.1,
            seed: Number(scene.number) * 17 + Math.round(size), clip: stage,
            emitter: {
              offset: paper ? { x: -size * 0.36, y: size * 0.08 } : { x: 0, y: size * 0.5 + 3 },
              direction: paper ? { x: -0.95, y: 0.3 } : { x: 0, y: 1 },
              rotate: true,
            },
          }),
        } : {}),
        ...extra,
      };
    };
    const track = playback => {
      const index = session.playbacks.length;
      session.playbacks.push(playback);
      session.progress.push(0);
      playback.on('update', event => {
        if (active.get(card) !== session) return;
        session.progress[index] = event.progress;
        card.style.setProperty('--demo-progress', String(session.progress.reduce((sum, value) => sum + value, 0) / session.progress.length));
      });
      return playback;
    };

    try {
      if (scene.id === 'orbit') {
        const ship = make('capsule', 0.16, 0.72, 62);
        track(play(options(ship, [0.16, 0.72], [0.78, 0.55], {
          duration: 2800, turns: 2, height: 72, depth: 28,
          path: [point(0.38, 0.68), point(0.59, 0.54)], pathMode: 'smooth',
        })));
      } else if (scene.id === 'portal') {
        const parcel = make('parcel', 0.14, 0.71, 52);
        track(sequence([
          options(parcel, [0.14, 0.71], [0.29, 0.52], { duration: 1400, height: 40, turns: 1, axis: 'x', bounce: 0 }),
          options(parcel, [0.71, 0.52], [0.86, 0.71], { duration: 1500, height: 58, turns: 1, axis: 'y', direction: -1, bounce: 0.2 }),
        ]));
      } else if (scene.id === 'vinyl') {
        const record = make('record', 0.23, 0.64, 98);
        track(sequence([
          options(record, [0.23, 0.64], [0.73, 0.56], { duration: 1900, height: 65, axis: 'x', turns: 1, bounce: 0.06, preset: 'gentle' }),
          options(record, [0.73, 0.56], [0.73, 0.56], { duration: 1500, height: 0, axis: 'z', turns: 2, bounce: 0, preset: 'float' }),
        ]));
      } else if (scene.id === 'candy') {
        for (let i = 0; i < 5; i++) {
          const from = [0.34 + i * 0.08, 0.74];
          const to = [0.14 + i * 0.18, 0.75 - (i % 2) * 0.09];
          const sweet = make(i % 2 === 0 ? 'donut' : 'sweet', ...from, 42 + (i % 2) * 6, i);
          track(play(options(sweet, from, to, {
            duration: 1800 + i * 180, height: 66 + (i % 3) * 20,
            turns: 1 + i % 2, direction: i % 2 ? -1 : 1, axis: ['z', 'y', 'x'][i % 3],
            bounce: 0.3, preset: 'snappy',
          })));
        }
      } else if (scene.id === 'arcade') {
        const token = make('token', 0.14, 0.73, 48);
        const stops = [[0.14, 0.73], [0.38, 0.68], [0.73, 0.4], [0.82, 0.73]];
        track(sequence(stops.slice(1).map((to, index) => options(token, stops[index], to, {
          duration: 1000 + index * 120, height: index === 1 ? 32 : 56,
          axis: index === 1 ? 'y' : 'z', turns: index === 1 ? 2 : 1,
          direction: index === 1 ? -1 : 1, bounce: 0.16, preset: 'snappy',
          onLand: () => { if (active.get(card) === session) combo.textContent = `0${index + 1}`; },
        }))));
      } else if (scene.id === 'paper') {
        for (let i = 0; i < 3; i++) {
          const from = [0.14, 0.6 + i * 0.09];
          const to = [0.82 - i * 0.07, 0.32 + i * 0.16];
          const plane = make('plane', ...from, 64 - i * 8, i);
          track(play(options(plane, from, to, {
            duration: 2400 + i * 260, height: 20 + i * 9, axis: 'x', turns: i === 1 ? 1 : 0,
            direction: -1, bounce: 0, preset: 'float',
            path: [point(0.4, 0.55 + i * 0.08), point(0.61, 0.42 + i * 0.1)], pathMode: 'smooth',
          })));
        }
      }

      const results = await Promise.all(session.playbacks.map(playback => playback.finished));
      if (active.get(card) !== session) return;
      active.delete(card);
      for (const node of session.nodes) node.remove();
      card.dataset.playing = 'false';
      const finished = results.every(result => result.status === 'finished');
      card.dataset.completed = String(finished);
      card.style.setProperty('--demo-progress', finished ? '1' : '0');
      setStatus(card, finished
        ? (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reducedComplete' : 'complete')
        : 'stopped');
    } catch (error) {
      cancelScene(card, 'error');
      setStatus(card, 'error');
      console.error('Tflip showcase:', error);
    }
  }

  for (const scene of scenes) {
    const card = gallery.querySelector(`[data-demo="${scene.id}"]`);
    card.querySelector('[data-demo-play]').addEventListener('click', () => void runScene(card, scene));
    card.querySelector('[data-demo-jet]').addEventListener('change', () => {
      if (active.has(card)) void runScene(card, scene);
      else setStatus(card, card.querySelector('[data-demo-jet]').checked ? 'jetOn' : 'jetOff');
    });
  }
  const stopAll = reason => { for (const card of [...active.keys()]) cancelScene(card, reason); };
  // Scrolling invalidates viewport anchors. Cancel all segments, not only the
  // currently playing child of a sequence, before a later segment can start.
  document.addEventListener('scroll', () => stopAll('layout'), { capture: true, passive: true });
  window.addEventListener('resize', () => stopAll('layout'), { passive: true });
  window.addEventListener('pagehide', () => stopAll('disposed'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAll('disposed'); });
}
