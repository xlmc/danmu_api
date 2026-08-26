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
  const native = convertCommentsToDanmux({
    comments: [
      {
        cid: 'demo-1',
        p: '12,1,25,16777215,0,0,0,100',
        m: 'B站原生：白色填充＋渐变描边',
        color_v2: JSON.stringify({
          fill_color: 'https://i0.hdslb.com/bfs/dm/9dcd329e617035b45d2041ac889c49cb5edd3e44.png',
          stroke_color: 'https://i0.hdslb.com/bfs/dm/716a749b2461e02df0b4dafb59bbaf0ceab79da9.png',
        }),
      },
      {
        cid: 'demo-2',
        p: '18,1,25,16777215,0,0,0,100',
        m: 'B站原生：同一套会员渐变资源',
        color_v2: JSON.stringify({
          fill_color: 'https://i0.hdslb.com/bfs/dm/9dcd329e617035b45d2041ac889c49cb5edd3e44.png',
          stroke_color: 'https://i0.hdslb.com/bfs/dm/716a749b2461e02df0b4dafb59bbaf0ceab79da9.png',
        }),
      },
    ],
  }, { sourceLabel: 'bilibili' });
  const fallback = convertCommentsToDanmux({
    comments: [
      { cid: 'demo-3', p: '25,1,25,255,0,0,0,100', m: '本地模拟：兼容单色' },
    ],
  }, { sourceLabel: 'player-demo' });
  return {
    format: 'danmux',
    schemaVersion: 1,
    count: native.count + fallback.count,
    comments: [...native.comments, ...fallback.comments],
    diagnostics: [...native.diagnostics, ...fallback.diagnostics],
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
