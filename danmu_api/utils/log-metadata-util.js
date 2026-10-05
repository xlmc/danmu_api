// 分类与来源独立；不根据附近的日志猜测当前来源。
const sources = new Set(['tencent','youku','iqiyi','mango','bilibili','migu','sohu','leshi','hongguo','bahamut']);
export function normalizeLogSource(source) {
  return ({imgo:'mango',qq:'tencent','bilibili-proxy':'bilibili'}[source] || source);
}
export function getLogMetadata(message) {
  const prefix = String(message).match(/^(?:\s*\[[^\]]+\])+/)?.[0] || '';
  const tags = [...prefix.matchAll(/\[([^\]]+)\]/g)].map(m => m[1].toLowerCase());
  const categories = [];
  if (tags.some(t => /^(match|auto-match|title-mapping|remote-mapping)/.test(t))) {
    if (tags.some(t => /mapping/.test(t))) categories.push('mapping');
    if (tags.some(t => /^match(?:-|$)/.test(t) || t === 'auto-match-mapping')) categories.push('match');
  }
  if (tags.some(t => ['blocked-words','person-filter','person-metadata','domestic-filter','danmu'].includes(t))) categories.push('filter');
  if (tags.some(t => /cache|redis/.test(t))) categories.push('cache');
  if (tags.includes('merge')) categories.push('merge');
  const normalized = tags.map(normalizeLogSource);
  const source = normalized.find(t => sources.has(t)) || null;
  if (source) categories.push('source');
  if (!categories.length) categories.push('system');
  return { categories: [...new Set(categories)], source, tags: tags.filter(t => !t.startsWith('match-id=')), requestId: message.match(/\[match-id=([^\]]+)\]/)?.[1] || null };
}
