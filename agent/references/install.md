# Install and relocate

Read [catalog.json](../catalog.json). It records `package` (`name`, `version`, `url`, `sha256`, `bytes`), `downloads`, and recipe paths. Paths in the catalog are relative to the catalog itself, not the Playground page or the consuming application's root.

```js
// entryURL is the actual agent/index.md URL that was fetched.
const catalogURL = new URL('./catalog.json', entryURL);
const catalog = await (await fetch(catalogURL)).json();
const sdkURL = new URL(catalog.package.url, catalogURL);
const canonicalDemo = catalog.aliases?.[selectedDemo] ?? selectedDemo;
const recipeURL = new URL(
  catalog.recipes.find(item => item.id === canonicalDemo).recipe,
  catalogURL,
);
```

For a local file/archive, resolve the same relative paths on disk; browser `fetch(file:)` is not the installation method. Serve examples through the application's existing HTTP server. Keep URLs provided by the current deployment: do not invent `/agent/`, strip a subpath, or reuse a tailnet address from another session.

## Native SDK: lab

Download the exact `package.url` file and verify its byte count and SHA-256 against the catalog. On macOS/Linux, `shasum -a 256 <downloaded-file>` computes the hash. Inspect the package manifest and use the application's existing package manager with lifecycle scripts disabled. With npm and the current filename:

```sh
npm install --ignore-scripts ./tflip-motion-0.3.1.tgz
```

Use the filename/version from the catalog if it differs. Do not run `npm install @tflip/motion` against the registry: this package is private and unpublished. The SDK is MIT licensed and declares Node >=20 for consumers. Source development uses the newer Node versions documented in the repository README. React is an optional peer (>=18 <20); vanilla usage does not require React. Do not replace an application's framework to satisfy the example.

Imports: `@tflip/motion/core`, `/dom`, `/effects`, `/react`. The tarball contains built ESM, declarations, and its detailed API reference. Read specific types only when the concise [SDK contract](./sdk.md) is insufficient.

## Upgrading an existing installation

Download the current tarball, inspect it, and update the application dependency and imports to `@tflip/motion` together. Version 0.3.1 uses only `data-tflip-*`, `--tflip-scene-height`, `tflip:languagechange`, `tflip:themechange`, `tflip.language`, and `tflip.theme`. Earlier branding selectors, preference keys, events, Skill paths and download URLs are retired from the current site. Historical package bytes are preserved in the local release archive. Apply the [configuration migration](./config.md) separately; the two-shot Stunt remains unchanged.

## Gallery / vehicle scenes

If the extracted skill bundle already contains `examples/` and `runtime/`, reuse them directly. Its local catalog intentionally has `downloads: {}`; do not request a missing examples ZIP or another network download.

Otherwise download `downloads.examples.url` from the website catalog and verify its hash. Extract `tflip-examples/` as a unit: `examples/`, `runtime/`, and its `index.html` stay together. Serve or copy that directory to an application-owned static location. Example modules import the sibling runtime; CSS is a separate `style.css` beside each example entry. No npm installation is needed for this bundle.

Recipe snippets assume an HTML file at the archive root, beside `examples/` and `runtime/`. For another application route, adjust imports and stylesheet URLs to the chosen local asset base. Do not hotlink private preview modules into a production application. These are mountable examples, not additional SDK exports.

The skill archive instead has root `tflip/` containing `SKILL.md`, documentation, `examples/`, `runtime/`, and the SDK tarball under `downloads/`; its local catalog describes those local files. It does not contain recursive copies of the ZIP downloads.

A private preview requires network access to that deployment, often the user's tailnet. If unavailable, request the catalog and matching archive as attachments or use the supplied local bundle. Report the precise inaccessible resource; do not fabricate a replacement source. An archive's hash establishes integrity relative to the supplied catalog, not a public license or independent signature.
