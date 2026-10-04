import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTmdbMatchIdentity, filterTmdbMatchCandidates, findSavedTmdbIdentity, resolveTmdbSpecialEpisode, selectTmdbSpecialEpisode } from './utils/tmdb-match-util.js';
import { parseAutoMatchMappingRules, collectAutoMatchCandidates } from './utils/auto-match-mapping-util.js';
import { Globals } from './configs/globals.js';
import { handleRequest } from './worker.js';
import { getSourceByKey } from './sources/registry.js';
import { addAnime } from './utils/cache-util.js';
import { refreshRemoteAutoMatchMappingNow } from './utils/auto-match-mapping-url-util.js';
import { Anime } from './models/dandan-model.js';
import { httpGet } from './utils/http-util.js';

test('TMDB query carries its typed ID and aliases forward without intermediary providers', async () => {
  const calls = [];
  const identity = await resolveTmdbMatchIdentity({title:'Example',season:2,episode:1,year:2025}, {
    search: async (title,type,options) => {calls.push([title,type,options]);return {data:{results:[{id:12,name:'示例',original_name:'Example',first_air_date:'2020-01-01'}]}};},
    details: async (type,id) => {calls.push([type,id]);return {id,name:'示例',original_name:'Example',first_air_date:'2020-01-01',seasons:[{season_number:2,air_date:'2025-01-01'}],alternative_titles:{results:[{title:'別名'}]}};}
  });
  assert.equal(identity.key,'tv:12');assert.equal(identity.tmdbId,'12');assert.equal(identity.seasonYear,2025);
  assert.ok(identity.aliases.includes('別名'));assert.deepEqual(calls,[['Example','tv',{page:1}],['tv',12]]);
});

test('TMDB ambiguity, wrong year, and unrelated top results do not assign an ID', async () => {
  let detailsCalls=0;
  const deps={search:async()=>({data:{results:[{id:1,name:'同名',release_date:'2020-01-01'},{id:2,name:'同名',release_date:'2024-01-01'}]}}),details:async()=>{detailsCalls++;return {id:2,title:'同名',release_date:'2024-01-01'};}};
  assert.equal(await resolveTmdbMatchIdentity({title:'同名'},deps),null);assert.equal(detailsCalls,0);
  assert.equal((await resolveTmdbMatchIdentity({title:'同名',year:2024},deps)).key,'movie:2');
  assert.equal(await resolveTmdbMatchIdentity({title:'另一部'},deps),null);
  assert.equal(await resolveTmdbMatchIdentity({title:'同名',year:1999},deps),null);
});

test('remote season mappings use TMDB identity regardless of their display title', () => {
  const {rules,warnings}=parseAutoMatchMappingRules([
    '旧译名{[tmdbid=12;type=tv]} S02E01 -> 平台标题 S01E25 @tencent',
    'Example S02E01 -> 错误作品{[tmdbid=99;type=tv]} S01E50',
    'Example S02E01 -> 无身份的标题 S01E70',
    '电影名{[tmdbid=12;type=movie]} S02E01 -> 电影标题 S01E01'
  ].join('\n'),['tencent']);
  assert.deepEqual(warnings,[]);
  const found=collectAutoMatchCandidates(rules,{title:'Example',identityKey:'tv:12',season:2,episode:3});
  assert.equal(found.length,1);assert.equal(found[0].targetEpisode,27);assert.equal(found[0].targetTitle,'平台标题');
  assert.equal(collectAutoMatchCandidates(rules,{title:'旧译名',identityKey:'tv:404',season:2,episode:3}).length,0);
  assert.equal(collectAutoMatchCandidates(rules,{identityKey:'movie:12',season:2,episode:1})[0].targetTitle,'电影标题');
});

test('conflicting mapping IDs and platform candidates are rejected', () => {
  assert.equal(parseAutoMatchMappingRules('原名{[tmdbid=12;type=tv]} S01E01 -> 目标{[tmdbid=99;type=tv]} S01E01').rules.length,0);
  const identity={key:'tv:12',tmdbId:'12',mediaType:'tv',aliases:['示例']};
  const result=filterTmdbMatchCandidates([{animeTitle:'示例',tmdbId:99},{animeTitle:'示例',type:'movie'},{animeTitle:'示例',type:'tvseries',tmdbId:12}],identity);
  assert.equal(result.length,1);assert.equal(result[0].tmdbId,12);
  const fresh={animeId:1,source:'tencent',bangumiId:'same-video',animeTitle:'示例'};
  assert.equal(filterTmdbMatchCandidates([fresh],identity,null,[{...fresh,tmdbIdentity:{key:'tv:99'}}]).length,0);
});

