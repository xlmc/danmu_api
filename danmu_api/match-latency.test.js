import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from './configs/globals.js';
import { handleRequest } from './worker.js';
import { matchAniAndEp, searchAnime } from './apis/dandan-api.js';
import { addAnime } from './utils/cache-util.js';
import { getSourceByKey } from './sources/registry.js';

function reset(env = {}) {
  Globals.init({SOURCE_ORDER: 'tencent,dandan', PLATFORM_ORDER: 'qq,dandan',
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
    const returned = Globals.logBuffer.findLast(line => line.message.includes('[match-trace] 请求返回'));
    const requestId = returned.message.match(/\[match-id=([^\]]+)\]/)[1];
    release();
    await waitForCompleteCache();
    assert.equal(slowFinished, true);
    const backgroundLine = Globals.logBuffer.findLast(line => line.message.includes('来源 dandan 搜索 完成'));
    assert.ok(backgroundLine.message.includes(`[match-id=${requestId}]`));
    assert.ok(Globals.logBuffer.indexOf(backgroundLine) > Globals.logBuffer.indexOf(returned));
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
      if (!manual) assert.ok(Globals.logBuffer.some(line => line.message.includes('未启用：搜索预算关闭')));
    } finally { release(); restoreTx(); restoreDd(); }
  }
});

function resetMerge(env = {}) {
  reset({ SOURCE_ORDER: 'tencent,youku,dandan', PLATFORM_ORDER: 'tencent&youku,dandan', MERGE_SOURCE_PAIRS: 'tencent&youku', ...env });
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
      installSource('dandan', anime('dandan'), async () => { calls.push('dandan'); return []; })];
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
    installSource('dandan', null, async () => { outsideCalls++; return []; })];
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
  const incomplete = youkuAnime();
  incomplete.links = incomplete.links.slice(0, 8);
  incomplete.episodeCount = 8;
  const restores = [installSource('tencent', null, async () => { calls.push('tencent'); return []; }),
    installSource('youku', incomplete, async () => { calls.push('youku'); return []; }),
    installSource('dandan', anime('dandan'), async () => {
      assert.ok(Globals.logBuffer.some(line => line.message.includes('配置合并源无可用匹配')));
      calls.push('dandan'); return [];
    })];
  try {
    const result = await match();
    assert.equal(result.matches[0].animeId, 7002);
    assert.deepEqual(calls, ['tencent', 'youku', 'dandan']);
  } finally { restores.forEach(restore => restore()); }
});

test('合并源均为空或失败：回退组外源', async () => {
  resetMerge({ TITLE_MAPPING_TABLE: '' });
  let outsideCalls = 0;
  const restores = [installSource('tencent', null, async () => { throw new Error('source unavailable'); }),
    installSource('youku', null), installSource('dandan', anime('dandan'), async () => { outsideCalls++; return []; })];
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
    installSource('dandan', anime('dandan'), async () => { calls.push('dandan'); return []; })];
  try {
    await match();
    const response = await searchAnime(new URL('http://localhost/api/v2/search/anime?keyword=诛仙 最终季&season=4&episode=9'));
    const data = await response.json();
    assert.ok(data.animes.some(item => item.source === 'dandan'));
    assert.equal(calls.filter(source => source === 'dandan').length, 1);
    Globals.envs.mergeSourcePairs = [{ primary: 'tencent', secondaries: ['dandan'] }];
    Globals.env.MERGE_SOURCE_PAIRS = 'tencent&dandan';
    await match();
    assert.equal(calls.filter(source => source === 'dandan').length, 2);
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

test('自定义合并关联来源纳入首轮范围', async () => {
  resetMerge({ TITLE_MAPPING_TABLE: '', CUSTOM_MERGE_RULES: '诛仙 最终季@dandan -> 诛仙 最终季@tencent' });
  let outsideCalls = 0;
  const restores = [installSource('tencent', mergeAnime('tencent')), installSource('youku', null),
    installSource('dandan', mergeAnime('dandan'), async () => { outsideCalls++; return []; })];
  try {
    const result = await match();
    assert.equal(result.isMatched, true);
    assert.equal(outsideCalls, 1);
    assert.ok(result.matches[0].url.includes('$$$'));
  } finally { restores.forEach(restore => restore()); }
});

test('显式指定组外优先平台仍遵循用户偏好', async () => {
  resetMerge({ TITLE_MAPPING_TABLE: '' });
  const restores = [installSource('tencent', null), installSource('youku', youkuAnime()),
    installSource('dandan', anime('dandan'))];
  try {
    const result = await match('诛仙 S04E09 第 9 集 @dandan');
    assert.equal(result.matches[0].animeId, 7002);
  } finally { restores.forEach(restore => restore()); }
});
