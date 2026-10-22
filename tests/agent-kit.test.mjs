import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const kit = resolve(root, 'agent');
const catalog = JSON.parse(await readFile(resolve(kit, 'catalog.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function walk(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) result.push(...await walk(path)); else result.push(path);
  }
  return result;
}
function localPath(value, base = kit) {
  assert.ok(value.startsWith('./') || value.startsWith('../'), `Relative artifact URL: ${value}`);
  assert.ok(!value.includes('\\'), 'URL path uses forward slashes');
  const target = resolve(base, value.split('#')[0]);
  assert.ok(target.startsWith(kit + '/'), 'Artifact cannot escape kit');
  return target;
}

test('Tflip catalog exposes eight canonical recipes, aliases and verified local artifacts', async () => {
  const source = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  assert.equal(catalog.package.version, source.version);
  assert.equal(catalog.package.published, false);
  assert.equal(catalog.package.name, '@kyun.si/tflip');
  assert.equal(catalog.recipes.length, 8);
  assert.deepEqual(catalog.recipes.map(item => item.id), ['lab', 'orbit', 'portal', 'vinyl', 'candy', 'arcade', 'paper', 'stunt']);
  assert.equal(new Set(catalog.recipes.map(item => item.id)).size, 8);
  assert.deepEqual(catalog.aliases, { roadster: 'stunt', ramp: 'stunt' });
  assert.equal(catalog.docs.skill, './tflip/SKILL.md');
  assert.equal(catalog.recipes.find(item => item.id === 'lab').kind, 'sdk');
  assert.equal(catalog.recipes.find(item => item.id === 'stunt').kind, 'canvas-scene');
  assert.deepEqual(catalog.scenes.stunt, { durationMs: 13800, transition: 'cut', shots: [
    { id: 'ramp', offsetMs: 0, durationMs: 8000 },
    { id: 'roadster', offsetMs: 8000, durationMs: 5800 },
  ] });
  for (const id of Object.keys(catalog.aliases)) assert.ok((await stat(localPath(`./recipes/${id}.md`))).isFile());
  for (const item of [catalog.package, ...Object.values(catalog.downloads)]) {
    const bytes = await readFile(localPath(item.url));
    assert.equal(bytes.length, item.bytes);
    assert.equal(hash(bytes), item.sha256);
  }
  for (const value of Object.values(catalog.docs)) assert.ok((await stat(localPath(value))).isFile());
  for (const item of catalog.recipes) assert.ok((await stat(localPath(item.recipe))).isFile());
});

test('agent documentation links resolve on disk and under an arbitrary deployment prefix', async () => {
  const docs = (await walk(kit)).filter(path => path.endsWith('.md'));
  for (const path of docs) {
    const text = await readFile(path, 'utf8');
    assert.doesNotMatch(text, /https?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)(?=[:/\s]|$)|\.ts\.net\b/i);
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      if (match[1].startsWith('#')) continue;
      const target = localPath(match[1], dirname(path));
      assert.ok((await stat(target)).isFile(), `${relative(kit, path)} → ${match[1]}`);
      const base = new URL(relative(kit, path), 'https://relocation.invalid/deep/preview/agent/');
      const relocated = new URL(match[1], base);
      assert.equal(relocated.origin, base.origin);
      assert.ok(relocated.pathname.startsWith('/deep/preview/agent/'));
    }
  }
});

test('portable runtime and scene ESM imports exist and import without a browser', async () => {
  for (const path of (await walk(resolve(kit, 'examples'))).concat(await walk(resolve(kit, 'runtime'))).filter(path => path.endsWith('.js'))) {
    const source = await readFile(path, 'utf8');
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const node of ast.statements) {
      if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
      const specifier = node.moduleSpecifier.text;
      if (!specifier.startsWith('.')) { assert.ok(['react'].includes(specifier), specifier); continue; }
      assert.ok((await stat(localPath(specifier, dirname(path)))).isFile(), `${path} → ${specifier}`);
    }
  }
  const gallery = await import('../agent/examples/gallery/index.js');
  const featured = await import('../agent/examples/featured/index.js');
  assert.equal(typeof gallery.mountGalleryDemo, 'function');
  assert.equal(typeof featured.mountStunt, 'function');
  assert.equal(typeof featured.mountRoadster, 'function');
  assert.equal(typeof featured.mountRamp, 'function');
});

