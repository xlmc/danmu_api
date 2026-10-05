import test from 'node:test';
import assert from 'node:assert/strict';
import HanjutvSource from './sources/hanjutv.js';
import { Globals } from './configs/globals.js';
import { getSourceByKey } from './sources/registry.js';
import { isSupportedLocation, pruneSourcePreferences } from './sources/policy.js';
import { encodeMergedHanjutvEpisodeDanmuId } from './utils/hanjutv-util.js';
import { addAnime } from './utils/cache-util.js';
import { handleRequest } from './worker.js';

function reset(extra={}) {
 Globals.init({TOKEN:'87654321',SOURCE_ORDER:'hanjutv,renren',LOCAL_CACHE_ENABLED:'false',LOCAL_REDIS_URL:'',RATE_LIMIT_MAX_REQUESTS:'0',LOG_LEVEL:'error',GROUP_MINUTE:'0',BLOCKED_WORDS:'',USE_BANGUMI_DATA:'false',REMEMBER_LAST_SELECT:'false',...extra});
 Globals.deployPlatform='node';Globals.animes=[];Globals.episodeIds=[];Globals.episodeNum=10001;
 for(const key of ['searchCache','commentCache','lastSelectMap'])Globals[key]=new Map();
}
const request=(route,method='GET',body)=>handleRequest(new Request('http://localhost'+route,{method,...(body!==undefined&&{headers:{'content-type':'application/json'},body:JSON.stringify(body)})}),Globals.env,'node','127.0.0.1');
reset();

test('Hanjutv warmup should retry after failure and share concurrent promise', async () => {
  const source = new HanjutvSource();
  let attempts = 0;
  let finishFirst;
  source.buildMobileHeaders = async () => ({ uid: 'stable-uid', headers: {} });
  source.warmupMobileIdentity = async () => {
    attempts++;
    if (attempts === 1) return new Promise(resolve => { finishFirst = resolve; });
    return true;
  };

  const concurrent = [source.ensureMobileIdentityWarmed(), source.ensureMobileIdentityWarmed()];
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 1);
  finishFirst(false);
  await Promise.all(concurrent);
  await source.ensureMobileIdentityWarmed();
  await source.ensureMobileIdentityWarmed();
  assert.equal(attempts, 2);
});

test('Hanjutv details should stay fully parallel and preserve candidate order', async () => {
  const source = new HanjutvSource();
  const candidates = Array.from({ length: 6 }, (_, index) => ({ sid: `sid-${index}`, name: `顺序测试剧${index}` }));
  const resolvers = new Map();
  const started = [];
  const previous = { animes: Globals.animes, episodeIds: Globals.episodeIds, episodeNum: Globals.episodeNum };
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  source.buildAnimePayload = anime => new Promise(resolve => {
    started.push(anime.sid);
    resolvers.set(anime.sid, resolve);
  });
  source.sortAndPushAnimesByYear = (items, target) => target.push(...items);

  try {
    const current = [];
    const task = source.handleAnimes(candidates, '顺序测试剧', current, new Map());
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, candidates.map(item => item.sid));
    [...candidates].reverse().forEach(anime => {
      const index = candidates.indexOf(anime);
      resolvers.get(anime.sid)({
        summary: { animeId: 900000 + index, bangumiId: String(900000 + index), animeTitle: anime.name, type: '韩剧', typeDescription: '韩剧', imageUrl: '', startDate: '2025-01-01T00:00:00Z', episodeCount: 1, rating: 0, isFavorited: true, source: 'hanjutv' },
        links: [{ name: '第1集', url: `hxq:${anime.sid}`, title: '【hanjutv】 第1集' }],
      });
    });
    const expected = candidates.map(item => item.name);
    assert.deepEqual((await task).map(item => item.animeTitle), expected);
    assert.deepEqual(current.map(item => item.animeTitle), expected);
    assert.deepEqual(Globals.animes.map(item => item.animeTitle), expected);
  } finally {
    Globals.animes = previous.animes;
    Globals.episodeIds = previous.episodeIds;
    Globals.episodeNum = previous.episodeNum;
  }
});

