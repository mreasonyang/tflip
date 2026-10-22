import test from 'node:test';
import assert from 'node:assert/strict';
import { createParticles } from '../dist/effects/index.js';

function harness({ contextMissing = false, contextThrows = false } = {}) {
  const draws = [];
  const children = [];
  const ctx = {
    globalAlpha: 1, fillStyle: '',
    setTransform(...args) { draws.push(['transform', ...args]); },
    clearRect(...args) { draws.push(['clear', ...args]); },
    beginPath() {},
    moveTo(...args) { draws.push(['move', this.globalAlpha, this.fillStyle, ...args]); },
    quadraticCurveTo(...args) { draws.push(['curve', this.globalAlpha, this.fillStyle, ...args]); },
    closePath() {},
    arc(...args) { draws.push(['arc', this.globalAlpha, this.fillStyle, ...args]); },
    fill() {},
  };
  const attributes = {};
  const canvas = {
    style: {}, width: 0, height: 0,
    getContext(kind) {
      assert.equal(kind, '2d');
      if (contextThrows) throw new Error('Canvas setup failed');
      return contextMissing ? null : ctx;
    },
    setAttribute(key, value) { attributes[key] = value; },
    remove() { const index = children.indexOf(this); if (index !== -1) children.splice(index, 1); },
  };
  const document = {
    defaultView: { innerWidth: 900, innerHeight: 600, devicePixelRatio: 3 },
    createElement(tag) { assert.equal(tag, 'canvas'); return canvas; },
  };
  const container = { appendChild(child) { children.push(child); } };
  return { canvas, draws, children, attributes, document, context: { container, document, width: 900, height: 600 } };
}

const poseAt = time => ({
  x: 100 + time / 2, y: 200, z: 0, rotateX: 0, rotateY: 0, rotateZ: 0,
  scaleX: 1, scaleY: 1, progress: time / 3600, phase: 'roll',
  thrust: 0.9, shadowScale: 1, shadowOpacity: 1,
});
const frameAt = time => ({ pose: poseAt(time), time, delta: 16, duration: 3600, progress: time / 3600, reducedMotion: false, sample: poseAt });
const particleDraws = h => h.draws.filter(draw => draw[0] === 'arc');

test('particle output is independent of render order, delta, and instance history', () => {
  const a = harness();
  const effect = createParticles({ seed: 73 })(a.context);
  effect.render(frameAt(1400));
  const expected = particleDraws(a);
  assert.ok(expected.length > 0);
  effect.render(frameAt(2000));
  effect.render(frameAt(500));
  a.draws.length = 0;
  effect.render({ ...frameAt(1400), delta: 900 });
  assert.deepEqual(particleDraws(a), expected);

  const b = harness();
  createParticles({ seed: 73 })(b.context).render(frameAt(1400));
  assert.deepEqual(particleDraws(b), expected);
  const c = harness();
  createParticles({ seed: 74 })(c.context).render(frameAt(1400));
  assert.notDeepEqual(particleDraws(c), expected);
});

test('historical sampler places particles on the traveled path', () => {
  const h = harness();
  const sampled = [];
  createParticles({ jet: false })(h.context).render({
    ...frameAt(1400),
    sample(time) { sampled.push(time); return poseAt(time); },
  });
  assert.ok(sampled.every(time => time >= 680 && time <= 1400));
  assert.ok(particleDraws(h).some(draw => draw[3] < poseAt(1400).x - 100));
});

test('reduced motion clears previous particles and never samples or draws', () => {
  const h = harness();
  const effect = createParticles()(h.context);
  effect.render(frameAt(1000));
  h.draws.length = 0;
  effect.render({ ...frameAt(1200), reducedMotion: true, sample() { throw new Error('must not sample'); } });
  assert.equal(particleDraws(h).length, 0);
  assert.deepEqual(h.draws.at(-1), ['clear', 0, 0, 900, 600]);
});

