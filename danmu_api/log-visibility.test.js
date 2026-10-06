import test from 'node:test';
import assert from 'node:assert/strict';
import { getLogMetadata } from './utils/log-metadata-util.js';
import { log, logEvent } from './utils/log-util.js';
import { runWithMatchTrace, traceMatchStep } from './utils/match-trace-util.js';
import { Globals } from './configs/globals.js';
import { handleRequest } from './worker.js';
import vm from 'node:vm';
import { logviewJsContent } from './ui/js/logview.js';

test('前端保留未知来源，拒绝将不安全请求编号插入追踪界面', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(logviewJsContent, context);
  const normalized = context.normalizeLogEntry({ source: null, categories: ['system'], message: '[favorite] 收藏刷新', requestId: 'bad"onclick="attack' }, 0);
  assert.equal(normalized.source, null);
  assert.equal(normalized.requestId, null);
});

test('分类与来源是独立维度，旧标签不猜测未声明来源', () => {
  const meta = getLogMetadata('[match-id=1234abcd] [tencent] [blocked-words] 命中');
  assert.deepEqual(meta.categories, ['match', 'filter', 'source']);
  assert.equal(meta.source, 'tencent');
  assert.equal(meta.requestId, '1234abcd');
  assert.equal(getLogMetadata('[system] [blocked-words] 聚合后过滤').source, null);
  assert.ok(getLogMetadata('[system] [remote-mapping] 刷新').categories.includes('mapping'));
  assert.equal(getLogMetadata('[imgo] 搜索').source, 'mango');
});

test('UGC JSON and legacy text logs appear in matching filter without a fake source', () => {
  const message = '[ugc] [ugc-id=test-1] 「作品」第5集 UGC结束';
  const metadata = getLogMetadata(message);
  assert.deepEqual(metadata.categories, ['match']);
  assert.equal(metadata.source, null);
  const context = vm.createContext({ window: {} });
  vm.runInContext(logviewJsContent, context);
  context.entries = [{ message, ...metadata }, { message }];
  vm.runInContext("let logs = entries.map(normalizeLogEntry); logViewState.category = 'match';", context);
  assert.equal(vm.runInContext('filterLogEntries().length', context), 2);
  assert.equal(vm.runInContext('logs[1].source', context), null);
  vm.runInContext("logViewState.category = 'system';", context);
  assert.equal(vm.runInContext('filterLogEntries().length', context), 0);
});

test('真实日志接口兼容文本，JSON保留结构与脱敏，未授权请求被拒绝', async () => {
  const env = { TOKEN: 'test-log-user', ADMIN_TOKEN: 'test-log-admin', USE_BANGUMI_DATA: 'false', LOG_LEVEL: 'debug' };
  Globals.init(env); Globals.logBuffer = [];
  Globals.originalEnvVars = { API_KEY: 'sensitive-test-key' };
  Globals.accessedEnvVars = { API_KEY: '******************' };
  await runWithMatchTrace(async () => {
    logEvent('debug', 'match.identity', '[system] [match-trace] 解析身份', { title: 'sensitive-test-key', season: 4, episode: 9 });
    await traceMatchStep(log, '来源 tencent 搜索', async () => []);
    log('warn', '[iqiyi] client ip: 192.168.1.9');
  });
  const request = path => handleRequest(new Request('http://localhost/' + path), env);
  const json = await request('test-log-user/api/logs?format=json');
  assert.equal(json.status, 200);
  const text = await json.text();
  assert.ok(!text.includes('sensitive-test-key'));
  assert.ok(!text.includes('192.168.1.9'));
  const payload = JSON.parse(text);
  const event = payload.entries.find(e => e.event === 'match.identity');
  assert.equal(event.data.title, '******************');
  assert.equal(event.data.episode, 9);
  assert.equal(event.level, 'debug');
  assert.ok(payload.entries.some(entry => entry.level === 'info' && entry.event === 'step.end'));
  assert.ok(event.requestId);
  assert.equal(new Set(payload.entries.map(e => e.id)).size, payload.entries.length);
  const timing = payload.entries.find(e => e.event === 'step.end');
  assert.equal(timing.source, 'tencent');
  assert.equal(timing.data.status, 'completed');
  const retained = Globals.logBuffer.length;
  await request('test-log-user/api/logs?format=json');
  assert.equal(Globals.logBuffer.length, retained, '读取日志不应产生自我轮询日志');
  const plain = await request('test-log-user/api/logs');
  assert.match(plain.headers.get('content-type'), /text\/plain/);
  assert.ok((await plain.text()).includes('[match-id='));
  const admin = await request('test-log-admin/api/logs?format=json');
  assert.ok((await admin.text()).includes('192.168.1.9'));
  const denied = await request('wrong-token/api/logs?format=json');
  assert.ok([401,403].includes(denied.status));
});

test('configured log levels filter buffer and console consistently', () => {
  const levels = ['error', 'warn', 'info', 'debug'];
  const original = Object.fromEntries(levels.map(level => [level, console[level]]));
  try {
    for (let threshold = 0; threshold < levels.length; threshold++) {
      Globals.init({ LOG_LEVEL: levels[threshold] }); Globals.logBuffer = [];
      const emitted = [];
      for (const level of levels) console[level] = () => emitted.push(level);
      for (const level of levels) log(level, '[system] matrix ' + level);
      assert.deepEqual(Globals.logBuffer.map(entry => entry.level), levels.slice(0, threshold + 1));
      assert.deepEqual(emitted, levels.slice(0, threshold + 1));
    }
  } finally {
    for (const level of levels) console[level] = original[level];
  }
});

test('log UI keeps debug entries and filters them independently', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(logviewJsContent, context);
  vm.runInContext("let logs = [normalizeLogEntry({level:'debug',message:'[system] detail'},0), normalizeLogEntry({level:'info',message:'[system] summary'},1)]; logViewState.level = 'debug';", context);
  assert.equal(vm.runInContext('filterLogEntries().length', context), 1);
  assert.equal(vm.runInContext('filterLogEntries()[0].type', context), 'debug');
});
