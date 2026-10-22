# Tflip: agent entry

Integrate one selected motion without reading the whole Playground. Start with [catalog.json](./catalog.json): resolve every URL against the catalog's actual URL, preserving its origin and path prefix. No fixed host, IP, port, or deployment root is required.

1. Select one recipe below; read only its shared references as needed.
2. Use the catalog's versioned SDK or examples archive; verify its SHA-256 before using it.
3. Bind the motion to the application's elements and lifecycle; run the [acceptance checks](./references/verification.md).

| Need | Recipe | Implementation |
| --- | --- | --- |
| Roll or transfer application content | [lab](./recipes/lab.md) | Native SDK; vanilla / React |
| Capsule to a planet | [orbit](./recipes/orbit.md) | Composed DOM example |
| Parcel through two portals | [portal](./recipes/portal.md) | Composed DOM example |
| Record flip and spin | [vinyl](./recipes/vinyl.md) | Composed DOM example |
| Five simultaneous sweets | [candy](./recipes/candy.md) | Composed DOM example |
| Three consecutive hops | [arcade](./recipes/arcade.md) | Composed DOM example |
| Three paper planes | [paper](./recipes/paper.md) | Composed DOM example |
| Complete U-ramp shot → cut → complete car-flight shot | [stunt](./recipes/stunt.md) | Two Canvas shots, one 13.8 s timeline |

[Skill instructions](./tflip/SKILL.md) · [Install / portability](./references/install.md) · [Exported JSON](./references/config.md)

There are eight canonical demos. Legacy `roadster` and `ramp` IDs and recipe URLs both resolve to `stunt`; they do not add separate demos. Current package: `@tflip/motion@0.3.1`. Follow the explicit configuration migration rules for older SDK exports.

The SDK, original examples, and integration Skill are MIT licensed. npm publication remains disabled; use the catalog download. A private preview may require the user's tailnet connection. An unreachable page is not evidence that npm has a replacement package. Reduced reading is a design goal, not a measured token guarantee.
