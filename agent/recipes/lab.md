# lab: application content motion

Use the native SDK for an element roll or a decorative transfer between anchors. [Install the exact tarball](../references/install.md), then read [controls and ownership](../references/sdk.md). Gallery and vehicle visuals are separate recipes.

## Vanilla: dedicated wrapper

```html
<div data-motion-wrapper style="display:inline-block"><span>My card</span></div>
<button id="roll" type="button">Roll</button>
```

```js
import { createAnimator } from '@tflip/motion/dom';

export function mountRoll(button, wrapper) {
  const animator = createAnimator({
    element: wrapper, mode: 'in-place', preset: 'launch',
    height: 120, turns: 1, duration: 2400,
    reducedMotion: 'system', layout: 'cancel', repeat: 'replace',
  });
  const launch = () => {
    const playback = animator.play();
    void playback.finished.then(result => console.log(result.status));
  };
  button.addEventListener('click', launch);
  return () => {
    button.removeEventListener('click', launch);
    animator.dispose();
  };
}
const cleanup = mountRoll(
  document.querySelector('#roll'),
  document.querySelector('[data-motion-wrapper]'),
);
// Call cleanup() when this UI is removed.
```

## React: same ownership boundary

```tsx
import { useRef } from 'react';
import { Motion, useMotion } from '@tflip/motion/react';

export function RollCard() {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useMotion(ref, {
    preset: 'launch', height: 120, turns: 1, duration: 2400,
    reducedMotion: 'system', layout: 'cancel', repeat: 'replace',
  });
  return <>
    <Motion ref={ref} style={{ display: 'inline-block' }}>
      <span>My card</span>
    </Motion>
    <button type="button" onClick={() => motion.play()}>Roll</button>
    <button type="button" onClick={() => motion.playback.current?.pause()}>Pause</button>
    <button type="button" onClick={() => motion.playback.current?.resume()}>Resume</button>
    <button type="button" onClick={() => motion.cancel()}>Cancel</button>
  </>;
}
```

The hook owns cleanup on unmount. Keep child transforms on the inner content. Call play only after mount, e.g. from an event handler; keep application state independent of animation completion.

## Transfer between application elements

```js
import { play } from '@tflip/motion/dom';

export function fly(source, target) {
  return play({
    mode: 'transfer', from: source, to: target,
    size: { width: 120, height: 72 }, preset: 'gentle',
    reducedMotion: 'system',
    visual() {
      const node = document.createElement('div');
      node.textContent = 'Sent';
      Object.assign(node.style, {
        width: '120px', height: '72px', background: '#dcd7ff',
        borderRadius: '12px', display: 'grid', placeItems: 'center',
      });
      return node;
    },
  });
}
// Store fly(...)'s returned controller and dispose it on teardown.
```

For Playground exports, follow [JSON mapping](../references/config.md): selectors, viewport coordinates, sizes, and particle offsets describe the demo and need application-specific binding. Never spread the export envelope into `play()`. Validate with the [acceptance checks](../references/verification.md).
