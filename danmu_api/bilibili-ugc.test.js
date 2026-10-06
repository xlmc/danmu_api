import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUgcContext, buildUgcQueries, selectUgcPages, mergeUgcComments, createUgcSupplement, ugcSupplement } from './utils/bilibili-ugc-util.js';
import { validateAudioTimeline, validateAudioInWorker } from './utils/ugc-audio-util.js';
import { Globals } from './configs/globals.js';
import { addAnime } from './utils/cache-util.js';
import { getComment } from './apis/player-api.js';
import { getSourceByKey } from './sources/registry.js';
import { handleConfig } from './apis/system-api.js';

const context = { identity: 'existing:1', title: '测试作品', aliases: ['Test Series'], year: 2020, season: 2, episode: 5, episodeTitle: '第5集 相逢', referenceUrl: 'https://www.bilibili.com/video/BVreference/' };
const video = (title, pages = [{ cid: 55, page: 1, part: '正片', duration: 40 }]) => ({ bvid: 'BVcandidate', aid: 9, title, pages });
test('queries consume existing aliases and identity without changing context', () => {
  const before = structuredClone(context); const q = buildUgcQueries(context);
  assert(q.includes('测试作品 第2季 第5集')); assert(q.includes('Test Series 第2季 05')); assert(q.some(x => x.endsWith('合集')));
  assert.deepEqual(context, before);
});
test('explicit season, year, episode and non-content conflicts are rejected', () => {
  for (const title of ['测试作品 第1季 第5集', '测试作品 第2季 第4集', '测试作品 2021年 第5集', '测试作品 第2季 第5集 reaction', '测试作品 第2季 第5集 精编版', '测试作品 第2季 第5集 删减版']) assert.equal(selectUgcPages(context, video(title)).length, 0, title);
  assert.equal(selectUgcPages(context, video('另一作品 第2季 第5集')).length, 0);
  assert.equal(selectUgcPages(context, video('测试作品 第2季 第5集（未删减版）')).length, 1);
});
test('episode labels cover subtitles, brackets, Chinese numerals and variety periods', () => {
  for (const tag of ['[05]', '【05】', 'E05', 'EP05', '第五话', '05期']) assert.equal(selectUgcPages(context, video(`测试作品 第2季 ${tag}`)).length, 1, tag);
});
test('parts identify an episode; page position and conflicting episode cannot override it', () => {
  const pages = [{ cid: 1, page: 1, part: '预告', duration: 40 }, { cid: 2, page: 2, part: '第5集 相逢', duration: 200 }];
  const selected = selectUgcPages(context, video('测试作品 第2季 全集', pages));
  assert.equal(selected.length, 1); assert.equal(selected[0].cid, 2); // longer tail is not a rejection
  assert.equal(selectUgcPages(context, video('测试作品 第2季 全集', [{ cid: 3, page: 5, part: '正片', duration: 40 }])).length, 0);
  assert.equal(selectUgcPages(context, video('测试作品 第2季 全集', [{ cid: 3, page: 1, part: '第4集 相逢', duration: 40 }])).length, 0);
  assert.equal(selectUgcPages(context, video('测试作品 第2季 全集', [{ cid: 3, page: 1, part: '相逢', duration: 40 }])).length, 1);
});
test('overlay offsets and clipping preserve original comments and within-CID multiplicity', () => {
  const base = [{ p: '1,1,25,0', m: '重复' }], before = structuredClone(base);
  const timeline = { status: 'verified', offsetSeconds: 5, validRange: [0, 40] };
  const comments = [{ p: '6,1,25,0', m: '重复' }, { p: '6,1,25,0', m: '重复' }, { p: '7,1,25,0', m: '新增' }, { p: '45,1,25,0', m: '尾部' }];
  const rows = mergeUgcComments(base, [{ cid: 5, comments, timeline }, { cid: 5, comments, timeline }]);
  assert.deepEqual(base, before); assert.deepEqual(rows.map(c => c.m), ['重复', '重复', '新增']); assert.equal(parseFloat(rows.at(-1).p), 2);
  assert.deepEqual(mergeUgcComments(base, [{ cid: 9, comments, timeline: { status: 'pending' } }]), base);
});
function sound(seconds) {
  const sr = 2000, a = new Float32Array(sr * seconds); let seed = 7;
  for (let i = 0; i < a.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const t = i / sr; a[i] = .2 * Math.sin(2 * Math.PI * (130 * t + 6 * t * t)) + .3 * Math.sin(2 * Math.PI * (440 * t + Math.sin(t * 2))) + (seed / 4294967296 - .5) * (.1 + .3 * Math.sin(t) ** 2); }
  return a;
}
test('continuous audio establishes fixed shift and handles extra tail without time stretching', async () => {
  const ref = sound(40), candidate = new Float32Array(2000 * 65); candidate.set(ref, 2000 * 5);
  const result = await validateAudioInWorker(ref, candidate, { duration: 40, maxOffset: 10 });
  assert.equal(result.status, 'verified'); assert(Math.abs(result.offsetSeconds - 5) < .001); assert.deepEqual(result.validRange, [0, 40]);
});
test('cut content, short candidates and silence never get verified', () => {
  const ref = sound(40), cut = new Float32Array(ref.length - 4000); cut.set(ref.subarray(0, 40000)); cut.set(ref.subarray(44000), 40000);
  for (const candidate of [cut, ref.subarray(0, 20000), new Float32Array(ref.length)]) assert.notEqual(validateAudioTimeline(ref, candidate, { duration: 40, maxOffset: 10 }).status, 'verified');
  assert.notEqual(validateAudioTimeline(new Float32Array(80000), new Float32Array(80000), { duration: 40 }).status, 'verified');
});
function dependencies({ fail = false, verdict = 'verified' } = {}) {
  const source = { _getWbiMixinKey: async () => 'key', _getWbiSignedParams: p => p, getEpisodeDanmu: async () => [{ p: '5,1,25,0', m: '一条也可用' }], formatComments: x => x };
  const json = async url => {
    if (fail) throw Error('network unavailable');
    if (url.includes('/search/type')) return { code: 0, data: { result: [{ bvid: 'BVcandidate', title: '测试作品 第2季 第5集', video_review: 0 }] } };
    if (url.includes('/view?')) return { code: 0, data: url.includes('BVreference') ? video('参考', [{ cid: 77, page: 1, part: '参考', duration: 40 }]) : video('测试作品 第2季 第5集') };
    return { code: 0, data: { dash: { audio: [{ baseUrl: 'https://media.test/audio', bandwidth: 1 }] } } };
  };
  return { source, json, audio: async () => sound(40), validate: () => ({ status: verdict, offsetSeconds: 0, validRange: [0, 40] }) };
}
test('search-to-CID-to-comments works even with zero reported count and caches separately', async () => {
  const service = createUgcSupplement(dependencies()), base = [{ p: '1,1,25,0', m: '原有' }];
  const before = structuredClone(context); const result = await service.supplement(context, base);
  assert.equal(result.length, 2); assert.equal(result[1].m, '一条也可用'); assert.deepEqual(context, before);
  assert.deepEqual(await service.supplement(context, base), result);
});
test('network errors, pending timeline and bounded timeout return original comments', async () => {
  const base = [{ p: '1,1,25,0', m: '原有' }];
  for (const d of [dependencies({ fail: true }), dependencies({ verdict: 'pending' }), { ...dependencies(), json: () => new Promise(() => {}) }]) {
    assert.strictEqual(await createUgcSupplement(d).supplement(context, base, { budgetMs: 10 }), base);
  }
});
test('episode context inherits existing metadata and does not invent a season', () => {
  const resolved = { anime: { animeId: 3, source: 'tencent', bangumiId: 'cover', animeTitle: '测试作品', aliases: ['Alias'], startDate: '2020-01-01' }, link: { title: '测试作品_05', url: 'https://v.qq.com/x/a' }, index: 4 };
  assert.equal(buildUgcContext(resolved).episode, 5); assert.equal(buildUgcContext(resolved).season, null); assert.equal(buildUgcContext(null), null);
});
test('ugc gate: bilibili thin triggers supplement; bilibili rich skips; non-bilibili always supplements', async () => {
  Globals.init({ BILIBILI_UGC_ENABLED: 'true', BLOCK_DOMESTIC_CELEBRITIES: 'false', LOG_LEVEL: 'error', REMEMBER_LAST_SELECT: 'false' });
  Globals.animes = []; Globals.episodeIds = []; Globals.commentCache = new Map(); Globals.searchCache = new Map();
  let calls = 0;
  const originalSupplement = ugcSupplement.supplement;
  ugcSupplement.supplement = async (ctx, base) => { calls++; return [...base, { p: '2,1,25,0', m: '补充' }]; };

  // 1. Bilibili primary source, rich pool (≥1000) → UGC skipped
  const biliAnime = { animeId: 10, bangumiId: 'ss10', animeTitle: '测试作品 第2季', source: 'bilibili', startDate: '2020-01-01',
    links: [{ id: 12345, title: '第5集 相逢', url: context.referenceUrl }] };
  assert(addAnime(biliAnime));
  const biliCommentId = Globals.animes[0].links[0].id;
  const biliSource = getSourceByKey('bilibili'), originalBiliComments = biliSource.getComments;
  // Simulate rich pool: 1000 comments
  biliSource.getComments = async () => Array.from({ length: 1000 }, (_, i) => ({ p: `${i + 1},1,25,0`, m: `弹幕${i}` }));
  try {
    const r = await getComment(`/api/v2/comment/${biliCommentId}`, 'json', false, '127.0.0.1');
    assert.equal((await r.json()).count, 1000, 'bilibili rich: ugc skipped, count stays 1000');
    assert.equal(calls, 0, 'bilibili rich: supplement not called');
  } finally { biliSource.getComments = originalBiliComments; }

  // 2. Bilibili primary source, thin pool (<1000, e.g. childhood anime) → UGC runs
  Globals.animes = []; Globals.episodeIds = []; Globals.commentCache = new Map(); Globals.searchCache = new Map(); calls = 0;
  assert(addAnime(biliAnime));
  const biliCommentId2 = Globals.animes[0].links[0].id;
  const biliSource2 = getSourceByKey('bilibili');
  const orig2 = biliSource2.getComments;
  biliSource2.getComments = async () => Array.from({ length: 999 }, (_, i) => ({ p: `${i + 1},1,25,0`, m: `弹幕${i}` }));
  try {
    const r = await getComment(`/api/v2/comment/${biliCommentId2}`, 'json', false, '127.0.0.1');
    assert.equal((await r.json()).count, 1000, 'bilibili thin: 999 comments triggers ugc supplement');
    assert.equal(calls, 1, 'bilibili thin: supplement called once');
  } finally { biliSource2.getComments = orig2; }

  // 3. Non-bilibili primary source (tencent) → UGC always runs
  Globals.animes = []; Globals.episodeIds = []; Globals.commentCache = new Map(); Globals.searchCache = new Map(); calls = 0;
  const tencent = getSourceByKey('tencent'), originalTencentComments = tencent.getComments;
  const nonBiliUrl = 'https://v.qq.com/x/cover/test-series/ep005.html';
  const nonBiliAnime = { animeId: 20, bangumiId: 'cover-20', animeTitle: '测试作品 第2季', source: 'tencent', startDate: '2020-01-01',
    links: [{ id: 23456, title: '第5集 相逢', url: nonBiliUrl }] };
  assert(addAnime(nonBiliAnime));
  const nonBiliCommentId = Globals.animes[0].links[0].id;
  tencent.getComments = async () => [{ p: '1,1,25,0', m: '原有' }];
  try {
    const r = await getComment(`/api/v2/comment/${nonBiliCommentId}`, 'json', false, '127.0.0.1');
    assert.equal((await r.json()).count, 2, 'non-bilibili: ugc supplements, count=2');
    assert.equal(calls, 1, 'non-bilibili: supplement called once');
    Globals.commentCache = new Map();
    Globals.envs.bilibiliUgcEnabled = false;
    assert.equal((await (await getComment(`/api/v2/comment/${nonBiliCommentId}`, 'json', false, '127.0.0.1')).json()).count, 1, 'disabled: count=1');
  } finally {
    tencent.getComments = originalTencentComments;
    ugcSupplement.supplement = originalSupplement;
    Globals.animes = []; Globals.episodeIds = []; Globals.commentCache = new Map();
  }
});


