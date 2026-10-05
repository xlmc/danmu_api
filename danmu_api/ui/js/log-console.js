// 模板中的脚本保持字面量，所有日志内容只经转义后显示。
export const logConsoleJsContent = String.raw`
const logViewState = { view: 'all', category: 'all', sources: new Set(), query: '', level: 'all', sort: 'new', context: '', auto: false, follow: true };
const logCategories = { all: '全部', match: '匹配', mapping: '映射', filter: '弹幕过滤', cache: '缓存', source: '来源请求', merge: '合并', system: '系统' };
const logSources = { tencent: '腾讯', iqiyi: '爱奇艺', bilibili: 'B站', mango: '芒果', youku: '优酷', imgo: '芒果', qq: '腾讯', migu: '咪咕', sohu: '搜狐', leshi: '乐视', hongguo: '红果', hanjutv: '韩剧TV', renren: '人人视频', bahamut: '巴哈姆特' };
let logFetchPending = false;
let logInitialized = false;
let logCapacity = 1000;
let logConfiguredLevel = 'info';
let logLastIds = new Set();
let logOpenIds = new Set();
function escapeLogHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function isLogViewVisible() { return document.getElementById('logs-section')?.classList.contains('active'); }
function logTime(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }); }
function logDuration(value) { return value == null ? '—' : value < 1000 ? value + ' ms' : (value / 1000).toFixed(2) + ' 秒'; }
function inferLogCategories(message) {
  const category = getLogCategory(message);
  if (['remote-mapping','title-mapping','auto-match-mapping'].includes(category)) return ['mapping'];
  if (category === 'blocked-words') return ['filter'];
  if (category === 'cache') return ['cache'];
  if (category === 'merge') return ['merge'];
  if (category === 'ai') return ['ai'];
  if (/\[match(?:-|\])/.test(message)) return ['match'];
  return category === 'system' || category === '_inherit_' ? ['system'] : ['source'];
}
function normalizeLogEntry(entry, index) {
  const category = getLogCategory(entry.message || '');
  const requestId = entry.requestId || entry.message?.match(/\[match-id=([^\]]+)\]/)?.[1] || '';
  return { ...entry, id: entry.id || 'legacy-' + index + '-' + entry.timestamp,
    type: entry.level || entry.type || 'info', categories: entry.categories || inferLogCategories(entry.message || ''),
    source: Object.hasOwn(entry,'source') ? entry.source : (['system','_inherit_','blocked-words','cache','merge','ai','title-mapping','remote-mapping'].includes(category) ? null : category),
    requestId: /^[a-zA-Z0-9_-]{1,64}$/.test(requestId) ? requestId : null, tags: entry.tags || [] };
}
function addLog(message, type = 'info') {
  logs.push(normalizeLogEntry({ id: 'ui-' + Date.now() + '-' + Math.random(), timestamp: new Date().toISOString(), message, type, categories: ['system'] }, logs.length));
  if (logs.length > logCapacity) logs.shift();
  if (isLogViewVisible()) renderLogs();
}
function filterLogEntries({ ignoreCategory = false } = {}) {
  const s = logViewState;
  return logs.filter(e => (ignoreCategory || s.category === 'all' || e.categories.includes(s.category)) &&
    (!s.sources.size || s.sources.has(e.source)) &&
    (s.level === 'all' || (s.level === 'warn' ? ['warn','error'].includes(e.type) : e.type === s.level)) &&
    (!s.context || e.requestId === s.context) &&
    (!s.query || (e.message + ' ' + (e.requestId || '')).toLowerCase().includes(s.query.toLowerCase())));
}
function formatLogDetail(entry) {
  const text = entry.message;
  const index = text.indexOf('{');
  if (index >= 0) { try { return text.slice(0, index) + '\n' + JSON.stringify(JSON.parse(text.slice(index)), null, 2); } catch {} }
  return text;
}
function rawLogLine(entry) { return '[' + entry.timestamp + '] ' + entry.type + ': ' + entry.message; }
function initLogControls() {
  if (logInitialized) return;
  logInitialized = true;
  const section = document.getElementById('logs-section');
  section.querySelectorAll('[data-log-view]').forEach(button => button.addEventListener('click', () => {
    logViewState.view = button.dataset.logView; logViewState.context = ''; renderLogs();
  }));
  document.getElementById('log-query').addEventListener('input', e => { logViewState.query = e.target.value; renderLogs(); });
  for (const key of ['level','sort']) document.getElementById('log-' + key).addEventListener('change', e => { logViewState[key] = e.target.value; renderLogs(); });
  document.getElementById('log-auto').addEventListener('change', e => { logViewState.auto = e.target.checked; if (e.target.checked) fetchRealLogs(); });
  document.getElementById('log-follow').addEventListener('change', e => { logViewState.follow = e.target.checked; renderLogs(); });
  document.getElementById('log-container').addEventListener('scroll', e => {
    const el = e.target;
    const awayFromLatest = logViewState.view === 'match' ? el.scrollTop > 70 : el.scrollHeight - el.scrollTop - el.clientHeight > 70;
    if (awayFromLatest && logViewState.follow) {
      logViewState.follow = false; document.getElementById('log-follow').checked = false;
    }
  }, { passive: true });
  document.getElementById('log-latest').addEventListener('click', () => { logViewState.follow = true; logViewState.sort = 'new'; document.getElementById('log-sort').value = 'new'; document.getElementById('log-follow').checked = true; renderLogs(); });
  document.getElementById('log-reset').addEventListener('click', resetLogFilters);
  document.getElementById('log-export').addEventListener('click', () => {
    const blob = new Blob([filterLogEntries().map(rawLogLine).join('\n')], {type:'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url;
    a.download = 'danmu-logs-' + Date.now() + '.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.getElementById('log-container').addEventListener('click', async e => {
    const button = e.target.closest('button'); if (!button) return;
    if (button.dataset.logContext) {
      logViewState.context = button.dataset.logContext; logViewState.query = ''; logViewState.category = 'all';
      logViewState.sources.clear(); logViewState.level = 'all'; logViewState.view = 'all';
      document.getElementById('log-query').value = ''; document.getElementById('log-level').value = 'all'; renderLogs();
    }
    if (button.dataset.logCopy) {
      const key = button.dataset.logCopy;
      const text = key.startsWith('request:') ? logs.filter(x => x.requestId === key.slice(8)).map(rawLogLine).join('\n') : rawLogLine(logs.find(x => x.id === key));
      try { await navigator.clipboard.writeText(text); document.getElementById('log-update-state').textContent = '已复制'; }
      catch { customAlert('浏览器未允许复制，请展开详情后选择文本复制。'); }
    }
  });
  document.getElementById('log-container').addEventListener('toggle', e => {
    const key = e.target.dataset.logOpen; if (!key) return;
    if (e.target.open) logOpenIds.add(key); else logOpenIds.delete(key);
  }, true);
  setInterval(() => { if (logViewState.auto && isLogViewVisible() && !document.hidden) fetchRealLogs(); }, 3000);
}
function resetLogFilters() {
  Object.assign(logViewState, {category:'all',sources:new Set(),query:'',level:'all',context:''});
  document.getElementById('log-query').value = ''; document.getElementById('log-level').value = 'all'; renderLogs();
}
function renderLogFilters() {
  const candidate = filterLogEntries({ignoreCategory:true});
  document.getElementById('log-categories').innerHTML = Object.entries(logCategories).map(([key,name]) =>
    '<button type="button" class="filter-btn ' + (logViewState.category===key?'active':'') + '" data-log-category="' + key + '">' + name + ' <span>' + (key==='all'?candidate.length:candidate.filter(e=>e.categories.includes(key)).length) + '</span></button>').join('');
  document.querySelectorAll('[data-log-category]').forEach(button=>button.onclick=()=>{logViewState.category=button.dataset.logCategory;renderLogs();});
  const sources = [...new Set(logs.map(e=>e.source).filter(Boolean))].sort();
  document.getElementById('log-sources').innerHTML = sources.map(source => '<label><input type="checkbox" value="' + escapeLogHTML(source) + '" ' + (logViewState.sources.has(source)?'checked':'') + '> ' + escapeLogHTML(logSources[source] || source) + '</label>').join('') || '<span>暂无来源记录</span>';
  document.getElementById('log-source-label').textContent = logViewState.sources.size ? '来源 · ' + logViewState.sources.size : '全部来源';
  document.querySelectorAll('#log-sources input').forEach(input=>input.onchange=()=>{if(input.checked)logViewState.sources.add(input.value);else logViewState.sources.delete(input.value);renderLogs();});
  document.getElementById('log-context').hidden = !logViewState.context;
  document.getElementById('log-context-id').textContent = logViewState.context;
}
function renderRawLogs(entries) {
  return entries.map(e=>{
    const key=escapeLogHTML(e.id); const content=escapeLogHTML(e.message.replace(/\[match-id=[^\]]+\]\s*/,''));
    const summary = content.length > 220 ? content.slice(0,220) + '…' : content;
    return '<details class="lv-entry ' + escapeLogHTML(e.type) + '" data-log-open="'+key+'" '+(logOpenIds.has(e.id)?'open':'')+'><summary><time>'+escapeLogHTML(logTime(e.timestamp))+'</time><span class="lv-level">'+escapeLogHTML(e.type.toUpperCase())+'</span><span class="lv-class">'+e.categories.map(c=>escapeLogHTML(logCategories[c]||c)).join(' · ')+'</span><span class="lv-source">'+escapeLogHTML(logSources[e.source]||e.source||'—')+'</span><span class="lv-summary">'+summary+'</span></summary><div class="lv-detail"><div class="lv-actions">'+(e.requestId?'<button type="button" class="btn btn-small" data-log-context="'+escapeLogHTML(e.requestId)+'">查看本次请求 #'+escapeLogHTML(e.requestId)+'</button>':'')+'<button type="button" class="btn btn-small" data-log-copy="'+key+'">复制日志</button></div><pre>'+escapeLogHTML(formatLogDetail(e))+'</pre></div></details>';
  }).join('');
}
function renderMatchLogs(entries) {
  const ids = new Set(entries.map(e=>e.requestId).filter(Boolean));
  let groups=[...ids].map(id=>{
    const rows=logs.filter(e=>e.requestId===id);
    const last=event=>rows.filter(e=>e.event===event).at(-1)?.data;
    return { id,rows,identity:last('match.identity'),result:last('match.result'),returned:last('match.return'),fast:last('match.fast') };
  });
  if(logViewState.sort==='slow')groups.sort((a,b)=>(b.returned?.durationMs??-1)-(a.returned?.durationMs??-1));
  else groups.reverse();
  return groups.map(g=>{
    const {rows,identity,result,returned,fast}=g; const completeStart=rows.some(e=>e.event==='match.start');
    const pending=new Map();for(const e of rows){if(e.event==='step.start')pending.set(e.data.name,e);if(e.event==='step.end')pending.delete(e.data.name);}
    const incomplete=!completeStart || (logConfiguredLevel!=='info' && logConfiguredLevel!=='debug');
    const searchPending=[...pending.keys()].some(n=>n.startsWith('完整搜索'));
    const status=result ? (result.isMatched?'匹配成功':'未匹配') : returned?.status>=400?'请求错误':returned?'结果记录缺失':incomplete?'过程不完整':'尚无返回记录';
    const title=identity?identity.title + ' S'+(identity.season??'?')+'E'+(identity.episode??'?'):'请求 #'+g.id;
    const steps=rows.filter(e=>e.event==='step.end'&&!e.data.source);
    const sourceSteps=rows.filter(e=>e.event==='step.end'&&e.data.source);
    const sourceNames=[...new Set(sourceSteps.map(e=>e.data.source).concat([...pending.values()].map(e=>e.data.source).filter(Boolean)))];
    const sourceRows=sourceNames.map(source=>{
      const done=sourceSteps.filter(e=>e.data.source===source);const ms=done.reduce((n,e)=>n+e.data.durationMs,0);
      const waiting=[...pending.values()].some(e=>e.data.source===source);
      const failed=done.some(e=>e.data.status==='failed');
      return '<div class="lv-source-time"><span>'+escapeLogHTML(logSources[source]||source)+'</span><span>'+logDuration(ms)+(waiting?' + 未结束阶段':'')+'</span><span>'+ (failed?'阶段失败':waiting?'尚未结束':'阶段已结束')+'</span></div>';
    }).join('');
    return '<details class="lv-request" data-log-open="request:'+g.id+'" '+(logOpenIds.has('request:'+g.id)?'open':'')+'><summary><span class="lv-request-name">'+escapeLogHTML(title)+'<small>'+escapeLogHTML(result?.stage||'阶段记录待确认')+(returned&&searchPending?' · 匹配已返回，其余来源仍在搜索':'')+'</small></span><span class="lv-status '+(result?.isMatched?'lv-success':'')+'">'+status+'</span><strong>'+logDuration(returned?.durationMs)+'</strong></summary><div class="lv-detail">'+(incomplete?'<p class="lv-note">过程不完整：起始日志已淘汰或当前日志级别未保留完整过程。</p>':'')+(fast?'<p class="lv-note">快速路径：'+(fast.enabled?'启用 · 预算 '+fast.budgetMs+' ms':'未启用 · '+escapeLogHTML(fast.reasons.join('、')))+'</p>':'')+steps.map(e=>'<div class="lv-step"><span>'+escapeLogHTML(e.data.name)+'</span><span>'+ (e.data.status==='failed'?'失败 · ':'')+logDuration(e.data.durationMs)+'</span></div>').join('')+(sourceRows?'<div class="lv-source-times"><div class="lv-note">本次来源阶段累计耗时 · 各来源并行，不相加计算响应时间</div>'+sourceRows+'</div>':'')+(result?.matches?.length?'<p>最终选择：'+escapeLogHTML(result.matches.map(m=>m.animeTitle+' / '+m.episodeTitle).join('、'))+'</p>':'')+'<div class="lv-actions"><button type="button" class="btn btn-small" data-log-context="'+g.id+'">查看本次全部日志</button><button type="button" class="btn btn-small" data-log-copy="request:'+g.id+'">复制本次日志</button><span class="lv-note">#'+g.id+'</span></div></div></details>';
  }).join('') || '<div class="lv-empty">暂无匹配追踪记录。完整过程需要 LOG_LEVEL=info 或 debug。</div>';
}
function renderLogs() {
  const container=document.getElementById('log-container');if(!container)return;
  initLogControls();
  const scrollTop=container.scrollTop;
  renderLogFilters();
  document.querySelectorAll('[data-log-view]').forEach(b=>{b.classList.toggle('active',b.dataset.logView===logViewState.view);b.setAttribute('aria-selected',String(b.dataset.logView===logViewState.view));});
  document.getElementById('log-sort').hidden=logViewState.view!=='match';
  document.getElementById('log-column-head').hidden=logViewState.view!=='all';
  const entries=filterLogEntries();
  container.innerHTML=logViewState.view==='match'?renderMatchLogs(entries):(renderRawLogs(entries)||'<div class="lv-empty">没有符合条件的日志</div>');
  document.getElementById('log-count').textContent='筛选 '+entries.length+' / 保留 '+logs.length+' 条 · 上限 '+logCapacity+' · 日志级别 '+logConfiguredLevel;
  container.scrollTop=logViewState.follow?(logViewState.view==='match'?0:container.scrollHeight):scrollTop;
}
async function fetchRealLogs() {
  if(logFetchPending)return;
  logFetchPending=true;
  const state=document.getElementById('log-update-state');
  try{
    const response=await fetch(buildApiUrl('/api/logs?format=json'),{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const payload=await response.json();
    if(!Array.isArray(payload.entries))throw new Error('日志响应格式不正确');
    const next=payload.entries.map(normalizeLogEntry);
    const added=next.filter(e=>!logLastIds.has(e.id)).length;
    logLastIds=new Set(next.map(e=>e.id));
    logCapacity=payload.capacity||1000;logConfiguredLevel=payload.logLevel||'info';
    const ids=new Set(next.map(e=>e.id).concat(next.map(e=>'request:'+e.requestId)));logOpenIds=new Set([...logOpenIds].filter(id=>ids.has(id)));
    const changed=logs.length!==next.length||logs.at(-1)?.id!==next.at(-1)?.id;
    logs=next;if(isLogViewVisible()&&(changed||!logInitialized))renderLogs();
    state.textContent='更新于 '+new Date().toLocaleTimeString('zh-CN',{hour12:false})+(added&&!logViewState.follow?' · 新增 '+added+' 条':'');
  }catch(error){state.textContent='获取日志失败：'+error.message;}finally{logFetchPending=false;}
}
function refreshLogs(){fetchRealLogs();}
async function clearLogs(){
  const check=await checkDeployPlatformConfig();if(!check.success){customAlert(check.message);return;}
  const confirmed=await customConfirm('确定清空服务端当前保留的所有日志？','清空确认');if(!confirmed)return;
  try{const response=await fetch(buildApiUrl('/api/logs/clear',true),{method:'POST'});const result=await response.json();if(!response.ok||!result.success)throw new Error(result.message||'清空失败');logs=[];logLastIds.clear();logOpenIds.clear();renderLogs();document.getElementById('log-update-state').textContent='日志已清空';}catch(error){customAlert(error.message);}
}
function highlightJSON(obj){
  const json=JSON.stringify(obj,null,2).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,match=>{
    const cls=/^"/.test(match)?(/:$/.test(match)?'key':'string'):/true|false/.test(match)?'boolean':/null/.test(match)?'null':'number';
    return '<span class="'+cls+'">'+match+'</span>';
  });
}
`;
