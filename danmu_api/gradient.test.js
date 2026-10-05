import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from './configs/globals.js';
import { convertToDanmakuJson, formatDanmuResponse } from './utils/danmu-util.js';
import { DANMUX_GRADIENT_META } from './utils/danmux-meta.js';
import { handleRequest } from './worker.js';
import { applyOffset } from './utils/offset-util.js';
import { getCommentCache, setCommentCache } from './utils/cache-util.js';
import { getCommentTransformConfig, runWithCommentTransform } from './utils/comment-context.js';
import { getSourceByKey } from './sources/registry.js';
import { getComment, getCommentByUrl, getSegmentComment } from './apis/player-api.js';

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

test('ordinary JSON adds selected gradients without changing Base, envelope or cached objects', async () => {
  reset();
  const comments = convert();
  comments[0].like = 7;
  comments[0].extra = { preserved: true };
  const data = { success: true, errorCode: 0, videoDuration: 100, count: 3, comments, extra: 'envelope' };
  const baseline = JSON.parse(JSON.stringify(data));
  const random = Math.random;
  Math.random = () => { throw new Error('output must not resample'); };
  try {
    for (const format of ['json', undefined]) {
      const result = await formatDanmuResponse(data, format).json();
      const enhanced = result.comments[0].danmux;
      assert.equal(enhanced.extensionVersion, 1);
      assert.equal(enhanced.effects[0].source.angle, 0);
      assert.equal(result.comments[2].danmux, undefined);
      const stripped = { ...result, comments: result.comments.map(({ danmux, ...base }) => base) };
      assert.deepEqual(stripped, baseline);
    }
    assert.equal(comments[0].danmux, undefined, 'writer must not contaminate cached objects');
  } finally { Math.random = random; }
});

test('disabled and zero-chance JSON remain identical to the legacy serialization', async () => {
  for (const config of [{ GRADIENT_ENABLED: 'false' }, { GRADIENT_CHANCE: '0' }]) {
    reset(config);
    const data = { count: 3, comments: convert(), success: true };
    assert.deepEqual(await formatDanmuResponse(data, 'json').json(), JSON.parse(JSON.stringify(data)));
  }
  // Output guard also handles a previously selected in-memory object.
  reset();
  const selected = convert();
  reset({ GRADIENT_ENABLED: 'false' });
  assert.ok((await formatDanmuResponse({ comments: selected }, 'json').json()).comments.every(c => !c.danmux));
});

test('seconds and percentage offsets preserve effects without mutating their source', async () => {
  reset();
  const original = convert();
  for (const [offset, options, time] of [[5, {}, '5.00'], [6, { usePercent: true, videoDuration: 60 }, '0.00']]) {
    const shifted = applyOffset(original, offset, options);
    assert.equal(shifted[0].p.split(',')[0], time);
    assert.deepEqual(shifted[0][DANMUX_GRADIENT_META], original[0][DANMUX_GRADIENT_META]);
    assert.equal(Object.getOwnPropertyDescriptor(shifted[0], DANMUX_GRADIENT_META).enumerable, false);
    assert.ok((await formatDanmuResponse({ comments: shifted }, 'json').json()).comments[0].danmux);
    assert.ok((await formatDanmuResponse({ comments: shifted }, 'danmux').json()).comments[0].danmux.effects);
  }
  assert.equal(original[0].p.split(',')[0], '0.00');
});

test('invalid optional gradient keeps Base and other comments available', async () => {
  reset();
  const data = { count: 3, comments: [
    { p: '1,1,255,[source]', m: 'bad effect', cid: 7 },
    ...convert().slice(0, 2),
  ] };
  Object.defineProperty(data.comments[0], DANMUX_GRADIENT_META, { value: { angle: NaN, stops: [] } });
  const result = await formatDanmuResponse(data, 'json').json();
  assert.equal(result.count, 3);
  assert.deepEqual(result.comments[0], { p: '1,1,255,[source]', m: 'bad effect', cid: 7 });
  assert.ok(result.comments[1].danmux);
});

test('native gradient fields remain in JSON and do not acquire artificial gradients', async () => {
  reset();
  const comments = convertToDanmakuJson([{ ...input()[0], color_v2: { fill: 'https://example.test/native.png' } }], 'bilibili');
  const result = await formatDanmuResponse({ comments }, 'json').json();
  assert.deepEqual(result.comments[0].color_v2, comments[0].color_v2);
  assert.equal(result.comments[0].danmux, undefined);
});

test('black object colors and original colored comments are never mistaken for white eligibility', () => {
  reset();
  for (const content of [
    { progress: 0, mode: 1, color: 0, content: 'black protobuf' },
    { timepoint: 1, ct: 1, color: 0, content: 'black object' },
  ]) {
    const [comment] = convertToDanmakuJson([content], 'bilibili');
    assert.equal(comment.p.split(',')[2], '0');
    assert.equal(comment[DANMUX_GRADIENT_META], undefined);
  }
  reset({ CONVERT_COLOR: 'white' });
  const comments = convert();
  assert.equal(comments[2].p.split(',')[2], '16777215', 'existing white conversion still applies');
  assert.equal(comments[2][DANMUX_GRADIENT_META], undefined, 'original blue is not eligible');
  assert.ok(comments[0][DANMUX_GRADIENT_META]);
});

