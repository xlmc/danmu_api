import { searchTmdbTitles, getTmdbMatchDetails, getTmdbMatchEpisode } from './tmdb-util.js';
import { extractSeasonNumberFromAnimeTitle } from './common-util.js';
import { filterMappingTargetCandidates } from './auto-match-mapping-util.js';

const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s._:：·-]+/g, '');
const yearOf = value => Number(String(value || '').slice(0, 4)) || null;

// TMDB identifies the work; platform IDs still identify its playable episodes.
// Never discard the media type: TV and movie IDs occupy different namespaces.
export async function resolveTmdbMatchIdentity({ title, year = null, season = null, episode = null },
  { search = searchTmdbTitles, details = getTmdbMatchDetails, getTmdbMatchEpisode } = {}) {
  const mediaType = season != null || episode != null ? 'tv' : 'movie';
  const response = await search(title, mediaType, { page: 1 });
  const data = typeof response?.data === 'string' ? JSON.parse(response.data) : response?.data;
  const candidates = (data?.results || []).filter(item => Number.isSafeInteger(item.id) && item.id > 0 &&
    (!item.media_type || item.media_type === mediaType) &&
    (!year || (mediaType === 'tv' && season > 1) || yearOf(item.first_air_date || item.release_date) === Number(year)));
  const exact = candidates.filter(item => [item.name, item.title, item.original_name, item.original_title].some(name => normalize(name) === normalize(title)));
  // An ambiguous result is not evidence for a platform association.
  if (exact.length > 1 || (exact.length === 0 && candidates.length > 1)) return null;
  const selected = exact[0] || candidates[0];
  if (!selected) return null;
  const detail = await details(mediaType, selected.id);
  if (!detail || detail.id !== selected.id || !(detail.name || detail.title)) return null;
  const aliases = [...new Set([
    detail.name, detail.title, detail.original_name, detail.original_title,
    ...(detail.alternative_titles?.results || detail.alternative_titles?.titles || []).map(item => item.title),
    ...(detail.translations?.translations || []).flatMap(item => [item.data?.name, item.data?.title])
  ].filter(value => typeof value === 'string' && value.trim()))];
  if (!aliases.some(alias => normalize(alias) === normalize(title))) return null;
  const identityYear = yearOf(detail.first_air_date || detail.release_date);
  const seasonYear = mediaType === 'tv' && season != null
    ? yearOf(detail.seasons?.find(item => item.season_number === Number(season))?.air_date) : null;
  if (year && Number(year) !== (mediaType === 'tv' && season > 1 ? seasonYear : identityYear)) return null;
  return {
    key: `${mediaType}:${selected.id}`, tmdbId: String(selected.id), mediaType,
    title: detail.name || detail.title, aliases, year: identityYear, seasonYear,
    // UGC 适用画像用：动画(genre 16)、原始语言与出品地区。
    isAnimation: [...(detail.genre_ids || []), ...(detail.genres || []).map(genre => genre?.id)].includes(16),
    originalLanguage: String(detail.original_language || '').toLowerCase() || null,
    originCountry: Array.isArray(detail.origin_country) ? detail.origin_country : [],
    seasons: (detail.seasons || []).map(item => ({ season: item.season_number, year: yearOf(item.air_date) }))
  };
}

function annualVariety(anime, identity) {
  if (!/综艺|variety/i.test([anime.type, anime.typeDescription, anime.animeTitle].join(' '))) return null;
  const title = String(anime.animeTitle || '').replace(/\s*from\s+.+$/i, '').replace(/【[^】]*】/g, '').replace(/[（(](?:19|20)\d{2}[）)]/g, '').trim();
  const match = title.match(/^(.*?)[\s._-]*((?:19|20)\d{2})$/);
  if (!match || !identity.aliases?.some(alias => normalize(alias) === normalize(match[1]))) return null;
  const year = Number(match[2]);
  const startYear = yearOf(anime.startDate);
  if (startYear && startYear !== year) return null;
  const seasons = (identity.seasons || []).filter(s => s.season > 0 && s.year === year);
  if (seasons.length !== 1) return null;
  return { title: match[1].trim(), year, season: seasons[0].season };
}