test('saved identities distinguish movie and TV namespaces and reject ambiguous aliases', () => {
  const tv={key:'tv:12',tmdbId:'12',mediaType:'tv',title:'同名',aliases:['同名'],year:2020};
  const movie={...tv,key:'movie:12',mediaType:'movie'};
  const animes=[{tmdbIdentity:tv},{tmdbIdentity:movie}];
  assert.equal(findSavedTmdbIdentity(animes,{title:'同名',season:1,episode:1}).key,'tv:12');
  assert.equal(findSavedTmdbIdentity(animes,{title:'同名'}).key,'movie:12');
  assert.equal(findSavedTmdbIdentity([...animes,{tmdbIdentity:{...tv,key:'tv:99',tmdbId:'99'}}],{title:'同名',season:1}),null);
});

test('TMDB failure leaves an unresolved platform search unmatched', async () => {
  Globals.init({TMDB_API_KEY:'test-key',TOKEN:'87654321',SOURCE_ORDER:'tencent',PLATFORM_ORDER:'tencent',LOCAL_CACHE_ENABLED:'false',LOCAL_REDIS_URL:'',USE_BANGUMI_DATA:'false',TITLE_MAPPING_TABLE_URL:'',AUTO_MATCH_MAPPING_TABLE_URL:'',LOG_LEVEL:'error'});
  Globals.animes=[];Globals.episodeIds=[];Globals.searchCache=new Map();Globals.queryCacheInitialized=false;
  const source=getSourceByKey('tencent'),saved=source.search,fetch=globalThis.fetch;let calls=0;
  source.search=async()=>{calls++;return [];};globalThis.fetch=async()=>new Response('{}',{status:401});
  try{
    const response=await handleRequest(new Request('http://localhost/87654321/api/v2/match',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fileName:'Unknown S01E01'})}),Globals.env,'node','127.0.0.1');
    const data=await response.json();assert.equal(data.isMatched,false);assert.equal(calls,1);
  }finally{source.search=saved;globalThis.fetch=fetch;}
});

