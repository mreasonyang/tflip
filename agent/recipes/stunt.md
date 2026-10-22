# stunt: two shots, one playback

Play the complete original 8-second U/C-ramp shot, then cut directly to the complete original 5.8-second car-flight shot. Total duration is 13.8 seconds. Each shot keeps its own camera, world, composition, and full action including landing. The car does not fly between the two spaces; the shared playback clock selects which original renderer is visible.

At nominal time `t < 8000 ms`, shot 1 samples the ramp at `t`. At `t >= 8000 ms`, shot 2 samples the car flight at `t - 8000`. `seek(8000 / 13800)` is the start of shot 2. Seeking in either direction across this boundary performs the same direct cut; no transition or camera interpolation is added.

This is a non-official visual interpretation, not a dimensional reconstruction, physical vehicle simulation, or native SDK preset. Installing the SDK alone does not provide the scene.

[Install the complete examples bundle](../references/install.md). From a page at its root:

```html
<link rel="stylesheet" href="./examples/featured/style.css">
<div id="stunt-scene"></div>
<script type="module">
  import { mountStunt } from './examples/featured/index.js';
  const demo = mountStunt(document.querySelector('#stunt-scene'), { jet: true });
  const run = demo.play();
  void run.finished.then(result => console.log(result.status));
  // Call demo.dispose() when this UI is removed.
</script>
```

Use [shared controls and cleanup](../references/examples.md). Jets default to on. Exported settings expose `jet` and `speed` via the [JSON contract](../references/config.md). Other choreography changes require scene-level work; choose [lab](./lab.md) for application element motion.

Legacy `roadster` / `ramp` IDs, recipe URLs, and `mountRoadster` / `mountRamp` exports map to this full two-shot demo. New code should use `stunt` and `mountStunt`; these legacy aliases do not select only one shot. System reduced motion shows the final pose of shot 2 without replaying either action or jets.
