import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from './configs/globals.js';
import { extractBaiduPersonMetadata, getBaiduPersonMetadata } from './utils/baidu-person-util.js';
import { getDomesticPersonMetadataForTitle } from './utils/tmdb-util.js';
import { cachedPersonSource, personCacheIdentity } from './utils/person-source-cache.js';
import { getComment, getCommentByUrl, getSegmentComment } from './apis/player-api.js';
import { setCommentCache } from './utils/cache-util.js';

const castRow = (actor, role) => `<div class="actorItem_example"><dl><dt><a>${actor}</a>&nbsp;饰&nbsp;<span>${role}</span></dt></dl></div>`;
const html = (title, rows = castRow('方逸伦', '宁长樾'), {year = '2026', region = '中国大陆', type = '电视剧'} = {}) =>
  `<title>${title}（${year}年导演执导的${type}）_百度百科</title>
   <div><dt class="basicInfoItem_test">制片地区</dt><dd>${region}</dd></div>
   <div><dt class="basicInfoItem_test">首播时间</dt><dd>${year}年9月24日<sup>[1]</sup></dd></div>
   <p>剧情提到无关人物，导演也不能当作演员。</p>${rows}`;

test('百度演员表只提取姓名，排除注释、简介和空角色', () => {
  const result = extractBaiduPersonMetadata(html('长生契', castRow('方逸伦<sup>[2]</sup>', '宁长樾')
    + castRow('栾竣淏', '-') + castRow('林小宅', '喻涂（青年）')
    + '<dt>导演 饰 无关人物</dt>'), {title:'长生契', year:'2026', mediaType:'tv'});
  assert.deepEqual(result.actorNames, ['方逸伦','栾竣淏','林小宅']);
  assert.deepEqual(result.characterNames, ['宁长樾','喻涂']);
});

test('拒绝错误名称、年份、小说、电影/剧集冲突、海外作品和验证页', () => {
  const context = {title:'长生契',year:'2026',mediaType:'tv'};
  for (const body of [html('另一部'), html('长生契','',{year:'2020'}),
    html('长生契','',{type:'网络小说'}), html('长生契','',{type:'电影'}),
    html('长生契','',{region:'日本'}), '<title>百度安全验证</title>']) {
    assert.throws(() => extractBaiduPersonMetadata(body, context));
  }
  assert.throws(() => extractBaiduPersonMetadata(html('长生契'),{...context,title:'长生契第二季'}));
  assert.deepEqual(extractBaiduPersonMetadata(html('流浪地球',castRow('吴京','刘培强'),{year:'2019',type:'科幻片'}),
    {title:'流浪地球',year:'2019',mediaType:'movie'}).characterNames,['刘培强']);
});

test('同名义项按年份和类型唯一选择，冲突时不请求详情', async () => {
  Globals.init({LOG_LEVEL:'error'});
  const original = globalThis.fetch;
  const calls = [];
  const link = (id, desc) => `<a href="/item/长生契/${id}?fromModule=disambiguation">${desc}</a>`;
  let ambiguous = false;
  globalThis.fetch = async url => {
    calls.push(String(url));
    return new Response(String(url).includes('/67411207?') ? html('长生契') :
      `<title>长生契_百度百科</title>${link(1,'网络小说')}${link(67411207,'2026年奇幻情感剧')}
       ${ambiguous ? link(2,'2026年电视剧') : link(3,'2020年电视剧')}`);
  };
  try {
    const result = await getBaiduPersonMetadata('长生契','2026','tv');
    assert.deepEqual(result.characterNames,['宁长樾']);
    assert.equal(calls.length,2);
    ambiguous=true; calls.length=0;
    await assert.rejects(getBaiduPersonMetadata('长生契','2026','tv'),/唯一匹配/);
    assert.equal(calls.length,1);
  } finally { globalThis.fetch=original; Globals.init({}); }
});

