import BilibiliSource from '../sources/bilibili.js';
import { globals } from '../configs/globals.js';
import { httpGet } from './http-util.js';
import { log } from './log-util.js';
import { convertChineseNumber, extractAnimeInfo } from './common-util.js';
import { decodeHtmlEntities } from './codec-util.js';
import { decodeAudio, validateAudioInWorker } from './ugc-audio-util.js';

const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', Referer: 'https://www.bilibili.com/' };
const normalize = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
const clean = s => decodeHtmlEntities(String(s || '').replace(/<[^>]*>/g, ''));
const number = s => /^\d+$/.test(s) ? Number(s) : convertChineseNumber(s);
const excluded = /reaction|第一次看|首看|一口气看|解说|讲解|混剪|预告|花絮|片段|测评|玩具|有声|小说|网盘|资源分享|\bMAD\b|\bCUT\b|纯\s*(?:OP|ED)/iu;
const versions = /精编|(?<!未)删减|重制|英文|日语|粤语|配音|特别版|特別版|番外|续集/g;

export function buildUgcContext(resolved) {
  if (!resolved?.anime || !resolved.link) return null;
  const { anime, link, index } = resolved;
  const parsed = extractAnimeInfo(anime.animeTitle, link.title);
  const episode = parsed.episode ?? index + 1; // Same episode position as the existing detail model.
  if (!parsed.baseTitle || !Number.isInteger(episode) || episode < 1) return null;
  return {
    identity: `${anime.source}:${anime.animeId}:${anime.bangumiId}`,
    title: parsed.baseTitle, aliases: [...(anime.aliases || [])],
    year: Number(String(anime.startDate || '').slice(0, 4)) || null,
    season: parsed.season ?? anime.tmdbIdentity?.seasonNumber ?? null,
    episode, episodeTitle: link.title, referenceUrl: link.url,
    type: anime.typeDescription || anime.type || '',
    tmdbIdentity: anime.tmdbIdentity || null,
  };
}

export function buildUgcQueries(context) {
  const n = context.episode, padded = String(n).padStart(2, '0');
  const names = [...new Set([context.title, ...(context.aliases || [])].filter(Boolean))].slice(0, 3);
  const season = context.season ? ` 第${context.season}季` : '';
  return [...new Set(names.flatMap(name => [`${name}${season} 第${n}集`, `${name}${season} ${padded}`, `${name}${season} 合集`]))];
}

function episodeNumber(text) {
  const m = String(text).normalize('NFKC').match(/第\s*([\d一二三四五六七八九十百零两]+)\s*[集话期回]|(?:\bEP?\s*|[\[【(（])0*(\d{1,3})(?:\b|[\]】)）])|(?:^|\s|_)0*(\d{1,3})\s*(?:[集话期回]|[.、_\s]|$)/iu);
  return m ? number(m[1] || m[2] || m[3]) : null;
}

export function selectUgcPages(context, video) {
  const title = clean(video.title), aliases = [context.title, ...(context.aliases || [])];
  if (!aliases.some(name => normalize(name).length >= 2 && normalize(title).includes(normalize(name)))) return [];
  const season = title.match(/第\s*([\d一二三四五六七八九十百]+)\s*季|\bS(\d+)\b/i);
  if (season && (!context.season || number(season[1] || season[2]) !== context.season)) return [];
  const year = title.match(/\b((?:19|20)\d{2})\s*(?:年|版)/);
  if (year && context.year && Number(year[1]) !== context.year) return [];
  const contextText = [context.title, ...context.aliases || [], context.episodeTitle].join(' ');
  if ([...title.matchAll(versions)].some(m => !contextText.includes(m[0]))) return [];
  const titleEpisode = episodeNumber(title), pages = video.pages || [];
  return pages.flatMap(p => {
    if (excluded.test(`${title} ${p.part}`)) return [];
    if ([...String(p.part).matchAll(versions)].some(m => !contextText.includes(m[0]))) return [];
    const pageEpisode = episodeNumber(p.part);
    let bareEpisodeTitle = normalize(String(context.episodeTitle || '').replace(/【[^】]+】/g, '').replace(/第\s*[\d一二三四五六七八九十百]+\s*[集话期回]/g, ''));
    for (const name of aliases) bareEpisodeTitle = bareEpisodeTitle.replace(normalize(name), '');
    const named = bareEpisodeTitle.length >= 2 && normalize(p.part) === bareEpisodeTitle;
    // A page's position is not an episode number. Trailer/OP pages often precede E01.
    const episode = pageEpisode ?? (pages.length === 1 ? titleEpisode : null);
    const movie = /电影|剧场版/.test(context.type || '') && pages.length === 1 && episode === null;
    if (episode !== context.episode && !named && !movie) return [];
    if (pageEpisode !== null && pageEpisode !== context.episode) return [];
    if (pages.length === 1 && titleEpisode !== null && titleEpisode !== context.episode) return [];
    if (!(p.duration > 0) || !p.cid || !video.bvid) return [];
    return [{ bvid: video.bvid, aid: video.aid, cid: p.cid, page: p.page, duration: p.duration, title, part: p.part,
      url: `https://www.bilibili.com/video/${video.bvid}/?p=${p.page}`, searchCount: video.stat?.danmaku || 0,
      evidence: { title, part: p.part, explicitEpisode: episode, episodeTitleMatched: named } }];
  });
}

