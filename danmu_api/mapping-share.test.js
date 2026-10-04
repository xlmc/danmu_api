import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {handleRequest} from './worker.js';
import {systemSettingsJsContent} from './ui/js/systemsettings.js';
const config={TOKEN:'fixture-user',ADMIN_TOKEN:'fixture-admin',TITLE_MAPPING_TABLE:'Local -> Target;Another -> Other',AUTO_MATCH_MAPPING_TABLE:'Show S2E1~E2 -> Show S1E11~E12'};
const req=(token='fixture-admin',body={kind:'title',indices:[0],lines:['Local -> Target']})=>new Request('http://localhost/'+token+'/api/title-mapping/share',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const handle=(request,env=config)=>handleRequest(request,env,'cloudflare','127.0.0.1');
test('real route requires admin, validates current local selection, forwards only selected rules',async()=>{
  const old=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({success:true,id:'id',status:'pending_review',stored:1,duplicate:0,conflict:[],invalid:[]});};
  try{
    assert.equal((await handle(req('fixture-user'))).status,403);
    assert.equal((await handle(req('bad'))).status,401);
    const stale=await handle(req('fixture-admin',{kind:'title',indices:[0],lines:['Changed -> Target']}));assert.equal(stale.status,400);
    assert.equal(calls.length,0);
    const good=await handle(req());assert.equal(good.status,200);assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://danmu-rules-upload.cbzj.workers.dev/api/rules/submit');
    assert.deepEqual(JSON.parse(calls[0].options.body),{version:1,rules:[{kind:'title',line:'Local -> Target'}]});
    assert.ok(!JSON.stringify(calls).includes('fixture-admin'));assert.ok(!JSON.stringify(calls).includes('fixture-user'));
    const tooLarge=await handle(new Request('http://localhost/fixture-admin/api/title-mapping/share',{method:'POST',body:'x'.repeat(131073)}));assert.equal(tooLarge.status,413);
    globalThis.fetch=async()=>{throw Error('offline');};assert.equal((await handle(req())).status,502);assert.equal(config.TITLE_MAPPING_TABLE,'Local -> Target;Another -> Other');
  }finally{globalThis.fetch=old;}
});
test('real route works with auth disabled and default TOKEN admin behavior',async()=>{
  const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({success:true,status:'pending_review',stored:1,duplicate:0,conflict:[],invalid:[]});
  try{
    assert.equal((await handle(req(''),{...config,TOKEN_AUTH_DISABLED:'true'})).status,200);
    assert.equal((await handle(req('fixture-user'),{...config,ADMIN_TOKEN:''})).status,200);
  }finally{globalThis.fetch=old;}
});
test('generated UI parses, escapes untrusted rules and splits marker semicolons',()=>{
  new vm.Script(systemSettingsJsContent);
  const extract=name=>{const start=systemSettingsJsContent.indexOf('function '+name+'(');let pos=systemSettingsJsContent.indexOf('{',start),depth=1;while(depth){pos++;if(systemSettingsJsContent[pos]==='{')depth++;if(systemSettingsJsContent[pos]==='}')depth--;}return systemSettingsJsContent.slice(start,pos+1);};
  const ctx=vm.createContext({escapeHtml:s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')});
  vm.runInContext(extract('mappingShareLines')+';'+extract('renderMappingShareItem'),ctx);
  assert.equal(vm.runInContext("mappingShareLines('A -> B;C -> D').length",ctx),2);
  const html=vm.runInContext("renderMappingShareItem({key:'TITLE_MAPPING_TABLE',value:'<img src=x> -> Target'})",ctx);
  assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes(' checked'));assert.match(html,/上传共享/);
});
test('Node deployment request streams are supported without request.text buffering',async()=>{
  const {Request:NodeRequest}=await import('node-fetch');
  const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({success:true,status:'pending_review',stored:1,duplicate:0,conflict:[],invalid:[]});
  try{const r=await handle(new NodeRequest('http://localhost/fixture-admin/api/title-mapping/share',{method:'POST',body:JSON.stringify({kind:'title',indices:[0],lines:['Local -> Target']})}));assert.equal(r.status,200);}finally{globalThis.fetch=old;}
});
