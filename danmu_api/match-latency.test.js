import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from './configs/globals.js';
import { handleRequest } from './worker.js';
import { matchAniAndEp, searchAnime } from './apis/dandan-api.js';
import { addAnime } from './utils/cache-util.js';
import { getSourceByKey } from './sources/registry.js';

function reset(env = {}) {
  Globals.init({ SOURCE_ORDER: 'tencent,dandan', PLATFORM_ORDER: 'qq,dandan',
    TITLE_MAPPING_TABLE: '诛仙S04->诛仙 最终季', MATCH_SEARCH_BUDGET_MS: '25',
    MERGE_SOURCE_PAIRS: '', USE_BANGUMI_DATA: 'false', RATE_LIMIT_MAX_REQUESTS: '0', ...env });
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
  Globals.envs.mergeSourcePairs = [];
}

function anime(source = 'tencent', mixed = false) {
  return { animeId: source === 'tencent' ? 7001 : 7002, bangumiId: source === 'tencent' ? 'tx-final' : 'dd-final',
    animeTitle: `诛仙 最终季(2026)【动漫】from ${source}`, source, type: 'tvseries',
    aliases: source === 'dandan' ? ['诛仙 第四季'] : [], episodeCount: 9,
    links: Array.from({ length: 9 }, (_, i) => ({
      url: source === 'tencent' ? `https://v.qq.com/x/cover/test/ep${i + 1}.html` : String(70020001 + i),
      title: source === 'tencent' ? `【qq】 诛仙${mixed && i === 0 ? 3 : 4}_${String(i + 1).padStart(2, '0')}` : `【dandan】 第${i + 1}话`,
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

async function match() {
  const req = new Request('http://localhost/87654321/api/v2/match', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName: '诛仙 S04E09 第 9 集' }) });
  const response = await handleRequest(req, Globals.env);
  assert.equal(response.status, 200);
  return response.json();
}

async function waitForCompleteCache() {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const entry = Globals.searchCache.get('诛仙 最终季_S4');
    if (entry?.results?.some(item => item.source === 'dandan')) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('完整搜索未完成缓存');
}

test('真实命名：紧凑标题映射命中后，腾讯分集季号证据选中第四季第9集', async () => {
  reset();
  let networkCalls = 0;
  const restore = installSource('tencent', null, async () => { networkCalls++; throw new Error('目录命中不应联网'); });
  const details = new Map();
  addAnime(anime('dandan'), details);
  addAnime(anime(), details);
  try {
    const result = await match();
    assert.equal(result.isMatched, true);
    assert.equal(result.matches[0].animeId, 7001);
    assert.equal(result.matches[0].episodeTitle, '【tencent】 诛仙4_09');
    assert.ok(Globals.logBuffer.some(line => JSON.stringify(line).includes('本机标题映射')));
    assert.equal(networkCalls, 0);
  } finally { restore(); }
});

test('分集混有其他季度时不推断最终季季号；低优先源不能伪装成qq组命中', async () => {
  reset({ TITLE_MAPPING_TABLE: '' });
  const details = new Map();
  const mixed = anime('tencent', true);
  addAnime(mixed, details);
  let result = await matchAniAndEp(4, 9, null, { animes: [mixed] }, '诛仙', null, 'qq', null, null, details);
  assert.equal(result.resAnime, null);
  const lower = anime('dandan');
  addAnime(lower, details);
  result = await matchAniAndEp(4, 9, null, { animes: [lower] }, '诛仙', null, 'qq', null, null, details);
  assert.equal(result.resAnime, null);
  result = await matchAniAndEp(4, 9, null, { animes: [lower] }, '诛仙', null, 'dandan', null, null, details);
  assert.equal(result.resAnime.animeId, 7002);
});

test('首次自动匹配在优先源准确就绪后返回，慢源继续完成且部分结果不污染完整缓存', async () => {
  reset();
  let release;
  let slowFinished = false;
  const slow = new Promise(resolve => { release = resolve; });
  const restoreTx = installSource('tencent', anime());
  const restoreDd = installSource('dandan', anime('dandan'), async () => { await slow; slowFinished = true; return []; });
  try {
    const result = await match();
    assert.equal(result.matches[0].animeId, 7001);
    assert.equal(slowFinished, false, '返回无需等待挂起的慢源');
    assert.equal(Globals.searchCache.has('诛仙 最终季_S4'), false, '部分结果不能被写成完整缓存');
    release();
    await waitForCompleteCache();
    assert.equal(slowFinished, true);
  } finally { release(); restoreTx(); restoreDd(); }
});

test('无准确优先候选时不提前报空，等待慢源后使用低优先组', async () => {
  reset();
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const restoreTx = installSource('tencent', null);
  const restoreDd = installSource('dandan', anime('dandan'), async () => { await slow; return []; });
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

test('手动搜索与0预算仍等待全部来源', async () => {
  for (const manual of [true, false]) {
    reset({ MATCH_SEARCH_BUDGET_MS: '0' });
    let release;
    let finished = false;
    const slow = new Promise(resolve => { release = resolve; });
    const restoreTx = installSource('tencent', anime());
    const restoreDd = installSource('dandan', anime('dandan'), async () => { await slow; return []; });
    try {
      const pending = (manual ? searchAnime(new URL('http://localhost/api/v2/search/anime?keyword=诛仙&season=4&episode=9')) : match())
        .then(result => { finished = true; return result; });
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(finished, false);
      release();
      await pending;
      assert.equal(finished, true);
    } finally { release(); restoreTx(); restoreDd(); }
  }
});
