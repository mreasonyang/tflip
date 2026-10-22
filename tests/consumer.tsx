// Compile public entry points as a consumer, rather than importing internal source.
import { play, sample, type MotionOptions, type PlaybackResult } from '@tflip/motion';
import { normalizeOptions, presets, type Pose } from '@tflip/motion/core';
import { createAnimator, sequence, wrap } from '@tflip/motion/dom';
import { createParticles, type EffectFactory } from '@tflip/motion/effects';
import { Motion, useMotion } from '@tflip/motion/react';
import { useRef } from 'react';

declare const element: HTMLElement;
const effect: EffectFactory = createParticles({ density: 2, seed: 42 });
const config: MotionOptions = { element, turns: 2, axis: 'z', effects: effect, phases: { roll: 4 } };
const playback = play(config);
const promise: Promise<PlaybackResult> = playback.finished;
const pose: Pose = sample(300, normalizeOptions({ duration: presets.snappy.duration }));
const animator = createAnimator(config);
animator.play().on('cancel', event => event.result);
sequence([config, config]).seek(.5);
wrap(element).dispose();
function Consumer() {
  const ref = useRef<HTMLDivElement>(null);
  const { play, playback } = useMotion(ref, { onFinish: event => event.progress });
  return <Motion ref={ref} aria-label="Motion"><button onClick={() => play()}>Play {playback.current?.status}</button></Motion>;
}
// @ts-expect-error Invalid direction must be caught at the public API boundary.
play({ element, direction: 0 });
// @ts-expect-error Hook owns its element; callers cannot override it.
useMotion({ current: element }, { element });
void promise; void pose; void Consumer;