export function filterTmdbMatchCandidates(animes, identity, mapping = null, savedAnimes = []) {
  return animes.filter(anime => {
    const saved = savedAnimes.find(item => item.animeId === anime.animeId && item.source === anime.source && item.bangumiId === anime.bangumiId);
    const keys = [anime.tmdbIdentity?.key, anime.tmdbIdentityKey, saved?.tmdbIdentity?.key].filter(Boolean);
    if (keys.some(key => key !== identity.key)) return false;
    const ids = [anime.tmdbId, anime.tmdb_id, anime.externalIds?.tmdb, anime.externalIds?.tmdbId].filter(Boolean);
    if (ids.some(id => String(id) !== identity.tmdbId)) return false;
    const type = String(anime.type || '').toLowerCase();
    if (identity.mediaType === 'tv' && ['movie', '电影'].includes(type)) return false;
    if (identity.mediaType === 'movie' && ['tv', 'tvseries', 'tv_series', '电视剧'].includes(type)) return false;
    const titles = mapping?.targetTitle ? [mapping.targetTitle] : identity.aliases;
    const annual = !mapping?.targetTitle && annualVariety(anime, identity);
    const candidate = annual ? { ...anime, animeTitle: annual.title } : anime;
    return titles.some(title => filterMappingTargetCandidates([candidate], { targetTitle: title }).length > 0);
  });
}

export function findSavedTmdbIdentity(animes, { title, season = null, episode = null, year = null }) {
  const type = season != null || episode != null ? 'tv' : 'movie';
  const found = new Map();
  for (const anime of animes) {
    const identity = anime.tmdbIdentity;
    if (!identity || identity.mediaType !== type || identity.key !== `${type}:${identity.tmdbId}` || !/^[1-9]\d*$/.test(identity.tmdbId)) continue;
    if (!Array.isArray(identity.aliases) || !identity.aliases.some(alias => normalize(alias) === normalize(title))) continue;
    const seasonYear = identity.seasons?.find(item => item.season === season)?.year || null;
    if (year && Number(year) !== (type === 'tv' && season > 1 ? seasonYear : identity.year)) continue;
    found.set(identity.key, { ...identity, seasonYear });
  }
  return found.size === 1 ? [...found.values()][0] : null;
}

// TMDB episode metadata identifies content, not a platform catalog position.
export async function resolveTmdbEpisodeMetadata(identity, season, episode, lookup = getTmdbMatchEpisode) {
  if (identity?.mediaType !== 'tv' || !Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1) return null;
  const detail = await lookup(identity.tmdbId, season, episode);
  if (!detail || detail.season_number !== season || detail.episode_number !== episode || !detail.name) return null;
  const name = String(detail.name).normalize('NFKC').trim();
  const explicitSeason = name.match(/第\s*(\d+)\s*季|\bS(?:eason)?\s*(\d+)\b/i);
  const airDate = /^\d{4}-\d{2}-\d{2}$/.test(detail.air_date || '') ? detail.air_date : null;
  const airYear = airDate ? Number(airDate.slice(0, 4)) : null;
  const seasonCandidates = (identity.seasons || []).filter(s => s.season > 0 && s.year === airYear);
  const namedSeason = explicitSeason ? Number(explicitSeason[1] || explicitSeason[2]) : null;
  if (season > 0 && namedSeason && namedSeason !== season) return null;
  const targetSeason = season > 0 ? season : namedSeason ||
    (seasonCandidates.length === 1 ? seasonCandidates[0].season : null);
  if (!targetSeason) return null;
  const knownYear = identity.seasons?.find(s => s.season === targetSeason)?.year;
  if (season === 0 && airYear && knownYear && airYear !== knownYear) return null;
  // A regular season may air across New Year; its catalog uses the season year.
  const year = season > 0 ? knownYear || (season === 1 ? identity.year : null) : airYear;
  return { name, title: name.replace(explicitSeason?.[0] || /$^/, '').trim(), airDate, year, targetSeason };
}

const episodeText = value => String(value || '').normalize('NFKC').replace(/^【[^】]*】\s*/, '')
  .split(/[:：]/)[0].toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

// 官方目录（如爱奇艺综艺）会把「第N期上 主标题」和后续副标题拼进同一条目，
// 上下篇标记因此不一定落在字符串末尾；先看期号后紧跟的标记，再看末尾标记。
// 标记后紧跟汉字时不算上下篇（避免把「第2期上海特辑」当成上篇）。
function issuePartMarker(raw) {
  const match = /第\s*\d+\s*期/.exec(raw);
  if (!match) return '';
  const rest = raw.slice(match.index + match[0].length);
  if (/^[\s:：、，,。.·_-]*下(?:\s*[集篇])?(?!\p{Script=Han})/u.test(rest)) return 'lower';
  if (/^[\s:：、，,。.·_-]*上(?:\s*[集篇])?(?!\p{Script=Han})/u.test(rest)) return 'upper';
  return '';
}

