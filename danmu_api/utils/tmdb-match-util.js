import { searchTmdbTitles, getTmdbMatchDetails, getTmdbMatchEpisode } from './tmdb-util.js';
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
    seasons: (detail.seasons || []).map(item => ({ season: item.season_number, year: yearOf(item.air_date) }))
  };
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
    return titles.some(title => filterMappingTargetCandidates([anime], { targetTitle: title }).length > 0);
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

// Special numbering belongs to TMDB, not the platform's catalog position.
export async function resolveTmdbSpecialEpisode(identity, season, episode, lookup = getTmdbMatchEpisode) {
  if (identity?.mediaType !== 'tv' || season !== 0 || !Number.isInteger(episode) || episode < 1) return null;
  const detail = await lookup(identity.tmdbId, season, episode);
  if (!detail || detail.season_number !== season || detail.episode_number !== episode || !detail.name) return null;
  const name = String(detail.name).normalize('NFKC').trim();
  const explicitSeason = name.match(/第\s*(\d+)\s*季|\bS(?:eason)?\s*(\d+)\b/i);
  const airDate = /^\d{4}-\d{2}-\d{2}$/.test(detail.air_date || '') ? detail.air_date : null;
  const year = airDate ? Number(airDate.slice(0, 4)) : null;
  const seasonCandidates = (identity.seasons || []).filter(s => s.season > 0 && s.year === year);
  const targetSeason = explicitSeason ? Number(explicitSeason[1] || explicitSeason[2]) :
    seasonCandidates.length === 1 ? seasonCandidates[0].season : null;
  if (!targetSeason) return null;
  const knownYear = identity.seasons?.find(s => s.season === targetSeason)?.year;
  if (year && knownYear && year !== knownYear) return null;
  return { name, title: name.replace(explicitSeason?.[0] || /$^/, '').trim(), airDate, year, targetSeason };
}

const episodeText = value => String(value || '').normalize('NFKC').replace(/^【[^】]*】\s*/, '')
  .split(/[:：]/)[0].toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

function varietyKey(title) {
  const text = episodeText(title);
  const issue = text.match(/第(\d+)期/);
  const kind = /加更/.test(text) ? (/超前/.test(text) ? 'ahead-extra' : /还有/.test(text) ? 'more-extra' :
    /特别/.test(text) ? 'special-extra' : /先导片|先導片/.test(text) ? 'pilot-extra' : 'extra') :
    /先导片|先導片/.test(text) ? 'pilot' : issue ? 'main' : null;
  if (!kind) return null;
  const part = /下(?:集|篇)?$/.test(text) ? 'lower' : /上(?:集|篇)?$/.test(text) ? 'upper' : '';
  return `${kind}:${issue?.[1] || ''}:${part}`;
}

export function selectTmdbSpecialEpisode(animes, metadata, identity, episodesForAnime) {
  const matches = [];
  const expected = episodeText(metadata.title);
  const key = varietyKey(metadata.title);
  if (!expected || /^(?:第?\d+[集话回期]?|episode\d+|specials?\d*)$/i.test(expected)) return null;
  for (const anime of filterTmdbMatchCandidates(animes, identity)) {
    const season = String(anime.animeTitle).match(/第\s*(\d+)\s*季|\bS(?:eason)?\s*(\d+)\b/i);
    const number = season ? Number(season[1] || season[2]) : 1;
    if (number !== metadata.targetSeason) continue;
    const year = Number(String(anime.animeTitle).match(/[（(]((?:19|20)\d{2})[）)]/)?.[1]) ||
      Number(String(anime.startDate || '').slice(0, 4)) || null;
    if (metadata.year && year && metadata.year !== year) continue;
    for (const ep of episodesForAnime(anime) || []) {
      const actual = episodeText(ep.episodeTitle);
      if (actual !== expected && !(key && varietyKey(ep.episodeTitle) === key)) continue;
      // Catalog airDate may be copied from the show's startDate. Only use a
      // real per-video date or a date explicitly present in its title.
      const raw = anime.links?.find(link => link.url === ep.url);
      const date = raw?.airDate || raw?.publishDate ||
        String(ep.episodeTitle).match(/(?:19|20)\d{2}-\d{2}-\d{2}/)?.[0];
      if (date && metadata.airDate && String(date).slice(0, 10) !== metadata.airDate) continue;
      if (!matches.some(m => m.resAnime.source === anime.source && m.resEpisode.url === ep.url))
        matches.push({ resAnime: anime, resEpisode: ep, spilloverMatched: false });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}
