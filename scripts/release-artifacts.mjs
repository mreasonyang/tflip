import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRootEntry } from './site-entry.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const generator = 'tflip-static-release-v1';

async function inspect(path, kind, optional = false) {
  let entry;
  try { entry = await lstat(path); } catch (error) {
    if (optional && error.code === 'ENOENT') return false;
    throw error;
  }
  if (entry.isSymbolicLink() || !(kind === 'directory' ? entry.isDirectory() : entry.isFile())) {
    throw new Error(`Expected a regular ${kind}; refusing symbolic or special path: ${path}`);
  }
  return true;
}

async function inventory(directory, prefix = '') {
  await inspect(directory, 'directory');
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await inventory(absolute, relative));
    else {
      await inspect(absolute, 'file');
      result.push(relative);
    }
  }
  return result;
}

function validateAssetPath(path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..') || posix.normalize(path) !== path) {
    throw new Error('Manifest contains an unsafe asset path');
  }
}

async function verifyOutput(directory, assets) {
  if (!Array.isArray(assets) || assets.length === 0) throw new Error('Missing ownership asset manifest');
  const expected = new Map();
  for (const asset of assets) {
    validateAssetPath(asset.path);
    if (expected.has(asset.path) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error('Invalid ownership asset manifest');
    }
    expected.set(asset.path, asset);
  }
  const actual = await inventory(directory);
  if (actual.length !== expected.size || actual.some(path => !expected.has(path))) {
    throw new Error('Refusing to replace output with untracked files; preserve or review them first');
  }
  for (const path of actual) {
    const bytes = await readFile(join(directory, path));
    const asset = expected.get(path);
    if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) {
      throw new Error(`Refusing to replace modified output: ${path}`);
    }
  }
}

async function verifyOwnedOutput(output, manifestPath) {
  if (!await inspect(output, 'directory', true)) return false;
  await inspect(manifestPath, 'file');
  const previous = JSON.parse(await readFile(manifestPath, 'utf8'));
  // Adopt the earlier synchronizer's output only when its exact bytes still
  // match the complete ownership manifest.
  if ((previous.generator && previous.generator !== generator) || previous.previewPath !== './' || previous.agentEntry !== './agent/index.md' || typeof previous.contentRevision !== 'string') {
    throw new Error('Refusing to replace an output without a recognized Tflip ownership manifest');
  }
  await verifyOutput(output, previous.assets);
  return true;
}

/** Build a complete verified tree; replace only this project's owned output. */
export async function syncStaticOutput(projectRoot) {
  const root = await realpath(projectRoot);
  await inspect(root, 'directory');
  const output = join(root, 'tailnet-preview');
  const results = join(root, 'test-results');
  if (!await inspect(results, 'directory', true)) await mkdir(results);
  const manifestPath = join(results, 'tailnet-preview-manifest.json');
  await inspect(manifestPath, 'file', true);
  await verifyOwnedOutput(output, manifestPath);
  const paths = ['llms.txt', '404.html'];
  for (const name of await readdir(root)) {
    if (/^LICEN[CS]E(?:\.(?:md|txt))?$/i.test(name)) {
      await inspect(join(root, name), 'file');
      paths.push(name);
    }
  }
  for (const [directory, accept] of [
    ['playground', /\.(html|js|css)$/],
    ['dist', /\.js$/],
    ['agent', /\.(md|json|js|css|html|ts|tgz|zip)$/],
  ]) {
    for (const file of await inventory(join(root, directory))) {
      if (accept.test(file)) paths.push(`${directory}/${file}`);
    }
  }
  await inspect(join(root, 'llms.txt'), 'file');
  await inspect(join(root, '404.html'), 'file');
  const catalog = JSON.parse(await readFile(join(root, 'agent/catalog.json'), 'utf8'));
  const transaction = await mkdtemp(join(root, '.tflip-preview-stage-'));
  const stage = join(transaction, 'next');
  const previous = join(transaction, 'previous');
  await mkdir(stage);
  let movedPrevious = false;
  let movedNext = false;
  let committed = false;
  try {
    const assets = [];
    for (const path of paths.sort()) {
      const bytes = await readFile(join(root, path));
      await mkdir(dirname(join(stage, path)), { recursive: true });
      await writeFile(join(stage, path), bytes);
      assets.push({ path, bytes: bytes.length, sha256: hash(bytes), localCopyVerified: true });
    }
    const entry = Buffer.from(createRootEntry(await readFile(join(root, 'playground/index.html'), 'utf8')));
    await writeFile(join(stage, 'index.html'), entry);
    assets.push({ path: 'index.html', bytes: entry.length, sha256: hash(entry), localCopyVerified: true });
    assets.sort((a, b) => a.path.localeCompare(b.path));
    await verifyOutput(stage, assets);
    const manifest = {
      generator, schemaVersion: 1, updatedAt: new Date().toISOString(), previewPath: './',
      agentEntry: './agent/index.md', contentRevision: catalog.contentRevision,
      scope: 'Complete static playground, reusable runtime, agent documentation, versioned downloads and HTTP 404 page. No host or network configuration.',
      assets, verification: { localCopiesMatch: true, exactFileSet: true, remoteUserDeviceVerified: false },
    };
    const nextManifest = join(transaction, 'manifest.json');
    await writeFile(nextManifest, JSON.stringify(manifest, null, 2) + '\n');
    if (await verifyOwnedOutput(output, manifestPath)) {
      await rename(output, previous);
      movedPrevious = true;
    }
    await rename(stage, output);
    movedNext = true;
    await rename(nextManifest, manifestPath);
    committed = true;
    return { directory: 'tailnet-preview', files: assets.length, contentRevision: catalog.contentRevision };
  } catch (error) {
    if (!committed) {
      if (movedNext) await rename(output, stage);
      if (movedPrevious) await rename(previous, output);
    }
    throw error;
  } finally {
    // Delete only our fresh transaction directory. Preserve an unrestored backup.
    if (committed || !await inspect(previous, 'directory', true)) await rm(transaction, { recursive: true, force: true });
  }
}

