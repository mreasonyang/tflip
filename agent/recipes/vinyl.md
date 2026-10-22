# vinyl: record flip and spin

Composition example: a record flips onto a turntable, then rotates around Z in a second sequence step. It is visual only: no audio playback, media transport, or SDK `vinyl` preset.

[Install the examples bundle](../references/install.md). From a page at its root:

```html
<link rel="stylesheet" href="./examples/gallery/style.css">
<div id="vinyl-scene"></div>
<script type="module">
  import { mountGalleryDemo } from './examples/gallery/index.js';
  const demo = mountGalleryDemo(document.querySelector('#vinyl-scene'), 'vinyl', { jet: true });
  const run = demo.play();
  void run.finished.then(result => console.log(result.status));
  // Call demo.dispose() when this UI is removed.
</script>
```

Use [shared controls and cleanup](../references/examples.md). Treat music/app state separately. Exported `jet`/`speed` follow the [JSON contract](../references/config.md). For an arbitrary album card flip, start from [lab](./lab.md).
