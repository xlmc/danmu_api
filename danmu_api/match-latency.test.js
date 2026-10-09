import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from './configs/globals.js';
import { handleRequest } from './worker.js';
import { getBangumi, matchAniAndEp, searchAnime, searchEpisodes, selectCollectionEpisode } from './apis/player-api.js';
import { buildUgcRequestContext, ugcSupplement } from './utils/bilibili-ugc-util.js';
import { addAnime } from './utils/cache-util.js';
import { getSourceByKey } from './sources/registry.js';

function reset(env = {}) {
  Globals.init({SOURCE_ORDER: 'tencent,bilibili', PLATFORM_ORDER: 'qq,bilibili',
    TITLE_MAPPING_TABLE: '诛仙S04->诛仙 最终季', MATCH_SEARCH_BUDGET_MS: '25',
    MERGE_SOURCE_PAIRS: '', USE_BANGUMI_DATA: 'false', RATE_LIMIT_MAX_REQUESTS: '0',
    LOCAL_CACHE_ENABLED: 'false', LOCAL_REDIS_URL: '', ...env });
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  Globals.searchCache = new Map();
  Globals.commentCache = new Map();
  Globals.favoriteCache = new Map();
  Globals.lastSelectMap = new Map();
  Globals.requestHistory = new Map();
  Globals.localCacheValid = false;
  Globals.localRedisValid = false;
  Globals.redisValid = false;
  Globals.aiValid = false;
}

function anime(source = 'tencent', mixed = false) {
  return { animeId: source === 'tencent' ? 7001 : 7002, bangumiId: source === 'tencent' ? 'tx-final' : 'dd-final',
    animeTitle: `诛仙 最终季(2026)【动漫】from ${source}`, source, type: 'tvseries',
    aliases: source === 'bilibili' ? ['诛仙 第四季'] : [], episodeCount: 9,
    links: Array.from({ length: 9 }, (_, i) => ({
      url: source === 'tencent' ? `https://v.qq.com/x/cover/test/ep${i + 1}.html` : String(70020001 + i),
      title: source === 'tencent' ? `【qq】 诛仙${mixed && i === 0 ? 3 : 4}_${String(i + 1).padStart(2, '0')}` : `【bilibili】 第${i + 1}话`,
    })) };
}

function installSource(source, data, search = async () => []) {
  const instance = getSourceByKey(source);
  const originalSearch = instance.search;
  const originalHandle = instance.handleAnimes;
  instance.search = search;
  instance.handleAnimes = async (_raw, _title, results, details) => {
    if (!data) return;
    addAnime(data, details);
    const { links, ...dto } = data;
    results.push(dto);
  };
  return () => { instance.search = originalSearch; instance.handleAnimes = originalHandle; };
}

async function match(fileName = '诛仙 S04E09 第 9 集') {
  const req = new Request('http://localhost/87654321/api/v2/match', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName }) });
  const response = await handleRequest(req, Globals.env);
  assert.equal(response.status, 200);
  return response.json();
}

async function waitForCompleteCache() {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const entry = [...Globals.searchCache.values()].find(value => value.results?.some(item => item.source === 'bilibili'));
    if (entry?.results?.some(item => item.source === 'bilibili')) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('完整搜索未完成缓存');
}

