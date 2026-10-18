// Infuse only keeps the numeric episodeId returned by /api/v2/search/episodes
// and later asks /api/v2/comment/:episodeId. Serverless requests may land in a
// different isolate, so process-local auto-increment IDs are not sufficient.
//
// This module gives TMDB-based requests a deterministic, reversible safe
// integer. The ID carries the TMDB id, media type, requested episode and source;
// the remaining bits fingerprint the concrete source URL. A local/edge mapping
// is still used as the fast path, while callers can decode the context and
// rediscover the URL after a cold start without requiring Redis or a KV binding.

const MAGIC_BITS = 7n;
const MAGIC_VALUE = 0b1011101n;
const HASH_BITS = 7n;
const SOURCE_BITS = 5n;
const EPISODE_BITS = 11n;
const MEDIA_BITS = 1n;
const HASH_MASK = (1n << HASH_BITS) - 1n;
const SOURCE_MASK = (1n << SOURCE_BITS) - 1n;
const EPISODE_MASK = (1n << EPISODE_BITS) - 1n;
const TMDB_BITS = 22n;
const TMDB_MASK = (1n << TMDB_BITS) - 1n;
const SOURCE_SHIFT = HASH_BITS;
const EPISODE_SHIFT = SOURCE_SHIFT + SOURCE_BITS;
const MEDIA_SHIFT = EPISODE_SHIFT + EPISODE_BITS;
const TMDB_SHIFT = MEDIA_SHIFT + MEDIA_BITS;
const MAGIC_SHIFT = TMDB_SHIFT + TMDB_BITS;
const MAGIC_MASK = (1n << MAGIC_BITS) - 1n;
const MARKER = MAGIC_VALUE << MAGIC_SHIFT;

const MAX_EPISODE = Number(EPISODE_MASK);
const MAX_TMDB_ID = Number(TMDB_MASK);
const EDGE_CACHE_PREFIX = 'https://danmu-infuse.invalid/episode/v2/';
const EDGE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_MEMORY_MAPPINGS = 1000;

// Keep this append-only. Numeric indexes are part of the public episodeId
// encoding, so reordering existing entries would invalidate old tracks.
export const INFUSE_SOURCE_KEYS = Object.freeze([
  '',
  'tencent',
  'youku',
  'iqiyi',
  'imgo',
  'bilibili',
  'migu',
  'sohu',
  'leshi',
  'xigua',
  'maiduidui',
  'aiyifan',
  'hongguo',
  'other',
  'dandan',
  'bahamut',
  'animeko',
  'custom',
  '360',
  'vod',
  'renren',
  'hanjutv',
  'local',
  'douban',
  'tmdb',
]);

const SOURCE_ALIASES = Object.freeze({
  qq: 'tencent',
  qiyi: 'iqiyi',
  mango: 'imgo',
  '360kan': '360',
});

const memoryMappings = new Map();

function normalizeSourceKey(source) {
  const value = String(source || '').trim().toLowerCase();
  return SOURCE_ALIASES[value] || value;
}

function sourceIndexFor(source) {
  const index = INFUSE_SOURCE_KEYS.indexOf(normalizeSourceKey(source));
  return index >= 0 ? index : 0;
}

function hashIdentity(value) {
  // FNV-1a 32-bit; only the low HASH_BITS are encoded. Collision probing is
  // deterministic because assignInfuseEpisodeIds sorts identities first.
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash & Number(HASH_MASK);
}

function normalizeContext(context = {}) {
  const tmdbId = Number(context.tmdbId);
  const episode = Number(context.episode || 0);
  if (!Number.isInteger(tmdbId) || tmdbId < 1 || tmdbId > MAX_TMDB_ID) return null;
  if (!Number.isInteger(episode) || episode < 0 || episode > MAX_EPISODE) return null;
  return {
    tmdbId,
    episode,
    mediaType: context.mediaType === 'movie' ? 'movie' : 'tv',
  };
}

function buildEpisodeId(context, sourceIndex, hash) {
  const media = context.mediaType === 'movie' ? 1n : 0n;
  const value = MARKER
    | (BigInt(context.tmdbId) << TMDB_SHIFT)
    | (media << MEDIA_SHIFT)
    | (BigInt(context.episode) << EPISODE_SHIFT)
    | (BigInt(sourceIndex) << SOURCE_SHIFT)
    | BigInt(hash);
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function isInfuseEpisodeId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < Number(MARKER)) return false;
  return ((BigInt(id) >> MAGIC_SHIFT) & MAGIC_MASK) === MAGIC_VALUE;
}