test('match endpoint binds TMDB query ID to remote season rules and reuses the verified platform directory', async () => {
  Globals.init({TMDB_API_KEY:'test-key',TOKEN:'87654321',SOURCE_ORDER:'tencent',PLATFORM_ORDER:'tencent',MATCH_SEARCH_BUDGET_MS:'5',MERGE_SOURCE_PAIRS:'',LOCAL_CACHE_ENABLED:'false',LOCAL_REDIS_URL:'',USE_BANGUMI_DATA:'false',LOG_LEVEL:'error',TITLE_MAPPING_TABLE_URL:'',AUTO_MATCH_MAPPING_TABLE_URL:'https://mapping.test/tmdb-id-rules',});
  Globals.animes=[];Globals.episodeIds=[];Globals.episodeNum=10001;Globals.searchCache=new Map();Globals.lastSelectMap=new Map();Globals.queryCacheInitialized=false;
  const source=getSourceByKey('tencent'),savedSearch=source.search,savedHandle=source.handleAnimes,fetch=globalThis.fetch;
  const urls=[];let searches=0;
  globalThis.fetch=async input=>{
    const url=new URL(input);urls.push(url.href);
    if(url.hostname==='mapping.test')return new Response('旧译名{[tmdbid=12;type=tv]} S02E01 -> 平台名 S01E25 @tencent');
    if(url.pathname.endsWith('/search/tv'))return Response.json({results:[{id:12,name:'示例',original_name:'Example',first_air_date:'2020-01-01'}]});
    if(url.pathname.endsWith('/tv/12'))return Response.json({id:12,name:'示例',original_name:'Example',first_air_date:'2020-01-01',seasons:[{season_number:2,air_date:'2025-01-01'}]});
    throw new Error('Unexpected network request: '+url);
  };
  source.search=async()=>{searches++;return [];};
  source.handleAnimes=async(_raw,_title,results,details)=>{
    const anime={animeId:812,bangumiId:'official-12',animeTitle:'平台名(2025)【动漫】from tencent',source:'tencent',type:'tvseries',startDate:'2025-01-01',episodeCount:26,links:Array.from({length:26},(_,i)=>({url:`https://v.qq.com/x/cover/example/e${i+1}.html`,title:`【tencent】 第${i+1}集`}))};
    addAnime(anime,details);const {links,...dto}=anime;results.push(dto);
  };
  const request=async fileName=>{
    const response=await handleRequest(new Request('http://localhost/87654321/api/v2/match',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fileName})}),Globals.env,'node','127.0.0.1');
    assert.equal(response.status,200);return response.json();
  };
  try{
    assert.equal((await refreshRemoteAutoMatchMappingNow()).success,true);
    let result=await request('Example S02E02');
    assert.equal(result.isMatched,true,JSON.stringify(result));assert.equal(result.tmdb.key,'tv:12');assert.match(result.matches[0].episodeTitle,/26/);
    assert.equal(urls.filter(url=>url.includes('/search/tv')).length,1);assert.equal(urls.filter(url=>url.includes('/tv/12?')).length,1);
    const count=urls.length,searchCount=searches;
    // Exercise the same model conversion used by snapshots and background refreshes.
    Globals.animes=Globals.animes.map(anime=>Anime.fromJson(JSON.parse(JSON.stringify(anime))));
    result=await request('示例 S02E02');
    assert.equal(result.isMatched,true);assert.equal(result.tmdb.key,'tv:12');assert.match(result.matches[0].episodeTitle,/26/);
    assert.equal(urls.length,count,'confirmed alias must not query TMDB again');assert.equal(searches,searchCount,'saved directory must skip platform search');
  }finally{globalThis.fetch=fetch;source.search=savedSearch;source.handleAnimes=savedHandle;}
});
async function adaptiveFixture(fileName, catalog, {tmdb=null,env={},probeDirectory=false,events=[]}={}) {
  Globals.init({RATE_LIMIT_MAX_REQUESTS:'0',TOKEN:'87654321',SOURCE_ORDER:'tencent',PLATFORM_ORDER:'tencent',MATCH_SEARCH_BUDGET_MS:'0',MERGE_SOURCE_PAIRS:'',LOCAL_CACHE_ENABLED:'false',LOCAL_REDIS_URL:'',USE_BANGUMI_DATA:'false',TITLE_MAPPING_TABLE:'',TITLE_MAPPING_TABLE_URL:'',AUTO_MATCH_MAPPING_TABLE:'',AUTO_MATCH_MAPPING_TABLE_URL:'',TMDB_API_KEY:'test-key',LOG_LEVEL:'error',...env});
  Globals.animes=[];Globals.episodeIds=[];Globals.episodeNum=10001;Globals.searchCache=new Map();Globals.lastSelectMap=new Map();Globals.queryCacheInitialized=false;
  const source=getSourceByKey('tencent');const saved={search:source.search,handle:source.handleAnimes,comments:source.getComments,fetch:globalThis.fetch};
  const searches=[],requests=[];
  source.search=async title=>{events.push('source:tencent');searches.push(title);return [{title}];};
  source.handleAnimes=async(raw,_title,results,details)=>{
    if(probeDirectory)await httpGet('https://v.qq.com/adaptive-directory');
    for(const item of catalog(raw[0].title)){
      const anime=structuredClone(item);addAnime(anime,details);const {links,...dto}=anime;results.push(dto);
    }
  };
  source.getComments=async()=>[{p:'1,1,16777215,test',m:'试用弹幕'}];
  globalThis.fetch=async input=>{const url=new URL(input);requests.push(url.href);events.push(url.pathname);
    if(url.hostname==='v.qq.com')return Response.json({episodes:[]});
    if(!tmdb)throw Error('明确命中不应请求TMDB');
    if(url.pathname.endsWith('/search/tv'))return Response.json({results:tmdb.results});
    if(url.pathname.includes('/season/'))return tmdb.episode ? Response.json(tmdb.episode) : new Response('',{status:404});
    if(url.pathname.includes('/tv/'))return Response.json(tmdb.details);
    throw Error('unexpected URL '+url);
  };
  try{
    const response=await handleRequest(new Request('http://localhost/87654321/api/v2/match',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fileName})}),Globals.env,'node','127.0.0.1');
    const data=await response.json();let comments=null;
    if(data.isMatched){const comment=await handleRequest(new Request('http://localhost/87654321/api/v2/comment/'+data.matches[0].episodeId),Globals.env,'node','127.0.0.1');comments=await comment.json();}
    return {data,searches,requests,comments};
  }finally{source.search=saved.search;source.handleAnimes=saved.handle;source.getComments=saved.comments;globalThis.fetch=saved.fetch;}
}
const fixtureAnime=(title,year=2024,id=812,type='tvseries')=>({animeId:id,bangumiId:String(id),animeTitle:`${title}(${year})【${type==='movie'?'电影':'动漫'}】from tencent`,source:'tencent',type,startDate:year+'-01-01',episodeCount:2,links:[1,2].map(i=>({url:`https://v.qq.com/x/cover/adaptive${id}/e${i}.html`,title:`【tencent】 第${i}集`}))});

