import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from './configs/globals.js';
import { personLookupTitle, selectTmdbActorCandidate, selectBangumiPersonSubject, getDomesticPersonMetadataForTitle } from './utils/tmdb-util.js';
import { filterDanmusByBlockedNames, convertToDanmakuJson } from './utils/danmu-util.js';
import { getComment } from './apis/dandan-api.js';
import { addAnime, setCommentCache } from './utils/cache-util.js';

const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
function setup(key) {
  Globals.init({ BLOCK_DOMESTIC_CELEBRITIES: 'true', BLOCK_DOMESTIC_REGIONS: 'false', USE_BANGUMI_DATA: 'false', COMMENT_CACHE_MIN_COUNT: '0', TMDB_API_KEY: key, LOG_LEVEL: 'error' });
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  Globals.commentCache = new Map();
  Globals.localCacheValid = false;
  Globals.redisValid = false;
  Globals.localRedisValid = false;
}
async function mockFetch(fetcher, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { await run(); } finally { globalThis.fetch = previous; }
}

test('person lookup strips display metadata and refuses wrong years, ambiguous titles and other seasons', () => {
  assert.equal(personLookupTitle('沧元图(2023)【动漫】from youku'), '沧元图');
  assert.equal(personLookupTitle('沧元图 第二季(2024)【动漫】from tencent'), '沧元图 第二季');
  const entries = [2023, 2024].map((year, id) => ({ id, name: '沧元图', media_type: 'tv', first_air_date: `${year}-01-01` }));
  assert.equal(selectTmdbActorCandidate(entries, '沧元图(2023)【动漫】from youku').id, 0);
  assert.equal(selectTmdbActorCandidate(entries, '沧元图'), null);
  assert.equal(selectTmdbActorCandidate(entries, '沧元图(2025)'), null);
  assert.equal(selectTmdbActorCandidate(entries, '沧元图 第二季(2024)'), null);
  assert.equal(selectBangumiPersonSubject([{ id: 1, type: 2, name: '沧元图番外', date: '2023-01-01' }], '沧元图(2023)'), null);
});

test('cached comment API loads metadata, supplements animation roles and preserves ordinary words', async () => {
  setup('endpoint-test');
  Globals.envs.proxyUrl = 'animeko@https://bgm-proxy.example.com';
  const requests = [];
  await mockFetch(async (url, options) => {
    const parsed = new URL(url);
    requests.push(parsed.pathname);
    if (parsed.pathname === '/3/search/multi') {
      assert.equal(parsed.searchParams.get('query'), '沧元图');
      return response({ results: [{ id: 229192, name: '沧元图', media_type: 'tv', first_air_date: '2023-06-22', original_language: 'zh', genre_ids: [16] }] });
    }
    if (parsed.pathname.endsWith('/aggregate_credits')) return response({ cast: [{ name: '宝木中阳', roles: [{ character: '(voice)' }] }] });
    if (parsed.pathname.startsWith('/search/subject/')) {
      assert.equal(parsed.hostname, 'bgm-proxy.example.com', 'Bangumi respects existing proxy configuration');
      assert.equal(options.method, 'GET');
      assert.equal(decodeURIComponent(parsed.pathname.split('/').at(-1)), '沧元图');
      assert.match(options.headers['User-Agent'], /xlmc\/danmu_api/);
      return response({ list: [{ id: 403607, type: 2, name: '沧元图', air_date: '2023-06-22' }] });
    }
    if (parsed.pathname.endsWith('/characters')) {
      assert.equal(parsed.hostname, 'bgm-proxy.example.com');
      return response([{ name: '孟川' }, { name: '柳七月' }, { name: '晏烬' }]);
    }
    throw new Error(`Unexpected request ${parsed.pathname}`);
  }, async () => {
    const videoUrl = 'https://v.youku.com/v_show/id_person_test.html';
    addAnime({ animeId: 98111, animeTitle: '沧元图(2023)【动漫】from youku', type: 'tvseries', links: [{ url: videoUrl, title: '第1集' }] });
    const episodeId = Globals.animes[0].links[0].id;
    const comments = ['孟川', '孟川：来了', '晏烬', '柳七月好帅', '宝木中阳配得很好', '来了，宝', '身体安康', '白鹿原很好看'].map(m => ({ p: '1,1,16777215,test', m }));
    setCommentCache(videoUrl, comments);
    const body = await (await getComment(`/api/v2/comment/${episodeId}`, 'json', false, '127.0.0.1')).json();
    assert.deepEqual(body.comments.map(item => item.m), ['来了，宝', '身体安康', '白鹿原很好看']);
    await getComment(`/api/v2/comment/${episodeId}`, 'json', false, '127.0.0.1');
    assert.equal(requests.length, 4, 'complete person metadata is reused');
    assert.equal(Globals.commentCache.get(videoUrl).comments.length, 8, 'raw comment cache remains unfiltered');
    const metadata = await getDomesticPersonMetadataForTitle('沧元图(2023)【动漫】from youku');
    assert.equal(metadata.status, 'ready');
    assert.deepEqual(metadata.characterNames, ['孟川', '柳七月', '晏烬']);
    metadata.names.length = 0;
    assert.equal((await getDomesticPersonMetadataForTitle('沧元图(2023)【动漫】from youku')).names.length, 4);
    Globals.envs.blockDomesticCelebrities = false;
    const disabled = await (await getComment(`/api/v2/comment/${episodeId}`, 'json', false, '127.0.0.1')).json();
    assert.equal(disabled.count, 8);
  });
});

