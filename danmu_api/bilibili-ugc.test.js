import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUgcContext, buildUgcQueries, selectUgcPages, mergeUgcComments, createUgcSupplement, ugcSupplement, isUgcApplicable, pickUgcEpisode, buildUgcRequestContext } from './utils/bilibili-ugc-util.js';
import { Globals } from './configs/globals.js';
import { addAnime } from './utils/cache-util.js';
import { getComment } from './apis/player-api.js';
import { getSourceByKey } from './sources/registry.js';
import { handleConfig } from './apis/system-api.js';

// UGC 的适用范围：番剧/国外剧、以及弹幕本来就少的国外平台；
// 国内官方平台命中的国产剧/综艺不参与，画像未知时保守不参与。
// 判据大多不依赖 TMDB：先看「B站有没有正片」「命中的是不是国外平台」「候选类型是不是番剧」，
// 只有这些都用不上时才查 TMDB 画像。
test('UGC applies without TMDB from the matched source and catalog type', () => {
  for (const source of ['bahamut', 'hanjutv', 'renren'])
    assert.equal(isUgcApplicable({ source }), true, source + ' 是弹幕少的国外平台');
  assert.equal(isUgcApplicable({ source: 'iqiyi', type: '动漫' }), true, '候选类型即番剧');
  assert.equal(isUgcApplicable({ source: 'tencent', types: ['综艺', '动漫'] }), true, '多候选里含番剧');
  assert.equal(isUgcApplicable({ source: 'bilibili', type: '国创' }), false, '国内平台非番剧');
  assert.equal(isUgcApplicable({ source: 'iqiyi', type: '综艺' }), false, '国产综艺');
  assert.equal(isUgcApplicable({ sources: ['renren', 'bahamut'] }), true, '多来源里任一国外平台即适用');
  assert.equal(isUgcApplicable({ sources: ['tencent', 'iqiyi'], type: '电视剧' }), false, '全是国内官方平台');
  assert.equal(isUgcApplicable({ source: 'tencent', type: '电视剧' }), false, '国产剧');
});

test('UGC falls back to the TMDB profile when neither source nor type decides', () => {
  assert.equal(isUgcApplicable({ identity: { isAnimation: true, originalLanguage: 'ja', originCountry: ['JP'] } }), true, 'TMDB 判定为动画');
  assert.equal(isUgcApplicable({ identity: { originalLanguage: 'en', originCountry: ['US'] } }), true, 'TMDB 判定为国外剧');
  assert.equal(isUgcApplicable({ source: 'tencent', identity: { originalLanguage: 'zh', originCountry: ['CN'], isAnimation: false } }), false, 'TMDB 判定为国产非动画');
  assert.equal(isUgcApplicable({ source: 'iqiyi' }), false, '无从判断时保守不参与');
  assert.equal(isUgcApplicable({ identity: {} }), false, '空画像');
  assert.equal(isUgcApplicable(), false);
});

test('matched UGC candidate prefers the exact episode title, then the busiest submission', () => {
  const candidate = (bvid, searchCount, episodeTitleMatched) => ({ bvid, searchCount, evidence: { episodeTitleMatched } });
  assert.equal(pickUgcEpisode([]), null);
  assert.equal(pickUgcEpisode([candidate('a', 10, false), candidate('b', 90, false)]).bvid, 'b', '都不同名时取弹幕多的');
  assert.equal(pickUgcEpisode([candidate('a', 500, false), candidate('b', 10, true)]).bvid, 'b', '标题完全一致优先');
  assert.equal(pickUgcEpisode([candidate('a', 500, true), candidate('b', 10, true)]).bvid, 'a', '都一致时再比弹幕数');
  assert.equal(pickUgcEpisode([{ bvid: 'c', searchCount: undefined }]).bvid, 'c', '缺弹幕数也能选中');
});

// 匹配阶段没有官方分集，只能用请求身份构造 context：集号来自 SxxExx，别名参与检索。
test('request-side UGC context carries the episode identity without a catalog match', () => {
  const ctx = buildUgcRequestContext({ title: '假面骑士麦斯', aliases: ['仮面ライダーマイス'], year: 2026, season: 1, episode: 4 });
  assert.equal(ctx.title, '假面骑士麦斯'); assert.equal(ctx.episode, 4); assert.equal(ctx.season, 1);
  assert.deepEqual(ctx.aliases, ['仮面ライダーマイス']);
  assert.equal(buildUgcQueries(ctx).some(q => q.includes('仮面ライダーマイス')), true);
  assert.equal(buildUgcRequestContext({ title: '假面骑士麦斯' }), null, '缺集号不构造');
  assert.equal(buildUgcRequestContext({ title: '假面骑士麦斯', episode: 0 }), null);
  assert.equal(buildUgcRequestContext({ episode: 4 }), null, '缺标题不构造');
});

