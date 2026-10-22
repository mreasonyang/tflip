import { lstat, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function regular(path, directory = false, optional = false) {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !(directory ? entry.isDirectory() : entry.isFile())) throw new Error(`Unsafe package path: ${path}`);
  } catch (error) { if (!(optional && error.code === 'ENOENT')) throw error; }
}

/** Copy the exact catalog SDK instead of creating a second npm packing route. */
export async function copyCanonicalSdk(projectRoot) {
  const root = await realpath(projectRoot);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const filename = `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`;
  if (!/^[a-zA-Z0-9_.-]+\.tgz$/.test(filename)) throw new Error('Unsafe package filename');
  await regular(join(root, 'agent'), true);
  await regular(join(root, 'agent/downloads'), true);
  await regular(join(root, 'agent/catalog.json'));
  const catalog = JSON.parse(await readFile(join(root, 'agent/catalog.json'), 'utf8'));
  if (catalog.package.name !== pkg.name || catalog.package.version !== pkg.version || catalog.package.url !== `./downloads/${filename}`) {
    throw new Error('Build the current canonical SDK before copying the local deliverable');
  }
  const source = join(root, 'agent/downloads', filename);
  const destination = join(root, filename);
  await regular(source);
  await regular(destination, false, true);
  const bytes = await readFile(source);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== catalog.package.bytes || sha256 !== catalog.package.sha256) throw new Error('Canonical SDK does not match its catalog');
  const temporary = await mkdtemp(join(root, '.tflip-sdk-copy-'));
  try {
    const staged = join(temporary, filename);
    await writeFile(staged, bytes);
    await regular(destination, false, true);
    await rename(staged, destination);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return { filename, bytes: bytes.length, sha256, version: pkg.version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await copyCanonicalSdk(fileURLToPath(new URL('..', import.meta.url)))));
}
