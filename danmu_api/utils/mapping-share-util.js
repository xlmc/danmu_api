import { Envs } from '../configs/envs.js';
import { jsonResponse } from './http-util.js';
import { logRemoteMapping } from './title-mapping-url-util.js';
const ENDPOINT='https://danmu-rules-upload.cbzj.workers.dev/api/rules/submit';
const uploadLog=(level,message)=>logRemoteMapping(level,`[system] [title-mapping] [upload] ${message}`);
function diagnostics(result) {
  return ['error_code','failure_stage','error_hint','error_type','github_status']
    .filter(key=>/^[\w.-]{1,80}$/.test(String(result?.[key]||'')))
    .map(key=>`${key}=${result[key]}`).join('，');
}
export function localShareRules(kind) {
  const key=kind==='title'?'TITLE_MAPPING_TABLE':'AUTO_MATCH_MAPPING_TABLE';
  // Never use globals.titleMappingTable: it also contains downloaded remote rules.
  const raw=Envs.get(key,'','string');
  const rules=[];let current='',markerDepth=0;
  for(let i=0;i<raw.length;i++) {
    const c=raw[i];if(raw.slice(i,i+2)==='{[')markerDepth++;
    if(raw.slice(i,i+2)===']}')markerDepth=Math.max(0,markerDepth-1);
    if((c===';'||c==='\n'||c==='\r')&&!markerDepth){if(current.trim())rules.push(current.trim());current='';}
    else current+=c;
  }
  if(current.trim())rules.push(current.trim());
  return rules;
}
async function readSelection(request) {
  const limit=131072;
  if(Number(request.headers.get('content-length'))>limit)throw new Error('选择请求过大');
  if(!request.body)throw new Error('缺少选择内容');
  let size=0;const chunks=[];
  const append=value=>{const bytes=typeof value==='string'?new TextEncoder().encode(value):value;size+=bytes.length;if(size>limit)throw new Error('选择请求过大');chunks.push(bytes);};
  // Standard Workers Requests use Web Streams; node-fetch uses Node readable streams.
  if(typeof request.body.getReader==='function') {
    const reader=request.body.getReader();
    try {while(true){const {done,value}=await reader.read();if(done)break;append(value);}}
    catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  } else {for await(const chunk of request.body)append(chunk);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export async function handleMappingShare(request) {
  let kind,indices,lines;
  try {
    if(Number(request.headers.get('content-length'))>131072)throw new Error('选择请求过大');
    const text=await readSelection(request);
    const body=JSON.parse(text);({kind,indices,lines}=body);
    if(Object.keys(body).some(k=>!['kind','indices','lines'].includes(k))||!['title','season'].includes(kind)
        ||!Array.isArray(indices)||!indices.length||indices.length>100||new Set(indices).size!==indices.length
        ||!Array.isArray(lines)||lines.length!==indices.length)throw new Error('请勾选 1~100 条本地规则');
    const local=localShareRules(kind);
    if(!indices.every((i,n)=>Number.isSafeInteger(i)&&i>=0&&i<local.length&&local[i]===lines[n]))throw new Error('本地规则已变化，请刷新后重新选择');
    lines=indices.map(i=>local[i]);
  } catch(e){uploadLog('warn',`上传请求被拒绝：${e.message||'选择格式无效'}；本地规则未改变`);return jsonResponse({success:false,error:e.message||'选择格式无效'},e.message==='选择请求过大'?413:400);}
  const payload={version:1,rules:lines.map(line=>({kind,line}))};
  if(new TextEncoder().encode(JSON.stringify(payload)).length>65536){uploadLog('warn','上传请求被拒绝：规则总大小超过 64 KiB；本地规则未改变');return jsonResponse({success:false,error:'规则总大小超过 64 KiB'},413);}
  const started=Date.now();
  uploadLog('info',`开始上传${kind==='title'?'标题':'季集'}映射 ${lines.length} 条，接收端 ${ENDPOINT}`);
  try {
    const response=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(30000)});
    let result;try{result=await response.json();}catch{
      uploadLog('error',`上传失败：共享服务 HTTP ${response.status}，返回内容不是有效 JSON；耗时 ${Date.now()-started}ms`);
      return jsonResponse({success:false,error:`共享服务返回格式错误（HTTP ${response.status}）；本地规则未改变`,upstreamStatus:response.status},502);
    }
    // Project user/admin tokens, IP, local paths, cookies and config are NOT forwarded.
    if(!response.ok||!result?.success){
      const reason=typeof result?.error==='string'?result.error.slice(0,300):'共享上传失败，本地规则未改变';
      uploadLog('error',`上传失败：共享服务 HTTP ${response.status}，${reason}${diagnostics(result)?`，${diagnostics(result)}`:''}；耗时 ${Date.now()-started}ms`);
      return jsonResponse({success:false,error:reason,upstreamStatus:response.status},response.status===429?429:502);
    }
    if(!['pending_review','already_received','no_new_rules'].includes(result.status)||!Number.isInteger(result.stored)){
      uploadLog('error',`上传失败：共享服务 HTTP ${response.status}，响应字段格式错误；耗时 ${Date.now()-started}ms`);
      return jsonResponse({success:false,error:'共享服务返回格式错误；本地规则未改变',upstreamStatus:response.status},502);
    }
    uploadLog('info',`上传完成：${kind==='title'?'标题':'季集'}映射 ${lines.length} 条，状态 ${result.status}，新增 ${result.stored} 条，重复 ${result.duplicate||0} 条，冲突 ${Array.isArray(result.conflict)?result.conflict.length:0} 条，无效 ${Array.isArray(result.invalid)?result.invalid.length:0} 条；耗时 ${Date.now()-started}ms`);
    return jsonResponse({success:true,id:result.id,status:result.status,stored:result.stored,duplicate:result.duplicate,
      conflict:result.conflict,invalid:result.invalid});
  }catch(error){
    const rawCode=error?.cause?.code||error?.code||'';
    const code=/^[A-Z0-9_]{1,64}$/.test(String(rawCode))?rawCode:'';
    const timedOut=['TimeoutError','AbortError'].includes(error?.name)||/TIMEOUT|TIMEDOUT/.test(code);
    const reason=timedOut?'共享上传请求超时':/ENOTFOUND|EAI_AGAIN/.test(code)?'无法解析共享服务域名':/CERT|TLS|SSL/.test(code)?'共享服务 TLS 连接失败':'无法连接共享服务';
    uploadLog('error',`上传失败：${reason}${code?`，网络错误 ${code}`:''}，错误类型 ${error?.name||'Error'}；耗时 ${Date.now()-started}ms；本地规则未改变`);
    return jsonResponse({success:false,error:`${reason}${code?`（${code}）`:''}，请稍后重试；本地规则未改变`},502);
  }
}