export function mergeUgcComments(base, sources) {
  const output = base.map(c => ({ ...c }));
  const prior = new Map();
  const getTimeAndText = item => {
    if ('progress' in item) return [item.progress / 1000, String(item.content ?? '')];
    const parts = String(item.p || '').split(',');
    return [Number(parts[0]), String(item.m ?? item.text ?? '')];
  };
  const remember = (item, source) => {
    const [time, key] = getTimeAndText(item);
    if (!Number.isFinite(time)) return;
    const list = prior.get(key) || []; list.push({ time, source, used: false }); prior.set(key, list);
  };
  for (const c of output) remember(c, 'base');
  const cids = new Set();
  for (const { cid, comments, timeline } of sources) {
    if (cids.has(cid) || timeline?.status !== 'verified') continue;
    cids.add(cid);
    for (const c of comments) {
      let [rawTime, text] = getTimeAndText(c);
      const t = rawTime - timeline.offsetSeconds;
      if (!Number.isFinite(t) || t < timeline.validRange[0] || t >= timeline.validRange[1]) continue;
      const duplicate = (prior.get(text) || []).find(v => !v.used && v.source !== cid && Math.abs(v.time - t) <= .05);
      if (duplicate) { duplicate.used = true; continue; }
      let item;
      if ('progress' in c) {
        item = { ...c, progress: Math.round(t * 1000), p: `${t.toFixed(5)},${c.mode || 1},${c.fontsize || 25},${c.color || 16777215},${c.ctime || 0},0,${c.midHash || ''},${c.id || 0}`, m: text };
      } else {
        const parts = String(c.p).split(','); parts[0] = t.toFixed(5);
        item = { ...c, p: parts.join(','), m: text };
      }
      output.push(item); remember(item, cid);
    }
  }
  return output.sort((a, b) => getTimeAndText(a)[0] - getTimeAndText(b)[0]);
}

async function getJson(url) {
  const r = await httpGet(url, { headers, retries: 0, timeout: 8000 });
  return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
}

