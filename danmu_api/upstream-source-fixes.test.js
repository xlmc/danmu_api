import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Globals } from './configs/globals.js';
import HanjutvSource from './sources/hanjutv.js';
import { cleanSearchQuery, stripSeasonMarker } from './utils/tmdb-util.js';
import { md5, parseDanmakuBase64 } from './utils/codec-util.js';
import TencentSource from './sources/tencent.js';
import IqiyiSource from './sources/iqiyi.js';
import YoukuSource from './sources/youku.js';
import { groupDanmusByMinute } from './utils/danmu-util.js';
import { isCommentCacheValid, setCommentCache } from './utils/cache-util.js';

test('Japanese search preserves in-word punctuation and removes season markers', () => {
  for (const title of ['Re:ゼロから始める異世界生活', 'も～っと！おジャ魔女どれみ', '地獄先生ぬ～べ～']) {
    assert.equal(cleanSearchQuery(title), title);
  }
  assert.equal(cleanSearchQuery('ワンパンマン 2nd Season'), 'ワンパンマン');
  assert.equal(stripSeasonMarker('スティール・ボール・ラン ジョジョの奇妙な冒険 1st STAGE'), 'スティール・ボール・ラン ジョジョの奇妙な冒険');
  assert.equal(stripSeasonMarker('飙马野郎 JOJO的奇妙冒险 第一赛段'), '飙马野郎 JOJO的奇妙冒险');
  assert.equal(stripSeasonMarker('第九部落'), '第九部落');
  assert.equal(cleanSearchQuery('作品名 〜副标题'), '作品名');
});

test('Hanjutv distinguishes an empty search list from invalid responses', async () => {
  Globals.init({ LOG_LEVEL: 'error' });
  const source = new HanjutvSource();
  assert.deepEqual(await source.extractFromPayload({ rescode: 0, seriesList: [] }, 'unused', 's5'), []);
  await assert.rejects(source.extractFromPayload({ rescode: 0 }, 'unused', 's5'), /缺少有效搜索列表/);
  await assert.rejects(source.extractFromPayload({ rescode: 1, seriesList: [] }, 'unused', 's5'), /接口返回错误/);
});

test('Hanjutv retries failed initialization once with cache bypass', async t => {
  Globals.init({ LOG_LEVEL: 'error' });
  const source = new HanjutvSource();
  source._mobileWarmedUid = 'old';
  const attempts = [];
  t.mock.method(source, 'ensureMobileIdentityWarmed', async bypassCache => {
    attempts.push({ bypassCache, warmedUid: source._mobileWarmedUid });
    return false;
  });
  await assert.rejects(source.searchWithS5Api('测试'), /手机身份初始化失败/);
  assert.deepEqual(attempts, [{ bypassCache: false, warmedUid: 'old' }, { bypassCache: true, warmedUid: null }]);
});

test('MD5 matches standard UTF-8 for emoji and supplementary characters', () => {
  for (const input of ['plain', '中文', '标题😀', '𠮷野家']) {
    assert.equal(md5(input), createHash('md5').update(input, 'utf8').digest('hex'));
  }
});

test('codec parseDanmakuBase64 正确解析字段标签占多字节的弹幕', () => {
  // 真实数据：该条含 field 22，其标签占两个字节（0xb2 0x01）。标签按单字节读取会漏掉第二个字节，
  // 使后续字段整体错位，content 会被解析成 field 22 的 JSON 参数
  const elemHex = '0880fe8df4dcf794e61e10948a2d180520192880feff073207393434366161373a15e7bca9e59cb0e68890e5afb8e5a4aae5b885e4ba864095d9a6d606480a621332323139323430373931303635343630343830688080427803a2010130aa010130b2015f7b226964223a32303032352c22636964223a302c22616476616e6365645f626c6f636b223a302c22616e696d6174696f6e5f61747472223a302c226d696d65223a227a6970222c227265736f75726365223a22222c227363616c65223a307dc80101d001b18884e79e01d80101';
  const elem = Buffer.from(elemHex, 'hex');
  const payload = Buffer.concat([Buffer.from([0x0a, 0xd2, 0x01]), elem]);
  const parsed = parseDanmakuBase64(payload.toString('base64'));
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].content, '缩地成寸太帅了');
  assert.strictEqual(parsed[0].progress, 738580);
  assert.strictEqual(parsed[0].mode, 5);
});

