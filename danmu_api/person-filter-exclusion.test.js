import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from './configs/globals.js';
import { shouldBlockDomesticCelebrities, splitPersonFilterExcludedTitles } from './utils/person-filter-exclusion-util.js';
import { applyRemoteTitleMappingText, resolveLocalTitleMapping } from './utils/title-mapping-url-util.js';
import { getComment, getCommentByUrl, getSegmentComment } from './apis/dandan-api.js';
import { getSourceByKey } from './sources/registry.js';
import { convertToDanmakuJson } from './utils/danmu-util.js';
import { setCommentCache } from './utils/cache-util.js';
import { previewJsContent } from './ui/js/preview.js';
import { cachedPersonSource, personCacheIdentity } from './utils/person-source-cache.js';

const enabled = { BLOCK_DOMESTIC_CELEBRITIES: 'true', PERSON_FILTER_EXCLUDED_TITLES: '诛仙4' };

test('人物免屏蔽名单支持别名、季度、映射优先级及配置更新', async t => {
  await t.test('默认行为与名单分隔符', async () => {
    assert.deepEqual(splitPersonFilterExcludedTitles('诛仙4，凡人修仙传;诛仙4\n斗破苍穹； '), ['诛仙4', '凡人修仙传', '斗破苍穹']);
    Globals.init({});
    assert.equal(await shouldBlockDomesticCelebrities('诛仙4'), false);
    Globals.init(enabled);
    assert.equal(await shouldBlockDomesticCelebrities('诛仙 第四季(2026)【国产动漫】from tencent'), false);
    assert.equal(await shouldBlockDomesticCelebrities('诛仙3'), true);
    assert.equal(await shouldBlockDomesticCelebrities('诛仙'), true);
    assert.equal(await shouldBlockDomesticCelebrities('诛仙完结季'), true);
    assert.equal(await shouldBlockDomesticCelebrities('新诛仙4'), true);
    assert.equal(await shouldBlockDomesticCelebrities(''), true);
    Globals.init({ ...enabled, PERSON_FILTER_EXCLUDED_TITLES: '86' });
    assert.equal(await shouldBlockDomesticCelebrities('86(2021)【动漫】from bilibili'), false);
  });

  await t.test('本地季号映射及反向填写正式名称', async () => {
    Globals.init({ ...enabled, TITLE_MAPPING_TABLE: '诛仙S04->诛仙完结季' });
    assert.equal(await shouldBlockDomesticCelebrities('诛仙完结季(2026)【国产动漫】from tencent'), false);
    assert.equal(await shouldBlockDomesticCelebrities('诛仙 S04'), false);
    assert.equal(await shouldBlockDomesticCelebrities('诛仙 第三季'), true);
    Globals.init({ ...enabled, PERSON_FILTER_EXCLUDED_TITLES: '诛仙完结季', TITLE_MAPPING_TABLE: '诛仙4->诛仙完结季' });
    assert.equal(await shouldBlockDomesticCelebrities('诛仙4'), false);
    assert.equal(await shouldBlockDomesticCelebrities('诛仙4(2026)【国产动漫】from tencent'), false);
    Globals.init({ ...enabled, TITLE_MAPPING_TABLE: '诛仙S04->诛仙完结季', PERSON_FILTER_EXCLUDED_TITLES: '' });
    assert.equal(await shouldBlockDomesticCelebrities('诛仙完结季'), true);
  });

  await t.test('远程映射复用、本地优先及热更新', async () => {
    const url = 'https://example.test/person-filter-mapping.txt';
    Globals.init({ ...enabled, TITLE_MAPPING_TABLE_URL: url });
    applyRemoteTitleMappingText(url, '诛仙S04->诛仙完结季');
    assert.equal(await shouldBlockDomesticCelebrities('诛仙完结季'), false);
    assert.equal(resolveLocalTitleMapping('诛仙', 4).matched, false);
    Globals.init({ ...enabled, TITLE_MAPPING_TABLE_URL: url, TITLE_MAPPING_TABLE: '诛仙S04->本地完结季' });
    assert.equal(await shouldBlockDomesticCelebrities('本地完结季'), false);
    assert.equal(await shouldBlockDomesticCelebrities('诛仙完结季'), true);
    applyRemoteTitleMappingText(url, '诛仙S04->新远程完结季');
    Globals.init({ ...enabled, TITLE_MAPPING_TABLE_URL: url });
    assert.equal(await shouldBlockDomesticCelebrities('新远程完结季'), false);
    assert.equal(await shouldBlockDomesticCelebrities('诛仙完结季'), true);
    Globals.init(enabled);
    assert.equal(await shouldBlockDomesticCelebrities('新远程完结季'), true);
  });

  await t.test('整季季集映射，含范围或歧义时保留精确名称匹配', async () => {
    Globals.init({ ...enabled, AUTO_MATCH_MAPPING_TABLE: '诛仙 S04E01->诛仙完结季 S01E01' });
    assert.equal(await shouldBlockDomesticCelebrities('诛仙完结季'), false);
    assert.equal(await shouldBlockDomesticCelebrities('诛仙3'), true);
    Globals.init({ ...enabled, AUTO_MATCH_MAPPING_TABLE: '诛仙 S04E01~E12->诛仙完结季 S01E01~E12' });
    assert.equal(await shouldBlockDomesticCelebrities('诛仙完结季'), true);
    Globals.init({ ...enabled, AUTO_MATCH_MAPPING_TABLE: '诛仙 S04E01->诛仙完结季 S01E01;诛仙 S04E13->诛仙特别篇 S01E01' });
    assert.equal(await shouldBlockDomesticCelebrities('诛仙完结季'), true);
  });

  await t.test('不丢失指定年份且兼容简繁名称', async () => {
    Globals.init({ ...enabled, PERSON_FILTER_EXCLUDED_TITLES: '誅仙4(2026)', TITLE_MAPPING_TABLE: '诛仙S04->诛仙完结季' });
    assert.equal(await shouldBlockDomesticCelebrities('诛仙完结季(2026)'), false);
    assert.equal(await shouldBlockDomesticCelebrities('诛仙完结季(2025)'), true);
    assert.equal(await shouldBlockDomesticCelebrities('诛仙完结季'), true);
    Globals.init({ ...enabled, TITLE_MAPPING_TABLE: '诛仙->其他标题' });
    assert.equal(await shouldBlockDomesticCelebrities('其他标题'), true);
    assert.equal(await shouldBlockDomesticCelebrities('诛仙3'), true);
  });

  await t.test('配置注册与弹幕分组入口', () => {
    Globals.init(enabled);
    const config = Globals.envs.envVarConfig.PERSON_FILTER_EXCLUDED_TITLES;
    assert.equal(config.category, 'danmu');
    assert.equal(config.type, 'text');
    assert.equal(Globals.envs.personFilterExcludedTitles, '诛仙4');
    assert.ok(previewJsContent.includes("'BLOCK_DOMESTIC_CELEBRITIES', 'PERSON_FILTER_EXCLUDED_TITLES'"));
  });
});

