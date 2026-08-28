import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from '../danmu_api/configs/globals.js';
import { convertToDanmakuJson, formatDanmuResponse } from '../danmu_api/utils/danmu-util.js';

test('formal danmu_api format=danmux response includes v1 effects', async () => {
  Globals.init({
    CONVERT_COLOR: 'color',
    GRADIENT_CHANCE: '100',
    GRADIENT_COLORS: 'default',
    DANMUX_GRADIENT_STOPS: JSON.stringify([
      { position: 0, color: '#FB7299' },
      { position: 1, color: '#33B8FF' },
    ]),
    DANMUX_GRADIENT_ANGLE: '0',
    DANMU_OUTPUT_FORMAT: 'json',
  });
  const comments = convertToDanmakuJson([
    { p: '12.5,1,16777215,[bilibili]', m: 'API integration', cid: 9 },
  ], 'bilibili');
  const response = formatDanmuResponse({ comments }, 'danmux');
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.comments[0].danmux.effects[0].type, 'gradient');
  assert.match(payload.comments[0].p, /^12\.5,1,\d+,\[danmu_api\]$/u);
});

test('formal danmu_api applies the default linear skin only to selected white comments', async () => {
  Globals.init({
    CONVERT_COLOR: 'color',
    GRADIENT_CHANCE: '100',
    GRADIENT_COLORS: 'default',
    DANMUX_GRADIENT_STOPS: '',
    DANMU_OUTPUT_FORMAT: 'json',
  });
  const converted = convertToDanmakuJson([
    { p: '1,1,16777215,[bilibili]', m: 'white comment', cid: 11 },
    { p: '2,1,16711680,[bilibili]', m: 'red comment', cid: 12 },
    {
      p: '3,1,16777215,[bilibili]',
      m: 'native comment',
      cid: 13,
      color_v2: JSON.stringify({ stroke_color: 'https://cdn.example.test/stroke.png' }),
    },
  ], 'bilibili');
  const response = formatDanmuResponse({ comments: converted }, 'danmux');
  const payload = await response.json();

  assert.equal(payload.comments[0].danmux.effects[0].source.type, 'linear');
  assert.equal(payload.comments[0].danmux.effects[0].origin, 'generated');
  assert.equal(payload.comments[1].danmux.effects, undefined);
  assert.equal(payload.comments[2].danmux.effects, undefined);
  assert.equal(payload.comments[2].p, '3,1,16777215,[dandan]');
  assert.equal(payload.diagnostics.some((entry) => entry.code === 'native_texture_dropped'), true);
});
