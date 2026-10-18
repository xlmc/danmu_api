import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from './configs/globals.js';
import { searchEpisodes, searchAnime } from './apis/player-api.js';
import { Anime } from './models/player-model.js';
import { addAnime } from './utils/cache-util.js';
import { getSourceByKey } from './sources/registry.js';
import { SUPPORTED_SOURCES } from './sources/policy.js';
import { handleRequest } from './worker.js';
import { assignInfuseEpisodeIds, clearInfuseEpisodeMappingsForTest, decodeInfuseEpisodeId, getInfuseEpisodeMapping, isInfuseEpisodeId, rememberInfuseEpisodeMapping } from './utils/infuse-util.js';
import { recoverInfuseEpisodeMapping } from './apis/player-api.js';

function reset(sourceOrder = 'tencent') {
  Globals.init({ SOURCE_ORDER: sourceOrder, MERGE_SOURCE_PAIRS: '', CUSTOM_MERGE_RULES: '',
    LOCAL_CACHE_ENABLED: 'false', LOCAL_REDIS_URL: '', BILIBILI_UGC_ENABLED: 'false',
    TITLE_MAPPING_TABLE: '', TITLE_MAPPING_TABLE_URL: '', USE_BANGUMI_DATA: 'false', LOG_LEVEL: 'error' });
  Globals.animes = []; Globals.episodeIds = []; Globals.episodeNum = 10001;
  Globals.searchCache = new Map(); Globals.lastSelectMap = new Map();
}

function record(details, source, links, title = '测试剧(2026)【电视剧】', id = 5001) {
  const anime = new Anime({ animeId: id, bangumiId: String(id), source, animeTitle: `${title}from ${source}`,
    type: '电视剧', typeDescription: '电视剧', startDate: '2026-01-01', episodeCount: links.length,
    links: links.map((link, index) => ({ title: `【${source}】 ${link.title}`, url: `https://${source}.test/${id}/${index}`, ...link })) });
  addAnime(anime, details);
  const { links: _, ...dto } = anime;
  return dto;
}

const response = animes => Response.json({ success: true, animes });
const request = query => new URL(`http://localhost/api/v2/search/episodes?${query}`);

test('Infuse retries TMDB original title only when the requested episode is absent', async () => {
  reset();
  const calls = [];
  const options = {
    tmdbTitleResolver: async () => ({ title: '译名', originalTitle: 'Original', year: 2026 }),
    searchAnimeFn: async (url, _id, _source, details) => {
      const title = url.searchParams.get('keyword'); calls.push(title);
      return response([record(details, 'tencent', [{ title: title === 'Original' ? '第2集' : '第1集' }], `${title}(2026)【电视剧】`, title === 'Original' ? 5002 : 5001)]);
    },
  };
  const data = await (await searchEpisodes(request('tmdbId=123&episode=2'), null, options)).json();
  assert.deepEqual(calls, ['译名', 'Original']);
  assert.equal(data.animes.length, 1);
  assert.equal(data.animes[0].episodes[0].episodeTitle, '第2集');
  calls.length = 0;
  await searchEpisodes(request('tmdbId=123&episode=1'), null, options);
  assert.deepEqual(calls, ['译名']);
});

test('Infuse supplements missing episodes with NAS sources without changing configured order', async () => {
  reset();
  const calls = [];
  const data = await (await searchEpisodes(request('anime=测试剧&episode=2'), null, {
    searchAnimeFn: async (_url, _id, _source, details, _platform, _refresh, _progress, _searches, sources, _ip, deadline) => {
      calls.push({ sources, deadline });
      return response([record(details, sources ? 'youku' : 'tencent', [{ title: sources ? '第2集' : '第1集' }])]);
    },
  })).json();
  assert.equal(data.animes.length, 1);
  assert.match(data.animes[0].animeTitle, /youku/);
  assert.deepEqual(Globals.animes.map(anime => anime.source), ['tencent', 'youku']);
  assert.equal(calls[0].sources, null);
  assert.ok(calls[1].sources.includes('youku'));
  assert.ok(calls[1].sources.every(source => SUPPORTED_SOURCES.includes(source) && source !== 'tencent'));
  assert.equal(calls[0].deadline, calls[1].deadline);
  assert.deepEqual(Globals.envs.sourceOrderArr, ['tencent']);
});

test('Infuse rejects previews and missing numbered episodes, and accepts source sort metadata', async () => {
  reset(SUPPORTED_SOURCES.join(','));
  const run = async (links, episode) => (await searchEpisodes(request(`anime=测试剧&episode=${episode}`), null, {
    searchAnimeFn: async (_url, _id, _source, details) => response([record(details, 'tencent', links)]),
  })).json();
  assert.deepEqual((await run([{ title: '第2集预告' }, { title: '第3集' }], 2)).animes, []);
  assert.deepEqual((await run([{ title: '无集号内容' }, { title: '第3集' }], 1)).animes, []);
  const data = await run([{ title: '篇章名', sort: 7 }], 7);
  assert.equal(data.animes[0].episodes[0].episodeTitle, '篇章名');
  const unnumbered = await run([{ title: '预告片' }, { title: '正片甲' }, { title: '正片乙' }], 2);
  assert.equal(unnumbered.animes[0].episodes[0].episodeTitle, '正片乙');
  assert.deepEqual((await run([{ title: '篇章名', sort: 7 }], 1)).animes, []);
});