async function seed(title, actors, roles, {candidate=true, wikiRoles=[]} = {}) {
  const key = await personCacheIdentity([title,'2026','','',Boolean(Globals.envs.useBangumiData)]);
  await cachedPersonSource(`${key}:identity`, async () => candidate ? {id:990701,media_type:'tv',name:title,
    original_language:'zh',origin_country:['CN'],first_air_date:'2026-09-24',genre_ids:[]} : null, value=>Boolean(value));
  if (candidate) await cachedPersonSource(`${key}:tv/990701:credits`,async()=>({actorNames:actors,characterNames:roles}),()=>true);
  await cachedPersonSource(`${key}:wiki`,async()=>({actorNames:[],characterNames:wikiRoles}),()=>true);
}

test('真实人物加载入口按缺项补查，保留原演员表，失败不丢弃已有资料', async () => {
  Globals.init({LOG_LEVEL:'error'});
  const original = globalThis.fetch;
  const calls=[];
  globalThis.fetch=async url=>{
    calls.push(String(url));
    const title=decodeURIComponent(new URL(url).pathname.split('/')[2]);
    if(title==='补查失败') return new Response('Forbidden',{status:403});
    return new Response(html(title));
  };
  try {
    for (const [title,actors,roles,options,expectedActors,expectedRoles,requests] of [
      ['名单齐全',['原演员'],['原角色'],{},['原演员'],['原角色'],0],
      ['仅缺角色',['原演员'],[],{},['原演员'],['宁长樾'],1],
      ['全部缺失',[],[],{candidate:false},['方逸伦'],['宁长樾'],1],
      ['维基已有',['原演员'],[],{wikiRoles:['维基角色']},['原演员'],['维基角色'],0],
      ['补查失败',['原演员'],[],{},['原演员'],[],1],
    ]) {
      await seed(title,actors,roles,options); calls.length=0;
      const result=await getDomesticPersonMetadataForTitle(`${title}(2026)`);
      assert.deepEqual(result.actorNames,expectedActors,title);
      assert.deepEqual(result.characterNames,expectedRoles,title);
      assert.equal(calls.length,requests,title);
      await getDomesticPersonMetadataForTitle(`${title}(2026)`);
      assert.equal(calls.length,requests,`${title} 使用缓存或失败退避`);
    }
  } finally { globalThis.fetch=original; Globals.init({}); }
});

test('百度补充的角色经普通、URL和分段弹幕入口实际过滤，缓存不重复查询', async () => {
  const title='百科入口回归';
  Globals.init({BLOCK_DOMESTIC_CELEBRITIES:'true',COMMENT_CACHE_MIN_COUNT:'0',LOG_LEVEL:'error'});
  await seed(title,['原演员'],[]);
  const url='https://v.qq.com/x/cover/baidu-person-test/episode.html';
  Globals.animes=[{animeTitle:`${title}(2026)`,links:[{id:990701,url}]}];
  const comments=['宁长樾出场','原演员来了','剧情很好看'].map((m,i)=>({p:`${i+1},1,16777215,[test]`,m}));
  setCommentCache(url,comments);
  const segment={type:'tencent',url:'baidu-test-segment',animeTitle:`${title}(2026)`,sourceUrl:url};
  setCommentCache(segment.url,comments);
  const original=globalThis.fetch; let calls=0;
  globalThis.fetch=async request=>{
    assert.equal(new URL(request).hostname,'bkso.baidu.com'); calls++;
    return new Response(html(title));
  };
  try {
    const responses=[await getCommentByUrl(url,'json',false),await getComment('/api/v2/comment/990701','json',false),await getSegmentComment(segment,'json')];
    for (const response of responses) assert.deepEqual((await response.json()).comments.map(c=>c.m),['剧情很好看']);
    assert.equal(calls,1);
  } finally { globalThis.fetch=original; Globals.init({}); Globals.animes=[]; Globals.commentCache=new Map(); }
});