test('同一弹幕缓存随人物名单热更新，其他作品仍屏蔽角色', async () => {
  Globals.init({ ...enabled, TITLE_MAPPING_TABLE: '诛仙S04->诛仙完结季', COMMENT_CACHE_MIN_COUNT: '0' });
  const url = 'https://v.qq.com/x/cover/person-filter-toggle/episode.html';
  const title = '人物屏蔽回归作品';
  const key = await personCacheIdentity([title, '', '', '', Boolean(Globals.envs.useBangumiData)]);
  await cachedPersonSource(`${key}:identity`, async () => ({ id: 990099, media_type: 'tv', name: title,
    original_language: 'zh', origin_country: ['CN'], genre_ids: [] }), () => true);
  await cachedPersonSource(`${key}:tv/990099:credits`, async () => ({ actorNames: [], characterNames: ['张小凡'] }), () => true);
  await cachedPersonSource(`${key}:wiki`, async () => ({ actorNames: [], characterNames: [] }), () => true);
  Globals.animes = [{ animeTitle: title, links: [{ id: 990099, url }] }];
  Globals.commentCache = new Map();
  setCommentCache(url, [{ p: '1,1,16777215,[test]', m: '张小凡出场了' }, { p: '2,1,16777215,[test]', m: '剧情很好看' }]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('测试资料已预置，不应联网'); };
  try {
    const filtered = await (await getCommentByUrl(url, 'json', false)).json();
    assert.deepEqual(filtered.comments.map(item => item.m), ['剧情很好看']);
    Globals.init({ ...enabled, PERSON_FILTER_EXCLUDED_TITLES: title, COMMENT_CACHE_MIN_COUNT: '0' });
    const excluded = await (await getCommentByUrl(url, 'json', false)).json();
    assert.deepEqual(excluded.comments.map(item => item.m), ['张小凡出场了', '剧情很好看']);
  } finally {
    globalThis.fetch = originalFetch;
    Globals.init({});
    Globals.animes = [];
    Globals.commentCache = new Map();
  }
});