test('过滤番外保留原集号，自动匹配与分集搜索均能选择98集，缺集不按位置补选', async () => {
  reset({ SOURCE_ORDER: 'youku', PLATFORM_ORDER: 'youku', TITLE_MAPPING_TABLE: '',
    BILIBILI_UGC_ENABLED: 'false', TMDB_API_KEY: '', LOG_LEVEL: 'error',
    EPISODE_TITLE_FILTER: '番外', ENABLE_ANIME_EPISODE_FILTER: 'true' });
  const data = { animeId: 4283592, bangumiId: 'cangyuan', animeTitle: '沧元图(2023)【动漫】from youku',
    source: 'youku', type: '动漫', typeDescription: '动漫', startDate: '2023-01-01', episodeCount: 98,
    links: Array.from({ length: 98 }, (_, i) => ({ id: 10489 + i,
      title: `【youku】 第${i + 1}集 ${i >= 59 && i <= 65 ? '元初山番外篇' : i === 97 ? '战神' : '正片'}`,
      url: `https://v.youku.com/v_show/id_cangyuan${i + 1}.html` })) };
  const restore = installSource('youku', data, async () => [{ title: '沧元图' }]);
  try {
    const result = await match('沧元图 S01E98');
    assert.equal(result.isMatched, true);
    assert.equal(result.matches[0].episodeTitle, '【youku】 第98集 战神');
    const details = new Map([['cangyuan', data]]);
    const catalog = await (await getBangumi('/api/v2/bangumi/cangyuan', details, 'youku')).json();
    assert.equal(catalog.bangumi.episodes.length, 91);
    assert.equal(catalog.bangumi.episodes.at(-1).episodeNumber, '98');
    const episodes = await (await searchEpisodes(new URL('http://localhost/api/v2/search/episodes?anime=沧元图&episode=98'))).json();
    assert.equal(episodes.animes[0].episodes[0].episodeTitle, '【youku】 第98集 战神');
    const missing = await matchAniAndEp(1, 60, null, { animes: [data] }, '沧元图',
      new Request('http://localhost/api/v2/match'), null, null, null, details);
    assert.equal(missing.resEpisode, null);
  } finally {
    restore();
    Globals.logBuffer = [];
  }
});

test('合集文件名保留版本与单集身份，拒绝西部牛仔；UGC不等待慢源且保留Sen原始文件名', async () => {
  reset({ SOURCE_ORDER: 'tencent,youku', PLATFORM_ORDER: 'tencent,youku', TITLE_MAPPING_TABLE: '',
    BILIBILI_UGC_ENABLED: 'true', TMDB_API_KEY: '', PROXY_URL: '', LOG_LEVEL: 'info' });
  const fileName = '猫和老鼠：黄金时代合集（1940-1958） S01E01 甜蜜的家 Puss Gets the Boot';
  const wrong = { animeId: 7101, bangumiId: 'wrong-collection', source: 'tencent', type: '动漫',
    animeTitle: '猫和老鼠(1965)【动漫】from tencent', aliases: [], episodeCount: 2,
    links: [{ url: 'https://v.qq.com/x/cover/test/western.html', title: '【tencent】 第1集 西部牛仔' },
      { url: 'https://v.qq.com/x/cover/test/other.html', title: '【tencent】 第2集 其他短片' }] };
  const context = buildUgcRequestContext({ title: '猫和老鼠：黄金时代合集（1940-1958）',
    season: 1, episode: 1, episodeTitle: '甜蜜的家 Puss Gets the Boot', type: '电视剧' });
  const earlier = { ...wrong, animeTitle: '猫和老鼠(1940)【动漫】from tencent' };
  const getEpisodes = anime => anime.links.map(link => ({ episodeTitle: link.title, url: link.url, episodeId: 1 }));
  assert.equal(selectCollectionEpisode([wrong], context, getEpisodes), null);
  assert.equal(selectCollectionEpisode([earlier], context, getEpisodes), null);
  const sameShort = { ...earlier, links: [{ url: 'https://v.qq.com/x/cover/test/puss.html', title: '【tencent】 第3集 Puss Gets The Boot' }] };
  assert.equal(selectCollectionEpisode([sameShort], context, getEpisodes).resEpisode.episodeTitle, sameShort.links[0].title);
  const numberedContext = { ...context, episodeTitle: '' };
  assert.equal(selectCollectionEpisode([earlier], numberedContext, getEpisodes), null);
  const exactCollection = { ...earlier, animeTitle: context.collectionTitle + '【动漫】from tencent' };
  assert.equal(selectCollectionEpisode([exactCollection], numberedContext, getEpisodes).resEpisode.episodeTitle, earlier.links[0].title);
  let release, officialFinished = false, laterSearches = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const restore = installSource('tencent', wrong, async () => { await gate; officialFinished = true; return []; });
  const restoreLater = installSource('youku', null, async () => { laterSearches++; return []; });
  const savedPrepare = ugcSupplement.prepare;
  const comments = [{ p: '1,1,16777215,0', m: '确认短片内容' }];
  ugcSupplement.prepare = async supplied => {
    assert.equal(supplied.collectionTitle, context.collectionTitle);
    assert.deepEqual(supplied.yearRange, [1940, 1958]);
    assert.equal(supplied.episodeTitle, context.episodeTitle);
    return { result: { candidates: [{ bvid: 'BV1nD421W7Vx', cid: 1494560729, page: 1,
      title: context.episodeTitle, part: context.episodeTitle, url: 'https://www.bilibili.com/video/BV1nD421W7Vx/?p=1',
      evidence: { episodeTitleMatched: true, titlePrecision: 1 } }], accepted: [{ cid: 1494560729, comments,
        timeline: { status: 'metadata-matched', offsetSeconds: 0, validRange: [0, 739] } }], failures: [] } };
  };
  try {
    const req = new Request('http://localhost/87654321/api/v2/match', { method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'SenPlayer/test' }, body: JSON.stringify({ fileName }) });
    const response = await handleRequest(req, Globals.env, 'node', '127.0.0.1');
    const result = await response.json();
    assert.equal(result.isMatched, true);
    assert.equal(result.matches[0].type, 'B站投稿');
    assert.equal(officialFinished, false);
    assert.ok(Globals.logBuffer.some(line => line.data?.fileName === fileName && line.data?.userAgent === 'SenPlayer/test'));
    assert.ok(Globals.logBuffer.some(line => line.message.includes('year-outside-collection')));
  } finally {
    release();
    await new Promise(resolve => setImmediate(resolve));
    restore(); restoreLater(); ugcSupplement.prepare = savedPrepare; Globals.logBuffer = [];
  }
  assert.equal(laterSearches, 0);
});

