import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const demoDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function safePath(requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const relativePath = decoded === '/' ? 'player.html' : decoded.replace(/^\/+/, '');
  const target = resolve(demoDirectory, relativePath);
  if (target !== demoDirectory && !target.startsWith(`${demoDirectory}${sep}`)) return null;
  return target;
}

const server = createServer(async (request, response) => {
  try {
    const target = safePath(new URL(request.url, 'http://localhost').pathname);
    if (!target || (await stat(target)).isDirectory()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': mimeTypes[extname(target)] ?? 'application/octet-stream',
    });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

const port = Number(process.env.DANMUX_PLAYER_PORT ?? 4190);
server.listen(port, '127.0.0.1', () => {
  console.log(`DanmuX player demo: http://127.0.0.1:${port}`);
});
