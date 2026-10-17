import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parse } from 'parse5';
import { Globals } from './configs/globals.js';
import { handleRequest } from './worker.js';
import { getDashboardMetrics, withDashboardMeasurement, activateDashboardMeasurement, measureCommentCache, measureCommentResponse } from './utils/dashboard-metrics.js';
import { setCommentCache } from './utils/cache-util.js';
import { getSourceByKey } from './sources/registry.js';

const env = { TOKEN: 'dashboard-user', ADMIN_TOKEN: 'dashboard-admin', LOCAL_CACHE_ENABLED: 'false', LOCAL_REDIS_URL: '',
  SOURCE_ORDER: 'tencent', PLATFORM_ORDER: 'tencent', USE_BANGUMI_DATA: 'false', LOG_LEVEL: 'error',
  COMMENT_CACHE_MIN_COUNT: '0', COMMENT_CACHE_MINUTES: '5', RATE_LIMIT_MAX_REQUESTS: '0',
  BLOCKED_WORDS: '', GROUP_MINUTE: '0' };
const request = (route, options) => handleRequest(new Request('http://localhost' + route, options), env, 'node', '127.0.0.1');
const stats = async () => (await request('/dashboard-user/api/dashboard')).json();

// Regression: the old page had constant counters and a fabricated hourly/weekly series.
test('dashboard uses authenticated backend metrics and polling does not count as player traffic', async () => {
  Globals.init(env);
  assert.equal((await request('/api/dashboard')).status, 401);
  assert.equal((await request('/wrong/api/dashboard')).status, 401);
  const initial = await stats();
  const response = await request('/dashboard-admin/api/dashboard');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  await request('/dashboard-user/api/config');
  const html = await (await request('/dashboard-user')).text();
  for (const fake of ['24,850', '210.3', '99.4', 'HOURLY_DATA', 'DAILY_DATA', 'P95: 22ms', '3天 14小时']) assert.ok(!html.includes(fake), fake);
  assert.ok(html.includes("buildApiUrl('/api/dashboard', true)"));
  function visit(node) {
    if (node.tagName === 'script') new vm.Script(node.childNodes.map(child => child.value || '').join(''));
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parse(html));
  const after = await stats();
  assert.equal(after.today.requests, initial.today.requests);
  assert.equal(after.today.hitRate, null);
  assert.equal(after.daily.length, 7);
  assert.ok(after.daily.slice(0, -1).every(point => !point.collected));
});

test('real comment routes count a miss then cached JSON and XML responses without duplicate cache probes', async () => {
  const url = 'https://v.qq.com/x/cover/dashboard-episode.html';
  const source = getSourceByKey('tencent');
  const original = source.getComments;
  const before = await stats();
  let downloads = 0;
  source.getComments = async () => { downloads++; return [{ p: '1,1,16777215,[tencent]', m: '弹幕统计回归' }]; };
  try {
    const route = '/dashboard-user/api/v2/comment?url=' + encodeURIComponent(url);
    assert.equal((await (await request(route)).json()).count, 1);
    assert.equal((await (await request(route)).json()).count, 1);
    assert.match(await (await request(route + '&format=xml')).text(), /<d p=/);
    assert.equal(downloads, 1);
    const after = await stats();
    assert.equal(after.today.requests - before.today.requests, 3);
    assert.equal(after.today.responses - before.today.responses, 3);
    assert.equal(after.today.comments - before.today.comments, 3);
    assert.equal(after.today.hits - before.today.hits, 2);
    assert.equal(after.today.misses - before.today.misses, 1);
    assert.equal(after.today.hitRate, 66.7);
    assert.equal(after.latency.samples - before.latency.samples, 3);
    assert.ok(after.latency.p99 >= after.latency.p95);
    assert.equal(after.hourly.reduce((sum, point) => sum + point.requests, 0), after.today.requests);
  } finally { source.getComments = original; }
});

test('empty and failed responses do not add successful comments; unknown IDs still count as requests', async () => {
  const before = await stats();
  const url = 'https://v.qq.com/x/cover/dashboard-empty.html';
  setCommentCache(url, []);
  assert.equal((await (await request('/dashboard-user/api/v2/comment?url=' + encodeURIComponent(url))).json()).count, 0);
  assert.equal((await request('/dashboard-user/api/v2/comment/999999')).status, 404);
  const after = await stats();
  assert.equal(after.today.requests - before.today.requests, 2);
  assert.equal(after.today.comments, before.today.comments);
  assert.equal(after.today.responses, before.today.responses);
});

test('concurrent request contexts isolate counts and skip repeat lookups in one request', async () => {
  const before = getDashboardMetrics();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = withDashboardMeasurement(async () => {
    activateDashboardMeasurement('/api/v2/comment/1', 'GET');
    measureCommentCache('shared-key', false);
    await gate;
    measureCommentCache('shared-key', true);
    measureCommentResponse(2);
    return new Response('ok');
  });
  const second = withDashboardMeasurement(async () => {
    activateDashboardMeasurement('/api/v2/comment/2', 'GET');
    measureCommentCache('shared-key', true);
    measureCommentResponse(3);
    release();
    return new Response('ok');
  });
  await Promise.all([first, second]);
  const after = getDashboardMetrics();
  assert.equal(after.today.requests - before.today.requests, 2);
  assert.equal(after.today.comments - before.today.comments, 5);
  assert.equal(after.today.hits - before.today.hits, 1);
  assert.equal(after.today.misses - before.today.misses, 1);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const rolled = getDashboardMetrics(+tomorrow);
  assert.equal(rolled.today.requests, 0);
  assert.equal(rolled.daily.at(-2).requests, after.today.requests);
});
