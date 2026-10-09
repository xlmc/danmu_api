import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUgcContext, buildUgcQueries, selectUgcPages, mergeUgcComments, createUgcSupplement, ugcSupplement, isUgcApplicable, pickUgcEpisode, buildUgcRequestContext, calculateUgcTitlePrecision, MIN_UGC_TITLE_PRECISION } from './utils/bilibili-ugc-util.js';
import { Globals } from './configs/globals.js';
import { addAnime } from './utils/cache-util.js';
import { getComment, isMovieFeatureFilmEpisode } from './apis/player-api.js';
import { getSourceByKey } from './sources/registry.js';
import { handleConfig, handleClearCache } from './apis/system-api.js';

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

test('通用 UGC 提取合集关键词并利用普通剧集的中英文单集标题', async () => {
  const ctx = buildUgcRequestContext({ title: '猫和老鼠：黄金时代合集（1940-1958）', season: 1, episode: 1,
    episodeTitle: '甜蜜的家 Puss Gets the Boot', type: '电视剧' });
  assert.equal(ctx.title, '猫和老鼠');
  assert(ctx.aliases.includes('猫和老鼠：黄金时代合集（1940-1958）'));
  assert.deepEqual(ctx.yearRange, [1940, 1958]);
  assert.equal(buildUgcQueries(ctx)[0], '猫和老鼠 甜蜜的家 Puss Gets the Boot');
  assert(buildUgcQueries(ctx).includes('猫和老鼠 甜蜜的家'));
  assert(buildUgcQueries(ctx).includes('猫和老鼠 Puss Gets the Boot'));
  const submission = { bvid: 'BV1nD421W7Vx', title: '甜蜜的家 Puss Gets the Boot（猫和老鼠）',
    pages: [{ cid: 1494560729, page: 1, part: '甜蜜的家 Puss Gets the Boot（猫和老鼠）', duration: 739 }] };
  const selected = selectUgcPages(ctx, submission);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].evidence.episodeBasis, 'episode-title');
  for (const part of ['甜蜜的家', 'Puss Gets The Boot', '猫和老鼠 Puss Gets The Boot（甜蜜的家）', '猫和老鼠 Puss Gets The Boot（猫被解雇了／甜蜜的家）']) {
    const varied = { ...submission, title: '猫和老鼠 Puss Gets The Boot（猫被解雇了／甜蜜的家）', pages: [{ ...submission.pages[0], part }] };
    assert.equal(selectUgcPages(ctx, varied).length, 1, part);
  }
  assert.equal(selectUgcPages(ctx, { ...submission, pages: [{ ...submission.pages[0], part: '第2集 甜蜜的家' }] }).length, 0);
  assert.equal(selectUgcPages(ctx, { ...submission, pages: [{ ...submission.pages[0], part: '1780256143293' }] }).length, 1);
  assert.equal(selectUgcPages(ctx, { ...submission, pages: [1, 2].map(page => ({ ...submission.pages[0], page, part: 'P' + page })) }).length, 0);
  assert.equal(selectUgcPages(ctx, { ...submission, title: submission.title + ' 原版标题卡' }).length, 0);
  assert.equal(selectUgcPages(ctx, { ...submission, title: submission.title + '（2021）' }).length, 0);
  assert.equal(selectUgcPages(ctx, { ...submission, pages: [{ ...submission.pages[0], part: '第1集 午夜点心' }] }).length, 0);
  assert.equal(buildUgcRequestContext({ title: '火影忍者：疾风传合集', episode: 1 }).title, '火影忍者：疾风传');
  assert.equal(buildUgcRequestContext({ title: '猫和老鼠：星盘奇缘', episode: 1 }).collectionTitle, null);
  const ordinary = buildUgcRequestContext({ title: '测试作品', aliases: ['Test Series'], season: 2, episode: 5,
    episodeTitle: '第5集 相逢 Encounter', type: '动漫' });
  assert(buildUgcQueries(ordinary).includes('测试作品 相逢'));
  assert(buildUgcQueries(ordinary).includes('Test Series Encounter'));
  assert.equal(selectUgcPages(ordinary, { bvid: 'BVordinary', title: '测试作品 第2季 第5集 Encounter（相逢）',
    pages: [{ cid: 55, page: 1, part: '相逢', duration: 100 }] }).length, 1);
  assert.equal(calculateUgcTitlePrecision('裝備仔 第2話', { title: '装备仔', episode: 2 }), 1);
  const catalog = buildUgcContext({ anime: { animeTitle: ctx.collectionTitle, type: '动漫' },
    link: { title: '第1集 甜蜜的家 Puss Gets the Boot', url: 'official' }, index: 0 });
  assert.equal(catalog.title, '猫和老鼠');
  assert.deepEqual(catalog.yearRange, [1940, 1958]);
  const queries = [];
  const supplement = createUgcSupplement({ source: { _getWbiMixinKey: async () => 'key', _getWbiSignedParams: params => params,
    getEpisodeDanmu: async () => [{ p: '1,1,25,16777215,0,0,0,1', m: '经典开场' }], formatComments: rows => rows },
    json: async url => {
      if (url.includes('/search/type')) { queries.push(new URL(url).searchParams.get('keyword'));
        return { code: 0, data: { result: [submission.bvid, 'BVadditional'].map(bvid => ({ bvid, title: submission.title })) } }; }
      return { code: 0, data: url.includes('BVadditional') ? { ...submission, bvid: 'BVadditional',
        pages: [submission.pages[0], { ...submission.pages[0], cid: 99, page: 2 }] } : submission };
    } });
  const result = await supplement.resolve(ctx, { maxCandidates: 2, logger: () => {} });
  assert.equal(queries[0], '猫和老鼠 甜蜜的家 Puss Gets the Boot');
  assert.deepEqual(result.accepted.map(row => row.cid), [1494560729, 99], '重复 CID 不占下载名额');
});