/** Package already-verified output without publishing it or changing Git state. */
export async function createReleaseArtifacts(projectRoot) {
  const root = await realpath(projectRoot);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!/^[0-9A-Za-z.-]+$/.test(pkg.version)) throw new Error('Unsafe release version');
  await inspect(join(root, 'test-results'), 'directory');
  const manifestPath = join(root, 'test-results/tailnet-preview-manifest.json');
  if (!await verifyOwnedOutput(join(root, 'tailnet-preview'), manifestPath)) throw new Error('Synchronize the static output before packaging a release');
  const staticManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const catalog = JSON.parse(await readFile(join(root, 'tailnet-preview/agent/catalog.json'), 'utf8'));
  if (catalog.package.version !== pkg.version || catalog.package.name !== pkg.name) throw new Error('Static output does not match the package version');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const source = { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), dirty: git('status', '--porcelain').length > 0 };
  const releases = join(root, 'release-artifacts');
  if (!await inspect(releases, 'directory', true)) await mkdir(releases);
  const destination = await mkdtemp(join(releases, `tflip-${pkg.version}-`));
  try {
    const artifacts = [];
    const record = async filename => {
      const bytes = await readFile(join(destination, filename));
      artifacts.push({ path: filename, bytes: bytes.length, sha256: hash(bytes) });
    };
    const siteFilename = `tflip-site-${pkg.version}.zip`;
    execFileSync('python3', ['-c', `import json,pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
 for name in sorted(json.load(sys.stdin)):
  item=zipfile.ZipInfo(name,(2020,1,1,0,0,0)); item.compress_type=zipfile.ZIP_DEFLATED; item.external_attr=0o100644 << 16
  archive.writestr(item,(root/name).read_bytes())`, join(root, 'tailnet-preview'), join(destination, siteFilename)], {
      input: JSON.stringify(staticManifest.assets.map(asset => asset.path)), encoding: 'utf8',
    });
    await record(siteFilename);
    for (const item of [catalog.package, ...Object.values(catalog.downloads)]) {
      if (!/^\.\/downloads\/[A-Za-z0-9_.-]+$/.test(item.url)) throw new Error('Unsafe release download URL');
      const filename = item.url.slice('./downloads/'.length);
      const bytes = await readFile(join(root, 'tailnet-preview/agent/downloads', filename));
      if (bytes.length !== item.bytes || hash(bytes) !== item.sha256) throw new Error(`Download integrity mismatch: ${filename}`);
      await writeFile(join(destination, filename), bytes);
      await record(filename);
    }
    // Verify that packaging did not race another output update.
    await verifyOutput(join(root, 'tailnet-preview'), staticManifest.assets);
    if (git('rev-parse', 'HEAD') !== source.commit || (git('status', '--porcelain').length > 0) !== source.dirty) {
      throw new Error('Source revision changed during release packaging; retry from a stable checkout');
    }
    const manifest = {
      schemaVersion: 1, product: 'Tflip', package: pkg.name, version: pkg.version, license: pkg.license,
      createdAt: new Date().toISOString(), source, contentRevision: catalog.contentRevision,
      releaseReady: !source.dirty,
      evidenceBoundary: 'Local archives only. Dirty source is a candidate build; no hosting deployment or user-device acceptance is implied.',
      artifacts, staticAssets: staticManifest.assets,
    };
    await writeFile(join(destination, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return { directory: destination, version: pkg.version, source, artifacts: artifacts.length, manifest: 'release-manifest.json' };
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await createReleaseArtifacts(fileURLToPath(new URL('..', import.meta.url)))));
}