test('unavailable and incomplete metadata retries after five minutes, and foreign productions never use Bangumi', async () => {
  setup('retry-test');
  let attempts = 0;
  let stage = 'empty';
  let time = 1000000;
  const previousNow = Date.now;
  Date.now = () => time;
  try {
    await mockFetch(async url => {
      const parsed = new URL(url);
      if (parsed.pathname === '/3/search/multi') {
        attempts++;
        if (stage === 'empty') return response({ results: [] });
        return response({ results: [{ id: 555, name: '重试动画', media_type: 'tv', original_language: stage === 'foreign' ? 'ja' : 'zh', genre_ids: [16] }] });
      }
      if (parsed.pathname.endsWith('/aggregate_credits')) return response({ cast: [{ name: '张三丰', roles: [] }] });
      if (parsed.pathname.startsWith('/search/subject/')) return response({ list: [] });
      throw new Error('Unexpected request');
    }, async () => {
      assert.equal((await getDomesticPersonMetadataForTitle('重试动画')).status, 'unavailable');
      stage = 'partial';
      time += 299999;
      assert.equal((await getDomesticPersonMetadataForTitle('重试动画')).status, 'unavailable');
      assert.equal(attempts, 1);
      time += 2;
      const partial = await getDomesticPersonMetadataForTitle('重试动画');
      assert.equal(partial.status, 'partial');
      assert.deepEqual(partial.actorNames, ['张三丰']);
      assert.equal(attempts, 2);
      stage = 'foreign';
      time += 300001;
      assert.equal((await getDomesticPersonMetadataForTitle('重试动画')).status, 'not-domestic');
      assert.equal(attempts, 3);
    });
  } finally { Date.now = previousNow; }
});

test('manual person entries share standalone and punctuation matching without treating adjacent ordinary words as names', () => {
  setup('manual-test');
  Globals.envs.blockedWords = '@白鹿';
  const result = convertToDanmakuJson(['白鹿', '白鹿：来了', '白鹿原很好看'].map((m, i) => ({ p: `${i},1,16777215,test`, m })), 'test');
  assert.deepEqual(result.map(item => item.m), ['白鹿原很好看']);
  assert.equal(filterDanmusByBlockedNames([{ m: '白鹿原' }, { m: '身体安康' }], ['白鹿', '安康']).removedCount, 0);
});