test('真实命名：紧凑标题映射命中后，腾讯分集季号证据选中第四季第9集', async () => {
  reset();
  let networkCalls = 0;
  const restore = installSource('tencent', null, async () => { networkCalls++; throw new Error('目录命中不应联网'); });
  const details = new Map();
  addAnime(anime('bilibili'), details);
  addAnime(anime(), details);
  try {
    const result = await match();
    assert.equal(result.isMatched, true);
    assert.equal(result.matches[0].animeId, 7001);
    assert.equal(result.matches[0].episodeTitle, '【tencent】 诛仙4_09');
    assert.ok(Globals.logBuffer.some(line => JSON.stringify(line).includes('本机标题映射')));
    assert.equal(networkCalls, 0);
    const traceLines = Globals.logBuffer.filter(line => line.message.includes('[match-id='));
    assert.ok(traceLines.some(line => line.message.includes('解析身份')));
    assert.ok(traceLines.some(line => line.message.includes('最终选择')));
    assert.ok(traceLines.some(line => line.message.includes('总耗时')));
    assert.equal(new Set(traceLines.map(line => line.message.match(/\[match-id=([^\]]+)\]/)[1])).size, 1);
  } finally { restore(); }
});

test('分集混有其他季度时不推断最终季季号；低优先源不能伪装成qq组命中', async () => {
  reset({ TITLE_MAPPING_TABLE: '' });
  const details = new Map();
  const mixed = anime('tencent', true);
  addAnime(mixed, details);
  let result = await matchAniAndEp(4, 9, null, { animes: [mixed] }, '诛仙', null, 'qq', null, null, details);
  assert.equal(result.resAnime, null);
  const lower = anime('bilibili');
  addAnime(lower, details);
  result = await matchAniAndEp(4, 9, null, { animes: [lower] }, '诛仙', null, 'qq', null, null, details);
  assert.equal(result.resAnime, null);
  result = await matchAniAndEp(4, 9, null, { animes: [lower] }, '诛仙', null, 'bilibili', null, null, details);
  assert.equal(result.resAnime.animeId, 7002);
});

