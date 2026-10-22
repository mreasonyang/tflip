// Exact segment settings from the original Roadster page controller.
export const ROADSTER_DURATION = 5800;
export const ROADSTER_SEGMENTS = Object.freeze([
  { name: 'approach', offset: 0, duration: 1200, from: { x: -13, y: 0 }, to: { x: -8, y: 0 }, height: 0, turns: 0, phases: { anticipation: 0, launch: 1, roll: 0, descent: 0, settle: 0 } },
  { name: 'jump', offset: 1200, duration: 3600, from: { x: -8, y: 0 }, to: { x: 8, y: 0 }, height: 4.8, turns: 1, phases: { anticipation: 0.04, launch: 0.17, roll: 0.54, descent: 0.17, settle: 0.08 } },
  { name: 'rollout', offset: 4800, duration: 1000, from: { x: 8, y: 0 }, to: { x: 13, y: 0 }, height: 0, turns: 0, phases: { anticipation: 0, launch: 1, roll: 0, descent: 0, settle: 0 } },
].map(s => Object.freeze({ ...s, from: Object.freeze(s.from), to: Object.freeze(s.to), phases: Object.freeze(s.phases) })));

export function createRoadsterSampler(coreSample) {
  if (typeof coreSample !== 'function') throw new TypeError('A core sample function is required');
  return function sampleRoadster(timeMs) {
    if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) throw new TypeError('Roadster time must be a finite number');
    const time = Math.max(0, Math.min(ROADSTER_DURATION, timeMs));
    const segment = ROADSTER_SEGMENTS.find(part => time < part.offset + part.duration) ?? ROADSTER_SEGMENTS.at(-1);
    const local = Math.max(0, Math.min(segment.duration, time - segment.offset));
    return { pose: coreSample(local, { ...segment, axis: 'x', direction: 1, depth: 0, bounce: 0.035 }),
      time, duration: ROADSTER_DURATION, progress: time / ROADSTER_DURATION,
      segment: segment.name, segmentProgress: local / segment.duration };
  };
}
