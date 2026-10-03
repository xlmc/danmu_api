import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { runWithMatchTrace, getMatchTracePrefix, traceMatchStep } from './utils/match-trace-util.js';
import { log } from './utils/log-util.js';
import { Globals } from './configs/globals.js';
import { logviewJsContent } from './ui/js/logview.js';

test('并发匹配编号隔离，返回后后台任务仍保留原编号', async () => {
  let releaseBackground;
  const backgroundGate = new Promise(resolve => { releaseBackground = resolve; });
  let background;
  const ids = await Promise.all([1, 2].map(index => runWithMatchTrace(async () => {
    const id = getMatchTracePrefix();
    await new Promise(resolve => setTimeout(resolve, index));
    assert.equal(getMatchTracePrefix(), id);
    if (index === 1) background = (async () => {
      await backgroundGate;
      return getMatchTracePrefix();
    })();
    return id;
  })));
  assert.notEqual(ids[0], ids[1]);
  assert.equal(getMatchTracePrefix(), '');
  releaseBackground();
  assert.equal(await background, ids[0]);
});

test('阶段计时保持返回值与错误，不追踪普通搜索', async () => {
  const entries = [];
  const record = (...args) => entries.push(args.join(' '));
  assert.equal(await traceMatchStep(record, '普通搜索', async () => 7), 7);
  assert.equal(entries.length, 0);
  const failure = new Error('source failed');
  await runWithMatchTrace(async () => {
    assert.equal(await traceMatchStep(record, '来源搜索', async () => 9), 9);
    await assert.rejects(traceMatchStep(record, '目录', async () => { throw failure; }), error => error === failure);
  });
  assert.ok(entries.some(entry => /来源搜索 完成，耗时 \d+ms/.test(entry)));
  assert.ok(entries.some(entry => /目录 失败，耗时 \d+ms/.test(entry)));
});

test('带编号日志仍按业务标签分类，级别与敏感值脱敏继续生效', async () => {
  const getLogCategory = vm.runInNewContext(`${logviewJsContent.split('// 日志相关')[0]}\ngetLogCategory`);
  assert.equal(getLogCategory('[match-id=abcd1234] [tencent] 请求'), 'tencent');
  assert.equal(getLogCategory('[match-id=abcd1234] [system] [match-timing] 阶段'), 'system');
  assert.equal(getLogCategory('[match-id=abcd1234] [system] [title-mapping] 规则'), 'title-mapping');
  const saved = { logLevel: Globals.logLevel, originalEnvVars: Globals.originalEnvVars,
    accessedEnvVars: Globals.accessedEnvVars, logBuffer: Globals.logBuffer };
  try {
    Globals.logLevel = 'info';
    Globals.logBuffer = [];
    Globals.originalEnvVars = { TOKEN: 'secret-test' };
    Globals.accessedEnvVars = { TOKEN: '***********' };
    await runWithMatchTrace(async () => { log('info', '[system] value=secret-test'); });
    assert.match(Globals.logBuffer[0].message, /^\[match-id=[0-9a-f]{8}\]/);
    assert.ok(!Globals.logBuffer[0].message.includes('secret-test'));
    Globals.logLevel = 'warn';
    await runWithMatchTrace(async () => { log('info', '[system] hidden'); });
    assert.equal(Globals.logBuffer.length, 1);
  } finally { Object.assign(Globals, saved); }
});
