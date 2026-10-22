import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyCanonicalSdk } from './pack-local.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--dry-run')) {
  throw new Error('Usage: npm run publish:npm [-- --dry-run]');
}
const root = fileURLToPath(new URL('..', import.meta.url));
// Validate the name, version, filename, byte count and SHA-256 against the
// catalog. Publish these exact consumer bytes, never the source workspace.
const artifact = await copyCanonicalSdk(root);
console.log(`Canonical SDK: ${artifact.filename}; SHA-256 ${artifact.sha256}`);
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
  'publish', `./${artifact.filename}`, '--access=public', '--ignore-scripts',
  '--registry=https://registry.npmjs.org/', ...args,
], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
