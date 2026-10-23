# Tflip

[English](README.en.md) | [简体中文](README.md)

Framework-independent roll, launch, and landing motion effects. Written in TypeScript, providing pure trajectory calculation, CSS 3D rendering, optional Canvas particles, and thin React adapters.

The current version is **0.3.2**, with project directory `tflip/`. Live demo: https://tflip.kyun.si. For naming and migration details, see [Tflip Unified Naming](docs/TFLIP_UPDATE.md).

This is a standalone component implementation. Visual completion in this project indicates only the end of the visual lifecycle, not the success of a business task.

## Installation

The npm package name is `@kyun.si/tflip`. In your own project, run:

```sh
npm install @kyun.si/tflip
```

```ts
import { play } from '@kyun.si/tflip';
```

The current version 0.3.2 is published to npm. You can also download the byte-identical SDK from the catalog and run `npm install --ignore-scripts ./kyun.si-tflip-0.3.2.tgz`; the import specifiers remain identical after installation. The React entry point is `@kyun.si/tflip/react`, with no need to install a separate Tflip package.

## Running Locally

Source development requires Node.js 22.22.2+ (22.x), 24.15.0+ (24.x), or 26+; 26.11.0 as specified in `.node-version` is recommended. SDK consumer requirements are separated from the development toolchain; see [SDK Integration Guide](docs/SDK_README.md). When dependencies are installed, run directly:

```sh
npm run build:agent
npm run dev
```

Open the `playground/` page using the URL output by the development server. The playground includes in-place / transfer motion, parameter adjustment, editable path waypoints, sequence examples, timeline seeking, event logging, and configuration copying. The page loads no CDNs, external images, or business backends.

When using for the first time on another machine, run `npm ci --ignore-scripts` first. Browser regression requires Brave, as well as the matching WebKit installed via `npx --no-install playwright install webkit`. Verification and local packaging:

```sh
npm test
npm run test:browser  # All current browser suites; Brave and Playwright WebKit
npm run pack:local
```

## Agent Integration

The playground's "Integrate Agent" feature supports selecting demos, copying prompt instructions for the current configuration, and downloading JSON. Agents can directly discover selected recipes and checksum-verified SDK / examples / skill bundles from the [compact entrypoint](agent/index.md); the [Integration Guide](docs/AGENT_INTEGRATION.md) documents directory structures and verification methods.

Asset links use relative paths, and copied instructions are generated based on the current access URL, preserving arbitrary deployment subdirectories. `npm run build:agent` generates static assets and archives, while `npm run preview:sync` synchronizes to an existing static preview directory; neither configures domain names, IP addresses, or network services. Skill bundles are intended for users to load manually in clients supporting Agent Skills; this project will not install anything automatically into global directories.

Browser testing requires local Brave and Playwright WebKit; custom paths can be specified via browser path environment variables supported by the test scripts, as detailed in [Verification Guide](docs/VERIFICATION.md).

Currently 8 demos are provided: Lab, six creative scenes, and the two-shot Stunt. Stunt plays the full 8-second halfpipe roll shot first, then cuts directly to the full 5.8-second car-jump shot; the two scenes retain their respective compositions, cameras, and actions while sharing a single 13.8-second playback timeline. Roadster / Ramp scene aliases continue to map to the full Stunt. See [Two-Shot Update](docs/TWO_SHOT_UPDATE.md) for current notes.

## Package Structure

| Entry Point | Contents | Browser Dependencies |
| --- | --- | --- |
| `@kyun.si/tflip/core` | `normalizeOptions`, `sample` / `stateAt`, `presets` | None; pure math, callable on the server |
| `@kyun.si/tflip/dom` | `play`, `createAnimator`, `sequence`, `wrap` | Requires DOM when called; import-safe |
| `@kyun.si/tflip/effects` | `createParticles` | Requires Canvas 2D when creating effect instances |
| `@kyun.si/tflip/react` | `Motion`, `useMotion` | Optional React peer; importable and renderable under SSR |
| `@kyun.si/tflip` | core + dom + public types | Import-safe, does not automatically include particles or React |

The published format is ESM, with bundled `.d.ts` declarations. The browser runtime has no third-party animation library dependencies; React is required only when using the React entry point.

`@kyun.si/tflip@0.3.2` is licensed under the [MIT License](LICENSE), allowing modification, commercial use, and distribution under license terms. `npm run pack:local` generates a canonical SDK byte-for-byte identical to the website; `npm run publish:npm` publishes that archive publicly to npm. The development repository's `private: true` prevents accidentally publishing raw source code; the generated SDK archive does not contain this restriction. The SDK, examples, and Skill bundles all carry licenses; reference videos and third-party brands are outside the scope of this project's license.

