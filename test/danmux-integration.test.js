import test from 'node:test';
import assert from 'node:assert/strict';
import { convertCommentsToDanmux } from '../danmu_api/utils/danmux-adapter.js';
import { simulateDanmuxPlayer } from '../danmu_api/utils/danmux-player-simulator.js';

const explicitStops = [
  { position: 0, color: '#FB7299', alpha: 0.85 },
  { position: 1, color: '#33B8FF', alpha: 0.85 },
];

test('danmu_api emits DanmuX v1 enhanced wire data', () => {
  const response = convertCommentsToDanmux({ comments: [{ p: '12.5,1,16777215,[bilibili]', m: 'integration', cid: 42 }] }, {
    sourceLabel: 'danmu_api',
    gradientStops: explicitStops,
  });
  assert.equal(response.schemaVersion, 1);
  assert.equal(response.comments.length, 1);
  assert.equal(response.comments[0].p, '12.5,1,16777215,[danmu_api]');
  assert.equal(response.comments[0].danmux.extensionVersion, 1);
  assert.equal(response.comments[0].danmux.effects[0].source.type, 'linear');
});

test('simulated downstream player reports gradient rendering', () => {
  const response = convertCommentsToDanmux({ comments: [{ p: '12.5,1,16777215,[bilibili]', m: 'render me', cid: 42 }] }, {
    sourceLabel: 'danmu_api',
    gradientStops: explicitStops,
  });
  const player = simulateDanmuxPlayer(response.comments[0]);
  assert.equal(player.legacyAccepted, true);
  assert.equal(player.enhancedAccepted, true);
  assert.equal(player.renderMode, 'gradient');
  assert.match(player.cssBackground, /linear-gradient/u);
});

test('without explicit stops the adapter keeps legacy fallback only', () => {
  const response = convertCommentsToDanmux({ comments: [{ p: '1,1,16777215,[bilibili]', m: 'fallback', cid: 43 }] });
  const player = simulateDanmuxPlayer(response.comments[0]);
  assert.equal(player.legacyAccepted, true);
  assert.equal(player.enhancedAccepted, false);
  assert.equal(player.renderMode, 'solid');
});

test('danmu_api converts configured native textures to portable gradients', () => {
  const fillUri = 'https://cdn.example.test/fill.png';
  const strokeUri = 'https://cdn.example.test/stroke.png';
  const response = convertCommentsToDanmux({ comments: [{
    p: '2,1,16777215,[bilibili]',
    m: 'portable native',
    cid: 44,
    color_v2: JSON.stringify({ fill_color: fillUri, stroke_color: strokeUri }),
  }] }, {
    textureGradients: {
      [fillUri]: { angle: 0, stops: [
        { position: 0, color: '#FFFFFF' },
        { position: 1, color: '#FFFFFF' },
      ] },
      [strokeUri]: { angle: 0, stops: [
        { position: 0, color: '#F2509E' },
        { position: 0.5, color: '#8671B9' },
        { position: 1, color: '#308BCD' },
      ] },
    },
  });
  const effects = response.comments[0].danmux.effects;
  assert.deepEqual(effects.map((effect) => [effect.target, effect.origin, effect.source.type]), [
    ['fill', 'native', 'linear'],
    ['stroke', 'native', 'linear'],
  ]);
  assert.equal(effects[1].source.stops[1].color, '#8671B9');
});

test('unconfigured native textures remain available to texture-capable players', () => {
  const response = convertCommentsToDanmux({ comments: [{
    p: '2,1,16777215,[bilibili]',
    m: 'native texture',
    color_v2: JSON.stringify({ stroke_color: 'https://cdn.example.test/stroke.png' }),
  }] });
  const effect = response.comments[0].danmux.effects[0];
  assert.equal(effect.origin, 'native');
  assert.equal(effect.source.type, 'texture');
});
