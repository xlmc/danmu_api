import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from './configs/globals.js';
import { Envs } from './configs/envs.js';
import TencentSource from './sources/tencent.js';
import YoukuSource from './sources/youku.js';
import HongguoSource from './sources/hongguo.js';
import { selectTmdbEpisode, varietyKey } from './utils/tmdb-match-util.js';
import MangoSource from './sources/mango.js';
import IqiyiSource from './sources/iqiyi.js';
import BilibiliSource from './sources/bilibili.js';
import { getBangumi } from './apis/player-api.js';
import { handleRequest } from './worker.js';
import { getSourceByKey } from './sources/registry.js';

Globals.init({ LOG_LEVEL: 'error', PROXY_URL: '', LOCAL_CACHE_ENABLED: 'false' });
const response = data => new Response(JSON.stringify(data), { status: 200 });
const txPage = (items, params = {}) => ({ ret: 0, data: { module_list_datas: [{ module_datas: [{
  module_params: params, item_data_lists: { item_datas: items.map(item_params => ({ item_params })) }
}] }] } });

async function withFetch(fetch, body) {
  const saved = globalThis.fetch;
  globalThis.fetch = fetch;
  try { return await body(); } finally { globalThis.fetch = saved; }
}

test('腾讯发现初始响应中的纯享和先导分类，分页去重，源不按预告标记过滤', async () => {
  const calls = [];
  await withFetch(async (_url, options) => {
    const context = new URLSearchParams(JSON.parse(options.body).page_params.page_context);
    const chapter = context.get('chapter_name');
    calls.push(chapter);
    if (!chapter) return response(txPage([
      { vid: 'main', title: '第1期' },
      ...['正片', '纯享', '先导片', '特辑'].map(title => ({ title, page_context: `chapter_name=${title}` }))
    ]));
    if (chapter === '纯享') return response(txPage([
      { vid: 'pure', title: '先导片·沙滩小黑脚纯享：四旬老人沈腾四脚朝天' },
      { vid: 'main', title: '第1期' }, { vid: 'trailer', title: '预告', is_trailer: '1' }
    ], { has_next: context.get('page_num') === '0' ? 'true' : 'false' }));
    if (chapter === '先导片') return response(txPage([{ vid: 'pilot', title: '先导片' }]));
    assert.fail('不应请求无关分类');
  }, async () => {
    const eps = await new TencentSource().getEpisodes('cover');
    assert.deepEqual(eps.map(ep => ep.vid), ['main', 'pure', 'trailer', 'pilot']);
    assert.deepEqual(calls, [null, '纯享', '纯享', '先导片']);
  });
});

test('腾讯正常目录有分页时仍补分类；没有正片时也能读取纯享', async () => {
  for (const hasMain of [true, false]) {
    await withFetch(async (_url, options) => {
      const context = new URLSearchParams(JSON.parse(options.body).page_params.page_context);
      if (context.get('chapter_name') === '纯享') return response(txPage([{ vid: 'pure', title: '纯享' }]));
      if (context.get('page_num') === '1') return response(txPage([{ vid: 'main', title: '第1期' }]));
      return response(txPage([{ title: '纯享', page_context: 'chapter_name=纯享' }],
        hasMain ? { tabs: JSON.stringify([{ page_context: 'page_num=1' }]) } : {}));
    }, async () => {
      const eps = await new TencentSource().getEpisodes('cover');
      assert.deepEqual(eps.map(ep => ep.vid), hasMain ? ['main', 'pure'] : ['pure']);
    });
  }
});

test('芒果保留纯享、先导、预告和花絮，不再执行源内黑名单', async () => {
  const entries = [
    { video_id: 'main2', t1: '第2期', src_clip_id: 'cover' },
    { video_id: 'pure', t1: '第1期上纯享版', src_clip_id: 'cover' },
    { video_id: 'pilot', t1: '先导片：森林体验篇', src_clip_id: 'cover' },
    { video_id: 'main1', t1: '第1期', src_clip_id: 'cover' },
    { video_id: 'trailer', t1: '先导预告', isnew: '2', src_clip_id: 'cover' },
    { video_id: 'bonus', t1: '花絮', src_clip_id: 'cover' }
  ];
  await withFetch(async () => response({ data: { list: entries } }), async () => {
    assert.deepEqual((await new MangoSource().getEpisodes('cover')).map(ep => ep.video_id),
      ['main1', 'main2', 'pure', 'pilot', 'trailer', 'bonus']);
  });
});