export function createUgcSupplement({ source = new BilibiliSource(), json = getJson, audio = decodeAudio, validate = validateAudioInWorker } = {}) {
  const cache = new Map(), pending = new Map();
  async function audioInfo(url) {
    const u = new URL(url);
    if (!['www.bilibili.com', 'bilibili.com'].includes(u.hostname)) throw new Error('no-bilibili-reference');
    const bvid = u.pathname.match(/\/video\/(BV[\w]+)/)?.[1];
    const epid = u.pathname.match(/\/bangumi\/play\/ep(\d+)/)?.[1];
    let page, play;
    if (epid) {
      const season = await json(`https://api.bilibili.com/pgc/view/web/season?ep_id=${epid}`);
      const ep = season.result?.episodes?.find(e => String(e.id) === epid);
      if (!ep) throw new Error('reference-metadata-unavailable');
      page = { cid: ep.cid, duration: ep.duration / 1000 };
      play = await json(`https://api.bilibili.com/pgc/player/web/playurl?ep_id=${epid}&qn=16&fnval=16`);
    } else if (bvid) {
      const view = await json(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
      page = view.data?.pages?.find(p => p.page === Number(u.searchParams.get('p') || 1));
      if (!page) throw new Error('reference-metadata-unavailable');
      play = await json(`https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${page.cid}&qn=16&fnval=16`);
    } else throw new Error('no-bilibili-reference');
    const track = (play.result || play.data)?.dash?.audio?.sort((a, b) => a.bandwidth - b.bandwidth)[0];
    if (play.code !== 0 || !track || !(page.duration > 0)) throw new Error('reference-audio-unavailable');
    return { ...page, urls: [track.baseUrl || track.base_url, ...(track.backupUrl || track.backup_url || [])].filter(Boolean) };
  }
  async function resolve(context, { signal, maxCandidates = 8, rangeSeconds } = {}) {
    const result = { candidates: [], accepted: [], failures: [] };
    const videos = new Map(), key = await source._getWbiMixinKey();
    for (const keyword of buildUgcQueries(context)) {
      for (const order of ['totalrank', 'dm']) {
        signal?.throwIfAborted();
        const params = source._getWbiSignedParams({ keyword, search_type: 'video', page: 1, page_size: 20, order }, key);
        const data = await json(`https://api.bilibili.com/x/web-interface/wbi/search/type?${new URLSearchParams(params)}`);
        if (data.code !== 0) throw new Error(`ugc-search-${data.code}`);
        for (const v of data.data?.result || []) if (v.bvid) videos.set(v.bvid, v);
      }
    }
    const ordered = [...videos.values()].filter(v => {
      const title = clean(v.title), ep = episodeNumber(title);
      return !excluded.test(title) && [context.title, ...context.aliases || []].some(name => normalize(title).includes(normalize(name))) &&
        (ep === null || ep === context.episode || /合集|全集|全\s*\d+|1\s*[-~～]\s*\d+/.test(title));
    }).sort((a, b) => (b.video_review || 0) - (a.video_review || 0));
    // Bound metadata requests; count ranks work but never makes a source eligible.
    for (const v of ordered.slice(0, 30)) {
      signal?.throwIfAborted();
      if (excluded.test(clean(v.title))) continue;
      try {
        const view = await json(`https://api.bilibili.com/x/web-interface/view?bvid=${v.bvid}`);
        result.candidates.push(...selectUgcPages(context, view.data || {}));
      } catch (e) { result.failures.push({ bvid: v.bvid, reason: e.message }); }
    }
    // Determine reference: prefer an explicit Bilibili URL; otherwise use the UGC candidate
    // with the most danmaku as the audio anchor (candidate-as-reference mode).
    const isBilibiliRef = /^https:\/\/www\.bilibili\.com\/(video\/BV|bangumi\/play\/ep)/.test(String(context.referenceUrl || ''));
    let reference, referenceIsCandidate = false, referenceCandidate = null;
    if (isBilibiliRef) {
      try { reference = await audioInfo(context.referenceUrl); }
      catch (e) { result.failures.push({ reason: e.message }); return result; }
    } else {
      // Pick the candidate with the most danmaku comments as the reference anchor.
      const sorted = result.candidates.slice().sort((a, b) => (b.searchCount || 0) - (a.searchCount || 0));
      for (const c of sorted.slice(0, 3)) {
        signal?.throwIfAborted();
        try {
          reference = await audioInfo(c.url);
          referenceIsCandidate = true;
          referenceCandidate = c;
          log('info', `[ugc] candidate-as-reference: ${c.url} (danmaku=${c.searchCount})`);
          break;
        } catch (e) { result.failures.push({ bvid: c.bvid, reason: `ref-${e.message}` }); }
      }
      if (!reference) { result.failures.push({ reason: 'no-bilibili-reference' }); return result; }
    }
    const duration = Math.min(reference.duration, rangeSeconds ?? reference.duration);
    if (!(duration > 0)) return result;
    const ref = await audio(reference.urls, { seconds: duration, signal });
    // When in candidate-as-reference mode, the anchor's own comments serve as base set.
    if (referenceIsCandidate && referenceCandidate) {
      try {
        const raw = await source.getEpisodeDanmu(referenceCandidate.url);
        const comments = source.formatComments(raw);
        referenceCandidate.fetchedCount = comments.length;
        if (comments.length) {
          result.accepted.push({ cid: referenceCandidate.cid, comments, timeline: { status: 'verified', offsetSeconds: 0, validRange: [0, duration] } });
        }
      } catch (e) { result.failures.push({ bvid: referenceCandidate.bvid, reason: `ref-danmu-${e.message}` }); }
    }
    for (const c of result.candidates.filter(c => c.cid !== reference.cid).slice(0, maxCandidates)) {
      if (signal?.aborted) break;
      try {
        const raw = await source.getEpisodeDanmu(c.url), comments = source.formatComments(raw);
        c.fetchedCount = comments.length;
        if (!comments.length) { c.timeline = { status: 'pending', reason: 'no-comments' }; continue; }
        const info = await audioInfo(c.url);
        const samples = await audio(info.urls, { seconds: duration + 121, signal });
        const timeline = await validate(ref, samples, { duration, signal }); c.timeline = timeline;
        signal?.throwIfAborted();
        if (timeline.status === 'verified') result.accepted.push({ cid: c.cid, comments, timeline });
      } catch (e) { c.timeline = { status: 'pending', reason: e.message }; if (signal?.aborted) break; }
    }
    return result;
  }

  async function supplement(context, base, options = {}) {
    const key = JSON.stringify(['ugc-v1', context, options.rangeSeconds ?? null, options.maxCandidates ?? 8]);
    const entry = cache.get(key);
    let result;
    if (entry && entry.expires > Date.now()) result = entry.result;
    else {
      let task = pending.get(key);
      if (!task) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.budgetMs ?? 10000);
        task = resolve(context, { ...options, signal: controller.signal }).catch(e => ({ candidates: [], accepted: [], failures: [{ reason: e.message }] })).then(result => {
          if (cache.size >= 128) cache.delete(cache.keys().next().value);
          cache.set(key, { result, expires: Date.now() + (result.accepted.length ? 3600000 : 60000) }); return result;
        }).finally(() => { clearTimeout(timeout); pending.delete(key); });
        pending.set(key, task);
      }
      // Deadline protects the original response even when an upstream ignores AbortSignal.
      result = await Promise.race([task, new Promise(resolve => {
        const t = setTimeout(() => resolve(null), options.budgetMs ?? 10000);
        task.finally(() => clearTimeout(t));
      })]);
    }
    if (!result) return base;
    log('info', `[ugc] candidates=${result.candidates.length}, accepted=${result.accepted.length}, failures=${result.failures.map(x => x.reason).join(',')}`);
    return result.accepted.length ? mergeUgcComments(base, result.accepted) : base;
  }
  return { resolve, supplement, clear: () => cache.clear() };
}

export const ugcSupplement = createUgcSupplement();
