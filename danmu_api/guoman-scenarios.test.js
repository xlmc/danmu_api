import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Globals } from './configs/globals.js';
import { matchAnime } from './apis/player-api.js';
import { addAnime } from './utils/cache-util.js';
import { getSourceByKey } from './sources/registry.js';
import { collectAutoMatchCandidates, parseAutoMatchMappingRules } from './utils/auto-match-mapping-util.js';
import { applyRemoteTitleMappingText } from './utils/title-mapping-url-util.js';
import { refreshRemoteAutoMatchMappingNow } from './utils/auto-match-mapping-url-util.js';
import { titleMatches, buildTitleKeywordQueries, getTitleKeywordParts, compoundTitleMatches } from './utils/common-util.js';
import { filterTmdbMatchCandidates } from './utils/tmdb-match-util.js';
import { buildUgcQueries, buildUgcRequestContext, selectUgcPages } from './utils/bilibili-ugc-util.js';
import TencentSource from './sources/tencent.js';
const catalog = JSON.parse(fs.readFileSync(new URL('./fixtures/guoman-catalog.json', import.meta.url)));
const titles = fs.readFileSync(new URL('./fixtures/guoman-2026.txt', import.meta.url), 'utf8');
const seasons = fs.readFileSync(new URL('./fixtures/guoman-season-candidates.txt', import.meta.url), 'utf8');

const compoundQuery = '蓝猫淘气3000问之太空历险记';
test('主副标题联合匹配兼容分隔、数字与历险标题形式，保留系列和季号约束', () => {
  reset({ STRICT_TITLE_MATCH: 'true' });
  assert.deepEqual(buildTitleKeywordQueries(compoundQuery), ['蓝猫淘气3000问 太空历险记', '蓝猫淘气3000问 太空历险']);
  for (const title of ['蓝猫淘气3000问 太空历险', '藍貓淘氣三千問：太空歷險記']) {
    assert.equal(titleMatches(title, compoundQuery, 1), true, title);
  }
  for (const title of ['蓝猫淘气3000问 恐龙时代', '蓝猫淘气3000问 海洋世界', '其他动画系列 太空历险', '蓝猫淘气3000问 太空历险 第二季']) {
    assert.equal(titleMatches(title, compoundQuery, 1), false, title);
  }
  assert.equal(compoundTitleMatches('蓝猫淘气3000问 太空历险记续篇', compoundQuery), false);
  assert.equal(compoundTitleMatches('蓝猫淘气3000问 太空历险', '蓝猫淘气3000问之太空历险记续篇'), false);
  for (const title of ['天之骄子', '命运之夜', 'Test Series']) assert.equal(getTitleKeywordParts(title), null);
});

test('TMDB 主副标题候选仍需通过年份与身份检查', () => {
  reset();
  const identity = { key: 'tv:250974', tmdbId: '250974', mediaType: 'tv', aliases: [compoundQuery], year: 2005, seasonYear: 2005 };
  const good = { animeId: 1, animeTitle: '蓝猫淘气3000问 太空历险(2005)【动漫】from bilibili', startDate: '2005-01-01', type: '动漫', source: 'bilibili' };
  assert.deepEqual(filterTmdbMatchCandidates([good, { ...good, animeId: 2, tmdbId: '999' },
    { ...good, animeId: 3, startDate: '2020-01-01', animeTitle: good.animeTitle.replace('2005', '2020') },
    { ...good, animeId: 4, animeTitle: good.animeTitle.replace('太空历险', '恐龙时代') }], identity).map(item => item.animeId), [1]);
});

test('UGC 使用相同关键字并联合校验系列，拒绝错误年份、季集和解说', () => {
  reset();
  const context = buildUgcRequestContext({ title: compoundQuery, season: 1, episode: 1, year: 2005 });
  assert.ok(buildUgcQueries(context).some(query => query.startsWith('蓝猫淘气3000问 太空历险 ')));
  const video = { bvid: 'BVcompound', title: '蓝猫淘气三千问 太空历险 第1集 全集',
    pages: [{ cid: 1, page: 1, part: '第1集', duration: 600 }] };
  assert.equal(selectUgcPages(context, video).length, 1);
  for (const title of [video.title.replace('太空历险', '恐龙时代'), video.title + ' 解说',
    video.title + ' 第二季', video.title + ' 2020']) {
    assert.equal(selectUgcPages(context, { ...video, title }).length, 0, title);
  }
  assert.equal(selectUgcPages(context, { ...video, pages: [{ ...video.pages[0], part: '第2集' }] }).length, 0);
});