test('普通、URL、缓存及分段弹幕入口跳过人物查询，保留其他过滤', async () => {
  Globals.init({ ...enabled, TITLE_MAPPING_TABLE: '诛仙S04->诛仙完结季',
    BLOCK_DOMESTIC_REGIONS: 'true', BLOCK_DATES: 'true', BLOCKED_WORDS: '打卡',
    GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default', COMMENT_CACHE_MIN_COUNT: '0' });
  const url = 'https://v.qq.com/x/cover/person-exclusion/episode.html';
  const animeTitle = '诛仙完结季(2026)【国产动漫】from tencent';
  Globals.animes = [{ animeTitle, links: [{ id: 990001, url }] }];
  Globals.episodeIds = [{ id: 990001, url, title: '第1集' }];
  Globals.commentCache = new Map();
  const previousDeployPlatform = Globals.deployPlatform;
  Globals.deployPlatform = 'node';
  const source = getSourceByKey('tencent');
  const originalComments = source.getComments;
  const originalSegments = source.getSegmentComments;
  const originalFetch = globalThis.fetch;
  let metadataRequests = 0;
  let sourceRequests = 0;
  globalThis.fetch = async () => { metadataRequests++; throw new Error('人物免屏蔽作品不应查询人物名单'); };
  const comments = [
    { p: '1,1,16777215,[test]', m: '张小凡出场了' },
    { p: '2,1,16777215,[test]', m: '来自海南的朋友' },
    { p: '3,1,16777215,[test]', m: '2026年9月4日' },
    { p: '4,1,16777215,[test]', m: '打卡' },
    { p: '5,1,16777215,[test]', m: '剧情很好看' }
  ];
  source.getComments = async () => { sourceRequests++; return convertToDanmakuJson(comments, 'test'); };
  source.getSegmentComments = async () => convertToDanmakuJson(comments, 'test');
  const assertComments = async response => {
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.comments.map(item => item.m), ['张小凡出场了', '剧情很好看']);
  };
  try {
    await assertComments(await getCommentByUrl(url, 'json', false));
    await assertComments(await getCommentByUrl(url, 'json', false));
    assert.equal(sourceRequests, 1);
    await assertComments(await getComment('/api/v2/comment/990001', 'json', false));
    const segment = { type: 'tencent', url: 'person-exclusion-segment', animeTitle, sourceUrl: url };
    await assertComments(await getSegmentComment(segment, 'json'));
    setCommentCache(segment.url, convertToDanmakuJson(comments, 'test'));
    await assertComments(await getSegmentComment(segment, 'json'));
    assert.equal(metadataRequests, 0);
  } finally {
    source.getComments = originalComments;
    source.getSegmentComments = originalSegments;
    globalThis.fetch = originalFetch;
    Globals.init({});
    Globals.animes = [];
    Globals.episodeIds = [];
    Globals.commentCache = new Map();
    Globals.deployPlatform = previousDeployPlatform;
  }
});
