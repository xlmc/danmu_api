import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from '../danmu_api/configs/globals.js';
import { formatDanmuResponse } from '../danmu_api/utils/danmu-util.js';

test('formal danmu_api format=danmux response includes v1 effects', async () => {
  Globals.init({
    DANMUX_GRADIENT_STOPS: JSON.stringify([
      { position: 0, color: '#FB7299' },
      { position: 1, color: '#33B8FF' },
    ]),
    DANMUX_GRADIENT_ANGLE: '0',
    DANMU_OUTPUT_FORMAT: 'json',
  });
  const response = formatDanmuResponse({
    comments: [{ p: '12.5,1,16777215,[bilibili]', m: 'API integration', cid: 9 }],
  }, 'danmux');
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.comments[0].danmux.effects[0].type, 'gradient');
  assert.equal(payload.comments[0].p, '12.5,1,16777215,[danmu_api]');
});