test('无合并的同组搜索可提前返回，组内慢源继续完成且缓存不污染手动全源搜索', async () => {
  reset({ PLATFORM_ORDER: 'tencent&bilibili' });
  let release;
  let slowFinished = false;
  const slow = new Promise(resolve => { release = resolve; });
  const restoreTx = installSource('tencent', anime());
  const restoreDd = installSource('bilibili', anime('bilibili'), async () => { await slow; slowFinished = true; return []; });
  try {
    const result = await match();
    assert.equal(result.matches[0].animeId, 7001);
    assert.equal(slowFinished, false, '返回无需等待挂起的慢源');
    assert.equal(Globals.searchCache.has('诛仙 最终季_S4'), false, '部分结果不能被写成完整缓存');
    const returned = Globals.logBuffer.findLast(line => line.message.includes('[match-trace] 请求返回'));
    const requestId = returned.message.match(/\[match-id=([^\]]+)\]/)[1];
    release();
    await waitForCompleteCache();
    assert.equal(slowFinished, true);
    const backgroundLine = Globals.logBuffer.findLast(line => line.message.includes('来源 bilibili 搜索 完成'));
    assert.ok(backgroundLine.message.includes(`[match-id=${requestId}]`));
    assert.ok(Globals.logBuffer.indexOf(backgroundLine) > Globals.logBuffer.indexOf(returned));
  } finally { release(); restoreTx(); restoreDd(); }
});