## In-Place Motion: Preserving Business Element Transforms

A wrapper layer handles motion exclusively, allowing inner business elements to retain their own styling and DOM node ownership.

```html
<div id="motion-wrapper"><button id="business-button">Run task</button></div>
```

```ts
import { play } from '@kyun.si/tflip/dom';

const playback = play({
  element: document.querySelector<HTMLElement>('#motion-wrapper')!,
  preset: 'launch',
  height: 160,
  turns: 1,
  direction: 1,
  duration: 2400,
  onLand: () => console.log('Visual landed'),
});

playback.pause();
playback.seek(0.5);             // 0..1
playback.setSpeed(0.35);
playback.resume();
const result = await playback.finished;
if (result.status === 'cancelled') console.log(result.reason);
```

`element` must be a dedicated motion wrapper. During playback, the library manages this layer's transform, transform-origin, transform-style, backface-visibility, and will-change, restoring original values upon completion or cancellation. Inner elements are never reparented, and their own transform properties are not overwritten.

Vanilla DOM projects can also explicitly call `wrap(businessElement)` to obtain `{ element, dispose }`, which places the element into a new wrapper and restores it on `dispose()`. Framework-based projects should let the framework render the wrapper. Additional wrapper elements impact flexbox, grid, and selector layouts, so their dimensions and placement must be accounted for explicitly in the business layout.

## Transfer Motion: Providing Temporary Visual Content

```ts
import { play } from '@kyun.si/tflip/dom';
import { createParticles } from '@kyun.si/tflip/effects';

const playback = play({
  from: document.querySelector('#ready')!,
  to: document.querySelector('#running')!,
  visual: () => {
    const card = document.createElement('div');
    card.textContent = 'Task 001';
    card.className = 'flight-card';
    return card;
  },
  size: { width: 220, height: 140 },
  height: 180,
  axis: 'x',
  direction: -1,
  turns: 2,
  effects: createParticles({ jet: true, trail: true, seed: 42, color: '#ef6136' }),
  shadow: true,
});
```

The factory must return a fresh, unmounted HTMLElement belonging to the same Document. The visual is a decorative proxy placed inside an `aria-hidden` / `inert` overlay that accepts no pointer or focus events. The library does not clone arbitrary interactive content, does not move the business source node, and does not automatically hide it. Business logic determines when to reveal target content, hide source content, or transition task states. Temporary visual elements are removed upon completion or cancellation.

Element anchors use bounding box centers; coordinate anchors are viewport CSS pixels, such as `{ x: 120, y: 300 }`. When `to` is omitted, motion rolls in place. `z`, height, and path waypoints are all expressed in pixels, not meters from original demo interfaces.

## Playback Control and Lifecycle

`play()` synchronously returns a controller object, deferring initial startup to a microtask so callers can register event listeners first. Properties include `status`, `currentTime`, `duration`, `progress`, and `finished`.

| Method | Semantics |
| --- | --- |
| `pause()` / `resume()` | Freeze/resume animation elapsed time; particles share the same timeline |
| `seek(progress)` | Seek within 0..1, clamped to bounds; does not complete playback or independently trigger landing events |
| `setSpeed(speed)` | Positive finite number; 1 is normal, 0.35 is slow motion |
| `cancel(reason?)` | Clean up and resolve `finished` to a cancelled result |
| `dispose()` | Cancel with reason `disposed` |
| `replay()` | Force `replace` policy, returning a brand new controller and completion Promise; previous Promise remains unchanged |
| `on(type, listener)` | Subscribe to `start/land/finish/cancel/update`, returning an unsubscribe function |

`finished` resolves normally to `{ status: 'finished' }` or `{ status: 'cancelled', reason, error? }`. Input validation errors throw synchronously; runtime errors in effects or callbacks result in cancellation. Resource cleanup upon completion or cancellation executes before Promise handlers run. Do not treat cancellation as an unhandled Promise rejection.

The same wrapper layer or source element shares duplicate trigger policies: `replace` (default; cancels previous playback and queued items), `ignore` (returns existing controller), or `queue` (returns an independent queued controller). Coordinate-only anchors have no shared element key, making calls mutually independent. Use `createAnimator(defaults)` to manage a group of runs and clean them up via `cancel()` / `dispose()`.

## Paths, Phases, and Choreography

`path` is an array of absolute viewport coordinates excluding start and end points. `pathMode: 'linear' | 'smooth'` selects between polylines or Catmull–Rom smooth curves; smooth curves may overshoot intermediate waypoints, and parameter segmentation does not equal constant arc-length speed. `height` and `depth` are added on top of this baseline path.

