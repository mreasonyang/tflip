import assert from 'node:assert/strict';
import { createElement, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { play, sample } from '@tflip/motion';
import { Motion, useMotion } from '@tflip/motion/react';
import { createParticles } from '@tflip/motion/effects';

assert.equal(typeof document, 'undefined');
function Consumer() {
  const ref = useRef(null);
  useMotion(ref, { duration: 400, effects: createParticles() });
  return createElement(Motion, { ref }, createElement('button', { style: { transform: 'rotate(3deg)' } }, 'Business action'));
}
const html = renderToStaticMarkup(createElement(Consumer));
assert.match(html, /Business action/);
assert.match(html, /rotate\(3deg\)/);
assert.throws(() => play({}), /browser Document/);
assert.equal(sample(400, { duration: 400 }).phase, 'finished');
console.log(JSON.stringify({ status: 'passed', globals: 'no document/window', html, imports: ['root', 'react', 'effects'] }));