test('codec parseDanmakuBase64 跳过未知字段与定长字段', () => {
  const elem = new Uint8Array([0x10, 0x7b, 0x3a, 0x0c, ...Buffer.from('正常弹幕', 'utf8')]);
  const payload = new Uint8Array([0x12, 0x01, 0x00, 0x0a, elem.length, ...elem]);
  const parsed = parseDanmakuBase64(Buffer.from(payload).toString('base64'));
  assert.strictEqual(parsed.length, 1, '外层未知字段应被跳过而不是终止解析');
  assert.strictEqual(parsed[0].content, '正常弹幕');

  // 外层字段标签占多字节时同样应被跳过（0xb2 0x01 = field 22, length-delimited）
  const outerElem = new Uint8Array([0x10, 0x7b, 0x3a, 0x0f, ...Buffer.from('外层多字节', 'utf8')]);
  const outerPayload = new Uint8Array([0xb2, 0x01, 0x01, 0x00, 0x0a, outerElem.length, ...outerElem]);
  const parsed3 = parseDanmakuBase64(Buffer.from(outerPayload).toString('base64'));
  assert.strictEqual(parsed3.length, 1, '外层多字节标签的字段应被整体跳过');
  assert.strictEqual(parsed3[0].content, '外层多字节');

  const withFixed = new Uint8Array([0x10, 0x2a, 0xa1, 0x01, 1, 2, 3, 4, 5, 6, 7, 8, 0x3a, 0x0c, ...Buffer.from('定长跳过', 'utf8')]);
  const parsed2 = parseDanmakuBase64(Buffer.from([0x0a, withFixed.length, ...withFixed]).toString('base64'));
  assert.strictEqual(parsed2[0].content, '定长跳过', '内层 64 位定长字段应整体跳过');

  assert.doesNotThrow(() => parseDanmakuBase64(Buffer.from([0x0a, 0x64, 0x08, 0x01]).toString('base64')),
    '截断数据不应抛出');
  assert.doesNotThrow(() => parseDanmakuBase64(Buffer.from([0x0a, 0x05, 0x0b, 0x00, 0x00, 0x00, 0x00]).toString('base64')),
    '内层遇到不支持的 wire type 不应抛出');
});

const VID = 'c4102g9a01t';
const PLAYER_URL = `https://v.qq.com/x/cover/mzc00200803dr6b/${VID}.html`;
const BASE_URL = `https://dm.video.qq.com/barrage/base/${VID}`;
const SEGMENT_URL = `https://dm.video.qq.com/barrage/segment/${VID}/t/v1/0/30000`;

Globals.init({ LOG_LEVEL: "error" });

function mockResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  };
}

