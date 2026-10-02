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

test('NAS compose uses GHCR latest and portable first-install paths', () => {
  const compose = read('compose.nas.yml');
  assert.match(compose, /^\s+image: ghcr\.io\/xlmc\/danmu_api:latest\s*$/m);
  assert.match(compose, /\$\{NAS_HTTP_PORT:-9321\}:9321/);
  assert.match(compose, /\.\/data\/config:\/app\/config/);
  assert.match(compose, /\.\/data\/\.cache:\/app\/\.cache/);
  assert.doesNotMatch(compose, /DANMU_API_IMAGE|:sha-|@sha256:/);
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

// Documentation and templates must stay portable; examples use placeholders, not hosts.
test('public deployment docs contain no private host addresses or absolute home/NAS paths', () => {
  for (const file of ['README.md', 'docs/deployment.md', 'compose.nas.yml', 'SELF_USE_CHANGELOG.md']) {
    const text = read(file);
    assert.doesNotMatch(text, /\b(?:192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)\b/);
    assert.doesNotMatch(text, /\/volume\d+\/|[A-Z]:[\\/]Users[\\/]|\/home\/[^\s/]+\//i);
  }
});
