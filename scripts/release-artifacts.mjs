import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { createRootEntry } from './site-entry.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const generator = 'tflip-static-release-v1';
// One rule avoids Cloudflare joining conflicting Cache-Control values when
// several patterns match. Version queries bypass fresh legacy browser entries.
const cacheHeaders = '/*\n  Cache-Control: no-cache, max-age=0, must-revalidate\n';

function versionResourceURL(value, owner, files, revision, allowBare = false) {
  if (typeof value !== 'string' || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return value;
  if (!allowBare && !/^\.{1,2}\//.test(value)) return value;
  const match = /^([^?#]+)(?:\?([^#]*))?(#.*)?$/.exec(value);
  if (!match || !/\.(?:m?js|css|json)$/i.test(match[1])) return value;
  const pathname = decodeURIComponent(match[1]);
  const target = pathname.startsWith('/') ? posix.normalize(pathname.slice(1)) : posix.normalize(posix.join(posix.dirname(owner), pathname));
  validateAssetPath(target);
  if (!files.has(target)) throw new Error(`Missing static dependency: ${owner} → ${value}`);
  const query = new URLSearchParams(match[2] ?? '');
  query.set('v', revision);
  return `${match[1]}?${query}${match[3] ?? ''}`;
}

function versionJavaScript(source, owner, files, revision) {
  const syntax = ts.createSourceFile(owner, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const changes = [];
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      const call = ts.isCallExpression(parent) && parent.arguments[0] === node;
      const fetchArgument = call && (ts.isIdentifier(parent.expression) && parent.expression.text === 'fetch' || ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === 'fetch');
      const urlArgument = ts.isNewExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'URL' && parent.arguments?.[0] === node;
      const value = versionResourceURL(node.text, owner, files, revision, fetchArgument || urlArgument);
      if (value !== node.text) changes.push({ start: node.getStart(syntax), end: node.end, value: JSON.stringify(value) });
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  for (const change of changes.sort((a, b) => b.start - a.start)) source = source.slice(0, change.start) + change.value + source.slice(change.end);
  return source;
}

function versionCSS(source, owner, files, revision) {
  const url = value => versionResourceURL(value, owner, files, revision, true);
  return source
    .replace(/\burl\(\s*(?:(['"])(.*?)\1|([^'"\s][^)]*?))\s*\)/gi, (match, quote, quoted, bare) => {
      const value = (quoted ?? bare).trim();
      const changed = url(value);
      return changed === value ? match : `url(${JSON.stringify(changed)})`;
    })
    .replace(/(@import\s+)(['"])([^'"]+)\2/gi, (match, prefix, quote, value) => `${prefix}${quote}${url(value)}${quote}`);
}

function versionStaticFile(bytes, owner, files, revision) {
  let source = bytes.toString('utf8');
  if (/\.m?js$/.test(owner)) source = versionJavaScript(source, owner, files, revision);
  else if (/\.css$/.test(owner)) source = versionCSS(source, owner, files, revision);
  else if (/\.html$/.test(owner)) {
    source = source.replace(/\b(src|href)(\s*=\s*)(['"])(.*?)\3/gi, (match, attribute, assignment, quote, value) => {
      const decoded = value.replaceAll('&amp;', '&');
      const changed = versionResourceURL(decoded, owner, files, revision, true);
      return changed === decoded ? match : `${attribute}${assignment}${quote}${changed.replaceAll('&', '&amp;')}${quote}`;
    });
    source = source.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (match, open, body, close) => `${open}${versionJavaScript(body, owner, files, revision)}${close}`);
    source = source.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (match, open, body, close) => `${open}${versionCSS(body, owner, files, revision)}${close}`);
  } else if (/\.json$/.test(owner)) {
    const walk = value => typeof value === 'string' ? versionResourceURL(value, owner, files, revision) : Array.isArray(value) ? value.map(walk) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)])) : value;
    source = JSON.stringify(walk(JSON.parse(source)), null, 2) + '\n';
  } else return bytes;
  return Buffer.from(source);
}

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
    ['playground', /\.(html|js|css|json|png|jpe?g|webp|svg)$/],
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
    const inputs = new Map();
    for (const path of paths.sort()) inputs.set(path, await readFile(join(root, path)));
    inputs.set('index.html', Buffer.from(createRootEntry(inputs.get('playground/index.html').toString('utf8'))));
    inputs.set('_headers', Buffer.from(cacheHeaders));
    const sourceInputs = [...inputs].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: hash(bytes), ...(['index.html', '_headers'].includes(path) ? { generated: true } : {}) }));
    const transformerSha256 = hash(await readFile(fileURLToPath(import.meta.url)));
    const assetRevision = hash(JSON.stringify({ transformerSha256, sourceInputs })).slice(0, 20);
    const assets = [];
    for (const [path, input] of inputs) {
      const bytes = versionStaticFile(input, path, inputs, assetRevision);
      await mkdir(dirname(join(stage, path)), { recursive: true });
      await writeFile(join(stage, path), bytes);
      assets.push({ path, bytes: bytes.length, sha256: hash(bytes), localCopyVerified: true, sourceSha256: hash(input), transformed: !bytes.equals(input), ...(path === '_headers' ? { served: false, role: 'hosting-configuration' } : {}) });
    }
    assets.sort((a, b) => a.path.localeCompare(b.path));
    await verifyOutput(stage, assets);
    const manifest = {
      generator, schemaVersion: 1, updatedAt: new Date().toISOString(), previewPath: './',
      agentEntry: './agent/index.md', contentRevision: catalog.contentRevision, assetRevision, transformerSha256, sourceInputs,
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
    return { directory: 'tailnet-preview', files: assets.length, contentRevision: catalog.contentRevision, assetRevision };
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
      createdAt: new Date().toISOString(), source, contentRevision: catalog.contentRevision, assetRevision: staticManifest.assetRevision,
      transformerSha256: staticManifest.transformerSha256, staticSourceInputs: staticManifest.sourceInputs,
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
