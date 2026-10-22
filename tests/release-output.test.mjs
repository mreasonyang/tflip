import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { syncStaticOutput, createReleaseArtifacts } from '../scripts/release-artifacts.mjs';
import { copyCanonicalSdk } from '../scripts/pack-local.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await mkdtemp('/tmp/tflip-release-output-');
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['playground', 'dist', 'agent/downloads']) await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, 'llms.txt'), 'Tflip');
  await writeFile(join(root, 'LICENSE'), 'Fixture license bytes');
  await writeFile(join(root, '404.html'), '<!doctype html><title>404</title><h1>Not found</h1>');
  await writeFile(join(root, 'playground/index.html'), '<!doctype html><script src="./app.js"></script>');
  await writeFile(join(root, 'playground/app.js'), 'export {};');
  const sdk = Buffer.from('fixture SDK bytes');
  await writeFile(join(root, 'agent/downloads/kyun.si-tflip-1.2.3.tgz'), sdk);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@kyun.si/tflip', version: '1.2.3' }));
  await writeFile(join(root, 'agent/catalog.json'), JSON.stringify({ contentRevision: 'fixture', downloads: {}, package: {
    name: '@kyun.si/tflip', version: '1.2.3', url: './downloads/kyun.si-tflip-1.2.3.tgz', bytes: sdk.length, sha256: hash(sdk),
  } }));
  return root;
}

test('a clean staged release removes retired assets and precisely manifests every output file', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'agent/downloads/retired.tgz'), 'old version');
  await syncStaticOutput(root);
  await rm(join(root, 'agent/downloads/retired.tgz'));
  await writeFile(join(root, 'playground/app.js'), 'export const changed = true;');
  await syncStaticOutput(root);
  await assert.rejects(readFile(join(root, 'tailnet-preview/agent/downloads/retired.tgz')), { code: 'ENOENT' });
  assert.equal(await readFile(join(root, 'tailnet-preview/playground/app.js'), 'utf8'), 'export const changed = true;');
  const manifest = JSON.parse(await readFile(join(root, 'test-results/tailnet-preview-manifest.json'), 'utf8'));
  const files = (await readdir(join(root, 'tailnet-preview'), { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name).slice(join(root, 'tailnet-preview').length + 1)).sort();
  assert.deepEqual(manifest.assets.map(asset => asset.path).sort(), files);
  assert.ok(files.includes('404.html'));
  assert.ok(files.includes('LICENSE'));
  for (const asset of manifest.assets) assert.equal(hash(await readFile(join(root, 'tailnet-preview', asset.path))), asset.sha256);
});

test('one revision covers HTML, nested modules, CSS and JSON without changing canonical downloads', async t => {
  const root = await fixture(t);
  const sources = {
    'playground/index.html': '<link rel="stylesheet" href="./style.css"><script type="module" src="./app.js"></script><a href="../agent/catalog.json">Catalog</a>',
    'playground/app.js': "import './nested.js'; export { value } from '../dist/core.js'; const later = () => import('./nested.js'); fetch(new URL('../agent/catalog.json', import.meta.url)); fetch('settings.json');",
    'playground/nested.js': "import { value } from '../dist/core.js'; export { value };",
    'playground/style.css': '@import "./extra.css"; @import url("./extra.css?theme=dark#theme");',
    'playground/extra.css': 'body { color: black; }',
    'playground/settings.json': '{"module":"./nested.js","theme":"./extra.css"}',
    'dist/core.js': 'export const value = 1;',
    'agent/examples/index.html': '<link rel="stylesheet" href="./style.css"><script type="module" src="./entry.js"></script>',
    'agent/examples/entry.js': "import '../runtime/index.js';",
    'agent/examples/style.css': 'body { color: black; }',
    'agent/runtime/index.js': "export { value } from '../../dist/core.js';",
  };
  for (const [path, bytes] of Object.entries(sources)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), bytes);
  }
  const first = await syncStaticOutput(root);
  assert.match(first.assetRevision, /^[a-f0-9]{20}$/);
  const read = path => readFile(join(root, 'tailnet-preview', path), 'utf8');
  const version = `v=${first.assetRevision}`;
  for (const path of ['index.html', 'playground/index.html', 'playground/app.js', 'playground/nested.js', 'playground/style.css', 'playground/settings.json', 'agent/examples/index.html', 'agent/examples/entry.js', 'agent/runtime/index.js']) {
    assert.ok((await read(path)).includes(version), `${path} has versioned dependencies`);
  }
  assert.ok((await read('playground/app.js')).includes(`settings.json?${version}`));
  assert.ok((await read('playground/style.css')).includes(`extra.css?theme=dark&${version}#theme`));
  const catalog = JSON.parse(await read('agent/catalog.json'));
  assert.equal(catalog.package.url, './downloads/kyun.si-tflip-1.2.3.tgz');
  assert.equal(await read('agent/downloads/kyun.si-tflip-1.2.3.tgz'), 'fixture SDK bytes');
  assert.equal(await read('_headers'), '/*\n  Cache-Control: no-cache, max-age=0, must-revalidate\n');
  const manifest = JSON.parse(await readFile(join(root, 'test-results/tailnet-preview-manifest.json'), 'utf8'));
  assert.equal(manifest.assets.find(asset => asset.path === '_headers').served, false);
  assert.equal(manifest.assetRevision, first.assetRevision);
  for (const [path, bytes] of Object.entries(sources)) assert.equal(await readFile(join(root, path), 'utf8'), bytes, 'Source is never rewritten');
  assert.equal((await syncStaticOutput(root)).assetRevision, first.assetRevision, 'Identical inputs produce a stable revision');
  await writeFile(join(root, 'playground/extra.css'), 'body { color: blue; }');
  const changed = await syncStaticOutput(root);
  assert.notEqual(changed.assetRevision, first.assetRevision, 'A nested resource change updates the whole graph revision');
  assert.ok((await read('index.html')).includes(`v=${changed.assetRevision}`));
  assert.ok((await read('agent/runtime/index.js')).includes(`v=${changed.assetRevision}`));
});

