/**
 * Serves the built client over plain HTTP for inspection.
 *
 * Used to check the production bundle in a browser the way the packaged builds
 * will run it — including the Content-Security-Policy, which only exists in
 * built output and so cannot be exercised by the dev server.
 *
 * Usage:  node scripts/serve-dist.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'client');
const port = Number(process.argv[2] ?? 4321);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let file = path.join(root, decodeURIComponent(url.pathname));

  try {
    const info = await stat(file).catch(() => null);
    // Client-side routes fall back to the shell, as the packaged builds do.
    if (!info || info.isDirectory()) file = path.join(root, 'index.html');

    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('Not found');
  }
}).listen(port, () => {
  console.log('Serving dist/client on http://localhost:' + port);
});
