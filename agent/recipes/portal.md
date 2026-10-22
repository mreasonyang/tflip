# portal: two-stage parcel transfer

Composition example: a parcel enters one portal and emerges from another, switching rotation axes between two sequence steps. The discontinuity is deliberate choreography, not a general portal system or an SDK preset.

[Install the examples bundle](../references/install.md). From a page at its root:

```html
<link rel="stylesheet" href="./examples/gallery/style.css">
<div id="portal-scene"></div>
<script type="module">
  import { mountGalleryDemo } from './examples/gallery/index.js';
  const demo = mountGalleryDemo(document.querySelector('#portal-scene'), 'portal', { jet: true });
  const run = demo.play();
  void run.finished.then(result => console.log(result.status));
  // Call demo.dispose() when this UI is removed.
</script>
```

[Controls and cleanup](../references/examples.md) apply to the whole scene. Do not derive business delivery state from the two visual steps. Map exported `jet`/`speed` using the [JSON contract](../references/config.md); use [lab](./lab.md) for your own anchors/content.
