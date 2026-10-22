import { play, sample, type MotionOptions, type PlaybackResult } from '@tflip/motion';
import { normalizeOptions } from '@tflip/motion/core';
import { createAnimator, sequence } from '@tflip/motion/dom';
import { createParticles } from '@tflip/motion/effects';
import { Motion, useMotion } from '@tflip/motion/react';
import { useRef } from 'react';

declare const element: HTMLElement;
const options: MotionOptions = { element, duration: 400, effects: createParticles(), signal: new AbortController().signal };
const result: Promise<PlaybackResult> = play(options).finished;
createAnimator(options).play().seek(.5);
sequence([options]).pause();
sample(100, normalizeOptions({ duration: 400 }));
function Consumer() {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useMotion(ref, { duration: 400 });
  return <Motion ref={ref}><button onClick={() => motion.play()}>Run</button></Motion>;
}
// @ts-expect-error A consumer cannot override the hook's owned element.
useMotion({ current: element }, { element });
// @ts-expect-error Invalid directions must fail at the published API boundary.
play({ element, direction: 0 });
void result; void Consumer;