export function decodeInfuseEpisodeId(value) {
  if (!isInfuseEpisodeId(value)) return null;
  const id = BigInt(Number(value));
  const sourceIndex = Number((id >> SOURCE_SHIFT) & SOURCE_MASK);
  const source = INFUSE_SOURCE_KEYS[sourceIndex] || '';
  return {
    id: Number(id),
    tmdbId: Number((id >> TMDB_SHIFT) & TMDB_MASK),
    mediaType: ((id >> MEDIA_SHIFT) & 1n) === 1n ? 'movie' : 'tv',
    episode: Number((id >> EPISODE_SHIFT) & EPISODE_MASK),
    source,
    hash: Number(id & HASH_MASK),
  };
}

/**
 * Assign stable IDs without changing result order.
 * Each candidate must contain at least { url, title, source }.
 */
export function assignInfuseEpisodeIds(candidates, rawContext) {
  const context = normalizeContext(rawContext);
  if (!context || !Array.isArray(candidates)) return null;

  const indexed = candidates.map((candidate, index) => {
    const source = normalizeSourceKey(candidate?.source);
    const resource = String(candidate?.url || '').trim() || String(candidate?.title || '').trim();
    const identity = [source, resource].join('|');
    return { candidate, index, source, identity };
  });
  const sorted = [...indexed].sort((a, b) => a.identity.localeCompare(b.identity));
  const used = new Set();
  const identityIds = new Map();
  const assigned = new Array(indexed.length);

  for (const item of sorted) {
    let id = identityIds.get(item.identity);
    if (id === undefined) {
      const sourceIndex = sourceIndexFor(item.source);
      let hash = hashIdentity(item.identity);
      let attempts = 0;
      do {
        id = buildEpisodeId(context, sourceIndex, hash);
        hash = (hash + 1) & Number(HASH_MASK);
        attempts += 1;
      } while (used.has(id) && attempts <= Number(HASH_MASK) + 1);
      if (attempts > Number(HASH_MASK) + 1 || id === null) return null;
      used.add(id);
      identityIds.set(item.identity, id);
    }
    assigned[item.index] = id;
  }

  return assigned;
}

function normalizeMapping(mapping) {
  const id = Number(mapping?.id);
  const url = String(mapping?.url || '').trim();
  if (!isInfuseEpisodeId(id) || !url) return null;
  return {
    id,
    url,
    title: String(mapping?.title || ''),
    animeTitle: String(mapping?.animeTitle || ''),
    source: normalizeSourceKey(mapping?.source),
    // NAS 仍以原 ID 查找 UGC、季集与人物过滤上下文，不把编码 ID 写入自增序列。
    ...(Number.isSafeInteger(mapping?.legacyEpisodeId) && !isInfuseEpisodeId(mapping.legacyEpisodeId)
      ? { legacyEpisodeId: mapping.legacyEpisodeId } : {}),
  };
}

function edgeCacheRequest(id) {
  return new Request(`${EDGE_CACHE_PREFIX}${id}`);
}

async function persistEdgeMapping(mapping) {
  const cache = globalThis.caches?.default;
  if (!cache || typeof cache.put !== 'function') return false;
  try {
    await cache.put(edgeCacheRequest(mapping.id), new Response(JSON.stringify(mapping), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${EDGE_CACHE_TTL_SECONDS}`,
      },
    }));
    return true;
  } catch {
    return false;
  }
}

export async function rememberInfuseEpisodeMapping(rawMapping, options = {}) {
  const mapping = normalizeMapping(rawMapping);
  if (!mapping) return null;

  memoryMappings.delete(mapping.id);
  memoryMappings.set(mapping.id, mapping);
  while (memoryMappings.size > MAX_MEMORY_MAPPINGS) {
    memoryMappings.delete(memoryMappings.keys().next().value);
  }

  if (options.persist !== false) await persistEdgeMapping(mapping);
  return mapping;
}

export async function getInfuseEpisodeMapping(value) {
  const id = Number(value);
  if (!isInfuseEpisodeId(id)) return null;
  const memory = memoryMappings.get(id);
  if (memory) return memory;

  const cache = globalThis.caches?.default;
  if (!cache || typeof cache.match !== 'function') return null;
  try {
    const response = await cache.match(edgeCacheRequest(id));
    if (!response) return null;
    const mapping = normalizeMapping(await response.json());
    if (!mapping || mapping.id !== id) return null;
    await rememberInfuseEpisodeMapping(mapping, { persist: false });
    return mapping;
  } catch {
    return null;
  }
}

export function clearInfuseEpisodeMappingsForTest() {
  memoryMappings.clear();
}
