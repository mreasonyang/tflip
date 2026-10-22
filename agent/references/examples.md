# Mountable examples

Use the verified [examples archive](./install.md), preserving `examples/` and sibling `runtime/`. The recipe's HTML/module paths assume an HTML page at that archive root. For another deployment, resolve those assets from the application's chosen local asset base; no hostname or root-relative path is required. Load each used example family's `style.css` separately.

Exports:

- `examples/gallery/index.js`: `mountGalleryDemo(container, id, { jet: true })`, where id is `orbit`, `portal`, `vinyl`, `candy`, `arcade`, or `paper`.
- `examples/featured/index.js`: `mountStunt(container, { jet: true })`. Deprecated `mountRoadster` and `mountRamp` are aliases of the same two-shot demo (8 s ramp shot, direct cut, 5.8 s car-flight shot).

Mount into a dedicated connected element after client mount. The mounted demo owns its scene DOM; put application controls outside it. It returns `play`, `pause`, `resume`, `seek`, `setSpeed`, `cancel`, and `dispose` methods. The SDK package alone does not export these scene functions.

Gallery mounts a complete card with its own Play button and jet checkbox. Reuse those controls and add only the extra host controls needed, such as pause/resume/cancel, to avoid duplicate Play buttons. Vehicle mounts contain the canvas and accessible status, with controls supplied by the host.

```js
// demo is the result of the recipe's mount function.
const run = demo.play();
demo.pause();
demo.seek(0.5);         // normalized progress, 0..1
demo.setSpeed(0.35);    // positive speed multiplier
demo.resume();
void run.finished.then(result => console.log(result.status));
// Application controls may call demo.cancel(); demo.play() starts a new run.
// On route removal / component unmount:
// demo.dispose();
```

Call `dispose()` on teardown even after a run has finished. Remove any controls/listeners created by your application too. Jet defaults to on; pass `jet: false` to omit it. To change a mount option, dispose and remount; do not assume an undocumented reactive setter. Preserve system reduced motion. Completion refers only to animation, never a business transaction.

Call `pause()` before seeking if you need a stable preview: gallery seek preserves the existing running/paused state, while vehicle seek pauses. Instance seek from idle/terminal creates a paused preview. Vehicle `seek(1)` previews the final frame; `resume()` then settles `finished`. With reduced motion enabled, vehicles show only the static final state and finish immediately; turning it off does not automatically replay. `setSpeed` also applies to future runs. Gallery scroll/resize cancels measured viewport motion; vehicle scenes redraw their canvas on resize. Featured scene height can be set with `--tflip-scene-height` on the host container.

For Stunt, normalized progress covers all 13.8 seconds. `demo.seek(8000 / 13800)` selects the start of shot 2; just before that point selects the end of shot 1. Seeking backward across the cut restores the original ramp camera and pose. Each shot keeps its own space and full motion; no cross-scene interpolation or camera travel joins them.

React can mount a scene in `useEffect` with a dedicated div ref and return `() => demo.dispose()` from that effect. Keep the controller in a ref for event handlers. Do not render React children inside the scene-owned container or run mount during SSR.

Start by embedding the working example. Change its art or choreography only when requested; lower-level customization requires the scene's renderer/composition code. Gallery scenes use native DOM motion compositions. Vehicles use dedicated Canvas rendering and motion data, not native SDK presets. Run the [host acceptance checks](./verification.md).