test('first match with empty caches reaches official comments without TMDB',async()=>{
  const {data,requests,searches,comments}=await adaptiveFixture('示例 S01E02',()=>[fixtureAnime('示例')]);
  assert.equal(data.isMatched,true);assert.equal(data.tmdb,undefined);assert.deepEqual(searches,['示例']);assert.equal(requests.length,0);assert.equal(comments.comments[0].m,'试用弹幕');
});
test('first match rejects ambiguous remakes; explicit year selects the correct work',async()=>{
  const catalog=()=>[fixtureAnime('同名',2020,1),fixtureAnime('同名',2024,2)];
  const ambiguous=await adaptiveFixture('同名 S01E02',catalog,{tmdb:{results:[{id:1,name:'同名',first_air_date:'2020-01-01'},{id:2,name:'同名',first_air_date:'2024-01-01'}]}});
  assert.equal(ambiguous.data.isMatched,false);assert.equal(ambiguous.searches.length,1);
  const clear=await adaptiveFixture('同名 2024 S01E02',catalog);assert.equal(clear.data.isMatched,true);assert.equal(clear.data.matches[0].animeId,2);assert.equal(clear.requests.length,0);
});
test('foreign first match uses one direct TMDB identity lookup then one new platform title',async()=>{
  const result=await adaptiveFixture('Example S01E02',title=>title==='示例'?[fixtureAnime('示例')]:[],{tmdb:{results:[{id:12,name:'示例',original_name:'Example',first_air_date:'2024-01-01'}],details:{id:12,name:'示例',original_name:'Example',first_air_date:'2024-01-01'}}});
  assert.equal(result.data.isMatched,true);assert.equal(result.data.tmdb.key,'tv:12');assert.deepEqual(result.searches,['Example','示例']);assert.equal(result.requests.length,2);
});
test('TMDB revalidation of the same title reuses the source search, including misses',async()=>{
  const result=await adaptiveFixture('示例 S01E02',()=>[],{tmdb:{results:[{id:12,name:'示例',first_air_date:'2024-01-01'}],details:{id:12,name:'示例',first_air_date:'2024-01-01'}}});
  assert.equal(result.data.isMatched,false);assert.deepEqual(result.searches,['示例']);assert.equal(result.requests.length,2);
});
test('TV request cannot select movie or use position for a different episode number',async()=>{
  const movie=fixtureAnime('示例',2024,1,'movie');
  assert.equal((await adaptiveFixture('示例 S01E02',()=>[movie])).data.isMatched,false);
  const numbered=fixtureAnime('示例');numbered.links=numbered.links.map((link,i)=>({...link,title:`【tencent】 第${i+11}集`}));
  assert.equal((await adaptiveFixture('示例 S01E02',()=>[numbered])).data.isMatched,false);
});

test('platform directory HTTP requests are shared across ordinary and TMDB-assisted stages',async()=>{
  const result=await adaptiveFixture('Example S01E02',title=>title==='示例'?[fixtureAnime('示例')]:[],{probeDirectory:true,tmdb:{results:[{id:12,name:'示例',original_name:'Example',first_air_date:'2024-01-01'}],details:{id:12,name:'示例',original_name:'Example',first_air_date:'2024-01-01'}}});
  assert.equal(result.data.isMatched,true);
  assert.equal(result.requests.filter(url=>url.includes('adaptive-directory')).length,1);
});

