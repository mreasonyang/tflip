import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOptions, presets, sample, stateAt } from '../dist/core/index.js';

const numericFields = ['x', 'y', 'z', 'rotateX', 'rotateY', 'rotateZ', 'scaleX', 'scaleY', 'progress', 'thrust', 'shadowScale', 'shadowOpacity'];
const phaseNames = ['anticipation', 'launch', 'roll', 'descent', 'settle'];
const flightOnly = { anticipation: 0, launch: 0, roll: 1, descent: 0, settle: 0 };
const near = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≈ ${expected}`);

test('normalization copies, freezes, and validates complete caller data without mutation', () => {
  const input = { from: { x: 13, y: -8 }, path: [{ x: 30, y: 40 }], phases: { roll: 2 }, preset: 'gentle', height: 31 };
  const before = structuredClone(input);
  const result = normalizeOptions(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result.to, { x: 13, y: -8, z: 0 });
  assert.equal(result.duration, presets.gentle.duration);
  assert.equal(result.height, 31);
  near(Object.values(result.phases).reduce((a, b) => a + b), 1);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.phases) && Object.isFrozen(result.path[0]));
  input.from.x = 900; input.path[0].x = 999;
  assert.equal(result.from.x, 13);
  assert.equal(result.path[0].x, 30);
  assert.equal(normalizeOptions(result), result);
});

test('exact endpoint coordinates and rotations hold for all presets, axes, and directions', () => {
  for (const preset of Object.keys(presets)) for (const axis of ['x', 'y', 'z']) for (const direction of [-1, 1]) {
    const options = normalizeOptions({ preset, axis, direction, turns: 2.5, from: { x: -17, y: 31, z: -8 }, to: { x: 519, y: -81, z: 20 } });
    const start = sample(-100, options);
    const end = sample(options.duration + 100, options);
    assert.deepEqual([start.x, start.y, start.z], [-17, 31, -8]);
    assert.deepEqual([end.x, end.y, end.z], [519, -81, 20]);
    assert.equal(start.progress, 0); assert.equal(end.progress, 1); assert.equal(end.phase, 'finished');
    for (const rotation of ['X', 'Y', 'Z']) assert.equal(end[`rotate${rotation}`], axis === rotation.toLowerCase() ? 900 * direction : 0);
    assert.equal(start.scaleY, 1); assert.equal(end.scaleY, 1); assert.equal(end.thrust, 0);
  }
});

test('all usable combinations of zero-length phases remain finite and continuous', () => {
  for (let mask = 1; mask < 32; mask++) {
    const phases = Object.fromEntries(phaseNames.map((name, index) => [name, mask & (1 << index) ? index + 1 : 0]));
    if (phases.launch + phases.roll + phases.descent === 0) continue;
    const options = normalizeOptions({ from: { x: -300, y: 70 }, to: { x: 700, y: 190 }, phases });
    let boundary = 0;
    for (const name of phaseNames) {
      boundary += options.phases[name];
      const time = boundary * options.duration;
      const before = sample(time - 1e-6, options);
      const after = sample(time + 1e-6, options);
      for (const field of numericFields) {
        assert.ok(Number.isFinite(before[field]) && Number.isFinite(after[field]), `${mask}: ${field} finite`);
        near(before[field], after[field], 1e-4);
      }
    }
    for (let step = 0; step <= 100; step++) {
      const pose = sample(options.duration * step / 100, options);
      for (const field of numericFields) assert.ok(Number.isFinite(pose[field]), `${mask}/${step}: ${field}`);
    }
  }
});

test('sampling is seek-order independent and keeps no state from prior samples', () => {
  const options = normalizeOptions({ path: [{ x: 100, y: 150, z: 20 }, { x: 300, y: 20, z: -60 }], to: { x: 550, y: 120 } });
  const times = [0, 950, 1700, 3550, 3600];
  const expected = new Map(times.map(time => [time, sample(time, options)]));
  for (const time of [3550, 0, 3600, 1700, 950, 1700, 0]) assert.deepEqual(sample(time, options), expected.get(time));
  assert.equal(stateAt, sample);
});

test('absolute waypoint coordinates are preserved in linear and smooth baselines', () => {
  for (const pathMode of ['linear', 'smooth']) {
    const options = { from: { x: 0, y: 100 }, to: { x: 300, y: 80, z: -10 }, path: [{ x: 190, y: -40, z: 12 }], pathMode, phases: flightOnly, height: 0, depth: 0, bounce: 0, duration: 1000 };
    const midpoint = sample(500, options);
    near(midpoint.x, 190); near(midpoint.y, -40); near(midpoint.z, 12);
    assert.deepEqual([sample(0, options).x, sample(1000, options).x], [0, 300]);
  }
});

test('height lifts relative to the path, depth offsets z, and direction controls rotation only', () => {
  const options = { from: { x: 0, y: 100 }, to: { x: 200, y: 100 }, height: 120, depth: -30, duration: 1000, phases: flightOnly, axis: 'z', turns: 2 };
  const pose = sample(500, options);
  near(pose.x, 100); near(pose.y, -20); near(pose.z, -30); near(pose.rotateZ, 360);
  const reverse = sample(500, { ...options, direction: -1 });
  assert.equal(reverse.x, pose.x); assert.equal(reverse.y, pose.y); assert.equal(reverse.rotateZ, -360);
  const inplace = sample(500, { ...options, from: { x: 45, y: 120 }, to: undefined });
  near(inplace.x, 45); near(inplace.y, 0);
});

test('zero roll spreads rotation continuously across remaining flight', () => {
  const options = { duration: 1000, phases: { anticipation: 0, launch: 1, roll: 0, descent: 1, settle: 0 } };
  near(sample(500, options).rotateX, 180);
  near(sample(1000, options).rotateX, 360);
});

test('ratio normalization does not overflow on large finite weights', () => {
  const options = normalizeOptions({ phases: { anticipation: 1e308, launch: 1e308, roll: 1e308, descent: 1e308, settle: 1e308 } });
  for (const value of Object.values(options.phases)) near(value, 0.2);
});

test('invalid numeric values, enum values, malformed points and degenerate flights fail clearly', () => {
  const invalid = [
    null, [], { duration: 0 }, { duration: null }, { duration: -10 }, { duration: Infinity }, { height: -1 }, { height: NaN },
    { turns: -1 }, { turns: Number.MAX_VALUE }, { direction: 0 }, { axis: 'q' }, { preset: 'unknown' },
    { preset: 'toString' }, { bounce: -0.1 }, { bounce: 1.1 }, { depth: NaN }, { from: { x: 1 } }, { from: null },
    { to: { x: Infinity, y: 1 } }, { path: 'line' }, { path: [null] }, { path: Array(2) }, { pathMode: 'cubic' },
    { phases: null }, { phases: [] }, { phases: { roll: null } }, { phases: { roll: -1 } }, { phases: { roll: NaN } },
    { phases: Object.fromEntries(phaseNames.map(name => [name, 0])) },
    { phases: { anticipation: 1, launch: 0, roll: 0, descent: 0, settle: 1 } },
  ];
  for (const options of invalid) assert.throws(() => normalizeOptions(options), { name: /TypeError|RangeError/ });
  for (const time of [NaN, Infinity, -Infinity, '100']) assert.throws(() => sample(time, {}), /finite/);
});