test('untracked output files prevent replacement and are preserved', async t => {
  const root = await fixture(t);
  await syncStaticOutput(root);
  await writeFile(join(root, 'tailnet-preview/operator-notes.txt'), 'preserve me');
  await assert.rejects(syncStaticOutput(root), /untracked files/);
  assert.equal(await readFile(join(root, 'tailnet-preview/operator-notes.txt'), 'utf8'), 'preserve me');
});

test('modified managed output is preserved instead of silently deleted', async t => {
  const root = await fixture(t);
  await syncStaticOutput(root);
  await writeFile(join(root, 'tailnet-preview/index.html'), 'manual change');
  await assert.rejects(syncStaticOutput(root), /modified output/);
  assert.equal(await readFile(join(root, 'tailnet-preview/index.html'), 'utf8'), 'manual change');
});

for (const location of ['tailnet-preview', 'test-results', 'playground/linked.js']) {
  test(`release refuses symbolic path ${location} without touching its target`, async t => {
    const root = await fixture(t);
    const outside = await mkdtemp('/tmp/tflip-release-outside-');
    t.after(() => rm(outside, { recursive: true, force: true }));
    await writeFile(join(outside, 'keep.txt'), 'unchanged');
    await symlink(location.endsWith('.js') ? join(outside, 'keep.txt') : outside, join(root, location));
    await assert.rejects(syncStaticOutput(root), /symbolic or special path/);
    assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'unchanged');
  });
}

test('ownership manifests cannot authorize paths outside the output', async t => {
  const root = await fixture(t);
  await syncStaticOutput(root);
  const path = join(root, 'test-results/tailnet-preview-manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.assets[0].path = '../package.json';
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(syncStaticOutput(root), /unsafe asset path/);
});

test('pack:local copies canonical SDK bytes and refuses a corrupted source', async t => {
  const root = await fixture(t);
  const result = await copyCanonicalSdk(root);
  assert.equal(result.version, '1.2.3');
  const destination = join(root, result.filename);
  const source = join(root, 'agent/downloads', result.filename);
  assert.deepEqual(await readFile(destination), await readFile(source));
  await writeFile(source, 'corrupt');
  await assert.rejects(copyCanonicalSdk(root), /does not match its catalog/);
  assert.equal(await readFile(destination, 'utf8'), 'fixture SDK bytes');
});

test('pack:local rejects symlink destinations without writing through them', async t => {
  const root = await fixture(t);
  const outside = join(root, 'keep.txt');
  await writeFile(outside, 'unchanged');
  await symlink(outside, join(root, 'kyun.si-tflip-1.2.3.tgz'));
  await assert.rejects(copyCanonicalSdk(root), /Unsafe package path/);
  assert.equal(await readFile(outside, 'utf8'), 'unchanged');
});

test('release archives bind exact static files and downloads to version and Git revision', async t => {
  const root = await fixture(t);
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=Tflip Test', '-c', 'user.email=tflip-test@example.invalid', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' }).trim();
  await writeFile(join(root, '.gitignore'), 'tailnet-preview/\ntest-results/\nrelease-artifacts/\n');
  git('init', '-q', '--initial-branch=main');
  git('add', '.');
  git('commit', '-q', '-m', 'Fixture source');
  await syncStaticOutput(root);
  const result = await createReleaseArtifacts(root);
  const manifest = JSON.parse(await readFile(join(result.directory, 'release-manifest.json'), 'utf8'));
  assert.equal(manifest.version, '1.2.3');
  assert.equal(manifest.source.commit, git('rev-parse', 'HEAD'));
  assert.equal(manifest.source.dirty, false);
  assert.equal(manifest.releaseReady, true);
  for (const artifact of manifest.artifacts) assert.equal(hash(await readFile(join(result.directory, artifact.path))), artifact.sha256);
  const entries = JSON.parse(execFileSync('python3', ['-c', 'import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z: print(json.dumps(sorted(z.namelist())))', join(result.directory, 'tflip-site-1.2.3.zip')], { encoding: 'utf8' }));
  assert.deepEqual(entries, manifest.staticAssets.map(asset => asset.path).sort());
  assert.ok(entries.includes('404.html'));
  assert.ok(entries.includes('LICENSE'));
});