test('distribution archives contain complete standalone assets and a self-contained skill', () => {
  const output = execFileSync('python3', ['-c', `import json,sys,zipfile,re,posixpath
result={}
for filename in sys.argv[1:]:
 with zipfile.ZipFile(filename) as archive:
  names=set(archive.namelist()); root=next(iter(names)).split('/')[0]
  assert all(not name.startswith('/') and '..' not in name.split('/') for name in names)
  assert root+'/examples/index.html' in names
  assert root+'/runtime/dom/index.js' in names
  assert root+'/examples/featured/roadster-geometry.js' in names
  assert root+'/examples/featured/roadster-motion.js' in names
  assert root+'/examples/featured/roadster-scene.js' in names
  assert root+'/examples/featured/ramp-motion.js' in names
  assert root+'/examples/featured/ramp-scene.js' in names
  assert root+'/examples/featured/stunt-motion.js' in names
  assert root+'/examples/featured/stunt-scene.js' in names
  if root=='tflip':
   assert root+'/SKILL.md' in names
   catalog=json.loads(archive.read(root+'/catalog.json'))
   assert root+'/'+catalog['package']['url'].removeprefix('./') in names
   assert catalog['downloads']=={}
   for name in names:
    if name.endswith('.md'):
     for target in re.findall(r'\\[[^\\]]*\\]\\(([^)]+)\\)',archive.read(name).decode()):
      if target.startswith('#'): continue
      resolved=posixpath.normpath(posixpath.join(posixpath.dirname(name),target.split('#')[0]))
      assert resolved in names,(name,target)
  result[root]=len(names)
print(json.dumps(result))`, localPath(catalog.downloads.examples.url), localPath(catalog.downloads.skill.url)], { encoding: 'utf8' });
  const entries = JSON.parse(output);
  assert.ok(entries['tflip-examples'] > 10);
  assert.ok(entries['tflip'] > entries['tflip-examples']);
});

test('SDK download contains only runtime, types and public API documentation with no lifecycle scripts', () => {
  const metadata = JSON.parse(execFileSync('tar', ['-xOf', localPath(catalog.package.url), 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(metadata.name, catalog.package.name);
  assert.equal(metadata.version, catalog.package.version);
  assert.equal(metadata.scripts, undefined);
  assert.equal(metadata.private, undefined);
  assert.deepEqual(metadata.publishConfig, { access: 'public', registry: 'https://registry.npmjs.org/' });
  const names = execFileSync('tar', ['-tzf', localPath(catalog.package.url)], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(names.includes('package/dist/react/index.d.ts'));
  assert.ok(names.every(name => /^package\/(?:dist\/|package\.json$|README\.md$|API\.md$|LICEN[CS]E(?:\.(?:md|txt))?$)/i.test(name)));
  assert.equal(metadata.engines.node, '>=20');
});

test('consumer documentation links and exact license bytes are included in every archive', async () => {
  const licenses = (await readdir(root)).filter(name => /^LICEN[CS]E(?:\.(?:md|txt))?$/i.test(name));
  const output = execFileSync('python3', ['-c', `import json,pathlib,posixpath,re,sys,tarfile,zipfile
root=pathlib.Path(sys.argv[1]); sdk=sys.argv[2]; licenses=json.loads(sys.argv[5])
with tarfile.open(sdk) as archive:
 files={entry.name:archive.extractfile(entry).read() for entry in archive.getmembers() if entry.isfile()}
 metadata=json.loads(files['package/package.json'])
 assert 'scripts' not in metadata and 'devDependencies' not in metadata
 readme=files['package/README.md'].decode()
 assert '{{SDK_' not in readme
 assert 'kyun.si-tflip-'+metadata['version']+'.tgz' in readme
 for name,data in files.items():
  if name.endswith('.md'):
   for target in re.findall(r'\\[[^\\]]*\\]\\(([^)]+)\\)',data.decode()):
    if target.startswith('#') or re.match(r'https?://',target): continue
    resolved=posixpath.normpath(posixpath.join(posixpath.dirname(name),target.split('#')[0]))
    assert resolved in files,(name,target)
 for name in licenses: assert files['package/'+name]==(root/name).read_bytes()
 for filename,prefix in [(sys.argv[3],'tflip-examples'),(sys.argv[4],'tflip')]:
  with zipfile.ZipFile(filename) as bundle:
   for name in licenses: assert bundle.read(prefix+'/'+name)==(root/name).read_bytes()
   if prefix=='tflip':
    catalog=json.loads(bundle.read('tflip/catalog.json'))
    assert bundle.read('tflip/'+catalog['package']['url'].removeprefix('./'))==pathlib.Path(sdk).read_bytes()
 print(json.dumps({'license':metadata['license'],'licenses':licenses}))`, root, localPath(catalog.package.url), localPath(catalog.downloads.examples.url), localPath(catalog.downloads.skill.url), JSON.stringify(licenses)], { encoding: 'utf8' });
  const result = JSON.parse(output);
  const metadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  assert.equal(result.license, metadata.license);
  assert.deepEqual(result.licenses, licenses);
});


test('current and legacy data have an explicit bounded migration contract', async () => {
  const schema = JSON.parse(await readFile(resolve(kit, 'configuration.schema.json'), 'utf8'));
  assert.ok(schema.properties.sdkVersion.enum.includes(catalog.package.version));
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.deepEqual(new Set(schema.properties.demo.enum), new Set([...catalog.recipes.map(item => item.id), ...Object.keys(catalog.aliases)]));
  assert.equal(catalog.configuration.sdkVersion, catalog.package.version);
  assert.deepEqual(new Set(catalog.configuration.acceptedLegacySdkVersions), new Set(schema.properties.sdkVersion.enum.filter(version => version !== catalog.package.version)));
  assert.match(catalog.configuration.migration, /preserve the original/i);
  assert.deepEqual((await readdir(resolve(kit, 'downloads'))).sort(), [catalog.package.url, ...Object.values(catalog.downloads).map(item => item.url)].map(url => url.split('/').at(-1)).sort());
});
