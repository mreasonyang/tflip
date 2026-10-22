# Exported configuration v1

Exports are JSON data, not executable SDK options. Validate against [configuration.schema.json](../configuration.schema.json) before mapping:

```json
{
  "schemaVersion": 1,
  "sdkVersion": "0.3.2",
  "demo": "lab",
  "framework": "auto",
  "config": {
    "mode": "in-place",
    "motion": { "preset": "gentle", "height": 90, "turns": 1, "duration": 2600 },
    "anchors": { "kind": "wrapper", "wrapper": "[data-motion-wrapper]" },
    "size": { "width": 176, "height": 116 },
    "effects": { "jet": true, "trail": true }
  }
}
```

`framework` is `auto`, `vanilla`, or `react`: an integration preference, not an SDK parameter or a request to switch frameworks. Match `sdkVersion` to the catalog/package; reject unsupported schema versions. `demo` should use one of the eight canonical catalog IDs. The schema also accepts the two explicitly deprecated aliases for migration.

## Explicit migration from earlier SDK versions

The schema recognizes current `sdkVersion: "0.3.2"` and legacy `"0.1.0"` / `"0.2.0"` / `"0.2.1"` / `"0.3.0"` / `"0.3.1"`; recognition does not authorize executing old data with a different runtime. Reject unknown schema/SDK versions. For an intended upgrade, preserve the original export, validate it, then create a new copy with `sdkVersion` set to the current catalog version and `demo` mapped through `catalog.aliases`. `roadster` and `ramp` become `stunt`; other IDs and allowed configuration fields remain unchanged. Explain that both old vehicle IDs now select the full two-shot edit: ramp action, cut at 8 seconds, then car-flight action. Validate the new copy again and bind it to the matching current artifacts.

The envelope shape stays at `schemaVersion: 1`; the SDK package version and catalog content revision identify the changed implementation. A current v0.3.2 envelope may still contain a legacy ID: canonicalize the ID before selecting its recipe, rather than treating it as an additional demo. This is an explicit adapter workflow, not an SDK `play()` feature.

## lab

`config.mode` is `in-place` or `transfer`. `motion` contains serializable SDK trajectory/playback settings only. `anchors` is one of:

- `{ kind: 'wrapper', wrapper: '[data-motion-wrapper]' }` for in-place motion.
- `{ kind: 'selectors', from: '#source', to: '#target', wrapper: '[data-motion-wrapper]' }` for transfer between measured element centers. The transfer can use `from` as its repeat owner; the wrapper string is not automatically a business node to move.
- `{ kind: 'viewport', from: { x, y }, to: { x, y }, wrapper: '[data-motion-wrapper]' }` for absolute viewport coordinates. Resolve the dedicated wrapper as repeat ownership; it is not the transfer visual.

`size` is the transfer visual's width/height. `effects` contains particle options as JSON, never a factory or `clip` element. No callback, DOM node, function, AbortSignal, or controller is serialized. Path points are absolute viewport pixels. Values captured in the Playground are not responsive application coordinates; measure/rebind for the host layout. Size and emitter offsets are demo starting values, not inferred from new business content.

Minimal explicit mapping after parsing JSON and checking its shape:

```js
import { play } from '@kyun.si/tflip/dom';
import { createParticles } from '@kyun.si/tflip/effects';

export function playLab(data, { sdkVersion, root = document, makeVisual, clip }) {
  if (data.schemaVersion !== 1 || data.sdkVersion !== sdkVersion || data.demo !== 'lab') {
    throw new Error('Unsupported configuration or SDK version');
  }
  const cfg = data.config;
  const anchor = cfg.anchors;
  const find = selector => {
    const element = root.querySelector(selector);
    if (!element) throw new Error(`Missing motion anchor: ${selector}`);
    return element;
  };
  const options = { mode: cfg.mode };
  for (const key of [
    'preset', 'height', 'turns', 'direction', 'axis', 'duration', 'bounce',
    'depth', 'path', 'pathMode', 'phases', 'speed', 'repeat',
    'layout', 'reducedMotion', 'perspective', 'shadow', 'backface',
  ]) {
    if (cfg.motion?.[key] !== undefined) options[key] = cfg.motion[key];
  }
  if (cfg.mode === 'in-place' && anchor.kind === 'wrapper') {
    options.element = find(anchor.wrapper);
  } else if (cfg.mode === 'transfer' && ['selectors', 'viewport'].includes(anchor.kind)) {
    options.from = anchor.kind === 'selectors' ? find(anchor.from) : anchor.from;
    options.to = anchor.kind === 'selectors' ? find(anchor.to) : anchor.to;
    if (anchor.kind === 'viewport') options.element = find(anchor.wrapper);
    options.size = { width: cfg.size.width, height: cfg.size.height };
    options.visual = makeVisual; // fresh detached decorative element each call
  } else {
    throw new Error('Mode and anchor kind do not match');
  }
  if (cfg.effects?.jet || cfg.effects?.trail) {
    const particles = {};
    for (const key of ['jet', 'trail', 'density', 'intensity', 'color', 'seed', 'emitter']) {
      if (cfg.effects[key] !== undefined) particles[key] = cfg.effects[key];
    }
    if (clip) particles.clip = clip; // positioned application element, never JSON
    options.effects = createParticles(particles);
  }
  return play(options); // dispose the returned controller on teardown
}
```

The host supplies the installed `sdkVersion`, application-scoped `root`, and transfer `makeVisual`. The SDK validates numerical ranges. This small adapter is for vanilla imperative integration; in React, map the same allowed data to `useMotion` options, use its mounted wrapper ref, and let the hook own cleanup. Never spread `data` or `data.config` into the SDK, evaluate JSON as code, or restore functions from strings.

## Seven example scenes

```json
{
  "schemaVersion": 1,
  "sdkVersion": "0.3.2",
  "demo": "stunt",
  "framework": "auto",
  "config": { "jet": true, "speed": 1 }
}
```

After validating the envelope, select the recipe's explicit mount function. Pass `{ jet: data.config.jet }`, then call `demo.setSpeed(data.config.speed)` and `demo.play()`. Validate that `jet` is boolean and `speed` is finite and positive. Gallery IDs select `mountGalleryDemo`; `stunt` selects `mountStunt`. Its `mountRoadster` / `mountRamp` aliases use the same two-shot demo. The selected ID does not isolate either shot. These fields do not parameterize arbitrary vehicle physics or turn a scene into an SDK preset.
