# orbit: capsule delivery

Composition example: one capsule follows a smooth arc and rolls toward a planet. It includes scene artwork and particle placement; `orbit` is not an SDK preset.

[Install the examples bundle](../references/install.md), then place this in a page at its root:

```html
<link rel="stylesheet" href="./examples/gallery/style.css">
<div id="orbit-scene"></div>
<script type="module">
  import { mountGalleryDemo } from './examples/gallery/index.js';
  const demo = mountGalleryDemo(document.querySelector('#orbit-scene'), 'orbit', { jet: true });
  const run = demo.play();
  void run.finished.then(result => console.log(result.status));
  // Call demo.dispose() when this UI is removed.
</script>
```

Use the [shared controls](../references/examples.md). The capsule and destination belong to this scene; for arbitrary application elements use [lab](./lab.md). Exported settings map only `jet` and `speed` via the [JSON contract](../references/config.md).