test('Hanjutv should merge only exact titles and disambiguate duplicate names', async () => {
  const source = new HanjutvSource();
  const getMergedPairs = (keyword, s5Items, tvItems) => source
    .mergeSearchCandidates(keyword, s5Items, tvItems)
    .resultList
    .filter(item => item._variant === 'merged')
    .map(item => [item.sid, item.tvSid])
    .sort((left, right) => left[0].localeCompare(right[0]));

  const taxi = source.mergeSearchCandidates('模范出租车', [
    { sid: 's3', name: '模范出租车3' },
    { sid: 's2', name: '模范出租车2' },
  ], [
    { sid: 't2', name: '模范出租车2' },
    { sid: 't3', name: '模范出租车3' },
  ]).resultList.filter(item => item._variant === 'merged');
  assert.deepEqual(taxi.map(item => [item.name, item.tvSid]), [
    ['模范出租车3', 't3'],
    ['模范出租车2', 't2'],
  ]);

  const duplicate = source.mergeSearchCandidates('配对游戏', [
    { sid: 's-new', name: '配对游戏', playMode: 100, publishTime: '2025-01-01', lastSerialNo: 6 },
    { sid: 's-old', name: '配对游戏', playMode: 101, publishTime: '2024-01-01', lastSerialNo: 63 },
  ], [
    { sid: 't-old', name: '配对游戏', playMode: 101, publishTime: '2024-01-01', lastSerialNo: 63 },
    { sid: 't-new', name: '配对游戏', playMode: 100, publishTime: '2025-01-01', lastSerialNo: 6 },
  ]).resultList.filter(item => item._variant === 'merged');
  assert.deepEqual(duplicate.map(item => item.tvSid), ['t-new', 't-old']);

  const partialS5 = [
    { sid: 's-unknown', name: '同名剧', playMode: 100, category: 1 },
    { sid: 's-2025', name: '同名剧', playMode: 100, publishTime: '2025-01-01', category: 1 },
  ];
  const datedTv = [
    { sid: 't-2025', name: '同名剧', playMode: 100, publishTime: '2025-01-01', category: 1 },
  ];
  for (const s5Order of [partialS5, [...partialS5].reverse()]) {
    assert.deepEqual(getMergedPairs('同名剧', s5Order, datedTv), [['s-2025', 't-2025']]);
  }

  const ambiguousS5 = [
    { sid: 's-a', name: '歧义剧', playMode: 100, category: 1 },
    { sid: 's-b', name: '歧义剧', playMode: 100, category: 1 },
  ];
  const ambiguousTv = [{ sid: 't-only', name: '歧义剧', playMode: 100, category: 1 }];
  assert.deepEqual(getMergedPairs('歧义剧', ambiguousS5, ambiguousTv), []);
  assert.deepEqual(getMergedPairs('歧义剧', [...ambiguousS5].reverse(), ambiguousTv), []);

  assert.deepEqual(getMergedPairs('待播剧', [
    { sid: 's-upcoming', name: '待播剧', playMode: 100, category: 1 },
  ], [
    { sid: 't-upcoming', name: '待播剧', playMode: 100, category: 1 },
  ]), [['s-upcoming', 't-upcoming']]);

  const eliminationS5 = [
    { sid: 's-known', name: '排除剧', playMode: 100, publishTime: '2025-01-01', category: 1 },
    { sid: 's-left', name: '排除剧', playMode: 100, category: 1 },
  ];
  const eliminationTv = [
    { sid: 't-left', name: '排除剧', playMode: 100, category: 1 },
    { sid: 't-known', name: '排除剧', playMode: 100, publishTime: '2025-01-01', category: 1 },
  ];
  const expectedEliminationPairs = [['s-known', 't-known'], ['s-left', 't-left']];
  for (const s5Order of [eliminationS5, [...eliminationS5].reverse()]) {
    for (const tvOrder of [eliminationTv, [...eliminationTv].reverse()]) {
      assert.deepEqual(getMergedPairs('排除剧', s5Order, tvOrder), expectedEliminationPairs);
    }
  }
});

