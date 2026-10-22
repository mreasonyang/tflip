---
name: tflip
description: Integrate a selected Tflip Playground motion into an application using its versioned SDK or mountable examples. Use for card roll/transfer, six gallery scenes, or a two-shot U-ramp and car-flight Stunt; bind controls, exported configuration, cleanup, and reduced motion without reading the full source.
---

# Tflip integration

1. Read the [catalog](../catalog.json) for the exact version, hashes, and downloads. Resolve its relative URLs against the actual catalog URL. For archives, use the local catalog and preserve its directory structure. Never substitute a remembered host or assumed npm release.
2. Select one [recipe](../index.md): `lab` for application elements; `orbit`, `portal`, `vinyl`, `candy`, `arcade`, `paper` for composed examples; `stunt` for two independent Canvas shots on one timeline. Legacy `roadster` and `ramp` IDs map to `stunt`. Read only the selected recipe and references it needs.
3. Follow [installation](../references/install.md). Use the existing package manager for `@tflip/motion`; use the examples archive for gallery/vehicle scenes. Do not rebuild the demo or read all source unless an integration problem requires it.
4. For exported JSON, apply the [serialization and migration contract](../references/config.md). Resolve selectors in the application's DOM, create fresh decorative transfer content, and map allowed fields explicitly. Do not pass the whole JSON object to `play()`.
5. Own every controller. Wire user controls and call `dispose()` when its host unmounts. Keep business completion separate from animation completion. Respect system reduced motion and retain focus on application controls.
6. Run the concise [acceptance checks](../references/verification.md); report the recipe, package version, changed files, and checks actually run.

Only `launch`, `gentle`, `snappy`, and `float` are native SDK presets. Gallery IDs are example selectors. Stunt needs both original Canvas renderers, their separate motion data, the cut timeline, and mesh; it is neither an SDK preset nor a physical vehicle simulation.

Do not publish, replace framework dependencies, or broaden application behavior merely to use this skill. Existing user authorization governs integration. The SDK, original examples, and this integration Skill are MIT licensed; preserve the copyright and license notice. Reference videos, third-party brands, and trademarks are not included in that grant.
