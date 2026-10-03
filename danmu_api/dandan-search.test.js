import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('dandan foreign search validates detail aliases and preserves explicit seasons', () => {
  const base = new URL('./', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { mock } from 'node:test';
    const base = ${JSON.stringify(base)};
    const { Globals } = await import(base + 'configs/globals.js');
    const http = await import(base + 'utils/http-util.js');
    const tmdb = await import(base + 'utils/tmdb-util.js');
    let original = [], fallback = [], converted = null, details = {};
    mock.module(base + 'utils/http-util.js', { namedExports: { ...http, httpGet: async url => {
      if (url.includes('/search/anime?')) return { data: { animes: structuredClone(original) } };
      if (url.includes('/search/episodes?')) return { data: { animes: structuredClone(fallback) } };
      throw new Error('unexpected network request: ' + url);
    } } });
    mock.module(base + 'utils/tmdb-util.js', { namedExports: { ...tmdb,
      getTmdbJaOriginalTitle: async (_, signal) => signal.aborted ? null : converted
    } });
    const { default: DandanSource } = await import(base + 'sources/dandan.js');
    const source = new DandanSource();
    source.getEpisodes = async id => ({ episodes: [{ episodeNumber: 1, episodeId: id * 100 + 1, episodeTitle: '第1集' }],
      titles: details[id] || [], relateds: [], type: 'tvseries', typeDescription: 'TV动画' });
    const anime = (id, title) => ({ animeId: id, animeTitle: title, startDate: '2026-01-01', typeDescription: 'TV动画' });
    async function run(keyword, expectedSearch, expectedFinal, season = null) {
      Globals.init({ SOURCE_ORDER: 'dandan', USE_BANGUMI_DATA: 'false', LOCAL_CACHE_ENABLED: 'false', LOG_LEVEL: 'error' });
      Globals.animes = []; Globals.episodeIds = []; Globals.episodeNum = 10001; Globals.lastSelectMap = new Map();
      Globals.queryCacheWritable = {}; Globals.queryCacheInitialized = false;
      const found = await source.search(keyword);
      assert.deepEqual(found.map(a => a.animeId), expectedSearch, keyword + ' search candidates');
      const results = [];
      await source.handleAnimes(found, keyword, results, new Map(), season);
      assert.deepEqual(results.map(a => a.animeId), expectedFinal, keyword + ' final alias/season validation');
      return found;
    }
    original = [anime(1, '再见，拉拉'), anime(2, '无关动画')]; details = { 1: ['Sayonara Lara'], 2: ['Unrelated Series'] };
    await run('Sayonara Lara', [1, 2], [1]);
    original = [anime(3, 'BanG Dream! It’s MyGO!!!!!'), anime(4, '我的女神')]; details = { 3: ['BanG Dream! It’s MyGO!!!!!'], 4: ['Aa! Megami-sama!'] };
    await run('mygo', [3], [3]);
    original = [anime(5, '再见，拉拉 第二季'), anime(6, '再见，拉拉 第三季')]; details = { 5: ['Sayonara Lara Season 2'], 6: ['Sayonara Lara Season 3'] };
    await run('Sayonara Lara Season 2', [5, 6], [5], 2);
    original = []; converted = { title: 'さよならララ', cnAlias: '再见，拉拉' };
    fallback = [anime(7, '再见，拉拉'), anime(8, '无关作品')]; details = { 7: ['Sayonara Lara'], 8: ['Unrelated Series'] };
    const relaxed = await run('Sayonara Lara', [7, 8], [7]);
    assert.ok(relaxed.every(a => !a.isTmdbSource && !a._tmdbCnAlias), 'foreign fallback requires alias verification');
    converted = null; fallback = []; original = [anime(9, '诛仙完结季'), anime(10, '其他动画')]; details = { 9: ['诛仙完结季'], 10: ['其他动画'] };
    await run('诛仙完结季', [9], [9]);
    original = [anime(11, '测试动画 第二季'), anime(12, '测试动画 第三季')]; details = { 11: ['测试动画 第二季'], 12: ['测试动画 第三季'] };
    await run('测试动画 第二季', [11], [11], 2);
  `;
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module'], {
    input: script, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, NODE_TEST_CONTEXT: '' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
