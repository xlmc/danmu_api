import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Globals } from './configs/globals.js';
import { matchAnime } from './apis/dandan-api.js';
import { addAnime } from './utils/cache-util.js';
import { getSourceByKey } from './sources/registry.js';
import { collectAutoMatchCandidates, parseAutoMatchMappingRules } from './utils/auto-match-mapping-util.js';
import { applyRemoteTitleMappingText } from './utils/title-mapping-url-util.js';
import { refreshRemoteAutoMatchMappingNow } from './utils/auto-match-mapping-url-util.js';
import { titleMatches } from './utils/common-util.js';
import TencentSource from './sources/tencent.js';
const catalog = JSON.parse(fs.readFileSync(new URL('./fixtures/guoman-catalog.json', import.meta.url)));
const titles = fs.readFileSync(new URL('./fixtures/guoman-2026.txt', import.meta.url), 'utf8');
const seasons = fs.readFileSync(new URL('./fixtures/guoman-season-candidates.txt', import.meta.url), 'utf8');

function reset(extra = {}) {
  Globals.init({TMDB_MATCH_ASSIST:'false',  SOURCE_ORDER: 'tencent,bilibili,youku', PLATFORM_ORDER: 'tencent,bilibili,youku',
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

for (const [fileName, title, episodeTitle] of cases) test('新模式首次匹配源站快照: '+fileName, async () => {
  const { result } = await endpoint(fileName, {env:{TMDB_MATCH_ASSIST:'true'}});
  assert.equal(result.isMatched,true,JSON.stringify(result));
  assert.ok(result.matches[0].animeTitle.startsWith(title),JSON.stringify(result.matches[0]));
  assert.ok(result.matches[0].episodeTitle.includes(episodeTitle),JSON.stringify(result.matches[0]));
});
