import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handleRequest } from './worker.js';
import { getCachedRemoteAutoMatchMappingRules } from './utils/auto-match-mapping-url-util.js';

const endpoint = '/api/auto-match-mapping/refresh';
const remoteUrl = 'https://mapping-test.example/season.txt';
const env = {
  TOKEN: 'test-user', ADMIN_TOKEN: 'test-admin',
  AUTO_MATCH_MAPPING_TABLE_URL: remoteUrl,
};
const request = (prefix = '') => new Request('http://localhost' + prefix + endpoint, { method: 'POST' });
const handle = (req, config) => handleRequest(req, config, 'cloudflare', '127.0.0.1');

test('season refresh reaches its handler instead of being rewritten to /api/v2', async () => {
  const response = await handle(request(), { TOKEN_AUTH_DISABLED: 'true' });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.match(body.error, /AUTO_MATCH_MAPPING_TABLE_URL/);
});

test('season refresh still requires admin permission when configured', async () => {
  const response = await handle(request('/test-user'), env);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).success, false);
});

test('admin refresh returns success and count after writing rules; failed refresh preserves cache', async () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'season-refresh-test-'));
  try {
    process.chdir(temp);
    let fetchCount = 0;
    globalThis.fetch = async url => {
      assert.equal(String(url), remoteUrl);
      fetchCount++;
      return new Response('测试作品 S02E01 -> 测试作品 S01E13', {
        status: 200, headers: { 'content-type': 'text/plain' },
      });
    };
    const response = await handle(request('/test-admin'), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, count: 1 });
    assert.equal(fetchCount, 1);
    assert.equal(getCachedRemoteAutoMatchMappingRules().length, 1);
    assert.match(await fs.readFile(path.join(temp, '.cache', 'auto-match-mapping-remote.txt'), 'utf8'), /S01E13/);

    globalThis.fetch = async () => { throw new Error('simulated network failure'); };
    const failed = await handle(request('/test-admin'), env);
    assert.equal(failed.status, 502);
    const failure = await failed.json();
    assert.equal(failure.success, false);
    assert.equal(failure.count, 1);
    assert.match(failure.error, /simulated network failure/);
    assert.equal(getCachedRemoteAutoMatchMappingRules().length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
