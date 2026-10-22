import { readFile, writeFile, mkdir, readdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Build only local, reviewed sources. No install, network, publishing or host URLs.
const root = fileURLToPath(new URL('..', import.meta.url));
const kit = join(root, 'agent');
const work = join(root, 'test-results/agent-build');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const configurationSchema = JSON.parse(await readFile(join(kit, 'configuration.schema.json'), 'utf8'));
const licenseFiles = (await readdir(root, { withFileTypes: true })).filter(entry => {
  if (!/^LICEN[CS]E(?:\.(?:md|txt))?$/i.test(entry.name)) return false;
  if (!entry.isFile()) throw new Error(`License must be a regular file: ${entry.name}`);
  return true;
}).map(entry => entry.name).sort();
async function copyLicenses(to) {
  for (const name of licenseFiles) await cp(join(root, name), join(to, name));
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJSON = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
async function files(path) {
  const result = [];
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await files(child));
    else if (entry.isFile()) result.push(child);
    else throw new Error(`Unsupported artifact entry: ${child}`);
  }
  return result;
}
async function copyRuntime(to) {
  for (const source of await files(join(root, 'dist'))) {
    if (!source.endsWith('.js') && !source.endsWith('.d.ts')) continue;
    const destination = join(to, relative(join(root, 'dist'), source));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, (await readFile(source, 'utf8')).replace(/^\/\/# sourceMappingURL=.*$/gm, ''));
  }
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
function zip(source, destination) {
  // Stable archive entries, with one portable top-level directory.
  run('python3', ['-c', `import pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
 for path in sorted(root.rglob('*')):
  if path.is_file():
   item=zipfile.ZipInfo(str(path.relative_to(root.parent)),(2020,1,1,0,0,0))
   item.compress_type=zipfile.ZIP_DEFLATED; item.external_attr=0o100644 << 16
   archive.writestr(item,path.read_bytes())`, source, destination], root);
}
async function artifact(path) {
  const bytes = await readFile(path);
  return { url: './' + relative(kit, path).split('\\').join('/'), sha256: digest(bytes), bytes: bytes.length };
}

await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
await rm(join(kit, 'downloads'), { recursive: true, force: true });
await mkdir(join(kit, 'downloads'), { recursive: true });
await rm(join(kit, 'runtime'), { recursive: true, force: true });
await copyRuntime(join(kit, 'runtime'));
// These are pure renderers; the page controllers and global i18n are excluded.
for (const name of ['stunt-motion.js', 'stunt-scene.js', 'roadster-geometry.js', 'roadster-motion.js', 'ramp-motion.js', 'roadster-scene.js', 'ramp-scene.js']) {
  await cp(join(root, 'playground', name), join(kit, 'examples/featured', name));
}

const sdkStage = join(work, 'sdk');
await mkdir(sdkStage, { recursive: true });
// The source workspace stays private; the canonical consumer SDK is public.
const { scripts, devDependencies, files: ignoredFiles, private: sourcePrivate, ...metadata } = pkg;
await writeJSON(join(sdkStage, 'package.json'), { ...metadata, engines: { node: '>=20' }, files: ['dist', 'README.md', 'API.md', ...licenseFiles] });
await copyRuntime(join(sdkStage, 'dist'));
await cp(join(root, 'docs/API.md'), join(sdkStage, 'API.md'));
await copyLicenses(sdkStage);
const sdkFilename = `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`;
const licenseNotice = licenseFiles.length ? `The included ${licenseFiles.map(name => `[${name}](${name})`).join(', ')} contains the applicable terms.` : 'No license text is included. This package does not establish public reuse rights.';
// Keep the checked-in guide readable; rebase its links and release metadata for
// the standalone package, whose README lives beside API.md and dist/.
const sdkReadme = (await readFile(join(root, 'docs/SDK_README.md'), 'utf8'))
  .replace(/^# Tflip .+$/m, `# Tflip ${pkg.version}`)
  .replace(/^npm install --ignore-scripts \.\/[^\s]+\.tgz$/m, `npm install --ignore-scripts ./${sdkFilename}`)
  .replace(/Package license identifier: `[^`]+`\./, `Package license identifier: \`${pkg.license}\`.`)
  .replace(/^The included .+ contains the applicable terms\.$/m, licenseNotice)
  .replaceAll('(../dist/', '(dist/');
await writeFile(join(sdkStage, 'README.md'), sdkReadme);
const packed = JSON.parse(run('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', join(work, 'npm-cache'), '--pack-destination', join(kit, 'downloads')], sdkStage))[0];
const sdk = { name: pkg.name, version: pkg.version, ...await artifact(join(kit, 'downloads', packed.filename)), published: false, license: pkg.license };
// Publication is confirmed by a checked-in registry readback, never inferred
// from a successful local build or inherited by a different version/archive.
const publication = await readFile(join(root, 'npm-publication.json'), 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return undefined;
  throw error;
});
sdk.published = publication?.name === sdk.name && publication.version === sdk.version
  && publication.registry === pkg.publishConfig.registry && publication.bytes === sdk.bytes
  && publication.sha256 === sdk.sha256;

