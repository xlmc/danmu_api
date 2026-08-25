import test from 'node:test';
import assert from 'node:assert/strict';

import { Globals } from './configs/globals.js';
import { buildSearchAnimeUrl } from './apis/dandan-api.js';
import {
  candidateMatchesMappingTitle,
  candidateMatchesMappingQualifiers,
  mergeAutoMatchMappingRules,
  parseAutoMatchMappingRules,
  resolveAutoMatchMapping,
} from './utils/auto-match-mapping-util.js';
import { strictTitleMatch } from './utils/common-util.js';
import { resolveLocalTitleMapping } from './utils/title-mapping-url-util.js';

test('标题映射兼容加号、逗号和空格', () => {
  Globals.init({ TITLE_MAPPING_TABLE: '标题+年份，第一季->目标作品' });
  const result = resolveLocalTitleMapping('标题 年份 第一季');
  assert.equal(result.matched, true);
  assert.equal(result.title, '目标作品');
});

test('远程季集规则只能在明确范围内换算', () => {
  const { rules, warnings } = parseAutoMatchMappingRules(
    '# 注释;不得拆成规则\n吞噬星空 S04E01~E34 -> 吞噬星空{[tmdbid=123;type=tv]} S01E86~E119'
  );
  assert.deepEqual(warnings, []);
  assert.equal(resolveAutoMatchMapping(rules, { title: '吞 噬+星空', season: 4, episode: 1 }).targetEpisode, 86);
  assert.equal(resolveAutoMatchMapping(rules, { title: '吞噬星空', season: 4, episode: 34 }).targetEpisode, 119);
  assert.equal(resolveAutoMatchMapping(rules, { title: '吞噬星空', season: 4, episode: 35 }), null);
});

test('TMDB 只作内部冲突校验，type=tv 不误排动画', () => {
  const { rules } = parseAutoMatchMappingRules(
    '测试 S01E01~E02 -> 目标{[tmdbid=123;type=tv]} S01E01~E02'
  );
  assert.equal(rules[0].targetType, '');
  assert.equal(candidateMatchesMappingQualifiers({ animeTitle: '目标', type: '动漫', tmdbId: 123 }, rules[0]), true);
  assert.equal(candidateMatchesMappingQualifiers({ animeTitle: '目标', type: '动漫', tmdbId: 999 }, rules[0]), false);
});

test('内部 match 搜索可禁止二次标题映射', () => {
  const url = buildSearchAnimeUrl('http://localhost/api/v2/match', '目标作品', 1, 2, true);
  assert.equal(url.searchParams.get('_skipTitleMapping'), '1');
});

test('严格模式允许完整季名对应条目内部第一季', () => {
  Globals.init({ STRICT_TITLE_MATCH: 'true' });
  assert.equal(strictTitleMatch('一念永恒 第3季', '一念永恒 第3季', 1), true);
  assert.equal(strictTitleMatch('一念永恒 第2季', '一念永恒', 3), false);
});

test('季集范围外和错误季号不会过度转换', () => {
  const { rules } = parseAutoMatchMappingRules(
    '吞噬星空 S04E01~E34 -> 吞噬星空 S01E86~E119'
  );
  assert.equal(resolveAutoMatchMapping(rules, { title: '吞噬星空', season: 3, episode: 1 }), null);
  assert.equal(resolveAutoMatchMapping(rules, { title: '吞噬星空', season: 4, episode: 0 }), null);
  assert.equal(resolveAutoMatchMapping(rules, { title: '吞噬星空', season: 4, episode: 35 }), null);
});

test('标题只允许精确目标或明确季名后缀，拒绝近似作品', () => {
  const mapping = { targetTitle: '吞噬星空' };
  assert.equal(candidateMatchesMappingTitle({ animeTitle: '吞噬星空(2020)【3D动漫】from tencent' }, mapping), true);
  assert.equal(candidateMatchesMappingTitle({ animeTitle: '吞噬星空 第4季' }, mapping), true);
  assert.equal(candidateMatchesMappingTitle({ animeTitle: '吞噬星空剧场版' }, mapping), false);
  assert.equal(candidateMatchesMappingTitle({ animeTitle: '吞噬星空外传' }, mapping), false);
});

test('本机季集规则优先于相同键的远程缓存规则', () => {
  const local = parseAutoMatchMappingRules('作品 S01E01~E03 -> 本机目标 S01E11~E13').rules;
  const remote = parseAutoMatchMappingRules('作品 S01E01~E03 -> 远程目标 S01E21~E23').rules;
  const result = resolveAutoMatchMapping(mergeAutoMatchMappingRules(local, remote), {
    title: '作品', season: 1, episode: 2
  });
  assert.equal(result.origin, 'local');
  assert.equal(result.targetTitle, '本机目标');
  assert.equal(result.targetEpisode, 12);
});

test('开放规则可供本机手工设置，有限规则在重叠处更具体', () => {
  const { rules, warnings } = parseAutoMatchMappingRules([
    '作品 S01E01 -> 连载目标 S01E51',
    '作品 S01E01~E03 -> 已确认目标 S01E11~E13',
  ].join('\n'));
  assert.deepEqual(warnings, []);
  assert.equal(resolveAutoMatchMapping(rules, { title: '作品', season: 1, episode: 2 }).targetTitle, '已确认目标');
  assert.equal(resolveAutoMatchMapping(rules, { title: '作品', season: 1, episode: 4 }).targetEpisode, 54);
});

test('无效和不等长范围不会进入规则表', () => {
  const { rules, warnings } = parseAutoMatchMappingRules([
    '作品 S01E01~E03 -> 目标 S01E11~E12',
    '作品 S01E01~E03 -> 目标 S01E11',
  ].join('\n'));
  assert.equal(rules.length, 0);
  assert.equal(warnings.length, 2);
});

test('TMDB 标记从检索标题剥离且不作为播放器标题输出', () => {
  const { rules } = parseAutoMatchMappingRules(
    '作品 S01E01~E02 -> 目标作品{[tmdbid=12345;type=tv]} S01E11~E12'
  );
  assert.equal(rules[0].targetTitle, '目标作品');
  assert.equal(rules[0].targetDisplayTitle, '目标作品');
  assert.equal(rules[0].targetTmdbId, 12345);
  assert.equal(JSON.stringify({ animeTitle: rules[0].targetDisplayTitle }).includes('tmdb'), false);
});
