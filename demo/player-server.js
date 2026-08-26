import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertCommentsToDanmux } from '../danmu_api/utils/danmux-adapter.js';

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

function sampleResponse() {
  const enhanced = convertCommentsToDanmux({
    comments: [
      { cid: 'demo-1', p: '12,1,25,16711680,0,0,0,100', m: '本地模拟：红色到黄色' },
      { cid: 'demo-2', p: '18,1,25,65280,0,0,0,100', m: '本地模拟：绿色到蓝色' },
    ],
  }, {
    sourceLabel: 'player-demo',
    gradientStops: [
      { position: 0, color: '#FB7299' },
      { position: 1, color: '#33B8FF' },
    ],
  });
  const fallback = convertCommentsToDanmux({
    comments: [
      { cid: 'demo-3', p: '25,1,25,255,0,0,0,100', m: '本地模拟：兼容单色' },
    ],
  }, { sourceLabel: 'player-demo' });
  return {
    ...enhanced,
    count: enhanced.count + fallback.count,
    comments: [...enhanced.comments, ...fallback.comments],
    diagnostics: [...enhanced.diagnostics, ...fallback.diagnostics],
  };
}

const server = createServer(async (request, response) => {
  try {
    const requestPath = new URL(request.url, 'http://localhost').pathname;
    if (requestPath === '/sample') {
      response.writeHead(200, {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      });
      response.end(JSON.stringify(sampleResponse()));
      return;
    }

    const target = safePath(requestPath);
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