test('自动匹配以组合关键词回退，通过真实 B站目录处理并选中正确系列第1集', async t => {
  reset({ SOURCE_ORDER: 'bilibili', PLATFORM_ORDER: 'bilibili', STRICT_TITLE_MATCH: 'true',
    TITLE_MAPPING_TABLE: '', AUTO_MATCH_MAPPING_TABLE: '', TMDB_API_KEY: '', PROXY_URL: '',
    TITLE_MAPPING_TABLE_URL: '', AUTO_MATCH_MAPPING_TABLE_URL: '', BILIBILI_UGC_ENABLED: 'false', LOG_LEVEL: 'error' });
  const source = getSourceByKey('bilibili'), searched = [], details = [];
  const wrong = { provider: 'bilibili', mediaId: 'ss999', title: '蓝猫淘气3000问 恐龙时代', type: '动漫', year: 2005, episodeCount: 2 };
  const correct = { ...wrong, mediaId: 'ss888', title: '蓝猫淘气3000问 太空历险' };
  t.mock.method(source, 'search', async keyword => {
    searched.push(keyword);
    return keyword === '蓝猫淘气3000问 太空历险' ? [wrong, correct] : [wrong];
  });
  t.mock.method(source, 'getEpisodes', async id => {
    details.push(id);
    return [{ id: 88801, title: '第1话', link: 'https://www.bilibili.com/bangumi/play/ep88801' },
      { id: 88802, title: '第2话', link: 'https://www.bilibili.com/bangumi/play/ep88802' }];
  });
  const response = await matchAnime(new URL('http://localhost/api/v2/match'), new Request('http://localhost/api/v2/match', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName: compoundQuery + '.2005.S01E01.mkv' })
  }));
  const result = await response.json();
  assert.equal(result.isMatched, true, JSON.stringify({result,searched,details}));
  assert.match(result.matches[0].animeTitle, /太空历险/);
  assert.match(result.matches[0].episodeTitle, /第1话/);
  assert.deepEqual(searched, [compoundQuery, '蓝猫淘气3000问 太空历险记', '蓝猫淘气3000问 太空历险']);
  assert.deepEqual(details, ['ss888'], '无关系列不应读取分集详情');
});

function reset(extra = {}) {
  Globals.init({SOURCE_ORDER: 'tencent,bilibili,youku', PLATFORM_ORDER: 'tencent,bilibili,youku',
    TITLE_MAPPING_TABLE: titles.split('\n').filter(line => !line.startsWith('#')).join(';'),
    AUTO_MATCH_MAPPING_TABLE: seasons, USE_BANGUMI_DATA: 'false', MERGE_SOURCE_PAIRS: '',
    MATCH_SEARCH_BUDGET_MS: '0', RATE_LIMIT_MAX_REQUESTS: '0', REMEMBER_LAST_SELECT: 'false', LOG_LEVEL: 'error', ...extra });
  Globals.animes = []; Globals.episodeIds = []; Globals.episodeNum = 10001;
  Globals.searchCache = new Map(); Globals.commentCache = new Map(); Globals.favoriteCache = new Map();
  Globals.lastSelectMap = new Map(); Globals.requestHistory = new Map();
  Globals.localCacheValid = false; Globals.localRedisValid = false; Globals.redisValid = false; Globals.aiValid = false;
  Globals.envs.mergeSourcePairs = [];
}

async function endpoint(fileName, options = {}) {
  reset(options.env);
  if (options.remote) {
    const titleUrl = 'https://example.test/guoman-title.txt';
    const seasonUrl = 'https://example.test/guoman-season.txt';
    Globals.envs.titleMappingTableUrl = titleUrl;
    Globals.envs.autoMatchMappingTableUrl = seasonUrl;
    applyRemoteTitleMappingText(titleUrl, titles);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(seasons, { status: 200 });
    try { assert.equal((await refreshRemoteAutoMatchMappingNow()).success, true); }
    finally { globalThis.fetch = originalFetch; }
  }
  const restores = [];
  const searches = [];
  for (const platform of ['tencent', 'bilibili', 'youku']) {
    const source = getSourceByKey(platform);
    const search = source.search, handle = source.handleAnimes;
    source.search = async keyword => { searches.push({ platform, keyword }); return []; };
    source.handleAnimes = async (_items, _title, results, details) => {
      for (const anime of catalog.filter(item => item.source === platform && !options.exclude?.includes(item.bangumiId))) {
        const copy = structuredClone(anime);
        addAnime(copy, details);
        results.push(copy);
      }
    };
    restores.push(() => { source.search = search; source.handleAnimes = handle; });
  }
  try {
    const request = new Request('http://localhost/api/v2/match', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName }) });
    const response = await matchAnime(new URL(request.url), request, '127.0.0.1');
    return { result: await response.json(), searches };
  } finally { restores.forEach(restore => restore()); }
}

