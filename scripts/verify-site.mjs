import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [site, manifestPath, reportPath] = process.argv.slice(2);
if (!site || !manifestPath || process.argv.length > 5) {
  throw new Error('Usage: node scripts/verify-site.mjs <site-url> <release-manifest.json> [report.json]');
}
const base = new URL(site.endsWith('/') ? site : `${site}/`);
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
  throw new Error('Use an HTTP(S) site URL without credentials, query or fragment');
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!manifest.source?.commit || !manifest.releaseReady || !Array.isArray(manifest.staticAssets)) {
  throw new Error('A release manifest from a clean, packaged checkout is required');
}
const assets = manifest.staticAssets.filter(asset => asset.served !== false);
if (!assets.some(asset => asset.path === 'index.html') || assets.some(asset =>
  typeof asset.path !== 'string' || !asset.path || asset.path.startsWith('/') || /[\\?#]/.test(asset.path)
  || asset.path.split('/').some(part => !part || part === '.' || part === '..')
  || !Number.isSafeInteger(asset.bytes) || !/^[a-f0-9]{64}$/.test(asset.sha256))) {
  throw new Error('Invalid static asset manifest');
}
const checks = [];
const failures = [];
let cursor = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (cursor < assets.length) {
    const asset = assets[cursor++];
    try {
      const url = new URL(asset.path === 'index.html' ? '' : asset.path, base);
      if (/\.(js|css|json)$/.test(asset.path)) url.searchParams.set('v', manifest.assetRevision);
      const response = await fetch(url, {
        headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000),
      });
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length !== asset.bytes || sha256 !== asset.sha256) throw new Error('Served bytes differ from the release manifest');
      const cacheControl = response.headers.get('cache-control') || '';
      if (['index.html', 'agent/catalog.json'].includes(asset.path)
        && (!/\bno-cache\b/.test(cacheControl) || !/\bmax-age=0\b/.test(cacheControl) || !/\bmust-revalidate\b/.test(cacheControl))) {
        throw new Error('Expected revalidation cache headers are missing');
      }
      checks.push({ path: asset.path, url: url.href, bytes: bytes.length, sha256, cacheControl });
    } catch (error) { failures.push({ path: asset.path, error: error.message }); }
  }
}));
const missingPath = 'agent/downloads/__tflip-verification-missing__.tgz';
try {
  const response = await fetch(new URL(missingPath, base), { signal: AbortSignal.timeout(30000) });
  if (response.status !== 404) throw new Error(`Expected HTTP 404, received ${response.status}`);
} catch (error) { failures.push({ path: missingPath, error: error.message }); }
checks.sort((a, b) => a.path.localeCompare(b.path));
const report = {
  schemaVersion: 1, verifiedAt: new Date().toISOString(), site: base.href,
  passed: failures.length === 0, source: manifest.source, assetRevision: manifest.assetRevision,
  checked: checks.length, expected: assets.length, missingDownload: failures.some(f => f.path === missingPath) ? 'failed' : 404,
  checks, failures,
  evidenceBoundary: 'HTTP byte, cache-header and 404 verification only; browser interaction and automatic Git deployment require separate evidence.',
};
if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ site: report.site, passed: report.passed, checked: report.checked, expected: report.expected, source: report.source.commit, failures, report: reportPath }));
if (!report.passed) process.exitCode = 1;