const context = { identity: 'existing:1', title: '测试作品', aliases: ['Test Series'], year: 2020, season: 2, episode: 5, episodeTitle: '第5集 相逢', referenceUrl: 'https://www.bilibili.com/video/BVreference/' };
const video = (title, pages = [{ cid: 55, page: 1, part: '正片', duration: 40 }]) => ({ bvid: 'BVcandidate', aid: 9, title, pages });
test('queries consume existing aliases and identity without changing context', () => {
  const before = structuredClone(context); const q = buildUgcQueries(context);
  assert(q.includes('测试作品 第2季 第5集')); assert(q.includes('Test Series 第2季 05')); assert(q.some(x => x.endsWith('合集')));
  assert.deepEqual(context, before);
});

test('UGC searches late TMDB aliases and their Chinese variants without losing episode identity', async () => {
  const tmdbIdentity = { key: 'tv:324502', mediaType: 'tv', aliases: ['装备我最强', 'テムパル～アイテムの力～', 'Tempal: Item no Chikara', 'Overgeared', '裝備仔'] };
  const ctx = buildUgcRequestContext({ title: '装备我最强', year: 2026, season: 1, episode: 2, tmdbIdentity });
  const queries = buildUgcQueries(ctx);
  for (const alias of ['裝備仔', '装备仔', 'Overgeared']) assert(queries.includes(`${alias} 第1季 第2集`), alias);
  assert(queries.indexOf('裝備仔 第1季 第2集') < queries.indexOf('Tempal: Item no Chikara 第1季 第2集'));
  assert.equal(new Set(queries).size, queries.length);
  const savedContext = buildUgcContext({ anime: { animeTitle: '装备我最强', type: '动漫', tmdbIdentity }, link: { title: '第2集', url: 'official' }, index: 1 });
  assert(savedContext.aliases.includes('裝備仔'), '目录补充同样继承 TMDB 别名');
  assert.equal(selectUgcPages(ctx, video('装备仔 第2话', [{ cid: 55, page: 1, part: '第2话', duration: 1665 }])).length, 1);
  assert.equal(selectUgcPages(ctx, video('装备仔 第3话', [{ cid: 55, page: 1, part: '第3话', duration: 1665 }])).length, 0);
  for (const chineseHit of [true, false]) {
    const deps = dependencies(), searched = [];
    const json = async url => {
      if (url.includes('/search/type')) {
        const keyword = new URL(url).searchParams.get('keyword');
        searched.push(keyword);
        if (!chineseHit && !keyword.startsWith('Test Series')) return { code: 0, data: { result: [] } };
      }
      return deps.json(url);
    };
    const found = await createUgcSupplement({ source: deps.source, json }).search({ ...context, tmdbIdentity: { aliases: ['Test Series', '中文别名'] } });
    assert.equal(found.candidates.length, 1);
    assert(searched.includes('中文别名 第2季 第5集'));
    assert.equal(searched.some(keyword => keyword.startsWith('Test Series')), !chineseHit, '中文未命中才搜索其他语言');
  }
});
test('explicit season, year, episode and non-content conflicts are rejected', () => {
  for (const title of ['测试作品 第1季 第5集', '测试作品 第2季 第4集', '测试作品 2021年 第5集', '测试作品 第2季 第5集 reaction', '测试作品 第2季 第5集 精编版', '测试作品 第2季 第5集 删减版']) assert.equal(selectUgcPages(context, video(title)).length, 0, title);
  assert.equal(selectUgcPages(context, video('另一作品 第2季 第5集')).length, 0);
  assert.equal(selectUgcPages(context, video('测试作品 第2季 第5集（未删减版）')).length, 1);
});
test('episode labels cover subtitles, brackets, Chinese numerals and variety periods', () => {
  for (const tag of ['[05]', '【05】', 'E05', 'EP05', '第五话', '05期']) assert.equal(selectUgcPages(context, video(`测试作品 第2季 ${tag}`)).length, 1, tag);
});
test('UGC recognizes S01E02 filenames and rejects explicit season and episode conflicts', () => {
  const ctx = { title: '魔女嘉莉', aliases: ['Carrie'], year: 2026, mediaType: 'tv', season: 1, episode: 2, episodeTitle: '【renren】第02集' };
  const pages = Array.from({ length: 8 }, (_, i) => ({ cid: i + 1, page: i + 1, part: `魔女嘉莉.S01E0${i + 1}.1080p.VINEnc_trim`, duration: 4800 }));
  const selected = selectUgcPages(ctx, video('魔女嘉莉 Carrie (2026) 中英字幕', pages));
  assert.deepEqual(selected.map(p => p.page), [2]);
  assert.equal(selected[0].evidence.explicitEpisode, 2);
  assert.equal(selectUgcPages(ctx, video('魔女嘉莉 (2026) S01E02')).length, 1);
  for (const part of ['魔女嘉莉.S02E02.1080p', '魔女嘉莉.S01E03.1080p'])
    assert.equal(selectUgcPages(ctx, video('魔女嘉莉 (2026)', [{ ...pages[1], part }])).length, 0, part);
  assert.equal(selectUgcPages(ctx, video('魔女嘉莉 (2026) S02E02')).length, 0);
  assert.equal(selectUgcPages(ctx, video('魔女嘉莉 (2002)', pages)).length, 0);
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
test('ugc gate: thin sources trigger supplement; rich sources skip', async () => {
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

  // 3. Non-bilibili primary source (tencent), thin pool → UGC runs
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

test('rich Tencent comments skip UGC search and supplement on cold and cached requests', async () => {
  Globals.init({ BILIBILI_UGC_ENABLED: 'true', BLOCK_DOMESTIC_CELEBRITIES: 'false', LOG_LEVEL: 'info', REMEMBER_LAST_SELECT: 'false' });
  Globals.animes = []; Globals.episodeIds = []; Globals.commentCache = new Map(); Globals.searchCache = new Map();
  const tencent = getSourceByKey('tencent'), originalComments = tencent.getComments;
  const originalPrepare = ugcSupplement.prepare, originalSupplement = ugcSupplement.supplement;
  let searches = 0, supplements = 0, fetches = 0;
  ugcSupplement.prepare = async () => { searches++; return {}; };
  ugcSupplement.supplement = async (ctx, base) => { supplements++; return base; };
  tencent.getComments = async () => {
    fetches++;
    return Array.from({ length: 1000 }, (_, i) => ({ p: `${i + 1},1,25,0`, m: `弹幕${i}` }));
  };
  try {
    assert(addAnime({ animeId: 20, bangumiId: 'cover-20', animeTitle: '美人余(2026)【电视剧】', source: 'tencent', startDate: '2026-01-01',
      links: [{ id: 23456, title: '第1集', url: 'https://v.qq.com/x/cover/test-series/ep001.html' }] }));
    const commentId = Globals.animes[0].links[0].id;
    for (let i = 0; i < 2; i++) {
      const response = await getComment(`/api/v2/comment/${commentId}`, 'json', false, '127.0.0.1');
      assert.equal((await response.json()).count, 1000);
    }
    assert.equal(fetches, 1, 'second request uses cached primary comments');
    assert.equal(searches, 0, 'sufficient comments never start a UGC search');
    assert.equal(supplements, 0, 'sufficient comments never run a UGC supplement');
    assert(Globals.logBuffer.some(e => e.event === 'ugc.skip' && e.data.reason === 'sufficient-comments' && e.data.originalCount === 1000));
  } finally {
    tencent.getComments = originalComments;
    ugcSupplement.prepare = originalPrepare; ugcSupplement.supplement = originalSupplement;
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
  // 真实样本：B站投稿里常混「动漫聊天群965056896欢迎」「ACGN交流群1076162477」以及单独一条群号。
  deps.source.getEpisodeDanmu = async () => [
    { p: '5,1,25,0', m: '大家点点关注支持呦' },
    { p: '6,1,25,0', m: '动漫聊天群965056896欢迎' },
    { p: '7,1,25,0', m: '1076162477' },
    { p: '8,1,25,0', m: 'ACGN交流群1076162477' },
    { p: '9,1,25,0', m: '6666666' },
    { p: '10,1,25,0', m: '一条也可用' }];
  const events = [], logger = (event, message, data) => events.push({ event, data });
  const result = await createUgcSupplement(deps).supplement(context, [{ p: '1,1,25,0', m: '原有' }], { logger });
  const texts = result.map(c => c.m);
  assert.ok(texts.includes('一条也可用'), '正常弹幕保留');
  assert.ok(texts.includes('6666666'), '连续同数字的梗保留');
  assert.ok(!texts.includes('1076162477'), '单独的群号被丢弃');
  assert.ok(!texts.some(t => /群/.test(t)), '带群字的广告被丢弃');
  assert(events.some(e => e.event === 'candidate.promo' && e.data.removed === 4), '4 条引流广告被过滤');
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
  assert.equal(data.envs.BILIBILI_UGC_BUDGET_MS, undefined);
  assert.equal(data.originalEnvVars.BILIBILI_UGC_BUDGET_MS, undefined);
  assert(!Object.values(data.categorizedEnvVars).flat().some(v => v.key === 'BILIBILI_UGC_BUDGET_MS'));

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
    const cached = Globals.logBuffer.find(e => e.event === 'ugc.candidate.accept' && e.data.cacheState === 'hit');
    assert.equal(cached.data.candidateTitle, '测试作品 第2季 第5集');
    assert.equal(cached.data.bvid, 'BVcandidate');
    assert.equal(cached.data.page, 1);
    assert.equal(cached.data.evidence.episodeBasis, 'explicit-episode');
  } finally { Globals.init({}); }
});

test('Carrie TV context retains identity and refuses a movie or conflicting compact year', () => {
  const ctx = buildUgcContext({ anime: { animeId: 58553, source: 'renren', animeTitle: '魔女嘉莉(2026)【电视剧】from renren', type: '电视剧', startDate: '2026-01-01' }, link: { title: '第01集' }, index: 0 });
  assert.equal(ctx.season, 1);
  assert.equal(ctx.year, 2026);
  assert.equal(ctx.mediaType, 'tv');
  assert(buildUgcQueries(ctx).includes('魔女嘉莉 2026 第1季 第1集'));
  for (const title of ['魔女嘉莉1976 第1集', '魔女嘉莉(1976) 第1集', '魔女嘉莉 电影 第1集', '魔女嘉莉 正片']) {
    assert.equal(selectUgcPages(ctx, video(title, [{ cid: 55, page: 1, part: '正片', duration: 6000 }])).length, 0, title);
  }
  assert.equal(selectUgcPages(ctx, video('魔女嘉莉 第1集')).length, 1, 'missing year remains allowed');
});

test('clearing comments also clears UGC; pending work cannot restore the old cache', async () => {
  const savedClear = ugcSupplement.clear;
  let cleared = 0;
  try {
    ugcSupplement.clear = () => { cleared++; };
    await handleClearCache(new Request('http://localhost/api/cache/clear', { method: 'POST', body: JSON.stringify({ items: ['commentCache'] }) }));
    assert.equal(cleared, 1);
  } finally { ugcSupplement.clear = savedClear; }
  const deps = dependencies();
  let release, searches = 0;
  const gate = new Promise(resolve => { release = resolve; });
  deps.source._getWbiMixinKey = async () => { if (++searches === 1) await gate; return 'key'; };
  const service = createUgcSupplement(deps);
  const pending = service.prepare(context);
  service.clear();
  release();
  await pending;
  await service.prepare(context);
  assert.equal(searches, 2);
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

test('isMovieFeatureFilmEpisode identifies feature films and rejects trailers/clips/boxoffice', () => {
  const anime = { animeTitle: '蜘蛛侠：崭新之日(2026)【电影】from tencent', aliases: ['Spider-Man: Brand New Day'] };
  // 必须识别为正片
  assert.equal(isMovieFeatureFilmEpisode({ episodeTitle: '正片' }, anime), true);
  assert.equal(isMovieFeatureFilmEpisode({ episodeTitle: '电影正片' }, anime), true);
  assert.equal(isMovieFeatureFilmEpisode({ episodeTitle: '完整版' }, anime), true);
  assert.equal(isMovieFeatureFilmEpisode({ episodeTitle: '蜘蛛侠：崭新之日' }, anime), true);
  assert.equal(isMovieFeatureFilmEpisode({ episodeTitle: '蜘蛛侠：崭新之日 1080P' }, anime), true);
  assert.equal(isMovieFeatureFilmEpisode({ episodeTitle: '第1集' }, anime), true);
  assert.equal(isMovieFeatureFilmEpisode({ episodeTitle: '全1集' }, anime), true);

  // 必须拒绝非正片（预告、花絮、战报、解说等）
  assert.equal(isMovieFeatureFilmEpisode({ episodeTitle: '【预告】崭新之日定档预告' }, anime), false);
  assert.equal(isMovieFeatureFilmEpisode({ episodeTitle: '【花絮】拍摄幕后特辑' }, anime), false);
  assert.equal(isMovieFeatureFilmEpisode({ episodeTitle: '票房突破10亿战报' }, anime), false);
  assert.equal(isMovieFeatureFilmEpisode({ episodeTitle: '首周末票房登顶纪念' }, anime), false);
  assert.equal(isMovieFeatureFilmEpisode({ episodeTitle: '高光打斗片段' }, anime), false);
  assert.equal(isMovieFeatureFilmEpisode({ episodeTitle: '彩蛋全解析' }, anime), false);
  assert.equal(isMovieFeatureFilmEpisode({ episodeTitle: '五分钟深度解说' }, anime), false);
});

test('calculateUgcTitlePrecision distinguishes full episodes from commentaries and fanedits', () => {
  const spiderCtx = { title: '蜘蛛侠：崭新之日', aliases: ['Spider-Man: Brand New Day'] };
  assert.ok(calculateUgcTitlePrecision('【4K 60帧】蜘蛛侠：崭新之日 (2026) 完整公映版 [中英双字]', spiderCtx) >= 0.8, '电影搬运准确率高');
  assert.ok(calculateUgcTitlePrecision('二刷《蜘蛛侠：崭新之日》全网最全细节解析与彩蛋盘点', spiderCtx) < 0.5, '影评解说准确率低');
  assert.ok(calculateUgcTitlePrecision('【木鱼微剧场】《蜘蛛侠：崭新之日》大结局，震撼人心的救赎', spiderCtx) < 0.5, '剧评准确率低');

  const linglongCtx = { title: '灵笼', aliases: [] };
  assert.ok(calculateUgcTitlePrecision('【幻月字幕组】灵笼 第01话 [1080P HEVC BDRip]', linglongCtx) >= 0.8, '番剧搬运准确率高');
  assert.ok(calculateUgcTitlePrecision('【灵笼】全剧最刀角色盘点，谁才是最意难平的那个？', linglongCtx) < 0.5, '角色盘点准确率低');

  const varietyCtx = { title: '披荆斩棘2026', aliases: [] };
  assert.ok(calculateUgcTitlePrecision('披荆斩棘2026 第8期', varietyCtx) >= 0.8, '综艺带年份标题准确率高');
});

test('selectUgcPages rejects low-precision commentary and short movie clips', () => {
  const movieCtx = { title: '蜘蛛侠：崭新之日', aliases: [], type: '电影', episode: 1 };
  const reasons = [];
  const onReject = r => reasons.push(r);

  // 1. 低准确率影评视频 -> 被 title-precision-low 拒绝
  const commentaryVideo = {
    bvid: 'BVcomm', aid: 1, title: '二刷《蜘蛛侠：崭新之日》全网最全细节解析与彩蛋盘点',
    pages: [{ cid: 101, page: 1, part: '解析', duration: 900 }]
  };
  assert.equal(selectUgcPages(movieCtx, commentaryVideo, onReject).length, 0);
  assert.ok(reasons.includes('title-precision-low'), '低准确率被拒绝');

  // 2. 标题准确但单P时长不足40分钟的短视频 -> 被 movie-duration-too-short 拒绝
  const shortClipVideo = {
    bvid: 'BVshort', aid: 2, title: '蜘蛛侠：崭新之日 完整版',
    pages: [{ cid: 102, page: 1, part: '正片', duration: 1200 }] // 20分钟
  };
  reasons.length = 0;
  assert.equal(selectUgcPages(movieCtx, shortClipVideo, onReject).length, 0);
  assert.ok(reasons.includes('movie-duration-too-short'), '电影时长不足被拒绝');

  // 3. 正常正片 (时长 > 40分钟, 准确率高) -> 成功通过
  const fullMovieVideo = {
    bvid: 'BVfull', aid: 3, title: '【1080P】蜘蛛侠：崭新之日 完整版',
    pages: [{ cid: 103, page: 1, part: '正片', duration: 7200 }] // 120分钟
  };
  const accepted = selectUgcPages(movieCtx, fullMovieVideo, onReject);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].cid, 103);
  assert.ok(accepted[0].precision >= MIN_UGC_TITLE_PRECISION);
});

test('pickUgcEpisode prioritizes higher title precision over lower precision candidates', () => {
  const lowPrec = { bvid: 'BVlow', searchCount: 10000, precision: 0.35, evidence: { episodeTitleMatched: false } };
  const highPrec = { bvid: 'BVhigh', searchCount: 500, precision: 1.0, evidence: { episodeTitleMatched: false } };
  assert.equal(pickUgcEpisode([lowPrec, highPrec]).bvid, 'BVhigh', '高准确率优先于纯弹幕量');
});


