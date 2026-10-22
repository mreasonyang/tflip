# Native SDK contract

`play(options)` and `sequence(steps)` return controllers immediately. `createAnimator(defaults)` owns repeated `play()` calls and cancels them on `dispose()`. `core.sample(timeMs, options)` is pure math; `/dom` performs browser measurement/rendering; `/effects` is optional; `/react` is a thin adapter.

## Placement

- `mode: 'in-place'`: supply a dedicated `element` wrapper. Put business content inside it, with its own transforms. Do not animate an interactive child directly.
- `mode: 'transfer'`: supply `from`, `to`, and `visual()` returning a fresh detached decorative HTMLElement from the same document. No live React node is reparented; arbitrary interactive DOM is not cloned. `size` specifies visual dimensions.
- Anchors may be elements (their measured centers) or points. Points/path use absolute viewport CSS pixels, y downward; they are not container-relative or normalized. Recompute them when layout changes. Give point-based transfers a stable `element` owner if using repeat policies.
- Distances are CSS pixels, durations milliseconds, rotations degrees. `turns` is a nonnegative number; `direction` is `1` or `-1`; `axis` is `x`, `y`, or `z`.
- Only presets: `launch`, `gentle`, `snappy`, `float`. Explicit options override preset defaults. `path` is an array of intermediate absolute points, excluding endpoints; `pathMode` is `smooth` or `linear`.

## Controls and ownership

```js
const playback = play(options);
playback.pause();
playback.seek(0.5);       // fraction 0..1; not elapsed milliseconds
playback.setSpeed(0.35);  // positive finite multiplier
playback.resume();
const result = await playback.finished;
// { status: 'finished' } or { status: 'cancelled', reason, error? }
```

`cancel(reason?)` settles with `cancelled`; `dispose()` also cleans resources. `replay()` returns a new controller and new promise: keep the returned object. `seek(1)` alone does not emit landing/completion or settle `finished`. An animation result never proves a business operation succeeded.

Events: `start`, `land`, `finish`, `cancel`, `update`; `on(type, listener)` returns an unsubscribe function. Options also accept `onStart`, `onLand`, `onFinish`, `onCancel`, `onUpdate`. Cancellation does not emit finish. Retain all owned runs, including queued/replayed ones, or use `createAnimator`/`useMotion` ownership.

`repeat` defaults to `replace`; `ignore` returns the active controller for the same owner, sharing its controls; `queue` waits. Ownership is keyed by `element`, otherwise an element `from`. `sequence()` controls all steps; cancel prevents later steps. Cross-step seeking skips intervening callbacks. Do not build business workflows around skipped animation events.

## Browser lifecycle

Importing the SDK during SSR is safe; call DOM play/mount only after client mount. `useMotion(ref, defaults)` cancels its owned controllers on unmount; changing defaults affects the next play, not an active run. Its `playback` ref is imperative, not React state.

`layout: 'cancel'` is the default for resize/scroll changes. Use `freeze` only when frozen measured geometry is intentional; `follow` remeasures element anchors. Detached anchors cancel. Dispose during application teardown and remove application-owned listeners. Moving overlays are decorative; leave focus on real controls.

Keep `reducedMotion: 'system'` unless the user explicitly needs another policy. The reduced-motion path skips motion and optional effects. Do not force `never` to make a demo look active.

## Optional particles

```js
import { createParticles } from '@tflip/motion/effects';
const effects = createParticles({ jet: true, trail: true });
// Pass effects to play(); omit it when neither effect is needed.
```

Particles share playback time, so pause/seek/replay also affect them. `emitter.offset` is relative to the visual center; `emitter.direction` is a nonzero vector; `rotate` follows the pose. Adjust the emitter for the new visual dimensions. Optional `clip` must be a positioned element in the same document; it is runtime DOM, not serialized JSON. Effect settings are not reactive: cancel/recreate to change them. The SDK does not require a backend.