export function varietyKey(title) {
  const raw = String(title || '').normalize('NFKC').replace(/^【[^】]*】\s*/, '');
  const text = episodeText(title);
  if (/纯享|純享|精编|精編|预告|預告/.test(text)) return null;
  const issue = text.match(/第(\d+)期/);
  const kind = /加更/.test(text) ? (/超前/.test(text) ? 'ahead-extra' : /还有/.test(text) ? 'more-extra' :
    /特别/.test(text) ? 'special-extra' : /先导片|先導片/.test(text) ? 'pilot-extra' : 'extra') :
    /先导片|先導片/.test(text) ? 'pilot' : issue ? 'main' : null;
  if (!kind) return null;
  // 上下篇标记在三处都可能出现：期号后紧跟（第3期上：…）、冒号前末尾（先导片下：…）、
  // 以及冒号后副标题的末尾（第1期：初舞台（上）——芒果这类写法，截断后会把上下篇丢掉）。
  const stripped = raw.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  const part = issuePartMarker(raw) ||
    (/下(?:集|篇)?$/.test(text) ? 'lower' : /上(?:集|篇)?$/.test(text) ? 'upper' : '') ||
    (/下(?:集|篇)?$/.test(stripped) ? 'lower' : /上(?:集|篇)?$/.test(stripped) ? 'upper' : '');
  return `${kind}:${issue?.[1] || ''}:${part}`;
}

const normalizedEpisodeTitle = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[\s\p{P}\p{S}]/gu, '');
const genericEpisodeTitle = value => /^(?:第?[0-9一二三四五六七八九十百]+[集话回期]?|e(?:p)?\d+|episode\d+|specials?\d*)$/i.test(value);

function episodeTitleVariants(title) {
  const text = String(title || '').normalize('NFKC').replace(/^【[^】]*】\s*/, '');
  const subtitle = text.replace(/^(?:第\s*[0-9一二三四五六七八九十百]+\s*[集话回]|(?:S\d+)?E(?:P)?\d+|episode\s*\d+)\s*[:：._-]?\s*/i, '');
  // Official titles can append a description after a colon. Compare complete
  // main titles while preserving part and category names, never arbitrary prefixes.
  return [...new Set([text, subtitle].flatMap(value => [value, value.split(/[:：]/, 1)[0]])
    .map(normalizedEpisodeTitle).filter(value => value && !genericEpisodeTitle(value)))];
}

export function selectTmdbEpisode(animes, metadata, identity, episodesForAnime) {
  const matches = [];
  const expectedTitles = episodeTitleVariants(metadata.title);
  const generic = genericEpisodeTitle(normalizedEpisodeTitle(metadata.title));
  const key = varietyKey(metadata.title);
  if (!expectedTitles.length && !(generic && metadata.airDate)) return null;
  for (const anime of filterTmdbMatchCandidates(animes, identity)) {
    const annual = annualVariety(anime, identity);
    const number = annual?.season ?? extractSeasonNumberFromAnimeTitle(anime.animeTitle).season ?? 1;
    if (number !== metadata.targetSeason) continue;
    const year = Number(String(anime.animeTitle).match(/[（(]((?:19|20)\d{2})[）)]/)?.[1]) ||
      Number(String(anime.startDate || '').slice(0, 4)) || null;
    if (metadata.year && year && metadata.year !== year) continue;
    for (const ep of episodesForAnime(anime) || []) {
      const titleMatch = episodeTitleVariants(ep.episodeTitle).some(actual => expectedTitles.includes(actual)) ||
        Boolean(key && varietyKey(ep.episodeTitle) === key);
      // Episode DTO dates are often copied from the show's startDate. Use only
      // per-video dates from the raw link or an explicit date in its title.
      const raw = anime.links?.find(link => link.url === ep.url);
      const date = String(raw?.airDate || raw?.publishDate ||
        String(ep.episodeTitle).match(/(?:19|20)\d{2}-\d{2}-\d{2}/)?.[0] || '').slice(0, 10);
      const dateMatch = date && metadata.airDate && date === metadata.airDate;
      if (date && metadata.airDate && !dateMatch) continue;
      if (!titleMatch && !(generic && dateMatch)) continue;
      if (!matches.some(m => m.resAnime.source === anime.source && m.resEpisode.url === ep.url))
        matches.push({ resAnime: anime, resEpisode: ep, spilloverMatched: false });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

// 文件名已经写明「第N期[上下]」时，可以直接用这个身份在官方目录里定位分集：
// 不需要 TMDB 身份，也不要求目录标题与文件名逐字相同；候选不唯一时不猜，交给后续阶段。
export function selectVarietyEpisodeByKey(animes, key, episodesForAnime) {
  if (!key) return null;
  const matches = [];
  for (const anime of animes) {
    for (const ep of episodesForAnime(anime) || []) {
      if (!ep?.episodeTitle || varietyKey(ep.episodeTitle) !== key) continue;
      if (!matches.some(m => m.resAnime.source === anime.source && m.resEpisode.url === ep.url))
        matches.push({ resAnime: anime, resEpisode: ep, spilloverMatched: false });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}