test('only the new matcher remains and removed sources cannot be configured',()=>{
  Globals.init({SOURCE_ORDER:'xigua,maiduidui,tencent',PLATFORM_ORDER:'xigua,maiduidui,tencent'});
  assert.equal(Globals.envs.tmdbMatchAssist,undefined);
  assert.equal(Globals.envs.titleToChinese,undefined);
  assert.deepEqual(Globals.envs.sourceOrderArr,['tencent']);
  assert.equal(getSourceByKey('xigua'),null);
  assert.ok(!Globals.envs.allowedPlatforms.includes('maiduidui'));
});

test('without TMDB credentials or proxy, an unresolved first match skips TMDB network requests',async()=>{
  const result=await adaptiveFixture('未知 S01E02',()=>[],{env:{TMDB_API_KEY:'',PROXY_URL:''}});
  assert.equal(result.data.isMatched,false);assert.deepEqual(result.searches,['未知']);assert.equal(result.requests.length,0);
});

const specialIdentity = {key:'tv:231620',tmdbId:'231620',mediaType:'tv',title:'现在就出发',aliases:['现在就出发'],
  seasons:[{season:3,year:2025},{season:4,year:2026}]};
const specialDetail = {id:101,season_number:0,episode_number:131,name:'第4季 先导片上',air_date:'2026-10-01'};
const specialCatalog = () => {
  const anime=fixtureAnime('现在就出发 第4季',2026,921,'variety');
  anime.links=[{url:'https://v.qq.com/x/cover/pilot/upper.html',title:'【tencent】 先导片上：沈腾沙滩十八滚'},
    {url:'https://v.qq.com/x/cover/pilot/lower.html',title:'【tencent】 先导片下：贾冰爆炒'},
    {url:'https://v.qq.com/x/cover/pilot/main.html',title:'【tencent】 第1期上：正片'}];
  anime.episodeCount=3;return anime;
};

test('TMDB S00E131 reaches the fourth-season pilot upper and its comments through POST match',async()=>{
  const result=await adaptiveFixture('现在就出发 S00E131',()=>[specialCatalog(),fixtureAnime('现在就出发 第3季',2025,922)],{
    tmdb:{results:[{id:231620,name:'现在就出发',first_air_date:'2023-01-01'}],
      details:{id:231620,name:'现在就出发',first_air_date:'2023-01-01',seasons:[{season_number:3,air_date:'2025-01-01'},{season_number:4,air_date:'2026-01-01'}]},
      episode:specialDetail}});
  assert.equal(result.data.isMatched,true,JSON.stringify(result.data));
  assert.match(result.data.matches[0].episodeTitle,/先导片上/);
  assert.ok(result.comments?.comments,JSON.stringify(result));
  assert.equal(result.comments.comments[0].m,'试用弹幕');
  assert.equal(result.requests.filter(url=>url.includes('/tv/231620/season/0/episode/131')).length,1);
  assert.deepEqual(result.searches,['现在就出发'],'fallback reuses this request’s source search');
});

test('TMDB special lookup validates episode coordinates and season year',async()=>{
  const resolve=detail=>resolveTmdbSpecialEpisode(specialIdentity,0,131,async()=>detail);
  assert.equal((await resolve(specialDetail)).targetSeason,4);
  assert.equal(await resolve({...specialDetail,episode_number:130}),null);
  assert.equal(await resolve({...specialDetail,season_number:1}),null);
  assert.equal(await resolve({...specialDetail,air_date:'2025-10-01'}),null);
  assert.equal(await resolve(null),null);
  assert.equal(await resolve({ ...specialDetail,name:'特别篇',air_date:null}),null);
});

