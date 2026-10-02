import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');

test('NAS-only: retired cloud deployment entries must not return during upstream sync', () => {
  for (const file of [
    'vercel.json', 'netlify.toml', 'edgeone.json', 'wrangler.toml',
    'README.hf.md', '.github/workflows/sync_hf.yml',
    'netlify/functions/api.js', 'node-functions/index.js',
    'node-functions/[[...path]]..js', 'node-functions/[[...path]].js',
  ]) {
    assert.equal(fs.existsSync(new URL(file, root)), false, `Retired deployment entry: ${file}`);
  }
});

test('NAS compose requires an explicit image and preserves production port and data paths', () => {
  const compose = read('compose.nas.yml');
  assert.match(compose, /image: \$\{DANMU_API_IMAGE:\?[^}]+\}/);
  assert.match(compose, /29321:9321/);
  assert.match(compose, /\/volume1\/docker\/logvar\/data\/config:\/app\/config/);
  assert.match(compose, /\/volume1\/docker\/logvar\/data\/\.cache:\/app\/\.cache/);
  assert.doesNotMatch(compose, /:latest/);
});

test('NAS retains its Docker server and shared request handler', () => {
  assert.match(read('Dockerfile'), /CMD \["node", "danmu_api\/server\.js"\]/);
  assert.match(read('danmu_api/server.js'), /import \{ handleRequest \} from '\.\/worker\.js'/);
  assert.ok(fs.existsSync(new URL('danmu_api/worker.js', root)));
  for (const file of ['README.md', 'docs/configuration.md', 'danmu_api/ui/README.md']) {
    assert.doesNotMatch(read(file), /^#{2,} (?:部署到 |部署平台支持|部署平台环境变量配置指南)/m);
    assert.doesNotMatch(read(file), /https:\/\/(?:vercel\.com\/new|app\.netlify\.com\/start|deploy\.workers\.cloudflare\.com)/);
  }
});