test('overlay is decorative, uses viewport coordinates, resizes, and caps DPR at 2', () => {
  const h = harness();
  const effect = createParticles()(h.context);
  assert.equal(h.canvas.style.pointerEvents, 'none');
  assert.equal(h.canvas.style.position, 'fixed');
  assert.equal(h.attributes['aria-hidden'], 'true');
  assert.equal(h.attributes.inert, '');
  effect.render(frameAt(600));
  assert.equal(h.canvas.width, 1800);
  assert.equal(h.canvas.height, 1200);
  h.document.defaultView.innerWidth = 500;
  h.document.defaultView.innerHeight = 300;
  h.document.defaultView.devicePixelRatio = 1.5;
  effect.render(frameAt(616));
  assert.equal(h.canvas.width, 750);
  assert.equal(h.canvas.height, 450);
  assert.ok(h.draws.some(draw => draw[0] === 'transform' && draw[1] === 1.5));
});

test('dispose removes the canvas, releases its bitmap, and is idempotent', () => {
  const h = harness();
  const effect = createParticles()(h.context);
  effect.render(frameAt(900));
  effect.dispose();
  effect.dispose();
  assert.equal(h.children.length, 0);
  assert.equal(h.canvas.width, 0);
  assert.equal(h.canvas.height, 0);
  h.draws.length = 0;
  effect.render(frameAt(1100));
  assert.deepEqual(h.draws, []);
});

test('missing or throwing Canvas context does not leave an attached overlay', () => {
  for (const setup of [{ contextMissing: true }, { contextThrows: true }]) {
    const h = harness(setup);
    assert.throws(() => createParticles()(h.context), /Canvas/);
    assert.equal(h.children.length, 0);
  }
});

test('disabled effects do not create a canvas; options reject unbounded or invalid input', () => {
  const context = { document: { createElement() { throw new Error('must not create'); } } };
  for (const options of [{ density: 0 }, { jet: false, trail: false }]) {
    const effect = createParticles(options)(context);
    effect.render(frameAt(600));
    effect.dispose();
  }
  for (const density of [-1, 4.1, NaN, Infinity]) assert.throws(() => createParticles({ density }), RangeError);
  for (const seed of [1.2, NaN, Infinity]) assert.throws(() => createParticles({ seed }), TypeError);
  assert.throws(() => createParticles({ color: '' }), TypeError);
  assert.throws(() => createParticles({ jet: 1 }), TypeError);
});

test('density cap bounds work, time clamps, and absent historical sampler is supported', () => {
  const h = harness();
  const effect = createParticles({ density: 4 })(h.context);
  effect.render({ ...frameAt(2000), sample: undefined });
  assert.ok(particleDraws(h).length > 0);
  assert.ok(particleDraws(h).length < 250);
  h.draws.length = 0;
  effect.render({ ...frameAt(-100), sample: undefined });
  assert.ok(particleDraws(h).length <= 2);
  assert.throws(() => effect.render(frameAt(NaN)), TypeError);
});

test('extreme finite timelines and tiny densities remain bounded and finite', () => {
  const large = harness();
  const steadyPose = poseAt(0);
  createParticles({ density: 4 })(large.context).render({
    ...frameAt(0), time: 1e300, duration: 1e300, sample: () => steadyPose,
  });
  assert.ok(particleDraws(large).length < 250);
  const tiny = harness();
  createParticles({ density: Number.MIN_VALUE })(tiny.context).render({ ...frameAt(0), sample: undefined });
  assert.ok(particleDraws(tiny).length > 0);
  assert.ok(particleDraws(tiny).every(draw => draw.slice(3).every(Number.isFinite)));
});

test('explicit nozzle offset is applied to particles, including rotation with the actual pose', () => {
  const a = harness();
  createParticles({ trail: false, emitter: { offset: { x: 17, y: 41 } } })(a.context).render(frameAt(0));
  assert.equal(particleDraws(a)[0][3], 117);
  assert.equal(particleDraws(a)[0][4], 241);

  const b = harness();
  const rotated = { ...poseAt(0), rotateZ: 90 };
  createParticles({ trail: false, emitter: { offset: { x: 10, y: 0 }, direction: { x: 1, y: 0 }, rotate: true } })(b.context).render({
    ...frameAt(0), pose: rotated, sample: () => rotated,
  });
  assert.ok(Math.abs(particleDraws(b)[0][3] - 100) < 1e-9);
  assert.ok(Math.abs(particleDraws(b)[0][4] - 210) < 1e-9);
  const tip = b.draws.find(draw => draw[0] === 'curve');
  assert.ok(Math.abs(tip[5] - 100) < 1e-9);
  assert.ok(tip[6] > 230, 'the rotated jet points down from the rotated nozzle');
});