test('爱奇艺分集目录不按正片类型剔除内容，并读取纯享和先导标签页', async () => {
  const ep = (id, title, content_type = 2) => ({ title, content_type, album_order: 1,
    play_url: `https://example.test/?tvid=${id}`, page_url: `https://www.iqiyi.com/v_${id}.html` });
  const block = (data, tag = '') => ({ bk_type: 'video_list', tag,
    data: { data: [{ videos: [{ data }] }] } });
  const source = new IqiyiSource();
  source._fetchBaseInfoData = async () => ({ status_code: 0, data: { template: { tabs: [
    { blocks: [block([ep('1', '第1期', 1), ep('2', '第1期纯享'), ep('3', '预告')], 'episodes')] },
    { title: '纯享', blocks: [block([ep('4', '沙滩小黑脚')])] },
    { title: '先导', blocks: [block([ep('5', '出发吧')])] },
    { title: '花絮', blocks: [block([ep('6', '采访')])] }
  ] } } });
  assert.deepEqual((await source.getEpisodes('123')).map(ep => ep.id), ['1', '3', '2', '4', '5']);
});

test('爱奇艺旧目录中纯享无正片集号仍保留', async () => {
  const source = new IqiyiSource();
  source._fetchBaseInfoData = async () => ({ status_code: 0, data: { template: { tabs: [{ blocks: [{
    bk_type: 'album_episodes', data: { data: [{ videos: { feature_paged: { 1: [
      { content_type: 2, title: '纯享', play_url: '?tvid=1', page_url: 'https://www.iqiyi.com/v_1.html' },
      { content_type: 2, title: '预告', play_url: '?tvid=2', page_url: 'https://www.iqiyi.com/v_2.html' }
    ] } } }] }
  }] }] } } });
  assert.deepEqual((await source.getEpisodes('123')).map(ep => ep.id), ['2', '1']);
});

test('B站详情缺少分类时查询 section 接口，保留纯享/先导并按视频 ID 去重', async () => {
  const main = { id: 1, aid: 10, cid: 11, title: '1' };
  const calls = [];
  await withFetch(async url => {
    calls.push(String(url));
    return response({ code: 0, result: String(url).includes('/season/section') ? {
      main_section: { episodes: [main] }, section: [
        { title: '纯享', episodes: [main, { id: 2, aid: 20, cid: 21, title: '纯享版' }] },
        { title: '先导片', episodes: [{ id: 3, aid: 30, cid: 31, title: '先导片' }] },
        { title: '预告', episodes: [{ id: 4, title: '预告' }] }
      ]
    } : { episodes: [main] } });
  }, async () => {
    const episodes = await new BilibiliSource()._getPgcEpisodes('123');
    assert.deepEqual(episodes.map(ep => ep.id), [1, 2, 3]);
    assert.equal(calls.length, 2);
  });
});

test('先导和纯享是否过滤仅由用户规则决定，不改写默认或自定义配置', () => {
  const original = Envs.env;
  try {
    Envs.env = { EPISODE_TITLE_FILTER: '预告|花絮' };
    const filter = Envs.resolveEpisodeTitleFilter();
    for (const title of ['先导片上：森林体验', '第1期纯享版', '先导片·沙滩小黑脚纯享'])
      assert.equal(filter.test(title), false, title);
    assert.equal(filter.test('先导预告'), true);
    Envs.env = { EPISODE_TITLE_FILTER: '纯享' };
    assert.equal(Envs.resolveEpisodeTitleFilter().test('第1期纯享'), true);
  } finally { Envs.env = original; }
});

test('B站附加分区中的分集能继续解析 CID 并生成弹幕请求', async () => {
  await withFetch(async () => response({ code: 0, result: { episodes: [], section: [{
    title: '纯享', episodes: [{ id: 2, aid: 20, cid: 21, duration: 600000, title: '纯享版' }]
  }] } }), async () => {
    const segments = await new BilibiliSource().getEpisodeDanmuSegments('https://www.bilibili.com/bangumi/play/ep2?season_id=123');
    assert.equal(segments.segmentList.length, 2);
    assert.match(segments.segmentList[0].url, /oid=21/);
  });
});

