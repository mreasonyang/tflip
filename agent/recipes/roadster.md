# roadster: compatibility alias for stunt

This recipe URL remains valid. Follow [stunt](./stunt.md) for the current two-shot demo: the full U-ramp action, a direct cut, then the full flight over cars.

In current Tflip, configuration `demo: "roadster"` maps to `"stunt"`, and `mountRoadster` remains an alias of `mountStunt`. It no longer selects the old standalone action. Keep the original export when applying the [explicit configuration upgrade](../references/config.md). New code should use the canonical names.