`phases` configures relative weights for `anticipation/launch/roll/descent/settle`; omitted phases retain preset defaults and are normalized together. Individual phases may be set to 0, but the sum of flight phases must be greater than 0. `bounce` ranges from 0..1. `turns` can be a non-negative decimal, `direction` is 1 or -1, and `axis` is x/y/z. Because the wrapper restores its initial styles upon completion, non-integer rotations (like half-turns) are not permanently written into business nodes.

```ts
import { sequence } from '@kyun.si/tflip/dom';

const timeline = sequence([
  { element: wrapper, preset: 'snappy', axis: 'x' },
  { element: wrapper, preset: 'gentle', axis: 'y', direction: -1 },
]);
timeline.pause();
timeline.seek(0.65); // Normalized progress across the entire sequence
timeline.resume();
await timeline.finished;
```

Sequences instantiate steps in order; seeking to another step cancels and cleans up the current step, constructs the target step in a paused state, seeks to the offset, and restores the original playback state. Skipped steps do not trigger start or finish callbacks. Cancelling a sequence prevents subsequent steps from starting. Each step remains an independent visual; relaying across regions can use the previous target as the next start.

If a sequence step uses `repeat: 'ignore'`, it joins existing playback, preserving its progress and sharing controls; it adopts that playback's actual duration, which may update total sequence duration when the subsequent step starts. Use `replace` or `queue` when independent control is required. Trajectory parameters are validated immediately, while DOM elements and visual factories for later steps are validated when entering each step. Replaying a sequence also forces `replace`, guaranteeing new controller objects and new Promises.

## React

```tsx
import { useRef } from 'react';
import { Motion, useMotion } from '@kyun.si/tflip/react';

export function TaskButton() {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useMotion(ref, { preset: 'snappy', height: 100 });
  return <Motion ref={ref} style={{ display: 'inline-block' }}>
    <button onClick={() => motion.play()}>Roll</button>
  </Motion>;
}
```

`Motion` is a dedicated wrapper layer that forwards div attributes and refs; `useMotion` returns stable `play` and `cancel` functions plus a `playback` ref. Changes to default parameters affect only the next playback; updating the `playback` ref does not trigger React re-renders. Unmounting cancels active, queued, and replayed controllers owned by the hook, suppressing hook-managed callbacks. Server-side rendering supports importing and rendering; invoke playback only after client mounting. For complete examples, see [examples/react.tsx](examples/react.tsx).

## Environmental Policies

- `reducedMotion: 'system'` is the default. When the system prefers reduced motion, playback finishes immediately without motion or particles; `always` forces this behavior, while `never` explicitly disables it. Changing preference to reduce at runtime completes active playback immediately. Business applications should preserve the default option to respect system preferences for users.
- `layout: 'cancel'` cancels playback on scroll or resize by default; `freeze` retains coordinates measured at start; `follow` remeasures element anchors. Coordinate anchors are absolute viewport values and do not move with document scrolling. Layouts with complex transformed parents or scaling require verification in the host application.
- Playback cancels if source, target, or wrapper elements are detached from the DOM. Cancellation or unmounting cleans up rAF, listeners, Observers, Canvas instances, and temporary nodes.
- Page visibility hiding pauses timeline progression and resumes when visible again; manual pauses are not automatically overridden.
- Decorative proxies do not capture focus; actual business controls, accessible names, and task completion notices remain the application's responsibility.
- CSS 3D requires browser support. Parent overflow, filter, opacity, or transforms may affect 3D contexts and stacking; dedicated wrappers should be used and verified on actual target pages. For browser verification coverage, see [Verification Record](docs/VERIFICATION.md); automated WebKit testing is not equivalent to acceptance across all Safari and iOS versions.

## Additional Documentation

- [Complete Parameters and API Reference](docs/API.md)
- [Verification and Known Boundaries](docs/VERIFICATION.md)
- [Changelog](CHANGELOG.md)
- [Vanilla Integration Example](examples/vanilla.html)

Design references: [React effect cleanup](https://react.dev/reference/react/useEffect), [CSS transform-style](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transform-style), [TypeScript module resolution](https://www.typescriptlang.org/tsconfig/moduleResolution.html). This component uses its own rAF timeline; `finished` cancellation resolution is an explicit API contract.

## Releases and Feedback

[GitHub Source & Issues](https://github.com/mreasonyang/tflip) · [Releases and Rollback](docs/RELEASING.md) · [Support Scope and Verification](docs/VERIFICATION.md)

The public demo is available for direct use. Host page layout, business state, and cleanup must still be validated according to the integration guidelines; current acceptance is not equivalent to verification across all browsers, mobile devices, and host frameworks.
