import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from './configs/globals.js';
import { searchEpisodes, searchAnime } from './apis/player-api.js';
import { Anime } from './models/player-model.js';
import { addAnime, findUrlById } from './utils/cache-util.js';
import { getSourceByKey } from './sources/registry.js';
import { SUPPORTED_SOURCES } from './sources/policy.js';
import { handleRequest } from './worker.js';

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

test('Episode lookup retries TMDB original title only when the requested episode is absent', async () => {
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
  const selected = data.animes[0].episodes[0];
  assert.equal(findUrlById(selected.episodeId), selected.url);
  calls.length = 0;
  await searchEpisodes(request('tmdbId=123&episode=1'), null, options);
  assert.deepEqual(calls, ['译名']);
});

test('Episode lookup supplements missing episodes with NAS sources without changing configured order', async () => {
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

test('Episode lookup rejects previews and missing numbered episodes, and accepts source sort metadata', async () => {
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

test('Episode lookup treats tmdbIdType=1 and episode=1 as a feature and rejects editorial clips', async () => {
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


test('完整限时查询可复用缓存，强制刷新不读取通用缓存', async t => {
  reset('tencent');
  let searches = 0;
  t.mock.method(getSourceByKey('tencent'), 'search', async () => { searches++; return []; });
  t.mock.method(getSourceByKey('tencent'), 'handleAnimes', async (_raw, _title, animes, details) => {
    animes.push(record(details, 'tencent', [{ title: '第1集' }]));
  });
  const url = request('keyword=测试剧');
  await searchAnime(url, null, null, null, null, false, null, null, null, null, performance.now() + 1000);
  await searchAnime(url);
  assert.equal(searches, 1);
  url.searchParams.set('season', '1');
  url.searchParams.set('episode', '1');
  await searchAnime(url, null, null, null, null, true);
  assert.equal(searches, 2);
});
