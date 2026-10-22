# paper: three-plane formation

Composition example: three decorative paper planes follow independent smooth paths with different durations and roll settings. The scene owns all planes and their directional emitters. `paper` is not an SDK preset.

[Install the examples bundle](../references/install.md). From a page at its root:

```html
<link rel="stylesheet" href="./examples/gallery/style.css">
<div id="paper-scene"></div>
<script type="module">
  import { mountGalleryDemo } from './examples/gallery/index.js';
  const demo = mountGalleryDemo(document.querySelector('#paper-scene'), 'paper', { jet: true });
  const run = demo.play();
  void run.finished.then(result => console.log(result.status));
  // Call demo.dispose() when this UI is removed.
</script>
```

Use [shared controls and cleanup](../references/examples.md). Keep the full group owned until disposal. Exported `jet`/`speed` follow the [JSON contract](../references/config.md). Custom application content belongs in [lab](./lab.md); adapt paths to its measured layout.