test('special selector rejects wrong part, season, year, date and ambiguous titles',async()=>{
  const metadata=await resolveTmdbSpecialEpisode(specialIdentity,0,131,async()=>specialDetail);
  const episodes=anime=>anime.links.map((link,i)=>({episodeId:i+1,episodeTitle:link.title,url:link.url}));
  const choose=catalog=>selectTmdbSpecialEpisode(catalog,metadata,specialIdentity,episodes);
  assert.match(choose([specialCatalog()]).resEpisode.url,/upper/);
  const wrongPart=specialCatalog();wrongPart.links=wrongPart.links.slice(1);assert.equal(choose([wrongPart]),null);
  const wrongSeason=specialCatalog();wrongSeason.animeTitle=wrongSeason.animeTitle.replace('第4季','第3季');assert.equal(choose([wrongSeason]),null);
  const wrongYear=specialCatalog();wrongYear.animeTitle=wrongYear.animeTitle.replace('2026','2025');assert.equal(choose([wrongYear]),null);
  const wrongDate=specialCatalog();wrongDate.links[0].publishDate='2026-10-02';assert.equal(choose([wrongDate]),null);
  const ambiguous=specialCatalog();ambiguous.links.push({...ambiguous.links[0],url:'https://v.qq.com/another-pilot'});assert.equal(choose([ambiguous]),null);
  assert.equal(selectTmdbSpecialEpisode([specialCatalog()],{...metadata,title:'第131集'},specialIdentity,episodes),null);
});


test('missing TMDB special detail and ambiguous real catalog leave POST match unresolved',async()=>{
  const tmdb={results:[{id:231620,name:'现在就出发',first_air_date:'2023-01-01'}],
    details:{id:231620,name:'现在就出发',first_air_date:'2023-01-01',seasons:[{season_number:4,air_date:'2026-01-01'}]}};
  assert.equal((await adaptiveFixture('现在就出发 S00E131',()=>[specialCatalog()],{tmdb})).data.isMatched,false);
  const catalog=specialCatalog();catalog.links.push({...catalog.links[0],url:'https://v.qq.com/x/cover/pilot/duplicate.html'});
  assert.equal((await adaptiveFixture('现在就出发 S00E131',()=>[catalog],{tmdb:{...tmdb,episode:specialDetail}})).data.isMatched,false);
});


test('special fallback resolves TMDB first and obeys platform groups without a Tencent shortcut',async()=>{
  const iqiyi=getSourceByKey('iqiyi'),dandan=getSourceByKey('dandan');
  const saved=[iqiyi,dandan].map(source=>({source,search:source.search,handle:source.handleAnimes,comments:source.getComments}));
  const tmdb={results:[{id:231620,name:'现在就出发',first_air_date:'2023-01-01'}],
    details:{id:231620,name:'现在就出发',first_air_date:'2023-01-01',seasons:[{season_number:4,air_date:'2026-01-01'}]},episode:specialDetail};
  try {
    for(const iqiyiHits of [true,false]) {
      const events=[];
      iqiyi.search=async()=>{events.push('source:iqiyi');return [];};
      iqiyi.handleAnimes=async(_raw,_title,results,details)=>{
        if(!iqiyiHits)return;
        const anime=specialCatalog();anime.source='iqiyi';anime.animeId=932;anime.bangumiId='iq-pilot';
        anime.animeTitle=anime.animeTitle.replace('from tencent','from iqiyi');
        anime.links=anime.links.map((link,i)=>({...link,title:link.title.replace('tencent','iqiyi'),url:`https://www.iqiyi.com/v_pilot${i}.html`}));
        addAnime(anime,details);const {links,...dto}=anime;results.push(dto);
      };
      iqiyi.getComments=async()=>[{p:'1,1,16777215,test',m:'试用弹幕'}];
      dandan.search=async()=>{events.push('source:dandan');return [];};dandan.handleAnimes=async()=>{};
      const result=await adaptiveFixture('现在就出发 S00E131',()=>[specialCatalog()],{tmdb,events,
        env:{SOURCE_ORDER:'tencent,iqiyi,dandan',PLATFORM_ORDER:'iqiyi,tencent,dandan'}});
      assert.equal(result.data.isMatched,true,JSON.stringify(result.data));
      assert.deepEqual(events.filter(event=>event.startsWith('source:')),iqiyiHits?['source:iqiyi']:['source:iqiyi','source:tencent']);
      assert.ok(events.indexOf('/3/tv/231620/season/0/episode/131')<events.indexOf('source:iqiyi'));
      assert.match(result.data.matches[0].url,iqiyiHits?/iqiyi/:/qq\.com/);
    }
  } finally {for(const {source,search,handle,comments} of saved){source.search=search;source.handleAnimes=handle;source.getComments=comments;}}
});