test('港澳台反代无 Key 搜索贯通分集回退，弹幕直连且账号凭据不发送给反代', async () => {
  Globals.init({ LOG_LEVEL: 'error', PROXY_URL: 'bilibili@https://reverse.example', LOCAL_CACHE_ENABLED: 'false',
    BILIBILI_COOKIE: 'SESSDATA=private-session; bili_jct=0123456789abcdef0123456789abcdef; access_key=0123456789abcdef0123456789abcdef' });
  const source = new BilibiliSource();
  const calls = [];
  const ep = { id: 2, aid: 20, cid: 21, title: '1', duration: 600000 };
  try {
    await withFetch(async (url, options) => {
      calls.push({ url: new URL(url), headers: new Headers(options.headers) });
      if (String(url).includes('/search/type')) return response({ code: 0, data: { result_is_recommend: 0, items: [
        { season_id: 1, title: '服务器公告', badge: '公告', area: '漫游' },
        { season_id: 123, title: '测试动画', goto: 'bangumi' }
      ] } });
      if (String(url).includes('/seg.so')) return new Response(new Uint8Array());
      if (String(url).includes('/season/section')) return response({ code: 0, result: { main_section: { episodes: [ep] } } });
      return response({ code: -404, message: 'not found' });
    }, async () => {
      const results = await source._searchOverseaRequest('测试动画', 7, 'media_bangumi');
      assert.deepEqual(results.map(row => row.mediaId), ['ss123']);
      assert.equal(results[0].type, '动漫');
      assert.equal(calls[0].url.searchParams.has('access_key'), false);
      const animes = [], details = new Map();
      await source.handleAnimes(results, '测试动画', animes, details);
      assert.equal(animes.length, 1);
      const segments = await source.getEpisodeDanmuSegments('https://www.bilibili.com/bangumi/play/ep2?season_id=123&area=hkmt');
      assert.equal(segments.segmentList.length, 2);
      await source.getEpisodeSegmentDanmu(segments.segmentList[0]);
      const proxied = calls.filter(call => call.url.host === 'reverse.example');
      assert.ok(proxied.some(call => call.url.pathname.includes('/season/section')));
      assert.ok(proxied.every(call => !call.headers.get('cookie') && !call.url.searchParams.has('access_key')));
      assert.equal(calls.at(-1).url.host, 'api.bilibili.com');
      assert.match(calls.at(-1).url.search, /oid=21/);
      calls.length = 0;
      await source.getEpisodes('ss123');
      assert.ok(calls.every(call => call.url.host === 'api.bilibili.com'));
      const rejected = [];
      await source.handleAnimes([{ mediaId: 'ss123', title: '其他作品', isOversea: true }], '测试动画', rejected, new Map());
      assert.equal(rejected.length, 0);
    });
    await withFetch(async () => response({ code: 0, data: { result_is_recommend: 1, items: [{ season_id: 123, title: '测试动画' }] } }), async () => {
      assert.deepEqual(await source._searchOverseaRequest('测试动画', 7, 'media_bangumi'), []);
    });
  } finally {
    Globals.init({ LOG_LEVEL: 'error', PROXY_URL: '', LOCAL_CACHE_ENABLED: 'false' });
  }
});

test('源保留的目录通过作品详情入口按设置过滤，关闭手动过滤时全部返回', async () => {
  for (const [filter, enabled, expected] of [
    ['预告', true, ['第1期', '第1期纯享', '先导片']],
    ['预告|纯享|先导', true, ['第1期']],
    ['预告|纯享|先导', false, ['第1期', '第1期纯享', '先导片', '预告']]
  ]) {
    Globals.init({ LOG_LEVEL: 'error', LOCAL_CACHE_ENABLED: 'false', SOURCE_ORDER: 'tencent',
      MERGE_SOURCE_PAIRS: '', EPISODE_TITLE_FILTER: filter, ENABLE_ANIME_EPISODE_FILTER: String(enabled) });
    Globals.animes = []; Globals.episodeIds = [];
    const source = new TencentSource();
    source.getEpisodes = async () => ['第1期', '第1期纯享', '先导片', '预告'].map((title, i) => ({ vid: `ep${i}`, title }));
    const details = new Map(), results = [];
    await source.handleAnimes([{ mediaId: 'fixture', title: '测试节目', type: '综艺', year: 2026 }], '测试节目', results, details, 1);
    const reply = await (await getBangumi('/api/v2/bangumi/fixture', details, 'tencent')).json();
    assert.equal(reply.success, true);
    assert.deepEqual(reply.bangumi.episodes.map(ep => ep.episodeTitle.replace(/^【tencent】 /, '')), expected);
  }
});