test('cold-gas direction and color are configurable, and nozzle geometry is stable after seeking', () => {
  const h = harness();
  const effect = createParticles({ color: '#eef7ff', seed: 8, intensity: 1.5, emitter: {
    offset: { x: -70, y: 12 }, direction: { x: -20, y: 0 },
  } })(h.context);
  effect.render(frameAt(700));
  const geometry = h.draws.filter(draw => draw[0] === 'move' || draw[0] === 'curve');
  assert.equal(geometry[0][2], '#eef7ff');
  assert.ok(geometry[1][5] < poseAt(700).x - 70, 'cold jet projects left from the rear nozzle');
  effect.render(frameAt(1900));
  h.draws.length = 0;
  effect.render({ ...frameAt(700), delta: 0 });
  assert.deepEqual(h.draws.filter(draw => draw[0] === 'move' || draw[0] === 'curve'), geometry);
});

test('plume uses current pose while particles use historical samples; weak flight thrust remains readable', () => {
  const h = harness();
  const current = { ...poseAt(0), x: 1000, thrust: 0.12 };
  createParticles({ intensity: 1.5, emitter: { offset: { x: 0, y: 60 } } })(h.context).render({
    ...frameAt(800), pose: current, sample: () => poseAt(0),
  });
  assert.ok(particleDraws(h).every(draw => draw[3] < 150));
  const plume = h.draws.filter(draw => draw[0] === 'move' || draw[0] === 'curve');
  assert.ok(plume[0][1] >= 0.5, 'low-thrust jet remains visible');
  assert.ok(plume[0][3] > 990, 'plume stays attached to current nozzle');
  assert.ok(plume[1][6] > current.y + 80, 'the jet extends beyond the card edge');
});

test('local clip uses a bounded bitmap and tracks position changes without changing pose coordinates', () => {
  const h = harness();
  let bounds = { left: 100, top: 250, width: 320, height: 240 };
  let mountedLocally = false;
  const clip = {
    ownerDocument: h.document,
    getBoundingClientRect() { return bounds; },
    appendChild(canvas) { mountedLocally = true; h.children.push(canvas); },
  };
  const effect = createParticles({ clip })(h.context);
  assert.equal(mountedLocally, true);
  assert.equal(h.canvas.style.position, 'absolute');
  assert.equal(h.attributes['data-tflip-particles'], '');
  effect.render(frameAt(900));
  assert.equal(h.canvas.width, 640);
  assert.equal(h.canvas.height, 480);
  assert.ok(h.draws.some(draw => draw[0] === 'transform' && draw[5] === -200 && draw[6] === -500));
  bounds = { ...bounds, left: 160, top: 310 };
  h.draws.length = 0;
  effect.render(frameAt(900));
  assert.ok(h.draws.some(draw => draw[0] === 'transform' && draw[5] === -320 && draw[6] === -620));
  effect.dispose();
  assert.equal(h.children.length, 0);
  assert.equal(h.canvas.width, 0);
});

test('jet off and reduced motion remove the plume, and new options reject invalid input', () => {
  const off = harness();
  createParticles({ jet: false })(off.context).render(frameAt(600));
  assert.equal(off.draws.filter(draw => draw[0] === 'move').length, 0);
  const reduced = harness();
  createParticles()(reduced.context).render({ ...frameAt(600), reducedMotion: true });
  assert.equal(reduced.draws.filter(draw => draw[0] === 'move' || draw[0] === 'arc').length, 0);
  const disabled = { document: { createElement() { throw new Error('must not mount'); } } };
  createParticles({ intensity: 0 })(disabled).render(frameAt(600));
  for (const intensity of [-1, 4.1, NaN, Infinity]) assert.throws(() => createParticles({ intensity }), RangeError);
  for (const emitter of [null, 3, { offset: { x: Infinity, y: 0 } }, { direction: { x: 0, y: 0 } }, { rotate: 'yes' }]) {
    assert.throws(() => createParticles({ emitter }), TypeError);
  }
  const invalidClip = harness();
  assert.throws(() => createParticles({ clip: { ownerDocument: {} } })(invalidClip.context), TypeError);
  assert.equal(invalidClip.children.length, 0);
});