test('Hanjutv should parse search-pair years without confusing seconds and milliseconds', () => {
  const source = new HanjutvSource();
  assert.equal(source.getSearchPairYear({ publishTime: 888768000000 }), 1998);
  assert.equal(source.getSearchPairYear({ publishTime: '956678400000' }), 2000);
  assert.equal(source.getSearchPairYear({ publishTime: 1735689600 }), 2025);
  assert.equal(source.getSearchPairYear({ publishTime: '20250101' }), 2025);
  assert.equal(source.getSearchPairYear({ releaseTime: '2025-07-11T00:00:00Z' }), 2025);
  assert.equal(source.getSearchPairYear({ publishTime: 0, searchMemo: '1998·韩剧·敬请期待' }), 1998);
  assert.equal(source.getSearchPairYear({ publishTime: 'not-a-date' }), null);
  assert.equal(source.getSearchPairYear({ publishTime: 253402300800000 }), null);

  assert.equal(source.isMergeableSearchPair(
    { name: '千禧剧', publishTime: 974788882000 },
    { name: '千禧剧', publishTime: 974820151000 },
  ), true);
});


test('restored source options and grouped merge settings reach config API',async()=>{
 reset({SOURCE_ORDER:'hanjutv,renren,dandan',PLATFORM_ORDER:'hanjutv&renren',MERGE_SOURCE_PAIRS:'hanjutv&renren;renren&hanjutv'});
 assert.deepEqual(Globals.envs.sourceOrderArr,['hanjutv','renren']);
 assert.deepEqual(Globals.envs.platformOrderArr,['hanjutv&renren',null]);
 assert.deepEqual(Globals.envs.mergeSourcePairs,[{primary:'hanjutv',secondaries:['renren']},{primary:'renren',secondaries:['hanjutv']}]);
 const config=await(await request('/api/config')).json();
 for(const key of ['SOURCE_ORDER','PLATFORM_ORDER','MERGE_SOURCE_PAIRS','CUSTOM_MERGE_RULES']){
  const options=config.envVarConfig[key].options||config.envVarConfig[key].sources;
  for(const source of ['hanjutv','renren'])assert.ok(options.includes(source),key+':'+source);
  assert.ok(!options.includes('dandan'));
 }
});

test('restored persisted IDs and preferences survive while dandan is rejected',()=>{
 for(const id of ['hxq:abc123','tv:abc123',encodeMergedHanjutvEpisodeDanmuId('abc123','456')])assert.equal(isSupportedLocation(id,'hanjutv'),true,id);
 for(const id of ['series-123','renren:series-123'])assert.equal(isSupportedLocation(id,'renren'),true,id);
 for(const id of ['tv:abc123','hxq:abc123','merge:invalid'])assert.equal(isSupportedLocation(id,'tencent'),false,id);
 assert.equal(isSupportedLocation('merge:invalid','hanjutv'),false);
 assert.equal(isSupportedLocation('dandan:123','hanjutv'),false);
 const preference={preferBySeason:{1:11,2:12,3:13},sourceBySeason:{1:'hanjutv',2:'renren',3:'dandan'}};
 assert.deepEqual(pruneSourcePreferences(preference).sourceBySeason,{1:'hanjutv',2:'renren'});
});

test('hanjutv real full and segment pipelines preserve TV/HXQ/merged IDs',async()=>{
 const source=getSourceByKey('hanjutv'),original=source.fetchEpisodeDanmuByRef;
 const seen=[];
 source.fetchEpisodeDanmuByRef=async ref=>{seen.push(ref.rawId);return [{did:seen.length,t:3000,tp:1,sc:16777215,con:ref.preferTv?'极速版测试':'韩小圈测试',lc:1}];};
 try{
  for(const id of ['tv:123','hxq:456',encodeMergedHanjutvEpisodeDanmuId('456','123')]){
   reset();seen.length=0;
   addAnime({animeId:101,bangumiId:'101',animeTitle:'测试剧(2026)【韩剧】from hanjutv',source:'hanjutv',type:'韩剧',links:[{title:'【hanjutv】 第1集',url:id}]});
   const episodeId=Globals.animes[0].links[0].id;
   const res=await request('/api/v2/comment/'+episodeId);assert.equal(res.status,200);
   const comments=(await res.json()).comments;
   assert.ok(comments.some(c=>c.m==='极速版测试')===!id.startsWith('hxq:'));
   assert.ok(comments.some(c=>c.m==='韩小圈测试')===!id.startsWith('tv:'));
   assert.ok(seen.every(ref=>ref.startsWith('tv:')||ref.startsWith('hxq:')));
   const segments=await source.getEpisodeDanmuSegments(id);
   Globals.commentCache.clear();
   const segmentRes=await request('/api/v2/segmentcomment','POST',segments.segmentList[0]);assert.equal(segmentRes.status,200);assert.equal((await segmentRes.json()).count,comments.length);
  }
 }finally{source.fetchEpisodeDanmuByRef=original;}
});