const cases = [
  ['神墓 S02E01', '神墓 辰南觉醒', '第17集'],
  ['Tomb.of.Fallen.Gods.S02E27.1080p.WEB-DL-HHWEB.mkv', '神墓 辰南觉醒', '第43集'],
  ['Shen.Mu.S03E01.mkv', '神墓 年番', '第1集'],
  ['IMMORTALITY.S02E01.mkv', '永生', '第13话'],
  ['Yong.Sheng.S03E16.mkv', '永生', '第40话'],
  ['永生 S04E01', '永生', '第41话'],
  ['永生 S01E41', '永生', '第41话'],
  ['Yi.Nian.Yong.Heng.2024.S03E01.mkv', '一念永恒 第3季', '第3季_01'],
  ['A.Will.Eternal.S01E107.mkv', '一念永恒 第3季', '第3季_01'],
  ['一念永恒 S01E106', '一念永恒 第2季', '_54'],
  ['一念永恒 S01E165', '一念永恒 第3季', '_59'],
  ['Jade.Dynasty.S02E01.mkv', '诛仙 第2季', '诛仙2_01'],
  ['Jade.Dynasty.S01E27.1080p.WEB-DL-ADWeb.mkv', '诛仙 第2季', '诛仙2_01'],
  ['诛仙 S03E26', '诛仙 第3季', '诛仙_26'],
  ['诛仙 S04E09', '诛仙 最终季', '诛仙4_09']
];
for (const [fileName, title, episodeTitle] of cases) test(`源站快照回放 /match: ${fileName}`, async () => {
  const { result } = await endpoint(fileName);
  assert.equal(result.isMatched, true, JSON.stringify(result));
  assert.ok(result.matches[0].animeTitle.startsWith(title), JSON.stringify(result.matches[0]));
  assert.ok(result.matches[0].episodeTitle.includes(episodeTitle), JSON.stringify(result.matches[0]));
});

test('同名标题能成功时，明确季集修正仍先参与', async () => {
  const { result, searches } = await endpoint('一念永恒 S01E107');
  assert.equal(result.isMatched, true);
  assert.equal(searches[0].keyword, '一念永恒 第3季');
});

test('远程缓存入口同样先修正季集，不被英文别名标题成功截断', async () => {
  const { result, searches } = await endpoint('IMMORTALITY.S04E01.mkv', {
    remote: true, env: { TITLE_MAPPING_TABLE: '', AUTO_MATCH_MAPPING_TABLE: '' }
  });
  assert.equal(result.isMatched, true);
  assert.ok(result.matches[0].episodeTitle.includes('第41话'));
  assert.equal(searches[0].keyword, '永生');
});

test('不猜发布组；范围外不采用季集偏移', () => {
  const rules = parseAutoMatchMappingRules(seasons).rules;
  assert.deepEqual(collectAutoMatchCandidates(rules, { title: '诛仙', season: 1, episode: 27 }), []);
  assert.deepEqual(collectAutoMatchCandidates(rules, { title: '神墓', season: 2, episode: 28 }), []);
  assert.equal(collectAutoMatchCandidates(rules, { title: '诛仙', season: 1, episode: 27, releaseGroups: ['ADWeb'] })[0].targetEpisode, 1);
});

test('相同条件冲突不按声明顺序任选；显式平台能够消除平台歧义', () => {
  const rules = parseAutoMatchMappingRules('作品 S01E1~E3 -> 甲 S01E11~E13 @tencent\n作品 S01E1~E3 -> 乙 S01E21~E23 @bilibili').rules;
  assert.deepEqual(collectAutoMatchCandidates(rules, { title: '作品', season: 1, episode: 2 }), []);
  assert.equal(collectAutoMatchCandidates(rules, { title: '作品', season: 1, episode: 2, preferredPlatform: 'qq' })[0].targetTitle, '甲');
});

test('目标平台缺失时，不把该偏移应用到其他源', async () => {
  const { result } = await endpoint('永生 S04E01', { env: {
    AUTO_MATCH_MAPPING_TABLE: '永生 S04E1~E16 -> 永生 S01E41~E56 @tencent'
  } });
  assert.ok(!result.matches.some(match => match.episodeTitle.includes('第41话')));
});

test('腾讯真实源预过滤允许完整第三季标题对应条目内部 S01，拒绝其他季', () => {
  reset({ STRICT_TITLE_MATCH: 'false' });
  assert.equal(new TencentSource().titleOrAliasMatches({ title: '一念永恒 第3季' }, '一念永恒 第3季', 1), true);
  assert.equal(titleMatches('一念永恒 第2季', '一念永恒 第3季', 1), false);
  assert.equal(titleMatches('一念永恒 第3季', '一念永恒', 1), false);
});
