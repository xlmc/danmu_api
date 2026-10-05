import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPlatformName, canonicalPlatformGroup } from './utils/platform-util.js';
import { Globals } from './configs/globals.js';
import { Envs } from './configs/envs.js';
import { Anime, Episodes, Segment, SegmentListResponse } from './models/player-model.js';
import { parseFileName, createDynamicPlatformOrder } from './utils/common-util.js';
import { parseAutoMatchMappingRules } from './utils/auto-match-mapping-util.js';
import { parseOffsetRules, resolveOffset } from './utils/offset-util.js';
import { getSegmentComment } from './apis/player-api.js';
import { getSourceByKey } from './sources/registry.js';
import { convertToDanmakuJson } from './utils/danmu-util.js';



Globals.init({PLATFORM_ORDER: 'tencent&iqiyi&bilibili,youku', DANMU_OUTPUT_FORMAT: 'json' });

test('canonical configuration and old aliases resolve to the same platform groups', () => {
 assert.equal(canonicalPlatformName('qq'), 'tencent');
 assert.equal(canonicalPlatformGroup('qq＆tencent& qiyi &bilibili1'), 'tencent&iqiyi&bilibili');
 const original = Envs.env;
 try {
  for (const value of ['tencent&iqiyi&bilibili,youku','qq&qiyi&bilibili1,youku']) {
   Envs.env = { PLATFORM_ORDER: value, MERGE_SOURCE_PAIRS: value };
   assert.deepEqual(Envs.resolvePlatformOrder(), ['tencent&iqiyi&bilibili','youku',null]);
   assert.deepEqual(Envs.resolveMergeSourcePairs()[0], {primary:'tencent',secondaries:['iqiyi','bilibili']});
  }
 } finally {Envs.env=original;}
 for (const platform of ['tencent','iqiyi','bilibili']) assert.ok(Envs.ALLOWED_PLATFORMS.includes(platform));
 for (const alias of ['qq','qiyi','bilibili1']) assert.ok(!Envs.ALLOWED_PLATFORMS.includes(alias));
});

test('file preferences, mapping rules and offset rules accept canonical names and old aliases', () => {
 for (const [old,name] of [['qq','tencent'],['qiyi','iqiyi'],['bilibili1','bilibili']]) {
  for (const input of [old,name]) {
   assert.equal(parseFileName(`测试 S01E01 @${input}`).preferredPlatform,name);
   assert.equal(createDynamicPlatformOrder(input)[0],name);
   assert.equal(parseAutoMatchMappingRules(`测试 S01E01 -> 测试 S01E01 @${input}`, Envs.ALLOWED_PLATFORMS).rules[0].targetPlatform,name);
   assert.equal(resolveOffset(parseOffsetRules(`测试@${input}:5`), {anime:'测试',source:name}),5);
   assert.equal(resolveOffset(parseOffsetRules(`测试@${name}:5`), {anime:'测试',source:old}),5);
  }
 }
});

test('removed members do not discard the priority of surviving platforms in a legacy group', () => {
 const original = Envs.env;
 try {
  Envs.env = { PLATFORM_ORDER: 'tencent&youku,renren&hanjutv&bilibili,leshi&xigua&sohu,hongguo,migu' };
  assert.deepEqual(Envs.resolvePlatformOrder(), ['tencent&youku','renren&hanjutv&bilibili','leshi&sohu','hongguo','migu',null]);
 } finally {Envs.env=original;}
});

test('cached link and episode labels and generated segment types use canonical names', () => {
 const anime = new Anime({links:[{title:'【qq&qiyi&bilibili1】 第1集'}]});
 assert.equal(anime.links[0].title,'【tencent&iqiyi&bilibili】 第1集');
 const eps = new Episodes({episodes:[{episodeTitle:'【qq】 第1集'}]});
 assert.equal(eps.episodes[0].episodeTitle,'【tencent】 第1集');
 const result = new SegmentListResponse({type:'qq',segmentList:[{type:'qq',segment_start:0,segment_end:30,url:'https://v.qq.com/test'}]});
 assert.equal(result.type,'tencent');
 assert.equal(result.segmentList[0].type,'tencent');
 assert.equal(new Segment({type:'bilibili1',segment_start:0,segment_end:30,url:'https://bilibili.com/test'}).type,'bilibili');
});

test('segment endpoint routes both canonical and legacy types to the same source', async () => {
 for (const [old,name] of [['qq','tencent'],['qiyi','iqiyi'],['bilibili1','bilibili']]) {
  const source = getSourceByKey(name), original=source.getSegmentComments;
  let called=0;
  source.getSegmentComments=async ()=>{called++;return [];};
  try {
   for (const type of [name,old]) {
    const response=await getSegmentComment({type,url:`https://example.com/${type}`,segment_start:0,segment_end:30},'json');
    assert.equal((await response.json()).success,true);
   }
   assert.equal(called,2);
  } finally {source.getSegmentComments=original;}
 }
});

test('danmu tags normalize old source labels and avoid duplicate real-time aliases', () => {
 const result=convertToDanmakuJson([{p:'1,1,16777215,0',m:'测试',_sourceLabel:'bilibili&qq',realTimeSource:'tencent'}],'qq');
 assert.match(result[0].p,/\[bilibili[&＆]tencent\]/);
 assert.doesNotMatch(result[0].p,/qq|tencent.*tencent/);
});
