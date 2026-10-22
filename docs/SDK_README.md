# Tflip 0.3.1

Framework-independent roll, flight and landing motion. This ESM package includes built JavaScript, TypeScript declarations and the [complete parameter reference](API.md). Browser animation has no runtime dependencies. React is an optional peer, required only for `@tflip/motion/react` (React 18 or 19). The SDK supports Node.js 20 or newer for server-side imports; its source-development toolchain has separate requirements.

## Install the downloaded SDK

Verify the archive's SHA-256 and byte count against the download catalog, then use your application's existing package manager:

```sh
npm install --ignore-scripts ./tflip-motion-0.3.1.tgz
```

This distribution is not published to npm; do not substitute a registry install. It contains no lifecycle scripts and does not require a source build. Use it through your existing ESM-capable application bundler. Direct browser modules need an import map or imports mapped to the installed `dist/` files. No CommonJS entry is provided.

The root export includes core and DOM APIs. Subpaths are `/core`, `/dom`, `/effects` and `/react`. Imports are safe during server rendering; call DOM animation only after client mount. Pure `sample(timeMs, options)` from `/core` does not need a browser. Distances and path coordinates are viewport CSS pixels, time is milliseconds and angles are degrees.

## Vanilla: animate a dedicated wrapper

```html
<div id="motion-wrapper" style="display:inline-block"><button>My content</button></div>
<button id="roll" type="button">Roll</button>
```

```js
import { createAnimator } from '@tflip/motion/dom';

const wrapper = document.querySelector('#motion-wrapper');
const button = document.querySelector('#roll');
const animator = createAnimator({
  element: wrapper, preset: 'launch', height: 120, duration: 2400,
  reducedMotion: 'system', layout: 'cancel', repeat: 'replace',
});
const roll = () => {
  const playback = animator.play();
  void playback.finished.then(result => {
    if (result.status === 'cancelled') console.log(result.reason, result.error);
  });
};
button.addEventListener('click', roll);

// Call when the host UI is removed, including an application route change.
export function dispose() {
  button.removeEventListener('click', roll);
  animator.dispose();
}
```

The wrapper owns animation transforms; keep business content's own transforms on its child. Completion and cancellation restore the wrapper's original styles. The library does not reparent business content. For transfer motion, provide `from`, `to` and a `visual()` factory returning a fresh, detached HTMLElement from the same document. That visual is decorative, inert and removed during cleanup; application code owns real content, focus and business state.

## React

```tsx
import { useRef } from 'react';
import { Motion, useMotion } from '@tflip/motion/react';

export function RollCard() {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useMotion(ref, { preset: 'snappy', reducedMotion: 'system' });
  return <>
    <Motion ref={ref} style={{ display: 'inline-block' }}><span>My card</span></Motion>
    <button onClick={() => motion.play()}>Roll</button>
    <button onClick={() => motion.cancel()}>Cancel</button>
  </>;
}
```

`Motion` renders a dedicated div wrapper. `useMotion` cancels all its active, queued and replayed controllers on unmount. Call `play()` only after mount. New defaults affect the next play. `motion.playback.current` is an imperative ref; changes do not trigger React rendering. Keep application listeners and other application resources under your own cleanup.

## Controls, cancellation and layout

`play()` returns a controller immediately and defers the initial start to a microtask. `pause()` / `resume()` control elapsed animation time; `seek(progress)` clamps a fraction to 0..1. Seeking to 1 alone does not complete playback or emit landing. `setSpeed()` requires a positive finite multiplier. `replay()` returns a **new controller and Promise**; retain that returned controller.

`finished` always resolves to `{ status: 'finished' }` or `{ status: 'cancelled', reason, error? }`, including cancellation from `cancel()`, `dispose()`, replacement, detachment and runtime errors. It does not reject for cancellation. Invalid setup throws synchronously. Resource cleanup occurs before `finished` handlers run. Visual completion never proves that a business operation succeeded.

`repeat: 'replace'` cancels the prior playback and queued work for the same owner. `ignore` returns the existing controller and shares its controls. `queue` waits for the active playback to settle. Ownership is keyed by `element`, otherwise an element `from`; coordinate-only runs have no shared key. Retain all controllers or use `createAnimator` / `useMotion` to own them. `sequence(steps)` controls steps in order; cancellation prevents later steps, and cross-step seeking skips intervening callbacks.

| Layout policy | Behavior |
| --- | --- |
| `cancel` (default) | Scrolling or resizing cancels the playback. |
| `freeze` | Keeps the coordinates measured when playback started. |
| `follow` | Remeasures element anchors; coordinate anchors remain absolute viewport coordinates. |

Detached anchors cancel. Page hiding suspends elapsed time; returning does not override a manual pause. Respect the default `reducedMotion: 'system'`: reduced motion finishes without movement or particles, and switching the system preference to reduce settles an active animation immediately. Test transforms, overflow and layout in the actual host application and supported browsers.

Optional particles from `/effects` share the playback time and cleanup; they do not start an independent animation loop. See [API.md](API.md) for configuration and sequence details. Built declarations are in [dist/types.d.ts](../dist/types.d.ts) and [dist/react/index.d.ts](../dist/react/index.d.ts).

## License

Package license identifier: `MIT`.

The included [LICENSE](../LICENSE) contains the applicable terms.
