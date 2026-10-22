import { createRampScene } from './ramp-scene.js';
import { createRoadsterScene } from './roadster-scene.js';

/** Separate cameras and contexts, presented on one surface with a direct cut. */
export function createStuntScene(canvas) {
  const document = canvas?.ownerDocument;
  const context = canvas?.getContext('2d', { alpha: false });
  if (!context || !document) throw new Error('Stunt scene requires a browser Canvas 2D element');
  const makeBuffer = () => {
    const buffer = document.createElement('canvas');
    // Preserve the original renderers' CSS measurement and DPR without adding
    // hidden scene DOM or sharing mutable drawing state between the two shots.
    buffer.getBoundingClientRect = () => canvas.getBoundingClientRect();
    return buffer;
  };
  const buffers = { ramp: makeBuffer(), roadster: makeBuffer() };
  const scenes = { ramp: createRampScene(buffers.ramp), roadster: createRoadsterScene(buffers.roadster) };
  let disposed = false;
  return {
    render(frame) {
      if (disposed) return;
      if (!frame || !Object.hasOwn(scenes, frame.shot) || !frame.sceneFrame) throw new TypeError('A sampled shot frame is required');
      const buffer = buffers[frame.shot];
      scenes[frame.shot].render({ ...frame.sceneFrame, jet: frame.jet, reducedMotion: frame.reducedMotion });
      if (canvas.width !== buffer.width || canvas.height !== buffer.height) { canvas.width = buffer.width; canvas.height = buffer.height; }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'copy';
      context.drawImage(buffer, 0, 0);
      context.globalCompositeOperation = 'source-over';
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const scene of Object.values(scenes)) scene.dispose();
      for (const buffer of Object.values(buffers)) { buffer.width = 1; buffer.height = 1; }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