test('芒果完整标题贯通两期抢鲜版匹配，区分同日正片和加更', async () => {
  Globals.init({ LOG_LEVEL: 'error', PROXY_URL: '', LOCAL_CACHE_ENABLED: 'false',
    MERGE_SOURCE_PAIRS: '', ENABLE_ANIME_EPISODE_FILTER: 'false' });
  Globals.animes = []; Globals.episodeIds = [];
  const rows = [
    { video_id: '24718368', t1: '抢鲜版：厉娜许飞下周正片抢先看', t2: '2026-10-23',
      t3: '后会友期 抢鲜版第1期：厉娜许飞痛诉迟到十五年的心结' },
    { video_id: '24718369', t1: '抢鲜版：EP04正片真心话抢先看', t2: '2026-10-30',
      t3: '后会友期 抢鲜版第2期：火车进藏全员真心话大冒险' },
    { video_id: 'extra', t1: '加更版：厉娜怒怼许飞现场翻脸', t2: '2026-10-23',
      t3: '后会友期 加更版第1期：厉娜怒怼许飞现场翻脸' },
    { video_id: 'main', t1: '第1期：朋友再见', t2: '2026-10-23' }
  ].map(row => ({ ...row, src_clip_id: '914227' }));
  const source = new MangoSource(), results = [], details = new Map();
  await withFetch(async () => response({ data: { list: rows } }), async () => {
    await source.handleAnimes([{ mediaId: '914227', title: '后会友期', type: '综艺', year: 2026 }],
      '后会友期', results, details, 1);
  });
  const anime = [...details.values()][0];
  assert.match(anime.links[0].url, /main\.html$/, '正片排序不被有期号的抢鲜/加更版挤占');
  const episodes = item => item.links.map((link, i) => ({ episodeId: i + 1, episodeTitle: link.title, url: link.url }));
  const identity = { key: 'tv:338938', tmdbId: '338938', mediaType: 'tv', aliases: ['后会友期'],
    year: 2026, seasonYear: 2026, seasons: [{ season: 1, year: 2026 }] };
  for (const [issue, date, id] of [[1, '2026-10-23', '24718368'], [2, '2026-10-30', '24718369']]) {
    const metadata = { title: `抢鲜版第${issue}期：TMDB的不同描述`, airDate: date, year: 2026, targetSeason: 1 };
    const chosen = selectTmdbEpisode([anime], metadata, identity, episodes);
    assert.ok(chosen, `抢鲜版第${issue}期应匹配`);
    assert.match(chosen.resEpisode.url, new RegExp(`/${id}\\.html$`));
    assert.match(chosen.resEpisode.episodeTitle, new RegExp(`抢鲜版第${issue}期`));
    assert.equal(selectTmdbEpisode([anime], { ...metadata, airDate: '2026-10-24' }, identity, episodes), null);
    assert.equal(selectTmdbEpisode([{ ...anime, links: [...anime.links, { ...anime.links.find(link => link.url === chosen.resEpisode.url), url: 'https://www.mgtv.com/duplicate' }] }], metadata, identity, episodes), null);
  }
  assert.notEqual(varietyKey('抢鲜版第1期：描述'), varietyKey('第1期：描述'));
  assert.notEqual(varietyKey('抢鲜版第1期：描述'), varietyKey('加更版第1期：描述'));
  assert.notEqual(varietyKey('抢鲜版第1期上：描述'), varietyKey('抢鲜版第1期下：描述'));
  assert.equal(varietyKey('抢鲜版：EP04正片真心话抢先看'), null, '短标题的预览内容不能提供抢鲜版期号');
});

test('爱奇艺和优酷保留完整分集标题中的版本和真实期号', () => {
  const iqiyi = new IqiyiSource();
  const full = '抢鲜版第2期：完整分集描述';
  const iqiyiTitle = iqiyi._buildEpisodeTitle({ short_display_name: '抢鲜版', title: full, subtitle: '补充描述' });
  assert.ok(iqiyiTitle.includes(full));
  assert.ok(iqiyiTitle.includes('补充描述'));
  assert.equal(varietyKey(iqiyiTitle), varietyKey(full));
  const youku = new YoukuSource();
  const title = youku._formatEpisodeTitle({ displayName: '抢鲜版', title: full, published: '2026-10-30 12:00:00' }, 9, 'variety');
  assert.ok(title.includes(full));
  assert.ok(title.includes('2026-10-30'));
  assert.equal(varietyKey(title), varietyKey(full));
  const unnumbered = youku._formatEpisodeTitle({ displayName: '先导片下：出发' }, 9, 'variety');
  assert.equal(varietyKey(unnumbered), 'pilot::lower', '目录位置不能成为特别篇期号');
});

