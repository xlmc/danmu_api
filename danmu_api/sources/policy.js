import { parseHanjutvEpisodeDanmuId } from '../utils/hanjutv-util.js';
import { canonicalPlatformName } from '../utils/platform-util.js';

export const SUPPORTED_SOURCES = Object.freeze([
  'tencent', 'youku', 'iqiyi', 'imgo', 'bilibili', 'migu', 'sohu',
  'leshi', 'hongguo', 'hanjutv', 'renren', 'bahamut'
]);

export function isSupportedSource(value) {
  return SUPPORTED_SOURCES.includes(canonicalPlatformName(value));
}

const domains = {
  tencent: ['qq.com'], youku: ['youku.com'], iqiyi: ['iqiyi.com'],
  imgo: ['mgtv.com'], bilibili: ['bilibili.com', 'b23.tv'], migu: ['miguvideo.com'],
  sohu: ['sohu.com'], leshi: ['le.com'], hongguo: ['hongguoduanju.com'], bahamut: ['ani.gamer.com.tw']
};

export function sourceForUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    const hostname = url.hostname.toLowerCase();
    return Object.keys(domains).find(source => domains[source].some(domain =>
      hostname === domain || hostname.endsWith('.' + domain))) || null;
  } catch { return null; }
}

// Stored episode links may be platform IDs or platform-prefixed IDs.
export function isSupportedLocation(value, source = null) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) return Boolean(sourceForUrl(raw));
  const prefix = raw.match(/^([a-z][a-z0-9]*):/i)?.[1];
  if (!prefix) return isSupportedSource(source);
  // 韩剧 TV 使用带变体前缀的集 ID；它们不是独立弹幕来源。
  if (canonicalPlatformName(source) === 'hanjutv' && ['hxq','tv','merge'].includes(prefix)) {
    const refs = parseHanjutvEpisodeDanmuId(raw).refs;
    return refs.length > 0 && refs.every(ref => /^[a-z0-9_-]+$/i.test(ref.id));
  }
  if (!isSupportedSource(prefix)) return false;
  const id = raw.slice(prefix.length + 1);
  return /^https?:\/\//i.test(id) ? sourceForUrl(id) === canonicalPlatformName(prefix) : true;
}

export function pruneSourcePreferences(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.source && !isSupportedSource(value.source)) return null;
  const copy = { ...value };
  if (copy.sourceBySeason) {
    copy.sourceBySeason = { ...copy.sourceBySeason };
    copy.preferBySeason = { ...(copy.preferBySeason || {}) };
    copy.offsets = { ...(copy.offsets || {}) };
    copy.explicitBySeason = { ...(copy.explicitBySeason || {}) };
    for (const [season, source] of Object.entries(copy.sourceBySeason)) {
      if (String(source).split(/[＆&]/).every(isSupportedSource)) continue;
      for (const key of ['sourceBySeason', 'preferBySeason', 'offsets', 'explicitBySeason']) delete copy[key][season];
    }
  }
  return copy;
}
