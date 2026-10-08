import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from './configs/globals.js';
import { Envs } from './configs/envs.js';
import TencentSource from './sources/tencent.js';
import MangoSource from './sources/mango.js';
import IqiyiSource from './sources/iqiyi.js';
import BilibiliSource from './sources/bilibili.js';
import { getBangumi } from './apis/player-api.js';

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