test('Infuse treats tmdbIdType=1 and episode=1 as a feature and rejects editorial clips', async () => {
  reset(SUPPORTED_SOURCES.join(','));
  const data = await (await searchEpisodes(request('tmdbId=123&tmdbIdType=1&episode=1'), null, {
    tmdbTitleResolver: async () => ({ title: '测试电影', year: 2026 }),
    searchAnimeFn: async (_url, _id, _source, details) => response([
      record(details, 'tencent', [{ title: '正片' }, { title: '预告片' }], '测试电影(2026)【电影】'),
      record(details, 'youku', [{ title: '电影解说' }], '测试电影(2026)【电影】', 5002),
    ]),
  })).json();
  assert.equal(data.animes.length, 1);
  assert.deepEqual(data.animes[0].episodes.map(episode => episode.episodeTitle), ['正片']);
});

test('episode lookup returns completed sources without caching partial results or bounding ordinary search', async t => {
  reset('tencent,youku');
  let finishSlow;
  const slow = new Promise(resolve => { finishSlow = resolve; });
  t.mock.method(getSourceByKey('tencent'), 'search', async () => []);
  t.mock.method(getSourceByKey('youku'), 'search', () => slow);
  for (const source of ['tencent', 'youku']) {
    t.mock.method(getSourceByKey(source), 'handleAnimes', async (_raw, _title, animes, details) => {
      animes.push(record(details, source, [{ title: '第1集' }]));
    });
  }
  const url = new URL('http://localhost/api/v2/search/anime?keyword=测试剧');
  try {
    const result = await (await searchAnime(url, null, null, null, null, false, null, null, null, null, performance.now() + 30)).json();
    assert.deepEqual(result.animes.map(anime => anime.source), ['tencent']);
    assert.equal(Globals.searchCache.size, 0);
    let completed = false;
    const ordinary = searchAnime(url).then(result => { completed = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(completed, false);
    finishSlow([]);
    const full = await (await ordinary).json();
    assert.deepEqual(full.animes.map(anime => anime.source), ['tencent', 'youku']);
  } finally { finishSlow([]); }
});

test('completed bounded episode lookups reuse search results on reentry', async t => {
  reset('tencent,youku');
  const calls = { tencent: 0, youku: 0 };
  for (const source of Object.keys(calls)) {
    t.mock.method(getSourceByKey(source), 'search', async () => { calls[source]++; return []; });
    t.mock.method(getSourceByKey(source), 'handleAnimes', async (_raw, _title, animes, details) => {
      animes.push(record(details, source, [{ title: '第19集' }], '重进测试(2026)【电视剧】', source === 'tencent' ? 5011 : 5012));
    });
  }
  const url = request('anime=重进测试&episode=19');
  const first = await (await searchEpisodes(url)).json();
  assert.ok(first.animes.length > 0);
  assert.ok(Globals.searchCache.size > 0, 'all sources completed before the deadline');
  assert.deepEqual(await (await searchEpisodes(url)).json(), first);
  assert.deepEqual(calls, { tencent: 1, youku: 1 }, 'reentry must not repeat source searches');
});

test('a failed source keeps a bounded lookup out of the complete search cache', async t => {
  reset('tencent,youku');
  t.mock.method(getSourceByKey('tencent'), 'search', async () => []);
  t.mock.method(getSourceByKey('tencent'), 'handleAnimes', async (_raw, _title, animes, details) => {
    animes.push(record(details, 'tencent', [{ title: '第19集' }]));
  });
  t.mock.method(getSourceByKey('youku'), 'search', async () => { throw new Error('source unavailable'); });
  const data = await (await searchEpisodes(request('anime=失败源测试&episode=19'))).json();
  assert.ok(data.animes.length > 0);
  assert.equal(Globals.searchCache.size, 0, 'partial results must not masquerade as a full catalog');
});

test('Infuse episode IDs are safe, reversible and independent of candidate order', () => {
  const candidates = [
    { source: 'youku', title: '【youku】 第5集', url: 'https://v.youku.com/v_show/id_a.html' },
    { source: 'tencent', title: '【qq】 第5集', url: 'https://v.qq.com/x/cover/a/b.html' },
  ];
  const context = { tmdbId: 300146, mediaType: 'tv', episode: 5 };
  const ids = assignInfuseEpisodeIds(candidates, context);
  const reversedIds = assignInfuseEpisodeIds([...candidates].reverse(), context).reverse();

  assert.deepEqual(ids, reversedIds);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) {
    assert.equal(Number.isSafeInteger(id), true);
    assert.equal(isInfuseEpisodeId(id), true);
  }
  assert.deepEqual(decodeInfuseEpisodeId(ids[0]), {
    id: ids[0],
    tmdbId: 300146,
    mediaType: 'tv',
    episode: 5,
    source: 'youku',
    hash: decodeInfuseEpisodeId(ids[0]).hash,
  });
});

test('Infuse episode mappings survive an isolate-local memory reset through Cache API', async () => {
  const previousCaches = globalThis.caches;
  const entries = new Map();
  globalThis.caches = {
    default: {
      async put(request, response) { entries.set(request.url, response.clone()); },
      async match(request) { return entries.get(request.url)?.clone(); },
    },
  };

  try {
    clearInfuseEpisodeMappingsForTest();
    const [id] = assignInfuseEpisodeIds([
      { source: 'iqiyi', title: '【qiyi】 第1集', url: 'https://www.iqiyi.com/v_test.html' },
    ], { tmdbId: 123456, mediaType: 'movie', episode: 1 });
    const expected = {
      id,
      url: 'https://www.iqiyi.com/v_test.html',
      title: '【qiyi】 第1集',
      animeTitle: '测试电影(2026)【电影】',
      source: 'iqiyi',
    };

    await rememberInfuseEpisodeMapping(expected);
    clearInfuseEpisodeMappingsForTest();
    assert.deepEqual(await getInfuseEpisodeMapping(id), expected);
  } finally {
    clearInfuseEpisodeMappingsForTest();
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test('Infuse encoded IDs match upstream while preserving old IDs and rebuilding NAS context after restart', async t => {
  reset('youku');
  Globals.init({ ...Globals.env, TOKEN_AUTH_DISABLED: 'true', TMDB_API_KEY: 'offline-test-key',
    BLOCK_DOMESTIC_CELEBRITIES: 'false', RATE_LIMIT_MAX_REQUESTS: '0', PROXY_URL: '' });
  clearInfuseEpisodeMappingsForTest();
  t.after(clearInfuseEpisodeMappingsForTest);
  const videoUrl = 'https://v.youku.com/v_show/id_infuse.html';
  const source = getSourceByKey('youku');
  t.mock.method(source, 'search', async () => []);
  t.mock.method(source, 'handleAnimes', async (_raw, _title, animes, details) => {
    animes.push(record(details, 'youku', [{ title: '第25集', url: videoUrl }], '九门(2026)【电视剧】'));
  });
  t.mock.method(source, 'getComments', async () => [{ cid: 1, p: '1,1,16777215,0', m: '映射恢复后弹幕' }]);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 300146, name: '九门', original_name: '九门' }));
  const request = path => handleRequest(new Request('http://localhost/api/v2/' + path,
    { headers: { 'User-Agent': 'Infuse/8.5.5793' } }), Globals.env, 'node', '127.0.0.1');
  const data = await (await request('search/episodes?tmdbId=300146&episode=25')).json();
  const episode = data.animes[0].episodes[0];
  const [expectedId] = assignInfuseEpisodeIds([{ source: 'youku', url: videoUrl, title: '第25集' }],
    { tmdbId: 300146, mediaType: 'tv', episode: 25 });
  assert.equal(episode.episodeId, expectedId);
  assert.equal(episode.url, videoUrl);
  const mapping = await getInfuseEpisodeMapping(episode.episodeId);
  assert.equal(mapping.legacyEpisodeId, Globals.episodeIds[0].id);
  assert.equal(isInfuseEpisodeId(mapping.legacyEpisodeId), false);
  assert.ok(Globals.episodeNum < 20000, 'encoded IDs never enter the legacy allocation sequence');
  for (const id of [episode.episodeId, mapping.legacyEpisodeId]) {
    const response = await request('comment/' + id);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), null);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal((await response.json()).comments[0].m, '映射恢复后弹幕');
  }

  clearInfuseEpisodeMappingsForTest();
  Globals.animes = []; Globals.episodeIds = []; Globals.episodeNum = 20000;
  Globals.searchCache = new Map(); Globals.commentCache = new Map();
  Globals.init({ ...Globals.env, SOURCE_ORDER: 'tencent' });
  t.mock.method(getSourceByKey('tencent'), 'search', async () => { throw new Error('recovery must only search the encoded source'); });
  const recovered = await request('comment/' + episode.episodeId);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.headers.get('content-disposition'), null);
  assert.equal((await recovered.json()).comments[0].m, '映射恢复后弹幕');
  const rebuilt = await getInfuseEpisodeMapping(episode.episodeId);
  assert.equal(rebuilt.legacyEpisodeId, 20001);
  assert.equal(Globals.animes[0].links[0].id, rebuilt.legacyEpisodeId, 'UGC and filters retain the restored NAS context');
});

test('encoded IDs for retired providers cannot bypass the NAS source policy', async () => {
  clearInfuseEpisodeMappingsForTest();
  const [id] = assignInfuseEpisodeIds([{ source: 'dandan', url: 'dandan:123' }],
    { tmdbId: 123, mediaType: 'tv', episode: 1 });
  let called = false;
  assert.equal(await recoverInfuseEpisodeMapping(id, async () => { called = true; }), null);
  assert.equal(called, false);
});
