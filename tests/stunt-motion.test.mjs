import test from 'node:test';
import assert from 'node:assert/strict';
import { sample } from '../dist/core/index.js';
import { STUNT_DURATION, STUNT_CUT, STUNT_SHOTS, createStuntSampler } from '../playground/stunt-motion.js';
import { RAMP_DURATION, sampleRamp } from '../playground/ramp-motion.js';

const sampleStunt = createStuntSampler(sample);
// Copied from the retained v0.1 Roadster page, so the edit is checked against
// its original choreography rather than against the new composition helper.
const originalSegments = [
  { name: 'approach', offset: 0, duration: 1200, from: { x: -13, y: 0 }, to: { x: -8, y: 0 }, height: 0, turns: 0, phases: { anticipation: 0, launch: 1, roll: 0, descent: 0, settle: 0 } },
  { name: 'jump', offset: 1200, duration: 3600, from: { x: -8, y: 0 }, to: { x: 8, y: 0 }, height: 4.8, turns: 1, phases: { anticipation: .04, launch: .17, roll: .54, descent: .17, settle: .08 } },
  { name: 'rollout', offset: 4800, duration: 1000, from: { x: 8, y: 0 }, to: { x: 13, y: 0 }, height: 0, turns: 0, phases: { anticipation: 0, launch: 1, roll: 0, descent: 0, settle: 0 } },
];
function originalRoadster(time) {
  const segment = originalSegments.find(part => time < part.offset + part.duration) ?? originalSegments.at(-1);
  const local = Math.max(0, Math.min(segment.duration, time - segment.offset));
  return { pose: sample(local, { ...segment, axis: 'x', direction: 1, depth: 0, bounce: .035 }), time, duration: 5800, progress: time / 5800, segment: segment.name, segmentProgress: local / segment.duration };
}
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} ≈ ${b}`);

test('the edit retains two complete independent shots with a hard cut at 8 seconds', () => {
  assert.equal(STUNT_CUT, RAMP_DURATION); assert.equal(STUNT_CUT, 8000); assert.equal(STUNT_DURATION, 13800);
  assert.deepEqual(STUNT_SHOTS.map(({ id, offset, duration }) => ({ id, offset, duration })), [{ id: 'ramp', offset: 0, duration: 8000 }, { id: 'roadster', offset: 8000, duration: 5800 }]);
  assert.ok(Object.isFrozen(STUNT_SHOTS)); assert.ok(STUNT_SHOTS.every(Object.isFrozen));
  for (const [time, shot, index, local] of [[0, 'ramp', 0, 0], [7999.99, 'ramp', 0, 7999.99], [8000, 'roadster', 1, 0], [8000.01, 'roadster', 1, .01], [13800, 'roadster', 1, 5800]]) {
    const frame = sampleStunt(time); assert.equal(frame.shot, shot); assert.equal(frame.shotIndex, index); near(frame.shotTime, local); near(frame.time, time); near(frame.progress, time / 13800); assert.equal(frame.duration, 13800);
    assert.equal(frame.shotDuration, index ? 5800 : 8000);
  }
});

test('shot one preserves the complete original ramp choreography through its landing', () => {
  for (let time = 0; time < STUNT_CUT; time += 25) assert.deepEqual(sampleStunt(time).sceneFrame, sampleRamp(time));
  for (const time of [1600, 4700, 6999.99, 7000, 7900, 7999.99]) assert.deepEqual(sampleStunt(time).sceneFrame, sampleRamp(time));
  const last = sampleStunt(7999.9999).sceneFrame, terminal = sampleRamp(8000);
  last.position.forEach((value, i) => near(value, terminal.position[i], .00001)); near(last.pitch, terminal.pitch); near(last.roll, terminal.roll);
  assert.equal(last.phase, 'landing'); assert.equal(sampleRamp(8000).phase, 'finished');
});

test('shot two starts afresh and preserves the original run-up, barrel roll and full landing rollout', () => {
  for (let local = 0; local <= 5800; local += 25) assert.deepEqual(sampleStunt(STUNT_CUT + local).sceneFrame, originalRoadster(local));
  for (const local of [0, 1200, 3000, 4800, 5799.99, 5800]) assert.deepEqual(sampleStunt(STUNT_CUT + local).sceneFrame, originalRoadster(STUNT_CUT + local - STUNT_CUT));
  assert.equal(sampleStunt(STUNT_CUT).sceneFrame.pose.x, -13);
  assert.equal(sampleStunt(STUNT_DURATION).sceneFrame.pose.x, 13);
  assert.equal(sampleStunt(STUNT_CUT).sceneFrame.segment, 'approach');
  assert.equal(sampleStunt(STUNT_DURATION).sceneFrame.segment, 'rollout');
});

test('seeking across the cut is deterministic and does not carry a world pose between shots', () => {
  const times = [0, 3000, 7999.99, 8000, 8000.01, 11000, 13800];
  const expected = new Map(times.map(time => [time, sampleStunt(time)]));
  for (const time of [13800, 7999.99, 11000, 3000, 8000.01, 0, 8000, 7999.99]) assert.deepEqual(sampleStunt(time), expected.get(time));
  assert.ok('position' in sampleStunt(7999.99).sceneFrame); assert.ok(!('pose' in sampleStunt(7999.99).sceneFrame));
  assert.ok('pose' in sampleStunt(8000).sceneFrame); assert.ok(!('position' in sampleStunt(8000).sceneFrame));
  const ramp = sampleStunt(3000); ramp.sceneFrame.position[0] = 999;
  const roadster = sampleStunt(11000); roadster.sceneFrame.pose.x = 999;
  assert.deepEqual(sampleStunt(3000), expected.get(3000)); assert.deepEqual(sampleStunt(11000), expected.get(11000));
});

test('the composed timeline clamps endpoints and rejects invalid nominal time', () => {
  assert.deepEqual(sampleStunt(-1), sampleStunt(0)); assert.deepEqual(sampleStunt(20000), sampleStunt(13800));
  for (const invalid of [NaN, Infinity, -Infinity, '100', null, undefined]) assert.throws(() => sampleStunt(invalid), TypeError);
});