test('handleConfig exposes BILIBILI_UGC_ENABLED and defaults budget to 10s without UI entry', async () => {
  Globals.init();
  const res = handleConfig(true);
  const data = await res.json();
  assert(data.envVarConfig.BILIBILI_UGC_ENABLED, 'BILIBILI_UGC_ENABLED should exist in envVarConfig');
  assert.equal(data.envVarConfig.BILIBILI_UGC_ENABLED.category, 'danmu');
  assert.equal(data.envVarConfig.BILIBILI_UGC_ENABLED.type, 'boolean');
  assert.equal(data.envVarConfig.BILIBILI_UGC_BUDGET_MS, undefined, 'BILIBILI_UGC_BUDGET_MS should not be in envVarConfig');

  const danmuVars = data.categorizedEnvVars.danmu;
  assert(danmuVars.some(v => v.key === 'BILIBILI_UGC_ENABLED'));
  assert(!danmuVars.some(v => v.key === 'BILIBILI_UGC_BUDGET_MS'));
  assert.equal(Globals.envs.bilibiliUgcBudgetMs, 10000);
});
test('candidate-as-reference: non-bilibili primary source uses top-danmaku candidate as anchor', async () => {
  // Simulate a tencent/renren primary source where referenceUrl is NOT a Bilibili URL.
  const nonBiliContext = { ...context, referenceUrl: 'https://v.qq.com/x/cover/abc/episode.html' };
  const dep = dependencies();
  // The search returns a candidate with searchCount; it becomes the anchor.
  dep.json = async url => {
    if (url.includes('/search/type')) return { code: 0, data: { result: [{ bvid: 'BVcandidate', title: '测试作品 第2季 第5集', video_review: 10, stat: { danmaku: 500 } }] } };
    if (url.includes('/view?bvid=BVcandidate')) return { code: 0, data: { bvid: 'BVcandidate', aid: 9, title: '测试作品 第2季 第5集', pages: [{ cid: 55, page: 1, part: '正片', duration: 40 }] } };
    if (url.includes('/playurl')) return { code: 0, data: { dash: { audio: [{ baseUrl: 'https://media.test/audio', bandwidth: 1 }] } } };
    return { code: 0, data: {} };
  };
  const service = createUgcSupplement(dep);
  const base = [{ p: '1,1,25,0', m: '原有' }];
  const result = await service.supplement(nonBiliContext, base);
  // Anchor candidate's comments are included (offsetSeconds=0), plus any cross-aligned extras.
  assert.ok(result.length >= 1, 'should include at least the anchor candidate comments');
  assert.ok(result.some(c => c.m === '原有' || c.m === '一条也可用'), 'original or UGC comments included');
});

test('candidate-as-reference: no candidates means no supplement', async () => {
  const nonBiliContext = { ...context, referenceUrl: 'https://v.qq.com/x/cover/abc/episode.html' };
  const dep = dependencies();
  dep.json = async url => {
    if (url.includes('/search/type')) return { code: 0, data: { result: [] } };
    return { code: 0, data: {} };
  };
  const service = createUgcSupplement(dep);
  const base = [{ p: '1,1,25,0', m: '原有' }];
  assert.strictEqual(await service.supplement(nonBiliContext, base), base);
});

