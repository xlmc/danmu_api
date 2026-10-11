import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Globals } from './configs/globals.js';
import HanjutvSource from './sources/hanjutv.js';
import { cleanSearchQuery, stripSeasonMarker } from './utils/tmdb-util.js';
import { md5 } from './utils/codec-util.js';

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
