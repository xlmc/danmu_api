import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from './configs/globals.js';
import { convertToDanmakuJson, formatDanmuResponse } from './utils/danmu-util.js';
import { DANMUX_GRADIENT_META } from './utils/danmux-meta.js';
import { handleRequest } from './worker.js';

const oldKeys = ['GRADIENT_COLORS', 'DANMUX_GRADIENT_STOPS', 'DANMUX_GRADIENT_ANGLE'];
function reset(extra = {}) {
  Globals.init({ TOKEN_AUTH_DISABLED: 'true', LOG_LEVEL: 'error', BLOCKED_WORDS: '',
    BLOCK_DOMESTIC_CELEBRITIES: 'false', GROUP_MINUTE: '0', DANMU_LIMIT: '0',
    LIKE_SWITCH: 'false', CONVERT_COLOR: 'default', GRADIENT_ENABLED: 'true',
    GRADIENT_CHANCE: '100', ...extra });
}
const input = () => [{ p: '0,1,16777215,[tencent]', m: '第一条' },
  { p: '30,1,16777215,[tencent]', m: '第二条' },
  { p: '59,1,255,[tencent]', m: '蓝色原文' }];
const convert = () => convertToDanmakuJson(input(), 'tencent');

test('independent switch applies fixed bili gradient and preserves colored comments', async () => {
  reset({ GRADIENT_COLORS: 'rainbow', DANMUX_GRADIENT_STOPS: '[{"position":0,"color":"#000000"}]', DANMUX_GRADIENT_ANGLE: '90' });
  const comments = convert();
  assert.deepEqual(comments[0][DANMUX_GRADIENT_META], { angle: 0,
    stops: [{ position: 0, color: '#FB7299' }, { position: 1, color: '#33B8FF' }] });
  assert.equal(comments[0].p.split(',')[2], '16478873');
  assert.equal(comments[2].p.split(',')[2], '255');
  assert.equal(comments[2][DANMUX_GRADIENT_META], undefined);
  const wire = await formatDanmuResponse({ comments }, 'danmux').json();
  assert.equal(wire.count, 3);
  assert.equal(wire.diagnostics.length, 0);
  assert.ok(JSON.stringify(wire.comments[0]).includes('#FB7299'));
  assert.ok(JSON.stringify(wire.comments[0]).includes('#33B8FF'));
  assert.ok(!JSON.stringify(wire.comments[2]).includes('#FB7299'));
});

test('disabled switch, zero probability and defaults generate no gradient', () => {
  for (const extra of [{ GRADIENT_ENABLED: 'false' }, { GRADIENT_CHANCE: '0' }]) {
    reset(extra);
    for (const comment of convert()) assert.equal(comment[DANMUX_GRADIENT_META], undefined);
    assert.equal(convert()[0].p.split(',')[2], '16777215');
  }
  Globals.init({ LOG_LEVEL: 'error' });
  assert.equal(Globals.envs.gradientEnabled, false);
  assert.equal(Globals.envs.gradientChance, 0);
});

test('probability boundary and out-of-range values are clamped', () => {
  const random = Math.random;
  try {
    reset({ GRADIENT_CHANCE: '50' });
    Math.random = () => 0.49;
    assert.ok(convert()[0][DANMUX_GRADIENT_META]);
    Math.random = () => 0.5;
    assert.equal(convert()[0][DANMUX_GRADIENT_META], undefined);
    reset({ GRADIENT_CHANCE: '200' });
    assert.ok(convert()[0][DANMUX_GRADIENT_META]);
    reset({ GRADIENT_CHANCE: '-10' });
    assert.equal(convert()[0][DANMUX_GRADIENT_META], undefined);
  } finally { Math.random = random; }
});

test('normal color conversion still works when gradient is disabled', () => {
  reset({ GRADIENT_ENABLED: 'false', CONVERT_COLOR: 'color', COLOR_POOL: '255' });
  const comments = convert();
  assert.equal(comments[0].p.split(',')[2], '255');
  assert.equal(comments[0][DANMUX_GRADIENT_META], undefined);
});

test('native gradient is not replaced', () => {
  reset();
  const comments = convertToDanmakuJson([{ ...input()[0], color_v2: 123 }], 'bilibili');
  assert.equal(comments[0][DANMUX_GRADIENT_META], undefined);
  assert.equal(comments[0].color_v2, 123);
});

test('actual config API exposes only switch and chance; old settings cannot be restored', async () => {
  reset();
  const req = (path, method = 'GET', body) => handleRequest(new Request('http://localhost' + path,
    { method, ...(body && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }), Globals.env, 'node', '127.0.0.1');
  const response = await req('/api/config');
  assert.equal(response.status, 200);
  const config = await response.json();
  const text = JSON.stringify(config);
  assert.ok(text.includes('GRADIENT_ENABLED'));
  assert.ok(text.includes('GRADIENT_CHANCE'));
  for (const key of oldKeys) {
    assert.ok(!text.includes(key), key);
    assert.equal((await req('/api/env/set', 'POST', { key, value: 'obsolete' })).status, 400, key);
  }
});
