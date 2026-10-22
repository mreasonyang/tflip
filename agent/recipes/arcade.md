# arcade: three-hop sequence

Composition example: one token hops through three targets; its landing count is a visual combo indicator. It is not game logic, scoring authority, or an SDK preset.

[Install the examples bundle](../references/install.md). From a page at its root:

```html
<link rel="stylesheet" href="./examples/gallery/style.css">
<div id="arcade-scene"></div>
<script type="module">
  import { mountGalleryDemo } from './examples/gallery/index.js';
  const demo = mountGalleryDemo(document.querySelector('#arcade-scene'), 'arcade', { jet: true });
  const run = demo.play();
  void run.finished.then(result => console.log(result.status));
  // Call demo.dispose() when this UI is removed.
</script>
```

[Shared controls](../references/examples.md) operate on the whole sequence. Seeking may skip lifecycle events; never award real rewards from animation callbacks. Exported `jet`/`speed` follow the [JSON contract](../references/config.md). See [lab](./lab.md) for custom application elements.