test('renren real pipeline falls back on failure and adjusts advertisement time',async()=>{
 reset();const source=getSourceByKey('renren');
 const originals=Object.fromEntries(['getDetail','getAppDanmu','getMacDanmu','getWinDanmu','getWebDanmuFallback'].map(k=>[k,source[k]]));
 const calls=[];
 source.getDetail=async()=>({watchInfo:{m3u8:{startingLength:2000}}});
 source.getAppDanmu=async()=>{calls.push('TV');return null;};
 source.getMacDanmu=async()=>{calls.push('MAC');return [{p:'3,1,25,16777215,0,0,u,1',d:'人人测试'},{p:'1,1,25,16777215,0,0,u,2',d:'广告前弹幕'}];};
 source.getWinDanmu=source.getWebDanmuFallback=async()=>{throw Error('unexpected fallback');};
 try{
  addAnime({animeId:102,bangumiId:'102',animeTitle:'测试剧(2026)【电视剧】from renren',source:'renren',type:'电视剧',links:[{title:'【renren】 第1集',url:'100-123'}]});
  const res=await request('/api/v2/comment/'+Globals.animes[0].links[0].id);assert.equal(res.status,200);
  const data=await res.json();assert.deepEqual(calls,['TV','MAC']);assert.equal(data.count,1);assert.equal(data.comments[0].m,'人人测试');assert.equal(Number(data.comments[0].p.split(',')[0]),1);
  const segments=await source.getEpisodeDanmuSegments('100-123');Globals.commentCache.clear();
  const segmentRes=await request('/api/v2/segmentcomment','POST',segments.segmentList[0]);assert.equal(segmentRes.status,200);assert.equal((await segmentRes.json()).count,1);
 }finally{Object.assign(source,originals);}
});

test('hanjutv and renren merged comment entry preserves variant and manual offset',async()=>{
 reset();const hj=getSourceByKey('hanjutv'),rr=getSourceByKey('renren');
 const originalH=hj.fetchEpisodeDanmuByRef,originalR=rr.getEpisodeDanmu;const seen=[];
 hj.fetchEpisodeDanmuByRef=async ref=>{seen.push(ref.rawId);return [{did:1,t:3000,tp:1,sc:16777215,con:'韩剧合并弹幕',lc:1}];};
 rr.getEpisodeDanmu=async id=>{seen.push(id);return [{p:'4,1,25,16777215,0,0,u,2',d:'人人合并弹幕'}];};
 try{
  addAnime({animeId:103,bangumiId:'103',animeTitle:'合并测试剧(2026)【电视剧】from hanjutv&renren',source:'hanjutv&renren',type:'电视剧',links:[{title:'【hanjutv&renren】 第1集',url:'hanjutv:tv:123@5$$$renren:100-123'}]});
  const response=await request('/api/v2/comment/'+Globals.animes[0].links[0].id);assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.count,2);assert.deepEqual(seen,['tv:123','100-123']);
  const comment=data.comments.find(c=>c.m==='韩剧合并弹幕');assert.equal(Number(comment.p.split(',')[0]),8);assert.match(comment.p,/极速版/);
  assert.match(data.comments.find(c=>c.m==='人人合并弹幕').p,/renren/);
 }finally{hj.fetchEpisodeDanmuByRef=originalH;rr.getEpisodeDanmu=originalR;}
});
