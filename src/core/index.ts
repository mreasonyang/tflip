import type {
  Axis, Direction, NormalizedTrajectory, Phase, PhaseRatios, Point, Pose, Preset, TrajectoryOptions,
} from '../types.js';

export type {
  Axis, Direction, NormalizedTrajectory, Phase, PhaseRatios, Point, Pose, Preset, TrajectoryOptions,
} from '../types.js';

type PresetDefinition = Readonly<Required<Pick<TrajectoryOptions,
  'height' | 'turns' | 'direction' | 'axis' | 'duration' | 'bounce' | 'depth' | 'pathMode'
>> & { phases: Readonly<PhaseRatios> }>;

const phaseNames = ['anticipation', 'launch', 'roll', 'descent', 'settle'] as const;
const normalized = new WeakSet<object>();
const provided = <T>(value: T | undefined, fallback: T): T => value === undefined ? fallback : value;

function preset(overrides: Partial<PresetDefinition> = {}): PresetDefinition {
  return Object.freeze({
    height: 160, turns: 1, direction: 1, axis: 'x', duration: 3600,
    bounce: 0.14, depth: 40, pathMode: 'smooth',
    phases: Object.freeze({ anticipation: 0.55, launch: 0.6, roll: 1.15, descent: 0.7, settle: 0.6 }),
    ...overrides,
  });
}

/** Presets are immutable defaults. Explicit options override each preset field. */
export const presets: Readonly<Record<Preset, PresetDefinition>> = Object.freeze({
  launch: preset(),
  gentle: preset({ height: 90, duration: 2600, bounce: 0.06, depth: 15 }),
  snappy: preset({
    height: 120, duration: 1000, bounce: 0.1, depth: 25,
    phases: Object.freeze({ anticipation: 0.1, launch: 0.22, roll: 0.3, descent: 0.2, settle: 0.18 }),
  }),
  float: preset({
    height: 200, duration: 4800, bounce: 0.04, depth: 65,
    phases: Object.freeze({ anticipation: 0.1, launch: 0.22, roll: 0.4, descent: 0.18, settle: 0.1 }),
  }),
});