test('无准确优先候选时不提前报空，等待慢源后使用低优先组', async () => {
  reset();
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const restoreTx = installSource('tencent', null);
  const restoreDd = installSource('bilibili', anime('bilibili'), async () => { await slow; return []; });
  let finished = false;
  try {
    const pending = match().then(result => { finished = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(finished, false);
    release();
    const result = await pending;
    // 映射后的完整季名未命中时仍保留普通匹配回退。
    assert.equal(result.matches[0].animeId, 7002);
  } finally { release(); restoreTx(); restoreDd(); }
});

test('手动搜索仍等待全部来源，0预算自动匹配也不启动下一组', async () => {
  for (const manual of [true, false]) {
    reset({ MATCH_SEARCH_BUDGET_MS: '0' });
    let release;
    let finished = false;
    let slowStarted = false;
    const slow = new Promise(resolve => { release = resolve; });
    const restoreTx = installSource('tencent', anime());
    const restoreDd = installSource('bilibili', anime('bilibili'), async () => { slowStarted = true; await slow; return []; });
    try {
      const pending = (manual ? searchAnime(new URL('http://localhost/api/v2/search/anime?keyword=诛仙&season=4&episode=9')) : match())
        .then(result => { finished = true; return result; });
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(finished, !manual);
      assert.equal(slowStarted, manual);
      release();
      await pending;
      assert.equal(finished, true);
      if (!manual) assert.ok(Globals.logBuffer.some(line => line.message.includes('未启用：搜索预算关闭')));
    } finally { release(); restoreTx(); restoreDd(); }
  }
});

function resetMerge(env = {}) {
  reset({ SOURCE_ORDER: 'tencent,youku,bilibili', PLATFORM_ORDER: 'tencent&youku,bilibili', MERGE_SOURCE_PAIRS: 'tencent&youku', ...env });
}

function youkuAnime() {
  return { ...anime(), animeId: 7003, bangumiId: 'yk-final', source: 'youku',
    animeTitle: '诛仙 最终季(2026)【动漫】from youku',
    links: anime().links.map((link, i) => ({
      url: `https://v.youku.com/v_show/id_yk${i + 1}.html`, title: `【youku】 诛仙4_${String(i + 1).padStart(2, '0')}`,
    })) };
}

function mergeAnime(source) {
  const data = source === 'youku' ? youkuAnime() : anime(source);
  data.aliases = ['诛仙 第四季'];
  data.links = data.links.map((link, i) => ({ ...link, title: `【${source}】 第${i + 1}集` }));
  return data;
}

test('腾讯优酷合并：仅优酷命中时不启动组外搜索，0预算也遵循合并源优先', async () => {
  for (const budget of ['0', '25']) {
    resetMerge({ MATCH_SEARCH_BUDGET_MS: budget });
    const calls = [];
    const restores = [installSource('tencent', null, async () => { calls.push('tencent'); return []; }),
      installSource('youku', youkuAnime(), async () => { calls.push('youku'); return []; }),
      installSource('bilibili', anime('bilibili'), async () => { calls.push('bilibili'); return []; })];
    try {
      const result = await match();
      assert.equal(result.isMatched, true);
      assert.equal(result.matches[0].animeId, 7003);
      assert.deepEqual(calls.sort(), ['tencent', 'youku']);
      assert.equal(Globals.searchCache.has('诛仙 最终季_S4'), false);
      await match();
      assert.equal(calls.length, 2, '同范围的合并目录可以复用');
    } finally { restores.forEach(restore => restore()); }
  }
});

test('腾讯优酷均命中：等待慢副源并完成实际合并，不启动组外搜索', async () => {
  resetMerge({ TITLE_MAPPING_TABLE: '' });
  let release;
  let finished = false;
  const slow = new Promise(resolve => { release = resolve; });
  let outsideCalls = 0;
  const restores = [installSource('tencent', mergeAnime('tencent')),
    installSource('youku', mergeAnime('youku'), async () => { await slow; return []; }),
    installSource('bilibili', null, async () => { outsideCalls++; return []; })];
  try {
    const pending = match().then(result => { finished = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(finished, false, '合并前不能只返回主源');
    assert.equal(outsideCalls, 0);
    release();
    const result = await pending;
    assert.equal(result.isMatched, true);
    const merged = Globals.animes.find(item => item.animeId === result.matches[0].animeId);
    assert.ok(merged.links.some(link => link.url.includes('$$$')), '所选目录包含真实合并链接');
    assert.ok(result.matches[0].url.includes('$$$'), '真实匹配响应返回合并链接');
    assert.equal(outsideCalls, 0);
  } finally { release(); restores.forEach(restore => restore()); }
});

test('合并源有搜索结果但目标集缺失：验证失败后才回退组外源，组内搜索不重复', async () => {
  resetMerge({ TITLE_MAPPING_TABLE: '' });
  const calls = [];
  const incomplete = mergeAnime('youku');
  incomplete.links = incomplete.links.slice(0, 8);
  incomplete.episodeCount = 8;
  const restores = [installSource('tencent', null, async () => { calls.push('tencent'); return []; }),
    installSource('youku', incomplete, async () => { calls.push('youku'); return []; }),
    installSource('bilibili', anime('bilibili'), async () => {
      assert.ok(Globals.logBuffer.some(line => line.message.includes('平台组 tencent&youku 无可用匹配')));
      calls.push('bilibili'); return [];
    })];
  try {
    const result = await match();
    assert.equal(result.matches[0].animeId, 7002);
    assert.deepEqual(calls, ['tencent', 'youku', 'bilibili']);
  } finally { restores.forEach(restore => restore()); }
});

test('合并源均为空或失败：回退组外源', async () => {
  resetMerge({ TITLE_MAPPING_TABLE: '' });
  let outsideCalls = 0;
  const restores = [installSource('tencent', null, async () => { throw new Error('source unavailable'); }),
    installSource('youku', null), installSource('bilibili', anime('bilibili'), async () => { outsideCalls++; return []; })];
  try {
    const result = await match();
    assert.equal(result.matches[0].animeId, 7002);
    assert.equal(outsideCalls, 1);
  } finally { restores.forEach(restore => restore()); }
});

test('合并匹配目录不污染手动全源搜索；修改合并配置后使用新范围', async () => {
  resetMerge();
  const calls = [];
  const restores = [installSource('tencent', null, async () => { calls.push('tencent'); return []; }),
    installSource('youku', youkuAnime(), async () => { calls.push('youku'); return []; }),
    installSource('bilibili', anime('bilibili'), async () => { calls.push('bilibili'); return []; })];
  try {
    await match();
    const response = await searchAnime(new URL('http://localhost/api/v2/search/anime?keyword=诛仙 最终季&season=4&episode=9'));
    const data = await response.json();
    assert.ok(data.animes.some(item => item.source === 'bilibili'));
    assert.equal(calls.filter(source => source === 'bilibili').length, 1);
    Globals.envs.mergeSourcePairs = [{ primary: 'tencent', secondaries: ['bilibili'] }];
    Globals.env.MERGE_SOURCE_PAIRS = 'tencent&bilibili';
    Globals.env.PLATFORM_ORDER = 'tencent&bilibili,youku';
    await match();
    assert.equal(calls.filter(source => source === 'bilibili').length, 2);
  } finally { restores.forEach(restore => restore()); }
});

test('所有启用源都在合并组内时也返回完成合并的目录', async () => {
  resetMerge({ SOURCE_ORDER: 'tencent,youku', TITLE_MAPPING_TABLE: '' });
  const restores = [installSource('tencent', mergeAnime('tencent')), installSource('youku', mergeAnime('youku'))];
  try {
    const result = await match();
    assert.ok(result.matches[0].url.includes('$$$'));
  } finally { restores.forEach(restore => restore()); }
});

test('自定义合并只使用本平台组来源，不提前启动后续组；同组时仍合并', async () => {
  for (const sameGroup of [false, true]) {
    resetMerge({ TITLE_MAPPING_TABLE: '', PLATFORM_ORDER: sameGroup ? 'tencent&youku&bilibili' : 'tencent&youku,bilibili',
      CUSTOM_MERGE_RULES: '诛仙 最终季@bilibili -> 诛仙 最终季@tencent' });
    let bilibiliCalls = 0;
    const restores = [installSource('tencent', mergeAnime('tencent')), installSource('youku', null),
      installSource('bilibili', mergeAnime('bilibili'), async () => { bilibiliCalls++; return []; })];
    try {
      const result = await match();
      assert.equal(result.isMatched, true);
      assert.equal(bilibiliCalls, sameGroup ? 1 : 0);
      assert.equal(result.matches[0].url.includes('$$$'), sameGroup);
    } finally { restores.forEach(restore => restore()); }
  }
});

test('显式指定组外优先平台仍遵循用户偏好', async () => {
  resetMerge({ TITLE_MAPPING_TABLE: '' });
  const restores = [installSource('tencent', null), installSource('youku', youkuAnime()),
    installSource('bilibili', anime('bilibili'))];
  try {
    const result = await match('诛仙 S04E09 第 9 集 @bilibili');
    assert.equal(result.matches[0].animeId, 7002);
  } finally { restores.forEach(restore => restore()); }
});

test('PLATFORM_ORDER 控制实际搜索组；SOURCE_ORDER、多个合并组和后组缓存不能提前拉起 bilibili/红果', async () => {
  for (const budget of ['0', '25']) {
    resetMerge({ TITLE_MAPPING_TABLE: '', MATCH_SEARCH_BUDGET_MS: budget,
      SOURCE_ORDER: 'hongguo,bilibili,youku,tencent', PLATFORM_ORDER: 'tencent&youku,bilibili,hongguo',
      MERGE_SOURCE_PAIRS: 'tencent&youku,bilibili&hongguo' });
    // A cached lower-priority answer must not bypass an earlier group still searching.
    addAnime(anime('bilibili'), new Map());
    const calls = [];
    const restores = [installSource('tencent', null, async () => { calls.push('tencent'); return []; }),
      installSource('youku', mergeAnime('youku'), async () => { calls.push('youku'); return []; }),
      installSource('bilibili', anime('bilibili'), async () => { calls.push('bilibili'); return []; }),
      installSource('hongguo', null, async () => { calls.push('hongguo'); return []; })];
    try {
      const result = await match();
      assert.equal(result.matches[0].animeId, 7003);
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(calls, ['youku', 'tencent']);
    } finally { restores.forEach(restore => restore()); }
  }
});

test('组内并发，候选验证失败后才启动下一组；第二组命中时不启动第三组', async () => {
  resetMerge({ TITLE_MAPPING_TABLE: '', SOURCE_ORDER: 'hongguo,bilibili,youku,tencent',
    PLATFORM_ORDER: 'tencent&youku,bilibili,hongguo' });
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const incomplete = mergeAnime('youku');
  incomplete.links = incomplete.links.slice(0, 8);
  const restores = [installSource('tencent', null, async () => { calls.push('tencent'); return []; }),
    installSource('youku', incomplete, async () => { calls.push('youku'); await gate; return []; }),
    installSource('bilibili', anime('bilibili'), async () => { calls.push('bilibili'); return []; }),
    installSource('hongguo', null, async () => { calls.push('hongguo'); return []; })];
  let pending;
  try {
    pending = match();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(calls, ['youku', 'tencent'], '优酷挂起时腾讯已启动、后续组未启动');
    release();
    const result = await pending;
    assert.equal(result.matches[0].animeId, 7002);
    assert.deepEqual(calls, ['youku', 'tencent', 'bilibili']);
  } finally { release(); if (pending) await pending; restores.forEach(restore => restore()); }
});

test('组重叠复用来源搜索，最后才搜索未列入 PLATFORM_ORDER 的启用源', async () => {
  resetMerge({ TITLE_MAPPING_TABLE: '', MERGE_SOURCE_PAIRS: '', TMDB_API_KEY: '', PROXY_URL: '',
    SOURCE_ORDER: 'hongguo,bilibili,youku,tencent', PLATFORM_ORDER: 'tencent&youku,youku&bilibili,tencent&youku' });
  const calls = [];
  const restores = ['hongguo', 'bilibili', 'youku', 'tencent'].map(source =>
    installSource(source, null, async () => { calls.push(source); return []; }));
  try {
    const result = await match();
    assert.equal(result.isMatched, false);
    assert.deepEqual(calls, ['youku', 'tencent', 'bilibili', 'hongguo']);
  } finally { restores.forEach(restore => restore()); }
});

test('平台排序变更即时改变搜索首组，不复用旧首组候选跳过新优先级', async () => {
  resetMerge({ TITLE_MAPPING_TABLE: '', MERGE_SOURCE_PAIRS: '', MATCH_SEARCH_BUDGET_MS: '0',
    PLATFORM_ORDER: 'youku,bilibili', SOURCE_ORDER: 'youku,bilibili' });
  const calls = [];
  const restores = [installSource('youku', mergeAnime('youku'), async () => { calls.push('youku'); return []; }),
    installSource('bilibili', anime('bilibili'), async () => { calls.push('bilibili'); return []; })];
  try {
    assert.equal((await match()).matches[0].animeId, 7003);
    assert.deepEqual(calls, ['youku']);
    Globals.env.PLATFORM_ORDER = 'bilibili,youku';
    assert.equal((await match()).matches[0].animeId, 7002);
    assert.deepEqual(calls, ['youku', 'bilibili']);
  } finally { restores.forEach(restore => restore()); }
});

test('没有 PLATFORM_ORDER 时全源并发；禁用来源不因平台组配置而启动', async () => {
  for (const platformOrder of ['', 'tencent&youku,hongguo']) {
    resetMerge({ TITLE_MAPPING_TABLE: '', MERGE_SOURCE_PAIRS: '', SOURCE_ORDER: 'youku,bilibili',
      PLATFORM_ORDER: platformOrder, MATCH_SEARCH_BUDGET_MS: '0' });
    const calls = [];
    const restores = [installSource('youku', mergeAnime('youku'), async () => { calls.push('youku'); return []; }),
      installSource('bilibili', anime('bilibili'), async () => { calls.push('bilibili'); return []; }),
      installSource('tencent', null, async () => { calls.push('tencent'); return []; }),
      installSource('hongguo', null, async () => { calls.push('hongguo'); return []; })];
    try {
      assert.equal((await match()).isMatched, true);
      assert.deepEqual(calls, platformOrder ? ['youku'] : ['youku', 'bilibili']);
    } finally { restores.forEach(restore => restore()); }
  }
});

test('平台限定映射只查询指定源，失败后普通路径恢复 PLATFORM_ORDER', async () => {
  resetMerge({ TITLE_MAPPING_TABLE: '', AUTO_MATCH_MAPPING_TABLE: '诛仙 S04E09 -> 不存在 S04E09 @bilibili' });
  const calls = [];
  const restores = ['tencent', 'youku', 'bilibili'].map(source => installSource(source,
    source === 'youku' ? mergeAnime('youku') : null, async title => { calls.push([source, title]); return []; }));
  try {
    assert.equal((await match()).matches[0].animeId, 7003);
    assert.deepEqual(calls, [['bilibili', '不存在'], ['tencent', '诛仙'], ['youku', '诛仙']]);
  } finally { restores.forEach(restore => restore()); }
});
