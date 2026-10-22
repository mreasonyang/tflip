import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRootEntry } from './site-entry.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1] || process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
  try {
    let path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/') {
      const content = Buffer.from(createRootEntry(await readFile(resolve(root, 'playground/index.html'), 'utf8')));
      response.writeHead(200, { 'content-type': types['.html'], 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : content);
      return;
    }
    let file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep) && file !== root) { response.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const content = await readFile(file);
    response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404).end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Tflip Playground: http://127.0.0.1:${port}/playground/`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
