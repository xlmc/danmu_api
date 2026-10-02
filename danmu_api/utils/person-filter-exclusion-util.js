import { globals } from '../configs/globals.js';
import { simplized } from './zh-util.js';
import { extractSeasonNumberFromAnimeTitle } from './common-util.js';
import { ensureCachedRemoteTitleMapping, resolveLocalTitleMapping, resolveCachedRemoteTitleMapping } from './title-mapping-url-util.js';
import { getCachedRemoteAutoMatchMappingRules } from './auto-match-mapping-url-util.js';

export function splitPersonFilterExcludedTitles(value) {
  return [...new Set(String(value || '').split(/[,，;；\r\n]+/).map(title => title.trim()).filter(Boolean))];
}

function titleIdentity(value) {
  const title = simplized(String(value || '').normalize('NFKC'))
    .replace(/(?:\s+|(?<=】))from\s+.+$/i, '').replace(/【[^】]*】/g, '').trim();
  const year = title.match(/\(((?:19|20)\d{2})\)/)?.[1] || '';
  const parsed = extractSeasonNumberFromAnimeTitle(title);
  // Numeric work names (e.g. 86) are names, not an empty title plus a season.
  const baseTitle = parsed.baseTitle || title.replace(/\((?:19|20)\d{2}\)/g, '').trim();
  const season = parsed.baseTitle ? parsed.season : null;
  return {
    title,
    baseTitle,
    key: String(baseTitle || '').replace(/[\s._+\-,，:：·]/g, '').toLowerCase(),
    season,
    year
  };
}

function mappedIdentity(value) {
  const identity = titleIdentity(value);
  const mapped = title => {
    const target = titleIdentity(title);
    return { ...target, year: target.year || identity.year };
  };
  const directMapping = lookup => {
    const exact = lookup(identity.title);
    return exact.matched || !identity.year ? exact : lookup(identity.title.replace(/\((?:19|20)\d{2}\)/g, '').trim());
  };
  // Only a unique, whole-season mapping can establish a work identity here.
  // Episode ranges and release-group variants need context the title alone lacks.
  const localRules = globals.autoMatchMappingTable || [];
  const matchingRules = rules => rules.filter(rule => titleIdentity(rule.sourceTitle).key === identity.key
    && rule.sourceSeason === (identity.season || 1));
  const local = matchingRules(localRules);
  const rules = local.length ? local : matchingRules(getCachedRemoteAutoMatchMappingRules());
  if (rules.length && rules.every(rule => !rule.bounded && rule.sourceStartEpisode === 1
    && !rule.sourceReleaseGroups?.length && !rule.sourceReleaseGroup)) {
    const targets = rules.map(rule => mapped(`${rule.targetTitle} S${rule.targetSeason}${rule.targetYear ? `(${rule.targetYear})` : ''}`));
    if (targets.every(target => target.key === targets[0].key && target.season === targets[0].season
      && target.year === targets[0].year)) return targets[0];
  }

  // Exact aliases take precedence. Parsed season aliases reuse the existing
  // mapping lookup, but a bare-series fallback must not erase a season number.
  const direct = directMapping(resolveLocalTitleMapping);
  if (direct.matched) return mapped(direct.title);
  const seasonal = resolveLocalTitleMapping(identity.baseTitle, identity.season, identity.year);
  if (seasonal.matched && (!identity.season || titleIdentity(seasonal.key).season === identity.season)) {
    return mapped(seasonal.title);
  }
  if (seasonal.matched) return identity;
  const remoteDirect = directMapping(resolveCachedRemoteTitleMapping);
  if (remoteDirect.matched) return mapped(remoteDirect.title);
  const remoteSeasonal = resolveCachedRemoteTitleMapping(identity.baseTitle, identity.season, identity.year);
  if (remoteSeasonal.matched && (!identity.season || titleIdentity(remoteSeasonal.key).season === identity.season)) {
    return mapped(remoteSeasonal.title);
  }
  return identity;
}

export async function shouldBlockDomesticCelebrities(animeTitle) {
  if (!globals.blockDomesticCelebrities) return false;
  const excluded = splitPersonFilterExcludedTitles(globals.personFilterExcludedTitles);
  if (!animeTitle || !excluded.length) return true;
  await ensureCachedRemoteTitleMapping();
  const work = mappedIdentity(animeTitle);
  return !excluded.some(title => {
    const entry = mappedIdentity(title);
    return entry.key && entry.key === work.key && (entry.season || 1) === (work.season || 1)
      && (!entry.year || entry.year === work.year);
  });
}
