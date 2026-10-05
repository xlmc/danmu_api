import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { TextEncoder } from 'node:util';
import { systemSettingsJsContent } from './ui/js/systemsettings.js';
function context() {
  const container = { innerHTML: '' };
  let submit;
  const requests = [];
  const rows = [];
  const ctx = vm.createContext({
    TextEncoder, AbortSignal, window: { addEventListener() {} },
    document: { body: { dataset: {} }, addEventListener() {},
      getElementById(id) { return id === 'env-form' ? { addEventListener(type, fn) { if (type === 'submit') submit = fn; } } : id === 'value-input-container' ? container : id === 'env-description-display' ? { textContent: 'mapping' } : null; },
      querySelectorAll(selector) { return selector === '#map-container .map-item' ? rows : []; }
    },
    escapeHtml: s => String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
    uiIcon: () => '', buildApiUrl: p => p, addLog() {}, customAlert(msg) { throw new Error(msg); },
    fetch: async (url, opts) => { requests.push(JSON.parse(opts.body)); return { json: async () => ({ success: true }) }; }
  });
  vm.runInContext(systemSettingsJsContent, ctx);
  vm.runInContext('renderEnvList = () => {}; renderPreview = () => {}; closeModal = () => {};',ctx);
  return {ctx,container,requests,rows,submit: (...args) => submit(...args)};
}
for (const key of ['TITLE_MAPPING_TABLE','AUTO_MATCH_MAPPING_TABLE']) {
  test(key + ' renders only row editor and add button, escaping existing values', () => {
    const r = context();
    r.ctx.renderValueInput({key, type:'map', value:'原值->目标;带"引号<值>->目标 @youku'});
    assert.match(r.container.innerHTML,/添加映射项/);
    assert.match(r.container.innerHTML,/上传共享/);
    assert.match(r.container.innerHTML, /mapping-editor-actions[\s\S]*addMapItem[\s\S]*mapping-upload-button[\s\S]*shareLocalMappings/);
    assert.doesNotMatch(r.container.innerHTML,/btn-secondary/);
    assert.doesNotMatch(r.container.innerHTML,/mapping-share-choice|checkbox|选择规则/);
    assert.match(r.container.innerHTML,/removeMapItem/);
    assert.match(r.container.innerHTML,/&quot;引号&lt;值&gt;/);
    assert.doesNotMatch(r.container.innerHTML,/textarea|map-bulk-value|解析并更新列表|查看最近数据|recent-data/);
  });
  test(key + ' saves current edited/added/deleted rows without reparsing bulk data', async () => {
    const r=context();
    Object.assign(r.ctx,{editingCategory:'match',editingKeyName:key,editingType:'map',editingKey:null,envVariables:{match:[]},currentCategory:'match'});
    for(const [left,right] of [[' 当前标题 S02E1~E2 ',' 目标 S01E11~E12 @youku '],['新增','平台目标'],['','']]) {
      r.rows.push({querySelector: selector => ({value:selector === '.map-input-left' ? left : right})});
    }
    await r.submit({preventDefault(){}});
    assert.deepEqual(r.requests,[{key,value:'当前标题 S02E1~E2->目标 S01E11~E12 @youku;新增->平台目标'}]);
  });
}

function uploadContext(lines, kind='title') {
  const r=context();
  const status={textContent:''};
  const panel={dataset:{shareKind:kind,shareLines:JSON.stringify(lines)},querySelector:()=>status};
  const button={innerHTML:'<svg></svg> 上传共享',textContent:'上传共享',disabled:false,closest:()=>panel};
  for(const line of lines) {const [left,right]=line.split('->').map(s=>s.trim());r.rows.push({querySelector:selector=>({value:selector==='.map-input-left'?left:right})});}
  r.ctx.fetch=async(url,opts)=>{const body=JSON.parse(opts.body);r.requests.push(body);return {ok:true,json:async()=>({success:true,stored:body.lines.length,duplicate:0,conflict:[],invalid:[]})};};
  return {...r,button,status};
}
test('one click uploads all saved rules in indexed batches without selection',async()=>{
  const lines=Array.from({length:205},(_,i)=>'标题'+i+' -> 目标'+i);
  const r=uploadContext(lines);await r.ctx.shareLocalMappings(r.button);
  assert.deepEqual(r.requests.map(b=>b.lines.length),[100,100,5]);
  assert.deepEqual(r.requests.flatMap(b=>b.lines),lines);
  assert.deepEqual(r.requests.flatMap(b=>b.indices),Array.from({length:205},(_,i)=>i));
  assert.match(r.status.textContent,/新增 205 条/);assert.equal(r.button.disabled,false);assert.equal(r.button.innerHTML,'<svg></svg> 上传共享');
});
test('unsaved edits prevent upload and season table uses season payload',async()=>{
  const r=uploadContext(['作品 S2E1 -> 平台 S1E10'],'season');await r.ctx.shareLocalMappings(r.button);
  assert.equal(r.requests[0].kind,'season');
  r.rows.push({querySelector:()=>({value:'未保存'})});await r.ctx.shareLocalMappings(r.button);
  assert.equal(r.requests.length,1);assert.match(r.status.textContent,/请先保存/);
});
test('partial failure stops subsequent batches and reports retry without local changes',async()=>{
  const r=uploadContext(Array.from({length:205},(_,i)=>'作品'+i+' -> 平台'+i));
  let calls=0;r.ctx.fetch=async()=>{calls++;return {ok:calls===1,json:async()=>calls===1?{success:true,stored:100}:{success:false,error:'共享服务不可用'}};};
  await r.ctx.shareLocalMappings(r.button);
  assert.equal(calls,2);assert.equal(r.rows.length,205);assert.match(r.status.textContent,/已完成 1\/3 批/);assert.match(r.status.textContent,/新增 100 条/);assert.equal(r.button.disabled,false);assert.equal(r.button.innerHTML,'<svg></svg> 上传共享');
});
test('non-editor configuration list does not render standalone upload panel',()=>{
  assert.doesNotMatch(systemSettingsJsContent,/renderEnvItem\(item, (?:category|currentCategory), originalIndex\) \+ renderMappingShareItem/);
});
