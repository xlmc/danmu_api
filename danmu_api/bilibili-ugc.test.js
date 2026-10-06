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
test('real comment endpoint augments fresh and cached results without changing matching records; disabling restores baseline', async () => {
  Globals.init({ BILIBILI_UGC_ENABLED: 'true', BLOCK_DOMESTIC_CELEBRITIES: 'false', LOG_LEVEL: 'error', REMEMBER_LAST_SELECT: 'false' });
  Globals.animes = []; Globals.episodeIds = []; Globals.commentCache = new Map(); Globals.searchCache = new Map();
  const anime = { animeId: 10, bangumiId: 'ss10', animeTitle: '测试作品 第2季', source: 'bilibili', startDate: '2020-01-01', links: [{ id: 12345, title: '第5集 相逢', url: context.referenceUrl }] };
  assert(addAnime(anime)); const commentId = Globals.animes[0].links[0].id; const before = JSON.stringify(Globals.animes);
  const source = getSourceByKey('bilibili'), originalComments = source.getComments, originalSupplement = ugcSupplement.supplement;
  source.getComments = async () => [{ p: '1,1,25,0', m: '原有' }]; let calls = 0;
  ugcSupplement.supplement = async (ctx, base) => { calls++; assert.equal(ctx.episode, 5); return [...base, { p: '2,1,25,0', m: '补充' }]; };
  try {
    for (let i = 0; i < 2; i++) { const r = await getComment(`/api/v2/comment/${commentId}`, 'json', false, '127.0.0.1'); const data = await r.json(); assert.equal(data.count, 2); }
    assert.equal(calls, 2); assert.equal(JSON.stringify(Globals.animes), before);
    Globals.envs.bilibiliUgcEnabled = false;
    assert.equal((await (await getComment(`/api/v2/comment/${commentId}`, 'json', false, '127.0.0.1')).json()).count, 1);
  } finally { source.getComments = originalComments; ugcSupplement.supplement = originalSupplement; }
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
