import type { EffectFactory, EffectFrame, Pose } from '../types.js';

export type { EffectContext, EffectFactory, EffectFrame, MotionEffect } from '../types.js';

export interface ParticleEmitter {
  /** CSS-pixel offset from the object's center. Defaults to { x: 0, y: 48 }. */
  offset?: { x: number; y: number };
  /** Nonzero exhaust vector, normalized automatically. Defaults to { x: 0, y: 1 }. */
  direction?: { x: number; y: number };
  /** Rotate the nozzle and direction with the pose. Defaults to false. */
  rotate?: boolean;
}

export interface ParticleOptions {
  jet?: boolean;
  trail?: boolean;
  /** Emission multiplier, from 0 (disabled) to 4. Defaults to 1. */
  density?: number;
  color?: string;
  /** A finite integer seed. Replaying or seeking gives the same particles. */
  seed?: number;
  emitter?: ParticleEmitter;
  /** Mount a bounded canvas inside this positioned element; poses remain viewport coordinates. */
  clip?: HTMLElement;
  /** Exhaust brightness/length multiplier, from 0 (disabled) to 4. Defaults to 1. */
  intensity?: number;
}

const MAX_DPR = 2;
const MAX_LIFETIME = 720;

// Integer hashing avoids shared random state, so results do not depend on which
// frames were rendered before this frame.
function random(seed: number, index: number, channel: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function dimension(value: number, fallback: number): number {
  if (Number.isFinite(value) && value > 0) return value;
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
}

/**
 * Optional decorative particles. There is no private clock or animation loop:
 * render only uses the caller's timeline. A historical frame sampler produces
 * a true path trail; without one, particles form a field around the current pose.
 */
export function createParticles(options: ParticleOptions = {}): EffectFactory {
  const density = options.density ?? 1;
  const seed = options.seed ?? 1;
  const color = options.color ?? '#7c8cff';
  const jet = options.jet ?? true;
  const trail = options.trail ?? true;
  const intensity = options.intensity ?? 1;
  const offset = options.emitter?.offset ?? { x: 0, y: 48 };
  const direction = options.emitter?.direction ?? { x: 0, y: 1 };
  const rotate = options.emitter?.rotate ?? false;
  const clip = options.clip;
  if (!Number.isFinite(density) || density < 0 || density > 4) {
    throw new RangeError('Particle density must be a finite number from 0 to 4.');
  }
  if (!Number.isSafeInteger(seed)) {
    throw new TypeError('Particle seed must be a finite safe integer.');
  }
  if (typeof color !== 'string' || color.trim() === '') {
    throw new TypeError('Particle color must be a non-empty CSS color string.');
  }
  if (typeof jet !== 'boolean' || typeof trail !== 'boolean') {
    throw new TypeError('Particle jet and trail options must be booleans.');
  }
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 4) {
    throw new RangeError('Particle intensity must be a finite number from 0 to 4.');
  }
  if (options.emitter !== undefined && (!options.emitter || typeof options.emitter !== 'object')) {
    throw new TypeError('Particle emitter must be an object.');
  }
  if (![offset.x, offset.y, direction.x, direction.y].every(Number.isFinite) || (!direction.x && !direction.y)) {
    throw new TypeError('Emitter offset and direction must be finite vectors, with a nonzero direction.');
  }
  if (typeof rotate !== 'boolean') throw new TypeError('Emitter rotate must be a boolean.');
  const unit = (x: number, y: number) => {
    const scale = Math.max(Math.abs(x), Math.abs(y));
    if (scale === 0) return { x: 0, y: 1 };
    const magnitude = Math.hypot(x / scale, y / scale);
    return { x: x / scale / magnitude, y: y / scale / magnitude };
  };
  const exhaust = unit(direction.x, direction.y);
  // CSS applies the rightmost rotation first: rotateZ, rotateY, then rotateX.
  const rotateVector = (x: number, y: number, pose: Pose) => {
    const rx = pose.rotateX * Math.PI / 180;
    const ry = pose.rotateY * Math.PI / 180;
    const rz = pose.rotateZ * Math.PI / 180;
    const zx = x * Math.cos(rz) - y * Math.sin(rz);
    const zy = x * Math.sin(rz) + y * Math.cos(rz);
    return { x: zx * Math.cos(ry), y: zy * Math.cos(rx) + zx * Math.sin(ry) * Math.sin(rx) };
  };
  const nozzle = (pose: Pose) => {
    const position = rotate ? rotateVector(offset.x * pose.scaleX, offset.y * pose.scaleY, pose) : offset;
    const projected = rotate ? rotateVector(exhaust.x, exhaust.y, pose) : exhaust;
    const vector = Math.hypot(projected.x, projected.y) < 1e-8 ? exhaust : unit(projected.x, projected.y);
    return { x: pose.x + position.x, y: pose.y + position.y, dx: vector.x, dy: vector.y };
  };

  return ({ container, document, width: initialWidth, height: initialHeight }) => {
    if (density === 0 || intensity === 0 || (!jet && !trail)) {
      return { render() {}, dispose() {} };
    }
    if (clip && (clip.ownerDocument !== document || typeof clip.getBoundingClientRect !== 'function')) {
      throw new TypeError('Particle clip must be an HTMLElement in the same Document.');
    }

    const canvas = document.createElement('canvas');
    let disposed = false;
    let context: CanvasRenderingContext2D | null;
    try {
      context = canvas.getContext('2d');
      if (!context) throw new Error('Tflip particles require a Canvas 2D context.');
      Object.assign(canvas.style, {
        position: clip ? 'absolute' : 'fixed', left: '0', top: '0', width: '100%', height: '100%',
        pointerEvents: 'none', userSelect: 'none', zIndex: clip ? '4' : 'auto',
      });
      canvas.setAttribute('data-tflip-particles', '');
      canvas.setAttribute('aria-hidden', 'true');
      canvas.setAttribute('role', 'presentation');
      canvas.setAttribute('inert', '');
      (clip ?? container).appendChild(canvas);
    } catch (error) {
      canvas.remove();
      throw error;
    }
    const ctx = context;
    let width = 0;
    let height = 0;
    let dpr = 0;
    let originX = 0;
    let originY = 0;
    // Updating dimensions on render means pause/dispose need no resize listener.
    const resize = () => {
      const view = document.defaultView;
      const bounds = clip?.getBoundingClientRect();
      const nextWidth = dimension(bounds?.width ?? view?.innerWidth ?? initialWidth, initialWidth);
      const nextHeight = dimension(bounds?.height ?? view?.innerHeight ?? initialHeight, initialHeight);
      originX = bounds?.left ?? 0;
      originY = bounds?.top ?? 0;
      const rawDpr = view?.devicePixelRatio ?? 1;
      const nextDpr = Number.isFinite(rawDpr) ? Math.min(MAX_DPR, Math.max(1, rawDpr)) : 1;
      if (width !== nextWidth || height !== nextHeight || dpr !== nextDpr) {
        width = nextWidth;
        height = nextHeight;
        dpr = nextDpr;
        canvas.width = Math.ceil(width * dpr);
        canvas.height = Math.ceil(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (pose: Pose, index: number, age: number, isJet: boolean) => {
      const kind = isJet ? 10 : 30;
      const lifetime = isJet
        ? 180 + random(seed, index, kind) * 240
        : 360 + random(seed, index, kind) * 360;
      if (age < 0 || age >= lifetime) return;
      const strength = isJet ? Math.max(0, Math.min(1, pose.thrust * intensity)) : Math.min(1, intensity);
      if (strength < 0.01 || (!isJet && (pose.phase === 'anticipation' || pose.phase === 'finished'))) return;
      const elapsed = age / 1000;
      const remaining = 1 - age / lifetime;
      const spread = (random(seed, index, kind + 1) - 0.5) * (isJet ? 100 : 38);
      const drift = isJet ? 90 + random(seed, index, kind + 2) * 100 : 18 + random(seed, index, kind + 2) * 22;
      const source = nozzle(pose);
      const distance = drift * elapsed + 20 * elapsed * elapsed;
      const x = source.x + source.dx * distance + source.dy * spread * elapsed;
      const y = source.y + source.dy * distance - source.dx * spread * elapsed;
      const radius = (isJet ? 1.8 : 1.2) + random(seed, index, kind + 3) * (isJet ? 3 : 2);
      ctx.globalAlpha = remaining * remaining * strength * (isJet ? 0.9 : 0.55);
      ctx.beginPath();
      ctx.arc(x, y, radius * (0.35 + 0.65 * remaining), 0, Math.PI * 2);
      ctx.fill();
    };

    // A readable short jet at the current nozzle, alongside historical exhaust
    // particles. This shape has no independent clock: pause and seek reconstruct
    // it exactly from the supplied pose and timeline time.
    const drawPlume = (pose: Pose, time: number) => {
      const strength = Math.max(0, Math.min(1, pose.thrust * intensity));
      if (strength < 0.015 || pose.phase === 'finished') return;
      const source = nozzle(pose);
      const pulse = 0.91 + Math.sin(time * 0.047 + seed) * 0.09;
      const length = (18 + 46 * Math.sqrt(strength)) * pulse;
      const width = 3 + 5 * Math.sqrt(strength);
      const point = (along: number, across: number) => [source.x + source.dx * along + source.dy * across, source.y + source.dy * along - source.dx * across] as const;
      const shape = (span: number, radius: number) => {
        ctx.beginPath();
        ctx.moveTo(...point(0, -radius * 0.42));
        ctx.quadraticCurveTo(...point(span * 0.45, -radius * 1.35), ...point(span, 0));
        ctx.quadraticCurveTo(...point(span * 0.45, radius * 1.35), ...point(0, radius * 0.42));
        ctx.closePath();
        ctx.fill();
      };
      ctx.fillStyle = '#7c8cff';
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.3 + Math.sqrt(strength) * 0.48;
      shape(length, width);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.55 + strength * 0.4;
      shape(length * 0.53, width * 0.4);
    };

    return {
      render(frame: EffectFrame) {
        if (disposed) return;
        resize();
        ctx.clearRect(0, 0, width, height);
        if (frame.reducedMotion) return;
        // Clip bounds are re-read every render, including position-only moves.
        if (clip) ctx.setTransform(dpr, 0, 0, dpr, -originX * dpr, -originY * dpr);
        if (!Number.isFinite(frame.time) || !Number.isFinite(frame.duration) || frame.duration < 0) {
          throw new TypeError('Particle frame time and duration must be finite, with non-negative duration.');
        }
        const time = Math.max(0, Math.min(frame.duration, frame.time));
        const interval = 1000 / (42 * density);
        const last = Math.floor(time / interval);
        const count = Math.min(last + 1, Math.ceil(MAX_LIFETIME / interval) + 1);
        // Reset to a valid default first: Canvas ignores invalid CSS colors.
        ctx.fillStyle = '#7c8cff';
        ctx.fillStyle = color;
        // Iterate a bounded small count instead of incrementing emission IDs:
        // very large finite times can have IDs above Number.MAX_SAFE_INTEGER.
        for (let offset = count - 1; offset >= 0; offset -= 1) {
          const index = last - offset;
          // An extremely small density can produce an infinite interval.
          const born = index === 0 ? 0 : index * interval;
          const age = time - born;
          if (age < 0 || age > MAX_LIFETIME) continue;
          const pose = frame.sample ? frame.sample(born) : frame.pose;
          if (trail) draw(pose, index, age, false);
          if (jet) draw(pose, index, age, true);
        }
        if (jet) drawPlume(frame.pose, time);
        ctx.globalAlpha = 1;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        canvas.remove();
        // Release the bitmap as well as removing the node.
        canvas.width = 0;
        canvas.height = 0;
      },
    };
  };
}