function finite(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function nonnegative(value: number, name: string): number {
  finite(value, name);
  if (value < 0) throw new RangeError(`${name} must be nonnegative`);
  return value;
}

function point(value: Point, name: string): Required<Point> {
  if (!value || typeof value !== 'object') throw new TypeError(`${name} must be a point`);
  return Object.freeze({
    x: finite(value.x, `${name}.x`),
    y: finite(value.y, `${name}.y`),
    z: finite(provided(value.z, 0), `${name}.z`),
  });
}

/**
 * Validate, copy, and freeze caller input. Ratios are relative weights; omitted
 * weights retain the selected preset's value. At least one flight phase must
 * have a positive weight. Individual zero-duration phases are skipped.
 */
export function normalizeOptions(options: TrajectoryOptions = {}): NormalizedTrajectory {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  if (normalized.has(options)) return options as NormalizedTrajectory;
  const presetName = provided(options.preset, 'launch');
  if (!Object.hasOwn(presets, presetName)) throw new RangeError(`Unknown preset: ${presetName}`);
  const defaults = presets[presetName];
  const axis = provided(options.axis, defaults.axis);
  if (!['x', 'y', 'z'].includes(axis)) throw new RangeError('axis must be x, y, or z');
  const direction = provided(options.direction, defaults.direction);
  if (direction !== 1 && direction !== -1) throw new RangeError('direction must be 1 or -1');
  const pathMode = provided(options.pathMode, defaults.pathMode);
  if (pathMode !== 'linear' && pathMode !== 'smooth') throw new RangeError('pathMode must be linear or smooth');
  const duration = finite(provided(options.duration, defaults.duration), 'duration');
  if (duration <= 0) throw new RangeError('duration must be greater than zero');
  const height = nonnegative(provided(options.height, defaults.height), 'height');
  const turns = nonnegative(provided(options.turns, defaults.turns), 'turns');
  if (!Number.isFinite(turns * 360)) throw new RangeError('turns is too large');
  const bounce = nonnegative(provided(options.bounce, defaults.bounce), 'bounce');
  if (bounce > 1) throw new RangeError('bounce must be between 0 and 1');
  const depth = finite(provided(options.depth, defaults.depth), 'depth');
  const from = point(provided(options.from, { x: 0, y: 0 }), 'from');
  const to = point(provided(options.to, from), 'to');
  if (options.path !== undefined && !Array.isArray(options.path)) throw new TypeError('path must be an array of points');
  const path = Object.freeze(Array.from(options.path ?? [], (value, index) => point(value, `path[${index}]`)));
  if (options.phases !== undefined && (!options.phases || typeof options.phases !== 'object' || Array.isArray(options.phases))) {
    throw new TypeError('phases must be an object');
  }
  const weights = phaseNames.map(name => nonnegative(provided(options.phases?.[name], defaults.phases[name]), `phases.${name}`));
  const maximum = Math.max(...weights);
  if (maximum === 0) throw new RangeError('phases must have a positive sum');
  // Scaling first avoids overflow for large finite ratio weights.
  const scaled = weights.map(weight => weight / maximum);
  const sum = scaled.reduce((a, b) => a + b, 0);
  const phases = Object.fromEntries(phaseNames.map((name, index) => [name, scaled[index]! / sum])) as unknown as PhaseRatios;
  const flightStart = phases.anticipation;
  const flightEnd = flightStart + phases.launch + phases.roll + phases.descent;
  if (flightEnd <= flightStart) {
    throw new RangeError('launch + roll + descent must have a positive, representable duration');
  }
  const result: NormalizedTrajectory = Object.freeze({
    from, to, height, turns, direction, axis, duration, preset: presetName,
    bounce, depth, path, pathMode, phases: Object.freeze(phases),
  });
  normalized.add(result);
  return result;
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const smooth = (value: number): number => value * value * (3 - 2 * value);
const mix = (a: number, b: number, value: number): number => a * (1 - value) + b * value;

function windowProgress(progress: number, start: number, end: number): number {
  return clamp((progress - start) / (end - start));
}

function pulse(progress: number): number {
  if (progress <= 0 || progress >= 1) return 0;
  return Math.sin(Math.PI * progress) ** 2;
}

/** Uniform Catmull–Rom interpolation; smooth paths may overshoot waypoints. */
function spline(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

function pathAt(progress: number, options: NormalizedTrajectory): Required<Point> {
  if (progress <= 0) return options.from;
  if (progress >= 1) return options.to;
  const points = [options.from, ...options.path, options.to];
  const scaled = progress * (points.length - 1);
  const index = Math.min(Math.floor(scaled), points.length - 2);
  const local = scaled - index;
  const left = points[index]!;
  const right = points[index + 1]!;
  if (options.pathMode === 'linear' || points.length === 2) {
    return { x: mix(left.x, right.x, local), y: mix(left.y, right.y, local), z: mix(left.z, right.z, local) };
  }
  const before = points[Math.max(0, index - 1)]!;
  const after = points[Math.min(points.length - 1, index + 2)]!;
  return {
    x: spline(before.x, left.x, right.x, after.x, local),
    y: spline(before.y, left.y, right.y, after.y, local),
    z: spline(before.z, left.z, right.z, after.z, local),
  };
}

function phaseAt(progress: number, phases: PhaseRatios): Phase {
  if (progress >= 1) return 'finished';
  let end = 0;
  let last: Phase = 'launch';
  for (const name of phaseNames) {
    end += phases[name];
    if (phases[name] === 0) continue;
    last = name;
    if (progress < end) return name;
  }
  return last; // Rounding must not create a spurious finished frame.
}

/**
 * Sample absolute milliseconds; values outside 0..duration clamp to endpoints.
 * Waypoints define the baseline; height/depth and landing bounce are offsets.
 * The baseline traverses equal-time segments, eased over the whole flight.
 * Rotation occupies the roll phase, or the whole flight if roll is omitted.
 * No clocks, browser globals, randomness, or state from earlier samples are used.
 */
export function sample(timeMs: number, input: TrajectoryOptions | NormalizedTrajectory = {}): Pose {
  finite(timeMs, 'timeMs');
  const options = normalizeOptions(input);
  const progress = clamp(timeMs / options.duration);
  const phase = phaseAt(progress, options.phases);
  const { anticipation, launch, roll, descent, settle } = options.phases;
  const flightStart = anticipation;
  const rollStart = flightStart + launch;
  const rollEnd = rollStart + roll;
  const flightEnd = rollEnd + descent;
  const flight = windowProgress(progress, flightStart, flightEnd);
  const easedFlight = smooth(flight);
  const position = pathAt(easedFlight, options);
  const arc = 4 * easedFlight * (1 - easedFlight);
  const anticipationProgress = anticipation > 0 ? clamp(progress / anticipation) : 1;
  const anticipationPulse = pulse(anticipationProgress);
  const settleProgress = settle > 0 ? windowProgress(progress, flightEnd, 1) : 1;
  const bounceEnvelope = (1 - settleProgress) ** 2;
  const bounceLift = options.bounce * Math.sin(2 * Math.PI * settleProgress) ** 2 * bounceEnvelope;
  const squash = options.bounce * Math.sin(4 * Math.PI * settleProgress) * bounceEnvelope * 0.4;
  const rotationProgress = roll > 0 && rollEnd > rollStart
    ? smooth(windowProgress(progress, rollStart, rollEnd)) : easedFlight;
  const angle = 360 * options.turns * options.direction * rotationProgress;
  const launchPulse = launch > 0 ? pulse(windowProgress(progress, flightStart, rollStart)) : 0;
  const descentPulse = descent > 0 ? pulse(windowProgress(progress, rollEnd, flightEnd)) : 0;
  const pose: Pose = {
    x: position.x,
    y: position.y - options.height * (arc + bounceLift) + options.height * 0.045 * anticipationPulse,
    z: position.z + options.depth * arc,
    rotateX: options.axis === 'x' ? angle : 0,
    rotateY: options.axis === 'y' ? angle : 0,
    rotateZ: options.axis === 'z' ? angle : 0,
    scaleX: 1 + 0.065 * anticipationPulse - 0.02 * arc + squash * 0.5,
    scaleY: 1 - 0.13 * anticipationPulse + 0.04 * arc - squash,
    progress, phase,
    thrust: clamp(0.12 * anticipationPulse + 0.12 * arc + 0.88 * launchPulse + 0.4 * descentPulse),
    shadowScale: 1 + 0.35 * arc + 0.1 * bounceLift,
    shadowOpacity: 0.22 * (1 - 0.65 * arc),
  };
  // Exact endpoints are part of the public contract, including floating-point
  // ratio sums that land just either side of 1.
  if (progress === 0 || progress === 1) {
    const endpoint = progress === 0 ? options.from : options.to;
    const endpointAngle = progress === 0 ? 0 : 360 * options.turns * options.direction;
    pose.x = endpoint.x; pose.y = endpoint.y; pose.z = endpoint.z;
    pose.rotateX = options.axis === 'x' ? endpointAngle : 0;
    pose.rotateY = options.axis === 'y' ? endpointAngle : 0;
    pose.rotateZ = options.axis === 'z' ? endpointAngle : 0;
    pose.scaleX = 1; pose.scaleY = 1; pose.thrust = 0;
    pose.shadowScale = 1; pose.shadowOpacity = 0.22;
  }
  return pose;
}

/** Alias for consumers migrating from the original demo's trajectory function. */
export const stateAt = sample;
