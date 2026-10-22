import test from 'node:test';
import assert from 'node:assert/strict';
import { RAMP_DURATION, RAMP_GEOMETRY, sampleRamp } from '../playground/ramp-motion.js';
import { roadsterMesh } from '../playground/roadster-geometry.js';
const geometry = { radius: 8.5, width: 4.6, lip: 2.3, wheelRadius: .49, wheelbase: 3.23, front: 1.61, rear: -1.62, pivot: [0, .79, 0] };
const evidence = { geometry: {} };
function near(actual, expected, epsilon, label) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: ${actual} expected ${expected} ± ${epsilon}`);
}
function distance(a, b) { return Math.hypot(...a.map((value, index) => value - b[index])); }
// Independent reconstruction from the public coordinate contract; deliberately
// do not import the renderer's transformRampPoint or contact-solving helpers.
function worldPoint(point, frame, direction = false) {
  const [x, y, z] = point.map((value, index) => value - (direction ? 0 : geometry.pivot[index]));
  const rolledY = y * Math.cos(frame.roll) - z * Math.sin(frame.roll);
  const rolledZ = y * Math.sin(frame.roll) + z * Math.cos(frame.roll);
  const rotated = [x * Math.cos(frame.pitch) - rolledY * Math.sin(frame.pitch), x * Math.sin(frame.pitch) + rolledY * Math.cos(frame.pitch), rolledZ];
  return rotated.map((value, index) => value + (direction ? 0 : frame.position[index]));
}
function angularDistance(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }

test('ramp wheel geometry independently matches the flat, inside arc and inverted exit', () => {
  assert.equal(RAMP_DURATION, 8000);
  for (const key of ['radius', 'width', 'lip', 'wheelRadius', 'wheelbase']) near(RAMP_GEOMETRY[key], geometry[key], 1e-12, key);
  let checkedContacts = 0, maxCenterError = 0, maxSurfaceError = 0;
  const regions = new Set();
  for (let time = 0; time <= 8000; time += 10) {
    const frame = sampleRamp(time);
    assert.ok([...frame.position, frame.pitch, frame.roll].every(Number.isFinite), `Finite state at ${time}ms`);
    near(frame.time, time, 1e-10, 'Sample owns requested nominal time');
    const front = worldPoint([geometry.front, geometry.wheelRadius, 0], frame);
    const rear = worldPoint([geometry.rear, geometry.wheelRadius, 0], frame);
    near(distance(front, rear), geometry.wheelbase, 1e-10, 'Rigid axle spacing');
    for (const [axle, center] of [['front', front], ['rear', rear]]) {
      const contact = frame.contacts[axle];
      if (!contact) continue;
      checkedContacts++; regions.add(contact.region);
      const centerError = distance(center, contact.center);
      maxCenterError = Math.max(maxCenterError, centerError);
      near(centerError, 0, 1e-8, `${axle} center reconstructed at ${time}ms`);
      near(Math.hypot(...contact.normal), 1, 1e-10, 'Unit support normal');
      const radial = center.map((value, index) => value - contact.point[index]);
      near(Math.hypot(...radial), geometry.wheelRadius, 1e-8, 'Tire touches its support surface');
      near(distance(radial, contact.normal.map(value => value * geometry.wheelRadius)), 0, 1e-8, 'Support normal points from surface to wheel');
      const [x, y, z] = contact.point;
      let surfaceError;
      if (contact.region === 'ground') {
        surfaceError = Math.abs(y);
        assert.ok(x <= 1e-8, 'Ground contact stays before the rising ramp');
        assert.deepEqual(contact.normal, [0, 1, 0]);
      } else if (contact.region === 'curve') {
        surfaceError = Math.abs(Math.hypot(x, y - geometry.radius) - geometry.radius);
        assert.ok(x >= -1e-8 && y >= -1e-8 && y <= 2 * geometry.radius + 1e-8, 'Contact lies on the right half of the side-profile C');
        near(Math.hypot(center[0], center[1] - geometry.radius), geometry.radius - geometry.wheelRadius, 1e-8, 'Tire is inside the arc');
      } else {
        assert.equal(contact.region, 'lip');
        surfaceError = Math.abs(y - 2 * geometry.radius);
        assert.ok(x <= 1e-8 && x >= -geometry.lip - 1e-8, 'Inverted contact ends at the physical lip');
        assert.deepEqual(contact.normal, [0, -1, 0]);
      }
      maxSurfaceError = Math.max(maxSurfaceError, surfaceError);
      near(surfaceError, 0, 1e-8, `Analytic surface at ${time}ms`);
      near(z, 0, 1e-10, 'Centerline contact plane');
      assert.ok(1.025 + .14 < geometry.width / 2, 'Both outside tire faces fit within track width');
    }
    if (time >= 4700 && time < 7000) {
      assert.deepEqual(frame.contacts, { front: null, rear: null }, 'Airborne phase releases both axles');
      assert.ok(worldPoint([1, 0, 0], frame, true)[0] < -.999, 'Airborne nose continues toward the open side');
      // Inspect actual tire circumferences including the rolling side offsets,
      // not just the centre of mass or the sampler self-reported contacts.
      for (const axle of [geometry.front, geometry.rear]) for (const side of [-1.025, 1.025]) for (let index = 0; index < 32; index++) {
        const theta = index / 32 * Math.PI * 2;
        const point = worldPoint([axle + Math.cos(theta) * geometry.wheelRadius, geometry.wheelRadius + Math.sin(theta) * geometry.wheelRadius, side], frame);
        assert.ok(point[1] >= -1e-7, `Airborne tire cannot penetrate ground at ${time}ms: ${point}`);
      }
    }
  }
  assert.deepEqual([...regions].sort(), ['curve', 'ground', 'lip']);
  assert.ok(checkedContacts > 800);
  const inverted = sampleRamp(4699.99), landed = sampleRamp(7000);
  near(inverted.pitch, Math.PI, 1e-8, 'Vehicle leaves inverted');
  near(inverted.roll, 0, 1e-8, 'Longitudinal recovery begins after release');
  near(landed.pitch, Math.PI, 1e-8, 'Nose faces the open side at landing');
  near(landed.roll, Math.PI, 1e-8, 'Exactly half a longitudinal roll restores wheels below body');
  near(worldPoint([0, 1, 0], landed, true)[1], 1, 1e-8, 'Vehicle up vector is upright');
  assert.ok(landed.contacts.front && landed.contacts.rear);
  assert.ok(landed.position[0] < -geometry.lip - 5, 'Landing occurs beyond the ramp opening');
  let minBodyClearance = Infinity, checkedVertices = 0;
  const vertices = roadsterMesh().flatMap(face => face.vertices);
  for (let time = 0; time <= 7000; time += 20) {
    const frame = sampleRamp(time);
    for (const vertex of vertices) {
      const [x, y] = worldPoint(vertex, frame);
      checkedVertices++;
      assert.ok(y >= -1e-7, `Mesh must not penetrate ground at ${time}ms: ${x},${y}`);
      if (x >= 0 && y >= 0 && y <= geometry.radius * 2) {
        const clearance = geometry.radius - Math.hypot(x, y - geometry.radius);
        minBodyClearance = Math.min(minBodyClearance, clearance);
        assert.ok(clearance >= -1e-7, `Body/tires must stay inside C surface at ${time}ms: clearance ${clearance}`);
      } else if (x >= -geometry.lip && x < 0) {
        assert.ok(y <= 2 * geometry.radius + 1e-7, `Body must stay below inverted lip at ${time}ms`);
      }
    }
  }
  evidence.geometry.contacts = { checkedContacts, maxCenterError, maxSurfaceError, regions: [...regions], minBodyClearance, checkedVertices };
});

test('ramp phase boundaries are continuous and seek sampling is history independent', () => {
  const boundaries = [];
  for (const boundary of [1600, 4700, 7000]) {
    const h = .1;
    const a = sampleRamp(boundary - h), b = sampleRamp(boundary), c = sampleRamp(boundary + h);
    const positionJump = distance(a.position, c.position);
    const pitchJump = angularDistance(a.pitch, c.pitch), rollJump = angularDistance(a.roll, c.roll);
    const beforeVelocity = a.position.map((value, i) => (b.position[i] - value) / h * 1000);
    const afterVelocity = b.position.map((value, i) => (c.position[i] - value) / h * 1000);
    const velocityJump = distance(beforeVelocity, afterVelocity);
    assert.ok(positionJump < .005, `Position continuous at ${boundary}ms: ${positionJump}`);
    assert.ok(pitchJump < .001 && rollJump < .001, `Orientation continuous at ${boundary}ms`);
    assert.ok(velocityJump < .05, `Velocity continuous at ${boundary}ms: ${velocityJump}`);
    boundaries.push({ time: boundary, positionJump, pitchJump, rollJump, velocityJump });
  }
  const times = [0, 800, 1600, 3000, 4400, 4700, 5540, 6400, 7000, 8000];
  const expected = times.map(time => sampleRamp(time));
  times.slice().reverse().forEach(time => sampleRamp(time));
  assert.deepEqual(times.map(time => sampleRamp(time)), expected, 'Backward and repeated seeks are deterministic');
  assert.deepEqual(sampleRamp(-1), sampleRamp(0));
  assert.deepEqual(sampleRamp(9000), sampleRamp(8000));
  for (const invalid of [NaN, Infinity, undefined, '3000']) assert.throws(() => sampleRamp(invalid), TypeError);
  evidence.geometry.boundaries = boundaries;
});
