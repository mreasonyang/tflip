import { RAMP_DURATION, sampleRamp } from './ramp-motion.js';
import { ROADSTER_DURATION, createRoadsterSampler } from './roadster-motion.js';

// An edit timeline: each shot retains its own time, choreography and camera.
export const STUNT_CUT = RAMP_DURATION;
export const STUNT_DURATION = RAMP_DURATION + ROADSTER_DURATION;
export const STUNT_SHOTS = Object.freeze([
  Object.freeze({ id: 'ramp', offset: 0, duration: RAMP_DURATION }),
  Object.freeze({ id: 'roadster', offset: STUNT_CUT, duration: ROADSTER_DURATION }),
]);

/** Inject the public core sampler so the page and portable kit share bytes. */
export function createStuntSampler(coreSample) {
  const sampleRoadster = createRoadsterSampler(coreSample);
  return function sampleStunt(timeMs) {
    if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) throw new TypeError('Stunt time must be a finite number');
    const time = Math.min(STUNT_DURATION, Math.max(0, timeMs));
    const shotIndex = time < STUNT_CUT ? 0 : 1;
    const shot = STUNT_SHOTS[shotIndex];
    const shotTime = time - shot.offset;
    const sceneFrame = shotIndex === 0 ? sampleRamp(shotTime) : sampleRoadster(shotTime);
    return { time, duration: STUNT_DURATION, progress: time / STUNT_DURATION,
      shot: shot.id, shotIndex, shotTime, shotDuration: shot.duration,
      phase: shotIndex === 0 ? sceneFrame.phase : sceneFrame.segment, sceneFrame };
  };
}