test('XML keeps the single-color wire format with no extension or internal metadata', async () => {
  reset();
  const text = await formatDanmuResponse({ comments: convert() }, 'xml').text();
  assert.match(text, /<d p="/);
  assert.ok(text.includes('16478873'));
  assert.ok(!text.includes('danmux'));
  assert.ok(!text.includes('effects'));
});

test('color configuration changes invalidate processed caches without clearing searches', () => {
  for (const change of [{ GRADIENT_ENABLED: 'false' }, { GRADIENT_CHANCE: '0' },
    { CONVERT_COLOR: 'white' }, { COLOR_POOL: '255' }, { CONVERT_TOP_BOTTOM_TO_SCROLL: 'true' }]) {
    reset({ COMMENT_CACHE_MINUTES: '30', COMMENT_CACHE_MIN_COUNT: '0' });
    setCommentCache('gradient-cache', convert());
    const revision = Globals.commentTransformRevision;
    Globals.searchCache.set('unrelated', { results: ['keep'] });
    Globals.env = { ...Globals.env, ...change };
    Globals.reInit();
    assert.ok(Globals.commentTransformRevision > revision);
    assert.equal(getCommentCache('gradient-cache'), null);
    assert.deepEqual(Globals.searchCache.get('unrelated').results, ['keep']);
  }
  reset({ COMMENT_CACHE_MINUTES: '30', COMMENT_CACHE_MIN_COUNT: '0' });
  setCommentCache('gradient-cache', convert());
  Globals.env = { ...Globals.env, LOG_LEVEL: 'warn' };
  Globals.reInit();
  assert.ok(getCommentCache('gradient-cache'), 'unrelated configuration keeps cache');
});

test('in-flight requests retain their rules and cannot overwrite or evict newer cache entries', async () => {
  reset({ COMMENT_CACHE_MINUTES: '30', COMMENT_CACHE_MIN_COUNT: '0' });
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  const previous = runWithCommentTransform(async () => {
    const revision = getCommentTransformConfig().revision;
    await gate;
    assert.equal(getCommentTransformConfig().revision, revision);
    const comments = convert();
    assert.ok(comments[0][DANMUX_GRADIENT_META], 'old request keeps enabled snapshot');
    assert.equal(getCommentCache('race'), null);
    setCommentCache('race', comments);
    return (await formatDanmuResponse({ comments }, 'json').json()).comments;
  });
  reset({ GRADIENT_ENABLED: 'false', COMMENT_CACHE_MINUTES: '30', COMMENT_CACHE_MIN_COUNT: '0' });
  const current = convert();
  setCommentCache('race', current);
  resume();
  assert.ok((await previous)[0].danmux, 'already running response may complete under old rules');
  assert.equal(getCommentCache('race'), current, 'new cache survives late completion');
  assert.equal((await formatDanmuResponse({ comments: current }, 'json').json()).comments[0].danmux, undefined);
});

test('existing URL, episode and segment routes return gradients on cold and warm caches', async t => {
  reset({ COMMENT_CACHE_MINUTES: '30', COMMENT_CACHE_MIN_COUNT: '0', LOCAL_CACHE_ENABLED: 'false',
    LOCAL_REDIS_URL: '', USE_BANGUMI_DATA: 'false', RATE_LIMIT_MAX_REQUESTS: '0', REMEMBER_LAST_SELECT: 'false' });
  Globals.animes = [{ animeId: 11, animeTitle: '渐变测试', source: 'tencent',
    links: [{ id: 990003, title: '【tencent】第1集', url: 'https://v.qq.com/x/cover/gradient/episode.html' }] }];
  Globals.episodeIds = [{ id: 990003, animeId: 11, ...Globals.animes[0].links[0] }];
  const source = getSourceByKey('tencent');
  const originals = { getEpisodeDanmu: source.getEpisodeDanmu, getEpisodeSegmentDanmu: source.getEpisodeSegmentDanmu,
    getEpisodeDanmuSegments: source.getEpisodeDanmuSegments, formatComments: source.formatComments };
  t.after(() => Object.assign(source, originals));
  let downloads = 0;
  source.getEpisodeDanmu = source.getEpisodeSegmentDanmu = async () => { downloads++; return input(); };
  source.formatComments = data => data;
  const requests = [
    () => handleRequest(new Request('http://localhost/api/v2/comment?url=' + encodeURIComponent(Globals.animes[0].links[0].url + '@5')), Globals.env, 'node', '127.0.0.1'),
    () => getComment('/api/v2/comment/990003', undefined, false, '127.0.0.1'),
    () => getSegmentComment({ type: 'tencent', url: 'gradient-segment' }, undefined),
  ];
  for (const request of requests) {
    const before = downloads;
    const first = await (await request()).json();
    const second = await (await request()).json();
    assert.equal(downloads, before + 1);
    assert.deepEqual(second, first);
    assert.equal(first.count, 3);
    assert.ok(first.comments[0].danmux);
    assert.equal(first.comments[0].p.split(',')[3], '[tencent]');
    assert.equal(first.comments[2].danmux, undefined);
  }
  const segmented = { count: 1, segments: [{ type: 'tencent', url: 'gradient-segment' }] };
  source.getEpisodeDanmuSegments = async () => segmented;
  assert.deepEqual(await (await getCommentByUrl(Globals.animes[0].links[0].url, undefined, true)).json(), segmented,
    'segment catalog is not treated as a comments envelope');
  Globals.env = { ...Globals.env, GRADIENT_ENABLED: 'false' };
  Globals.reInit();
  const plain = await (await requests[0]()).json();
  assert.equal(plain.comments[0].p.split(',')[2], '16777215');
  assert.equal(plain.comments[0].danmux, undefined);
});
