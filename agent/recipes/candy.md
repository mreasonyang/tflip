# candy: simultaneous objects

Composition example: five sweets move concurrently with different heights, axes, directions, and durations. The scene controller manages the group; this is not a particle-only effect or an SDK preset.

[Install the examples bundle](../references/install.md). From a page at its root:

```html
<link rel="stylesheet" href="./examples/gallery/style.css">
<div id="candy-scene"></div>
<script type="module">
  import { mountGalleryDemo } from './examples/gallery/index.js';
  const demo = mountGalleryDemo(document.querySelector('#candy-scene'), 'candy', { jet: true });
  const run = demo.play();
  void run.finished.then(result => console.log(result.status));
  // Call demo.dispose() when this UI is removed.
</script>
```

Use [group controls and cleanup](../references/examples.md); do not retain only one child playback. Exported `jet`/`speed` use the [JSON contract](../references/config.md). For business-owned cards, use [lab](./lab.md) and explicitly own each playback.