test('UGC is skipped when bilibili already has the official episode', () => {
  assert.equal(isUgcApplicable({ hasBilibiliPgc: true, type: '动漫' }), false);
  assert.equal(isUgcApplicable({ hasBilibiliPgc: true, source: 'bahamut' }), false);
  assert.equal(isUgcApplicable({ hasBilibiliPgc: true, identity: { isAnimation: true, originalLanguage: 'ja' } }), false);
  assert.equal(isUgcApplicable({ hasBilibiliPgc: false, source: 'bahamut' }), true);
});

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
function dependencies({ fail = false } = {}) {
  const source = { _getWbiMixinKey: async () => 'key', _getWbiSignedParams: p => p, getEpisodeDanmu: async () => [{ p: '5,1,25,0', m: '一条也可用' }], formatComments: x => x };
  const json = async url => {
    if (fail) throw Error('network unavailable');
    if (url.includes('/search/type')) return { code: 0, data: { result: [{ bvid: 'BVcandidate', title: '测试作品 第2季 第5集', video_review: 0 }] } };
    if (url.includes('/view?')) return { code: 0, data: url.includes('BVreference') ? video('参考', [{ cid: 77, page: 1, part: '参考', duration: 40 }]) : video('测试作品 第2季 第5集') };
    throw Error('Forbidden request: ' + url);
  };
  return { source, json };
}
test('search-to-CID-to-comments works even with zero reported count and caches separately', async () => {
  const service = createUgcSupplement(dependencies()), base = [{ p: '1,1,25,0', m: '原有' }];
  const before = structuredClone(context); const result = await service.supplement(context, base);
  assert.equal(result.length, 2); assert.equal(result[1].m, '一条也可用'); assert.deepEqual(context, before);
  assert.deepEqual(await service.supplement(context, base), result);
});
test('network errors and bounded timeout return original comments', async () => {
  const base = [{ p: '1,1,25,0', m: '原有' }];
  for (const d of [dependencies({ fail: true }), { ...dependencies(), json: () => new Promise(() => {}) }]) {
    assert.strictEqual(await createUgcSupplement(d).supplement(context, base, { budgetMs: 10 }), base);
  }
});
test('episode context inherits existing metadata and does not invent a season', () => {
  const resolved = { anime: { animeId: 3, source: 'tencent', bangumiId: 'cover', animeTitle: '测试作品', aliases: ['Alias'], startDate: '2020-01-01' }, link: { title: '测试作品_05', url: 'https://v.qq.com/x/a' }, index: 4 };
  assert.equal(buildUgcContext(resolved).episode, 5); assert.equal(buildUgcContext(resolved).season, null); assert.equal(buildUgcContext(null), null);
});
test('ugc gate: bilibili thin triggers supplement; bilibili rich skips; non-bilibili always supplements', async () => {
  Globals.init({ BILIBILI_UGC_ENABLED: 'true', BLOCK_DOMESTIC_CELEBRITIES: 'false', LOG_LEVEL: 'info', REMEMBER_LAST_SELECT: 'false' });
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
    assert(Globals.logBuffer.some(e => e.event === 'ugc.skip' && e.data.reason === 'sufficient-comments'));
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
    assert(Globals.logBuffer.some(e => e.event === 'ugc.trigger' && e.data.reason === 'thin-bilibili'));
    assert(Globals.logBuffer.some(e => e.event === 'ugc.return' && e.data.addedCount === 1 && e.data.finalCount === 1000));
    assert(Globals.logBuffer.some(e => e.event === 'ugc.response' && e.data.addedCount === 1 && e.data.finalCount === 1000));
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
    const merged = await r.json();
    assert.equal(merged.count, 2, 'non-bilibili: ugc supplements, count=2');
    // 弹弹play 协议以 cid 标识单条弹幕：补充弹幕必须顺延编号，不能与主源 cid 重复。
    assert.equal(new Set(merged.comments.map(c => c.cid)).size, merged.comments.length, 'cid stays unique after merging UGC');
    assert.equal(calls, 1, 'non-bilibili: supplement called once');
    Globals.envs.blockedWords = '补充'; Globals.commentCache = new Map();
    assert.equal((await (await getComment(`/api/v2/comment/${nonBiliCommentId}`, 'json', false, '127.0.0.1')).json()).count, 1);
    const filteredResponse = Globals.logBuffer.filter(e => e.event === 'ugc.response').at(-1);
    assert.equal(filteredResponse.data.addedCount, 0); assert.equal(filteredResponse.data.finalCount, 1);
    Globals.envs.blockedWords = '';
    Globals.commentCache = new Map();
    Globals.envs.bilibiliUgcEnabled = false;
    assert.equal((await (await getComment(`/api/v2/comment/${nonBiliCommentId}`, 'json', false, '127.0.0.1')).json()).count, 1, 'disabled: count=1');
    assert(Globals.logBuffer.some(e => e.event === 'ugc.skip' && e.data.reason === 'disabled'));
  } finally {
    tencent.getComments = originalTencentComments;
    ugcSupplement.supplement = originalSupplement;
    Globals.animes = []; Globals.episodeIds = []; Globals.commentCache = new Map();
  }
});