function buildTencentFetch({ getinfoResponse = null } = {}) {
  const calls = { page: 0, base: 0, getinfo: 0, segment: 0 };

  const fetchImpl = async (input) => {
    const url = String(input);
    if (url === PLAYER_URL) {
      calls.page++;
      return mockResponse('<html><title>测试剧集</title></html>');
    }
    if (url === BASE_URL) {
      calls.base++;
      return mockResponse({
        segment_index: {
          '0': { segment_start: '0', segment_name: 't/v1/0/30000' },
        },
      });
    }
    if (url.startsWith('https://vv.video.qq.com/getinfo')) {
      calls.getinfo++;
      return getinfoResponse || mockResponse('QZOutputJson={"vl":{"vi":[{"td":"2812.57"}]}};');
    }
    if (url === SEGMENT_URL) {
      calls.segment++;
      return mockResponse({ barrage_list: [] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  return { fetchImpl, calls };
}

test('tencent 标题字段规范化与兜底', () => {
  const source = new TencentSource();

  assert.equal(source.normalizeUnionTitle('兰香如故_001'), '兰香如故 第1集');
  assert.equal(source.normalizeUnionTitle(' 兰香如故_01 '), '兰香如故 第1集');
  assert.equal(source.normalizeUnionTitle('01'), '第1集');
  assert.equal(source.normalizeUnionTitle('兰香如故'), '兰香如故');

  assert.equal(
    source.buildEpisodeTitle({ playTitle: '兰香如故 第01集', videoSubtitle: '不争宠只争命' }),
    '兰香如故 第1集 不争宠只争命'
  );
  assert.equal(
    source.buildEpisodeTitle({ playTitle: '兰香如故 第1集', videoSubtitle: '第1集' }),
    '兰香如故 第1集'
  );
  assert.equal(
    source.buildEpisodeTitle({ unionTitle: '兰香如故_002', videoSubtitle: '标题' }),
    '兰香如故 第2集 标题'
  );
  assert.equal(source.buildEpisodeTitle({ cTitleOutput: '003' }), '第3集');
  assert.equal(source.buildEpisodeTitle({ title: '004' }), '第4集');
  assert.equal(
    source.buildEpisodeTitle({ playTitle: '优先标题', unionTitle: '兜底标题_09', cTitleOutput: '09' }),
    '优先标题'
  );
});

test('tencent getVideoDuration 支持 JSONP 字符串和已解析对象', async () => {
  const source = new TencentSource();

  const jsonpDuration = await withMockFetch(
    async () => mockResponse('QZOutputJson={"vl":{"vi":[{"td":"2751.55"}]}};'),
    () => source.getVideoDuration(VID)
  );
  assert.equal(jsonpDuration, 2751.55);

  const objectDuration = await withMockFetch(
    async () => mockResponse({ vl: { vi: [{ td: '2562.54' }] } }),
    () => source.getVideoDuration(VID)
  );
  assert.equal(objectDuration, 2562.54);
});

test('tencent getVideoDuration 缺失或非法 td 时返回 0', async () => {
  const source = new TencentSource();

  const missingTd = await withMockFetch(
    async () => mockResponse('QZOutputJson={"vl":{"vi":[{}]}};'),
    () => source.getVideoDuration(VID)
  );
  assert.equal(missingTd, 0);

  const malformedJson = await withMockFetch(
    async () => mockResponse('QZOutputJson={not-json};'),
    () => source.getVideoDuration(VID)
  );
  assert.equal(malformedJson, 0);

  const invalidTd = await withMockFetch(
    async () => mockResponse('QZOutputJson={"vl":{"vi":[{"td":"not-a-number"}]}};'),
    () => source.getVideoDuration(VID)
  );
  assert.equal(invalidTd, 0);

  let fetchCount = 0;
  const emptyVid = await withMockFetch(
    async () => {
      fetchCount++;
      throw new Error('empty vid should not fetch');
    },
    () => source.getVideoDuration('')
  );
  assert.equal(emptyVid, 0);
  assert.equal(fetchCount, 0);
});

test('tencent 普通弹幕流程不请求 getinfo', async () => {
  const source = new TencentSource();
  const { fetchImpl, calls } = buildTencentFetch();

  const comments = await withMockFetch(fetchImpl, () => source.getEpisodeDanmu(PLAYER_URL));

  assert.deepEqual(comments, []);
  assert.equal(calls.page, 1);
  assert.equal(calls.base, 1);
  assert.equal(calls.segment, 1);
  assert.equal(calls.getinfo, 0);
});

test('tencent 分片接口按需请求时长，includeDuration=false 时跳过', async () => {
  const source = new TencentSource();
  const withDuration = buildTencentFetch();

  const result = await withMockFetch(
    withDuration.fetchImpl,
    () => source.getEpisodeDanmuSegments(VID)
  );
  assert.equal(result.duration, 2812.57);
  assert.equal(result.segmentList.length, 1);
  assert.equal(result.segmentList[0].segment_end, 30);
  assert.equal(withDuration.calls.getinfo, 1);

  const withoutDuration = buildTencentFetch();
  const noDurationResult = await withMockFetch(
    withoutDuration.fetchImpl,
    () => source.getEpisodeDanmuSegments(VID, false)
  );
  assert.equal(noDurationResult.duration, 0);
  assert.equal(noDurationResult.segmentList.length, 1);
  assert.equal(withoutDuration.calls.getinfo, 0);
});

test('tencent getinfo 失败时保留分片列表并回退 duration=0', async () => {
  const source = new TencentSource();
  const { fetchImpl } = buildTencentFetch({ getinfoResponse: mockResponse('server error', 500) });

  const result = await withMockFetch(fetchImpl, () => source.getEpisodeDanmuSegments(VID));

  assert.equal(result.duration, 0);
  assert.equal(result.segmentList.length, 1);
});

const buildTitle = (epData) => IqiyiSource.prototype._buildEpisodeTitle.call({}, epData);
const ensureNumber = (title, animeTitle, order) =>
  IqiyiSource.prototype._ensureEpisodeNumber.call({}, title, animeTitle, order);

test('iqiyi episode title uses short_display_name and appends subtitle', () => {
  assert.strictEqual(buildTitle({ short_display_name: '太古神尊 天魔秘藏' }), '太古神尊 天魔秘藏');
  assert.strictEqual(
    buildTitle({ short_display_name: '太古神尊 第11集', subtitle: '巨额悬赏' }),
    '太古神尊 第11集 巨额悬赏'
  );
  // 分集名已包含副标题时不重复拼接
  assert.strictEqual(
    buildTitle({ short_display_name: '太古神尊 第11集 巨额悬赏', subtitle: '巨额悬赏' }),
    '太古神尊 第11集 巨额悬赏'
  );
});

test('iqiyi episode title falls back when name fields are missing', () => {
  assert.strictEqual(buildTitle({ title: '太古神尊 外门考核' }), '太古神尊 外门考核');
  assert.strictEqual(buildTitle({}), '未知分集');
});

test('iqiyi episode number is inserted after the anime title when missing', () => {
  assert.strictEqual(
    ensureNumber('太古神尊 天魔秘藏', '太古神尊', 10),
    '太古神尊 第10集 天魔秘藏'
  );
  // 不以作品名开头时集数置于标题前
  assert.strictEqual(ensureNumber('天魔秘藏', '太古神尊', 10), '第10集 天魔秘藏');
  // 作品名带年份与类型后缀时，剥去后缀再比对
  assert.strictEqual(
    ensureNumber('太古神尊 天魔秘藏', '太古神尊(2026)【3D动漫】from iqiyi', 10),
    '太古神尊 第10集 天魔秘藏'
  );
});

test('iqiyi episode number keeps titles that already carry an episode number', () => {
  assert.strictEqual(
    ensureNumber('太古神尊 第11集 巨额悬赏', '太古神尊', 11),
    '太古神尊 第11集 巨额悬赏'
  );
  // 接口的其它集数写法同样视为已含集数
  assert.strictEqual(ensureNumber('太古神尊 EP11', '太古神尊', 11), '太古神尊 EP11');
});

test('iqiyi episode number is not added without a valid order', () => {
  assert.strictEqual(ensureNumber('太古神尊 天魔秘藏', '太古神尊', undefined), '太古神尊 天魔秘藏');
  assert.strictEqual(ensureNumber('太古神尊 天魔秘藏', '太古神尊', null), '太古神尊 天魔秘藏');
  assert.strictEqual(ensureNumber('太古神尊 天魔秘藏', '太古神尊', ''), '太古神尊 天魔秘藏');
});

test('iqiyi episode titles share one format across all episodes', () => {
  const animeTitle = '太古神尊';
  const withoutNumber = ['太子转生', '天魔秘藏'].map((name, index) =>
    ensureNumber(buildTitle({ short_display_name: `${animeTitle} ${name}` }), animeTitle, index + 1)
  );
  const withNumber = ensureNumber(buildTitle({ short_display_name: `${animeTitle} 第11集`, subtitle: '巨额悬赏' }), animeTitle, 11);
  for (const title of [...withoutNumber, withNumber]) {
    assert.match(title, new RegExp(`^${animeTitle} 第\\d+集 `));
  }
});

async function withMockFetch(fetchImpl, action) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try { return await action(); } finally { globalThis.fetch = original; }
}

test('ungrouped single-source comments are sorted without mutating input', () => {
  const comments = [{ p: '30,1,16777215,0', m: 'late' }, { p: '1,1,16777215,0', m: 'early' }];
  const sorted = groupDanmusByMinute(comments, 0);
  assert.deepEqual(sorted.map(item => item.m), ['early', 'late']);
  assert.deepEqual(comments.map(item => item.m), ['late', 'early']);
});

test('Youku normalizes nested text and properties without using nicknames', () => {
  const comments = new YoukuSource().formatComments([
    { playat: 1000, content: '正文', propertis: '{"pos":"1","color":"#ff0000"}' },
    { timepoint: 2, progress: 2000, content: { text: '嵌套正文' }, properties: { pos: 2, color: '#123456' } },
    { progress: 3000, text: [' ', { value: '数组正文' }] },
    { time: 4, extFields: { text: '备用正文' } },
    { playat: 5000, content: '', name: '仅有昵称' },
  ]);
  assert.deepEqual(comments.map(item => item.m), ['正文', '嵌套正文', '数组正文', '备用正文']);
  assert.deepEqual(comments.map(item => item.timepoint), [1, 2, 3, 4]);
  assert.equal(comments[0].ct, 5);
  assert.equal(comments[0].color, 16711680);
  assert.equal(comments[1].ct, 4);
  assert.equal(comments[1].color, 0x123456);
});

test('Youku segment extraction accepts legacy and updated result envelopes', async () => {
  const source = new YoukuSource();
  const rows = [{ playat: 1000, content: '正文' }];
  for (const data of [
    { data: { result: JSON.stringify({ data: { result: rows } }) } },
    { data: { result: { data: { items: rows } } } },
    { result: { comments: rows } },
  ]) {
    const result = await withMockFetch(async () => mockResponse(data), () => source.getEpisodeSegmentDanmu({ url: 'https://example.com/danmu', data: '{}' }));
    assert.deepEqual(result, rows);
  }
});

test('comment cache refreshes malformed text while preserving valid entries', () => {
  Globals.init({ LOG_LEVEL: 'error', COMMENT_CACHE_MINUTES: '60', COMMENT_CACHE_MIN_COUNT: '0' });
  const url = 'https://example.com/cache-test';
  for (const comments of [[{ content: '旧正文' }], [{ m: ' ' }]]) {
    setCommentCache(url, comments);
    assert.equal(isCommentCacheValid(url), false);
    assert.equal(Globals.commentCache.has(url), false);
  }
  setCommentCache(url, [{ m: '有效正文', p: '1,1,16777215,0' }]);
  assert.equal(isCommentCacheValid(url), true);
});
