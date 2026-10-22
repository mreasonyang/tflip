# Integration acceptance

Check the selected recipe in the actual host application; existing Playground tests do not verify a new integration.

1. Confirm the catalog version/hash and use the matching SDK or complete example bundle. Confirm stylesheet/module URLs work under the application's real path prefix.
2. Play twice quickly; pause, seek, resume, change speed, cancel, and play again. Keep the latest returned controller. Check the promised result distinguishes finished/cancelled. Confirm teardown removes owned nodes, effects, and listeners, including queued runs.
3. Unmount while running and paused. Resize/scroll while playing; verify the chosen layout policy. Test a narrow viewport and actual application content dimensions.
4. Enable system reduced motion; verify a usable static/completed state and no jet animation. Preserve focus and keyboard access to the application's controls. In SSR applications, render on the server and mount only on the client.
5. Exercise supported browsers, including Safari when required. A WebKit automation run is not evidence of testing real Safari or an iPhone. For Canvas scenes, check rendering and controls in the target container. For Stunt, seek to just before, exactly at, and just after `8000 / 13800`, then back again: the first shot is the original ramp, the exact cut starts the original car-flight shot, and backward seek restores shot 1. Pause across the cut, resume, replay from shot 1, and finish shot 2; the two spaces must never appear combined.

Report what ran and any remaining limitation. Do not claim production readiness, physical accuracy, universal compatibility, or a measured token saving from documentation alone.
