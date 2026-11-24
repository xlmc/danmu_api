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

test('特别季简称和 TMDB 季集都命中三源首期，日期目录的短片不会冒充正片', async t => {
  reset('tencent,youku,iqiyi');
  Globals.init({ ...Globals.env, TOKEN: '87654321', TMDB_API_KEY: 'fixture-key',
    PLATFORM_ORDER: 'tencent&youku&iqiyi', MERGE_SOURCE_PAIRS: 'tencent&youku&iqiyi' });
  const seasonTitle = '奔跑吧·大湾区篇';
  const fixture = {
    tencent: [{ title: '第1期：王祖蓝回归', airDate: '2026-11-21', duration: 8164 },
      { title: '第1期加更', airDate: '2026-11-21', duration: 1296 }],
    youku: ['特别篇', '高光时刻', '宣传视频', '机智闯关解锁大湾区', '熟人局', '惩罚特辑', '游戏特辑', '剪辑']
      .map((title, index) => ({ title: `2026-11-21 ${title}`, airDate: '2026-11-21', duration: index === 3 ? 8175 : 1800 + index })),
    iqiyi: [{ title: '第1期 王祖蓝回归' }],
  };
  const host = { tencent: 'v.qq.com', youku: 'v.youku.com', iqiyi: 'www.iqiyi.com' };
  for (const [index, [key, episodes]] of Object.entries(fixture).entries()) {
    const source = getSourceByKey(key);
    t.mock.method(source, 'search', async keyword => keyword.includes('大湾区篇') ? [key] : []);
    t.mock.method(source, 'handleAnimes', async (raw, _title, results, details) => {
      if (!raw.length) return;
      const anime = { animeId: 7000 + index, bangumiId: key + '-bay', animeTitle: `${seasonTitle}(2026)【综艺】from ${key}`,
        source: key, type: '综艺', typeDescription: '综艺', startDate: '2026-11-21', episodeCount: episodes.length,
        links: episodes.map((ep, i) => ({ ...ep, title: `【${key}】 ${ep.title}`, url: `https://${host[key]}/bay-${i}.html` })) };
      addAnime(anime, details);
      const { links, ...dto } = anime;
      results.push(dto);
    });
  }
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.pathname.endsWith('/search/tv')) return Response.json({ results: [url.searchParams.get('query') === '湾区节目别名'
      ? { id: 239871, name: seasonTitle } : { id: 239870, name: '奔跑吧·特别篇' }] });
    if (url.pathname.endsWith('/tv/239871')) return Response.json({ id: 239871, name: seasonTitle,
      alternative_titles: { results: [{ title: '湾区节目别名' }] } });
    if (url.pathname.endsWith('/tv/239870')) return Response.json({ id: 239870, name: '奔跑吧·特别篇',
      seasons: [{ season_number: 7, name: '大湾区篇', air_date: '2026-11-21' }] });
    if (url.pathname.endsWith('/season/7/episode/1')) return Response.json({ season_number: 7, episode_number: 1,
      name: '年轻的回答', air_date: '2026-11-21' });
    throw new Error('Unexpected fixture request: ' + url.pathname);
  });
  const primary = await (await searchEpisodes(request(new URLSearchParams({ anime: '奔跑吧 大湾篇' })))).json();
  const merged = primary.animes[0]?.episodes[0]?.url;
  assert.match(merged, /tencent:.*bay-0.*youku:.*bay-3/);
  assert.match(merged, /iqiyi:.*bay-0/);
  assert.equal(primary.animes[0].episodes.length, 2);
  assert.ok(primary.animes.some(item => item.animeTitle.endsWith('from youku') &&
    item.episodes.some(ep => ep.episodeTitle.includes('熟人局'))));

  const expected = [merged];
  const title = '奔跑吧·特别篇 S07E01';
  for (const query of [{ anime: title }, { anime: '奔跑吧 大湾篇', episode: '1' },
    { tmdbId: '239870', season: '7', episode: '1' }, { anime: '湾区节目别名', episode: '1' }]) {
    const data = await (await searchEpisodes(request(new URLSearchParams(query)))).json();
    assert.deepEqual(data.animes.flatMap(anime => anime.episodes.map(ep => ep.url)), expected, JSON.stringify(query));
  }
  const response = await handleRequest(new Request('http://localhost/87654321/api/v2/match', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName: title }),
  }), Globals.env);
  assert.deepEqual((await response.json()).matches.map(item => item.url), expected);
});