const recipes = ['lab', 'orbit', 'portal', 'vinyl', 'candy', 'arcade', 'paper', 'stunt'].map(id => ({
  id, kind: id === 'lab' ? 'sdk' : id === 'stunt' ? 'canvas-scene' : 'composition',
  recipe: `./recipes/${id}.md`,
}));
const examplesStage = join(work, 'tflip-examples');
await mkdir(examplesStage, { recursive: true });
await cp(join(kit, 'examples'), join(examplesStage, 'examples'), { recursive: true });
await cp(join(kit, 'runtime'), join(examplesStage, 'runtime'), { recursive: true });
await copyLicenses(examplesStage);
await writeFile(join(examplesStage, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./examples/index.html"><a href="./examples/index.html">Open examples</a>');
await writeFile(join(examplesStage, 'README.txt'), `Tflip examples ${pkg.version}\nServe this folder using your existing local HTTP server and open examples/index.html.\nPreserve examples/ and runtime/ as siblings. File URLs are not supported by browser ES modules.\nThese examples are separate from SDK presets; license remains ${pkg.license}.\n`);
const exampleFile = join(kit, 'downloads', `tflip-examples-${pkg.version}.zip`);
zip(examplesStage, exampleFile);

const sourceFiles = [...await files(join(kit, 'recipes')), ...await files(join(kit, 'references')), ...await files(join(kit, 'examples')), ...await files(join(kit, 'runtime')), join(kit, 'configuration.schema.json'), join(kit, 'index.md'), join(kit, 'tflip/SKILL.md')];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.sort().map(async path => [relative(kit, path), digest(await readFile(path))])));
const licenseHashes = Object.fromEntries(await Promise.all(licenseFiles.map(async name => [name, digest(await readFile(join(root, name)))])));
const contentRevision = digest(JSON.stringify({ version: pkg.version, sdk: sdk.sha256, sourceHashes, licenseHashes })).slice(0, 16);
const catalog = { schemaVersion: 1, contentRevision, package: sdk,
  docs: { entry: './index.md', skill: './tflip/SKILL.md', configuration: './configuration.schema.json', api: './references/sdk.md' },
  downloads: { examples: await artifact(exampleFile) }, recipes,
  aliases: { roadster: 'stunt', ramp: 'stunt' },
  scenes: { stunt: { durationMs: 13800, transition: 'cut',
    shots: [{ id: 'ramp', offsetMs: 0, durationMs: 8000 }, { id: 'roadster', offsetMs: 8000, durationMs: 5800 }] } },
  configuration: { schemaVersion: 1, sdkVersion: pkg.version, acceptedLegacySdkVersions: configurationSchema.properties.sdkVersion.enum.filter(version => version !== pkg.version),
    migration: 'Validate v1 data, preserve the original, map legacy roadster/ramp IDs to stunt, and explicitly upgrade sdkVersion to the current package version. Stunt is now two independent shots with a direct cut at 8000ms of 13800ms. Unknown versions require review.' },
  urlResolution: 'Resolve URLs relative to this catalog URL. Preserve the current deployment prefix; no fixed host is required.',
};
const skillStage = join(work, 'tflip');
await mkdir(skillStage, { recursive: true });
await copyLicenses(skillStage);
for (const directory of ['recipes', 'references', 'examples', 'runtime']) await cp(join(kit, directory), join(skillStage, directory), { recursive: true });
for (const name of ['configuration.schema.json']) await cp(join(kit, name), join(skillStage, name));
await writeFile(join(skillStage, 'SKILL.md'), (await readFile(join(kit, 'tflip/SKILL.md'), 'utf8')).replaceAll('../', './'));
await writeFile(join(skillStage, 'index.md'), (await readFile(join(kit, 'index.md'), 'utf8')).replaceAll('./tflip/SKILL.md', './SKILL.md'));
await mkdir(join(skillStage, 'downloads'), { recursive: true });
await cp(join(kit, 'downloads', packed.filename), join(skillStage, 'downloads', packed.filename));
await writeJSON(join(skillStage, 'catalog.json'), { ...catalog, docs: { ...catalog.docs, skill: './SKILL.md' }, downloads: {}, bundled: { examples: './examples/index.html' } });
const skillFile = join(kit, 'downloads', `tflip-skill-${pkg.version}.zip`);
zip(skillStage, skillFile);
catalog.downloads.skill = await artifact(skillFile);
await writeJSON(join(kit, 'catalog.json'), catalog);
await writeJSON(join(root, 'test-results/agent-build-manifest.json'), { contentRevision: catalog.contentRevision, sourceHashes, licenseHashes, package: sdk, downloads: catalog.downloads });
console.log(JSON.stringify({ version: pkg.version, revision: catalog.contentRevision, recipes: recipes.length, package: sdk.bytes, examples: catalog.downloads.examples.bytes, skill: catalog.downloads.skill.bytes }));