test('B站详情与搜索预览同时保留展示标题和长标题', async () => {
  Globals.init({ LOG_LEVEL: 'error', PROXY_URL: '', LOCAL_CACHE_ENABLED: 'false' });
  const source = new BilibiliSource();
  const ep = { id: 2, aid: 20, cid: 21, title: '先导片下', show_title: '先导片', long_title: '森林体验篇（下）' };
  await withFetch(async () => response({ code: 0, result: { episodes: [ep] } }), async () => {
    const episodes = await source.getEpisodes('ss123');
    assert.ok(episodes[0].title.includes(ep.long_title));
    assert.ok(episodes[0].title.includes(ep.title));
  });
  const results = [], details = new Map();
  await source.handleAnimes([{ mediaId: 'ss123', title: '测试动画', isOversea: true, _eps: [ep] }], '测试动画', results, details);
  assert.ok([...details.values()][0].links[0].title.includes(ep.long_title));
});

test('红果分集标题不截断末尾的期号和上下篇信息', async () => {
  const source = new HongguoSource();
  const title = '这是一段超过三十个字符的正式分集名称用于验证标题在目录转换后仍然完整 抢鲜版第2期下';
  source.request = async () => ({ data: { video_data: { video_list: [{ vid: 'full-title', vid_index: 1, episode_title: title }] } } });
  const result = await source.getEpisodes('title-series');
  assert.equal(result.episodes[0].title, title);
});


test('Infuse S00E03通过芒果完整标题自动对应抢鲜版，过滤开关仍有效', async t => {
  const source = getSourceByKey('imgo');
  t.mock.method(source, 'search', async () => [{ mediaId: '914227', title: '后会友期', type: '综艺', year: 2026 }]);
  await withFetch(async input => {
    const url = new URL(input);
    if (url.hostname === 'pcweb.api.mgtv.com') return response({ data: { list: [
      { src_clip_id: '914227', video_id: '24718368', t1: '抢鲜版：厉娜许飞下周正片抢先看', t2: '2026-10-23',
        t3: '后会友期 抢鲜版第1期：厉娜许飞痛诉迟到十五年的心结' }
    ] } });
    if (url.pathname.endsWith('/tv/338938')) return response({ id: 338938, name: '后会友期', first_air_date: '2026-10-22',
      seasons: [{ season_number: 0, air_date: '2026-10-23' }, { season_number: 1, air_date: '2026-10-22' }] });
    if (url.pathname.endsWith('/season/0/episode/3')) return response({ id: 123, season_number: 0, episode_number: 3,
      name: '第1季 抢鲜版第1期:厉娜许飞痛诉“心结”', air_date: '2026-10-23' });
    throw new Error(`Unexpected request: ${url}`);
  }, async () => {
    for (const enabled of [false, true]) {
      Globals.init({ TOKEN_AUTH_DISABLED: 'true', LOG_LEVEL: 'error', PROXY_URL: '', LOCAL_CACHE_ENABLED: 'false',
        LOCAL_REDIS_URL: '', SOURCE_ORDER: 'imgo', PLATFORM_ORDER: 'imgo', MATCH_SEARCH_BUDGET_MS: '0',
        MERGE_SOURCE_PAIRS: '', USE_BANGUMI_DATA: 'false', TITLE_MAPPING_TABLE: '', TITLE_MAPPING_TABLE_URL: '',
        AUTO_MATCH_MAPPING_TABLE: '', AUTO_MATCH_MAPPING_TABLE_URL: '', BILIBILI_UGC_ENABLED: 'false',
        REMEMBER_LAST_SELECT: 'false', TMDB_API_KEY: 'test-key', EPISODE_TITLE_FILTER: '抢鲜',
        ENABLE_ANIME_EPISODE_FILTER: String(enabled), RATE_LIMIT_MAX_REQUESTS: '0' });
      Globals.animes = []; Globals.episodeIds = []; Globals.episodeNum = 10001;
      Globals.searchCache = new Map(); Globals.lastSelectMap = new Map(); Globals.queryCacheInitialized = false;
      const result = await (await handleRequest(new Request('http://localhost/api/v2/match', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          fileName: '后会友期 S00E03 2160p.WEB-DL.AVC.AAC-ADWeb', tmdbId: 338938, mediaType: 'tv' })
      }), Globals.env, 'node', '127.0.0.1')).json();
      assert.equal(result.isMatched, !enabled, JSON.stringify(result));
      if (!enabled) assert.match(result.matches[0].episodeTitle, /抢鲜版第1期/);
    }
  });
});
