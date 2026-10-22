import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const host = join(root, 'test-results/consumer-host');
const fixture = join(root, 'tests/fixtures/consumer');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
const manifest = await json(join(root, 'package.json'));
const catalog = await json(join(root, 'agent/catalog.json'));
if (catalog.package.name !== manifest.name || catalog.package.version !== manifest.version) {
  throw new Error('Consumer fixture requires the current package in agent/catalog.json; run npm run build:agent first.');
}
const archive = resolve(root, 'agent', catalog.package.url);
if (!archive.startsWith(join(root, 'agent/downloads') + sep)) throw new Error('Catalog package must be a local agent download.');
const archiveBytes = await readFile(archive);
if (hash(archiveBytes) !== catalog.package.sha256 || archiveBytes.byteLength !== catalog.package.bytes) {
  throw new Error('Catalog package hash or byte count does not match its archive.');
}
const versions = {};
for (const name of ['react', 'react-dom', '@types/react', '@types/react-dom', 'typescript']) {
  versions[name] = (await json(join(root, 'node_modules', name, 'package.json'))).version;
}

// This is a generated, disposable consumer project, never the repository's SDK.
await rm(host, { recursive: true, force: true });
await mkdir(join(host, 'vendor'), { recursive: true });
await cp(fixture, host, { recursive: true });
const archiveName = `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`;
await writeFile(join(host, 'vendor', archiveName), archiveBytes);
await writeFile(join(host, 'package.json'), JSON.stringify({
  name: 'tflip-independent-consumer-fixture', version: '1.0.0', private: true, type: 'module',
  dependencies: { [manifest.name]: `file:vendor/${archiveName}`, react: versions.react, 'react-dom': versions['react-dom'] },
  devDependencies: { '@types/react': versions['@types/react'], '@types/react-dom': versions['@types/react-dom'], typescript: versions.typescript },
}, null, 2) + '\n');
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: host, stdio: 'inherit', timeout: 180000,
});
const importTargets = ['', '/core', '/dom', '/effects', '/react'].map(suffix => `${manifest.name}${suffix}`).concat(['react', 'react-dom/client']);
const resolvedUrls = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
  `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(importTargets)}.map(name => [name, import.meta.resolve(name)]))))`], { cwd: host, encoding: 'utf8' }));
const resolutions = Object.fromEntries(Object.entries(resolvedUrls).map(([name, url]) => [name, fileURLToPath(url)]));
for (const [name, path] of Object.entries(resolutions)) {
  if (!path.startsWith(join(host, 'node_modules') + sep)) throw new Error(`${name} escaped the isolated consumer installation: ${path}`);
}
const installed = await json(join(host, 'node_modules', ...manifest.name.split('/'), 'package.json'));
if (installed.version !== manifest.version) throw new Error('Installed consumer SDK version does not match the catalog.');
execFileSync(process.execPath, [join(host, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: host, stdio: 'inherit' });
const ssr = JSON.parse(execFileSync(process.execPath, ['ssr.mjs'], { cwd: host, encoding: 'utf8' }));
const output = await build({
  absWorkingDir: host, entryPoints: ['consumer.jsx'], outfile: 'consumer.js', bundle: true,
  platform: 'browser', format: 'esm', target: ['es2022'], jsx: 'automatic', sourcemap: true,
  metafile: true, define: { 'process.env.NODE_ENV': '"development"' },
});
const inputs = Object.keys(output.metafile.inputs);
const installedDist = `node_modules/${manifest.name}/dist/`;
if (!inputs.some(path => path.startsWith(installedDist))) throw new Error('Browser bundle did not consume the installed SDK.');
if (inputs.some(path => resolve(host, path).startsWith(join(root, 'src') + sep))) throw new Error('Consumer bundle must not import repository SDK source.');
const evidence = {
  createdAt: new Date().toISOString(), package: { name: installed.name, version: installed.version, sha256: catalog.package.sha256, bytes: archiveBytes.byteLength },
  archive: relative(root, archive), installedVersions: versions,
  resolutions: Object.fromEntries(Object.entries(resolutions).map(([name, path]) => [name, relative(host, path)])),
  inputs, ssr, typecheck: 'passed', strictMode: true,
  browserBundleSha256: hash(await readFile(join(host, 'consumer.js'))),
};
await writeFile(join(host, 'fixture-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
await writeFile(join(host, 'bundle-metafile.json'), JSON.stringify(output.metafile, null, 2) + '\n');
console.log(`Independent consumer prepared: ${host}/index.html`);
console.log(`SDK ${installed.version}; tarball SHA-256 ${catalog.package.sha256}; SSR and consumer TypeScript passed.`);