test('variety episode numbers come from the episode title instead of the catalog index', () => {
  const resolved = { anime: { animeId: 7943670, source: 'imgo', bangumiId: '896231', animeTitle: '披荆斩棘2026(2026)【综艺】from imgo', aliases: [], startDate: '2026-08-01' },
    link: { title: '【imgo】 2026-10-03 第8期下：四公滚烫半场', url: 'https://www.mgtv.com/b/896231/1.html' }, index: 2 };
  const ctx = buildUgcContext(resolved);
  assert.equal(ctx.episode, 8, '第8期下 is episode 8, not the third catalog entry');
  assert.equal(ctx.episodeSource, 'episode-title');
  const queries = buildUgcQueries(ctx);
  assert(queries.includes('披荆斩棘2026 第8期'), 'variety issues are searched as 期');
  assert(queries.includes('披荆斩棘2026 第8集'), 'episode wording stays available as a fallback');
  // 目录下标只在标题无法给出集号时才使用。
  const fallback = buildUgcContext({ ...resolved, link: { ...resolved.link, title: '【imgo】 四公滚烫半场' } });
  assert.equal(fallback.episode, 3); assert.equal(fallback.episodeSource, 'catalog-index');
});
test('upper and lower parts cannot stand in for each other', () => {
  const variety = { ...context, episodeTitle: '第5期下：正片' };
  const reasons = [];
  const wrong = selectUgcPages(variety, video('测试作品 第2季 第5期', [{ cid: 1, page: 1, part: '第5期上', duration: 40 }]), r => reasons.push(r));
  assert.equal(wrong.length, 0); assert(reasons.includes('part-mismatch'));
  const right = selectUgcPages(variety, video('测试作品 第2季 第5期', [{ cid: 2, page: 1, part: '第5期下', duration: 40 }]));
  assert.equal(right.length, 1); assert.equal(right[0].cid, 2);
});
test('candidates with too few reported danmaku are rejected as noise', async () => {
  const deps = dependencies();
  deps.json = async url => {
    if (url.includes('/search/type')) return { code: 0, data: { result: [
      { bvid: 'BVnoise', title: '测试作品 第2季 第5集', video_review: 9, stat: { danmaku: 7 } },
      { bvid: 'BVcandidate', title: '测试作品 第2季 第5集', video_review: 1, stat: { danmaku: 500 } }] } };
    if (url.includes('/view?')) return { code: 0, data: video('测试作品 第2季 第5集') };
    throw Error('unexpected ' + url);
  };
  const events = [], logger = (event, message, data) => events.push({ event, data });
  const result = await createUgcSupplement(deps).supplement(context, [{ p: '1,1,25,0', m: '原有' }], { logger });
  assert.deepEqual(result.map(c => c.m), ['原有', '一条也可用']);
  assert(events.some(e => e.event === 'candidate.reject' && e.data.reason === 'low-danmaku' && e.data.bvid === 'BVnoise'));
});
test('promo danmaku inside candidate clips are dropped before merging', async () => {
  const deps = dependencies();
  deps.source.getEpisodeDanmu = async () => [{ p: '5,1,25,0', m: '大家点点关注支持呦' }, { p: '6,1,25,0', m: '一条也可用' }];
  const events = [], logger = (event, message, data) => events.push({ event, data });
  const result = await createUgcSupplement(deps).supplement(context, [{ p: '1,1,25,0', m: '原有' }], { logger });
  assert.deepEqual(result.map(c => c.m), ['原有', '一条也可用']);
  assert(events.some(e => e.event === 'candidate.promo' && e.data.removed === 1));
});
// 并行预取：检索可以先于主源弹幕发起，拿到弹幕后再用同一份结果合并，不能重复检索。
test('prefetched resolve merges without searching twice', async () => {
  const deps = dependencies();
  let searches = 0;
  const baseJson = deps.json;
  deps.json = async url => { if (url.includes('/search/type')) searches++; return baseJson(url); };
  const service = createUgcSupplement(deps), base = [{ p: '1,1,25,0', m: '原有' }];
  const prepared = await service.prepare(context, { budgetMs: 2000, prefetch: true });
  const afterPrepare = searches;
  assert(afterPrepare > 0, '预取阶段完成检索');
  const merged = await service.supplement(context, base, { budgetMs: 2000, prepared });
  assert.equal(merged.length, 2);
  assert.equal(merged[1].m, '一条也可用');
  assert.equal(searches, afterPrepare, '合并阶段不再重复检索');
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

test('UGC metadata-only path never requests media and logs truthful final counts', async () => {
  Globals.init({ LOG_LEVEL: 'info' }); Globals.logBuffer = [];
  try {
    const deps = dependencies(), requests = [], originalJson = deps.json;
    deps.json = async url => { requests.push(url); return originalJson(url); };
    deps.audio = () => { throw Error('Audio must never be downloaded'); };
    deps.validate = () => { throw Error('Audio validation must never run'); };
    const service = createUgcSupplement(deps), base = [{ p: '1,1,25,0', m: '原有' }];
    assert.equal((await service.supplement(context, base)).length, 2);
    const rows = Globals.logBuffer.filter(e => e.event?.startsWith('ugc.'));
    for (const event of ['start', 'search.query', 'search.result', 'candidate.select', 'mode', 'candidate.comments', 'candidate.accept', 'end']) {
      assert(rows.some(e => e.event === 'ugc.' + event), event);
    }
    assert.equal(new Set(rows.map(e => e.data.ugcId)).size, 1);
    assert(rows.every(e => e.categories.includes('match') && e.data.title === context.title && e.data.episode === 5));
    const end = rows.find(e => e.event === 'ugc.end');
    assert.equal(end.data.addedCount, 1); assert.equal(end.data.finalCount, 2);
    assert.equal(rows.find(e => e.event === 'ugc.candidate.accept').data.timelineVerified, false);
    assert(requests.every(url => url.includes('/search/type') || url.includes('/view?')));
    assert(!rows.some(e => e.event.startsWith('ugc.audio') || e.event.startsWith('ugc.alignment')));
    await service.supplement(context, base);
    assert(Globals.logBuffer.some(e => e.event === 'ugc.cache' && e.data.cacheState === 'hit'));
  } finally { Globals.init({}); }
});

test('UGC diagnostics distinguish timeout, network failure and empty results', async () => {
  const base = [{ p: '1,1,25,0', m: '原有' }];
  for (const [deps, expected] of [
    [{ ...dependencies(), json: () => new Promise(() => {}) }, 'timeout'],
    [dependencies({ fail: true }), 'network unavailable'],
    [{ ...dependencies(), json: async () => ({ code: 0, data: { result: [] } }) }, 'empty']
  ]) {
    const events = [], logger = (event, message, data, level) => events.push({ event, data, level });
    assert.strictEqual(await createUgcSupplement(deps).supplement(context, base, { budgetMs: 50, logger }), base);
    const end = events.find(e => e.event === 'end');
    assert.equal(end.data.addedCount, 0); assert.equal(end.data.finalCount, 1);
    if (expected === 'timeout') { assert.equal(end.data.status, 'timeout'); assert.equal(end.level, 'warn'); }
    else if (expected === 'network unavailable') assert(end.data.failures.includes(expected));
    else assert.equal(end.data.candidates, 0);
  }
});

test('UGC pending task logs point to shared workflow and avoid repeating search', async () => {
  const deps = dependencies(), originalJson = deps.json;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  deps.json = async url => { await held; return originalJson(url); };
  const events = [], logger = (event, message, data) => events.push({ event, data });
  logger.ugcId = 'shared-test';
  const service = createUgcSupplement(deps), base = [];
  const first = service.supplement(context, base, { logger });
  const second = service.supplement(context, base, { logger });
  release();
  assert.deepEqual(await first, await second);
  assert.equal(events.filter(e => e.event === 'search.start').length, 1);
  assert(events.some(e => e.event === 'cache' && e.data.cacheState === 'pending' && e.data.sharedUgcId === 'shared-test'));
});

test('UGC diagnostics explain rejected candidate identities', () => {
  for (const [title, reason] of [['另一作品 第5集', 'title-mismatch'], ['测试作品 第1季 第5集', 'season-mismatch'], ['测试作品 2021年 第5集', 'year-mismatch'], ['测试作品 第2季 第4集', 'episode-unconfirmed-or-mismatch']]) {
    const reasons = [];
    assert.equal(selectUgcPages(context, video(title), reason => reasons.push(reason)).length, 0);
    assert(reasons.includes(reason), title);
  }
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

