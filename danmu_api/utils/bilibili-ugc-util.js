import BilibiliSource from '../sources/bilibili.js';
import { globals } from '../configs/globals.js';
import { httpGet } from './http-util.js';
import { logEvent } from './log-util.js';
import { convertChineseNumber, extractAnimeInfo } from './common-util.js';
import { decodeHtmlEntities } from './codec-util.js';
import { decodeAudio, validateAudioInWorker } from './ugc-audio-util.js';

const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', Referer: 'https://www.bilibili.com/' };
const normalize = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
const clean = s => decodeHtmlEntities(String(s || '').replace(/<[^>]*>/g, ''));
const number = s => /^\d+$/.test(s) ? Number(s) : convertChineseNumber(s);
const excluded = /reaction|第一次看|首看|一口气看|解说|讲解|混剪|预告|花絮|片段|测评|玩具|有声|小说|网盘|资源分享|\bMAD\b|\bCUT\b|纯\s*(?:OP|ED)/iu;
const versions = /精编|(?<!未)删减|重制|英文|日语|粤语|配音|特别版|特別版|番外|续集/g;

let ugcLogSequence = 0;
export function createUgcLogger(context = {}) {
  const ugcId = Date.now().toString(36) + '-' + (++ugcLogSequence).toString(36);
  const logger = (event, message, data = {}, level = 'info') => logEvent(level, 'ugc.' + event,
    '[ugc] [ugc-id=' + ugcId + '] 「' + (context.title || '未知作品') + '」第' + (context.episode ?? '?') + '集 ' + message,
    { ...data, ugcId, identity: context.identity, title: context.title, season: context.season, episode: context.episode });
  logger.ugcId = ugcId;
  return logger;
}

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

export function selectUgcPages(context, video, onReject = () => {}) {
  const reject = (reason, page) => { onReject(reason, page); return []; };
  const title = clean(video.title), aliases = [context.title, ...(context.aliases || [])];
  if (!aliases.some(name => normalize(name).length >= 2 && normalize(title).includes(normalize(name)))) return reject('title-mismatch');
  const season = title.match(/第\s*([\d一二三四五六七八九十百]+)\s*季|\bS(\d+)\b/i);
  if (season && (!context.season || number(season[1] || season[2]) !== context.season)) return reject('season-mismatch');
  const year = title.match(/\b((?:19|20)\d{2})\s*(?:年|版)/);
  if (year && context.year && Number(year[1]) !== context.year) return reject('year-mismatch');
  const contextText = [context.title, ...context.aliases || [], context.episodeTitle].join(' ');
  if ([...title.matchAll(versions)].some(m => !contextText.includes(m[0]))) return reject('version-mismatch');
  const titleEpisode = episodeNumber(title), pages = video.pages || [];
  if (!pages.length) return reject('no-pages');
  return pages.flatMap(p => {
    if (excluded.test(`${title} ${p.part}`)) return reject('non-content', p);
    if ([...String(p.part).matchAll(versions)].some(m => !contextText.includes(m[0]))) return reject('version-mismatch', p);
    const pageEpisode = episodeNumber(p.part);
    let bareEpisodeTitle = normalize(String(context.episodeTitle || '').replace(/【[^】]+】/g, '').replace(/第\s*[\d一二三四五六七八九十百]+\s*[集话期回]/g, ''));
    for (const name of aliases) bareEpisodeTitle = bareEpisodeTitle.replace(normalize(name), '');
    const named = bareEpisodeTitle.length >= 2 && normalize(p.part) === bareEpisodeTitle;
    // A page's position is not an episode number. Trailer/OP pages often precede E01.
    const episode = pageEpisode ?? (pages.length === 1 ? titleEpisode : null);
    const movie = /电影|剧场版/.test(context.type || '') && pages.length === 1 && episode === null;
    if (episode !== context.episode && !named && !movie) return reject('episode-unconfirmed-or-mismatch', p);
    if (pageEpisode !== null && pageEpisode !== context.episode) return reject('episode-mismatch', p);
    if (pages.length === 1 && titleEpisode !== null && titleEpisode !== context.episode) return reject('episode-mismatch', p);
    if (!(p.duration > 0) || !p.cid || !video.bvid) return reject('metadata-incomplete', p);
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
  async function resolve(context, { signal, maxCandidates = 8, rangeSeconds, logger = createUgcLogger(context) } = {}) {
    const result = { candidates: [], accepted: [], failures: [] };
    logger('search.start', '开始检索投稿', { maxCandidates });
    const videos = new Map(), key = await source._getWbiMixinKey();
    for (const keyword of buildUgcQueries(context)) {
      for (const order of ['totalrank', 'dm']) {
        signal?.throwIfAborted();
        logger('search.query', '检索关键词：' + keyword + '，排序=' + order, { keyword, order });
        const params = source._getWbiSignedParams({ keyword, search_type: 'video', page: 1, page_size: 20, order }, key);
        const data = await json('https://api.bilibili.com/x/web-interface/wbi/search/type?' + new URLSearchParams(params));
        if (data.code !== 0) throw new Error('ugc-search-' + data.code);
        const rows = data.data?.result || [];
        for (const v of rows) if (v.bvid) videos.set(v.bvid, v);
        logger('search.result', '本次检索返回 ' + rows.length + ' 个投稿', { keyword, order, count: rows.length });
      }
    }
    const ordered = [...videos.values()].filter(v => {
      const title = clean(v.title), ep = episodeNumber(title);
      const reason = excluded.test(title) ? 'non-content'
        : ![context.title, ...context.aliases || []].some(name => normalize(title).includes(normalize(name))) ? 'title-mismatch'
        : !(ep === null || ep === context.episode || /合集|全集|全\s*\d+|1\s*[-~～]\s*\d+/.test(title)) ? 'episode-mismatch' : null;
      if (reason) logger('candidate.reject', '投稿初筛拒绝：' + v.bvid + '，原因=' + reason, { bvid: v.bvid, candidateTitle: title, reason });
      return !reason;
    }).sort((a, b) => (b.video_review || 0) - (a.video_review || 0));
    logger('search.end', '检索去重 ' + videos.size + ' 个，初筛通过 ' + ordered.length + ' 个', { discovered: videos.size, eligible: ordered.length, metadataLimit: 30 });
    for (const v of ordered.slice(0, 30)) {
      signal?.throwIfAborted();
      try {
        logger('candidate.detail', '读取投稿分P：' + v.bvid, { bvid: v.bvid });
        const view = await json('https://api.bilibili.com/x/web-interface/view?bvid=' + v.bvid);
        const selected = selectUgcPages(context, view.data || {}, (reason, page) => logger('candidate.reject',
          '投稿身份校验拒绝：' + v.bvid + '，原因=' + reason,
          { bvid: v.bvid, cid: page?.cid, page: page?.page, candidateTitle: clean(view.data?.title), reason }));
        result.candidates.push(...selected);
        for (const c of selected) logger('candidate.select', '候选通过身份校验：' + c.bvid + ' P' + c.page + '，CID=' + c.cid,
          { bvid: c.bvid, cid: c.cid, page: c.page, duration: c.duration, reportedComments: c.searchCount });
      } catch (e) {
        result.failures.push({ bvid: v.bvid, reason: e.message });
        logger('candidate.failure', '投稿详情获取失败：' + v.bvid + '，' + e.message, { bvid: v.bvid, reason: e.message }, 'warn');
      }
    }
    logger('candidates.ready', '可用分P候选 ' + result.candidates.length + ' 个', { count: result.candidates.length });
    const isBilibiliRef = /^https:\/\/www\.bilibili\.com\/(video\/BV|bangumi\/play\/ep)/.test(String(context.referenceUrl || ''));
    let reference, referenceIsCandidate = false, referenceCandidate = null;
    if (isBilibiliRef) {
      logger('reference.start', '使用当前B站集作为音频参考', { mode: 'primary' });
      try { reference = await audioInfo(context.referenceUrl); }
      catch (e) {
        result.failures.push({ reason: e.message });
        logger('reference.failure', '当前集音频参考不可用：' + e.message, { reason: e.message }, 'warn');
        return result;
      }
    } else {
      const sorted = result.candidates.slice().sort((a, b) => (b.searchCount || 0) - (a.searchCount || 0));
      for (const c of sorted.slice(0, 3)) {
        signal?.throwIfAborted();
        try {
          logger('reference.start', '尝试UGC候选作为音频参考：' + c.bvid, { mode: 'candidate', bvid: c.bvid, cid: c.cid });
          reference = await audioInfo(c.url);
          referenceIsCandidate = true;
          referenceCandidate = c;
          break;
        } catch (e) {
          result.failures.push({ bvid: c.bvid, reason: 'ref-' + e.message });
          logger('reference.failure', '候选音频参考不可用：' + c.bvid + '，' + e.message, { bvid: c.bvid, reason: e.message }, 'warn');
        }
      }
      if (!reference) {
        result.failures.push({ reason: 'no-bilibili-reference' });
        logger('reference.failure', '没有可用的B站音频参考，保留原弹幕', { reason: 'no-bilibili-reference' }, 'warn');
        return result;
      }
    }
    const duration = Math.min(reference.duration, rangeSeconds ?? reference.duration);
    if (!(duration > 0)) {
      logger('reference.failure', '音频参考时长无效', { reason: 'invalid-duration', duration }, 'warn');
      return result;
    }
    logger('reference.ready', '音频参考就绪，CID=' + reference.cid + '，时长=' + duration + '秒',
      { mode: referenceIsCandidate ? 'candidate' : 'primary', cid: reference.cid, duration });
    logger('audio.start', '开始下载并解码参考音频', { cid: reference.cid, duration });
    const ref = await audio(reference.urls, { seconds: duration, signal });
    logger('audio.ready', '参考音频解码完成', { cid: reference.cid });
    if (referenceIsCandidate && referenceCandidate) {
      try {
        const raw = await source.getEpisodeDanmu(referenceCandidate.url);
        const comments = source.formatComments(raw);
        referenceCandidate.fetchedCount = comments.length;
        logger('candidate.comments', '参考候选取得 ' + comments.length + ' 条弹幕', { bvid: referenceCandidate.bvid, cid: referenceCandidate.cid, count: comments.length });
        if (comments.length) {
          result.accepted.push({ cid: referenceCandidate.cid, comments, timeline: { status: 'verified', offsetSeconds: 0, validRange: [0, duration] } });
          logger('candidate.anchor', '接受UGC参考候选弹幕，参考轴偏移=0秒', { cid: referenceCandidate.cid, offsetSeconds: 0, validRange: [0, duration], mode: 'candidate-anchor' });
        }
      } catch (e) {
        result.failures.push({ bvid: referenceCandidate.bvid, reason: 'ref-danmu-' + e.message });
        logger('candidate.failure', '参考候选弹幕获取失败：' + e.message, { bvid: referenceCandidate.bvid, reason: e.message }, 'warn');
      }
    }
    const others = result.candidates.filter(c => c.cid !== reference.cid);
    logger('alignment.start', '准备校验 ' + Math.min(others.length, maxCandidates) + ' 个候选时间轴', { count: others.length, limit: maxCandidates });
    for (const c of others.slice(0, maxCandidates)) {
      if (signal?.aborted) break;
      const started = performance.now();
      try {
        logger('candidate.fetch', '下载候选弹幕：' + c.bvid + ' P' + c.page, { bvid: c.bvid, cid: c.cid });
        const raw = await source.getEpisodeDanmu(c.url), comments = source.formatComments(raw);
        c.fetchedCount = comments.length;
        logger('candidate.comments', '候选取得 ' + comments.length + ' 条弹幕', { bvid: c.bvid, cid: c.cid, count: comments.length });
        if (!comments.length) {
          c.timeline = { status: 'pending', reason: 'no-comments' };
          logger('candidate.reject', '候选没有弹幕，跳过时间轴校验', { bvid: c.bvid, cid: c.cid, reason: 'no-comments' });
          continue;
        }
        logger('audio.start', '下载并解码候选音频：' + c.bvid, { bvid: c.bvid, cid: c.cid });
        const info = await audioInfo(c.url);
        const samples = await audio(info.urls, { seconds: duration + 121, signal });
        logger('alignment.check', '开始音频时间轴校验：' + c.bvid, { bvid: c.bvid, cid: c.cid });
        const timeline = await validate(ref, samples, { duration, signal }); c.timeline = timeline;
        signal?.throwIfAborted();
        logger('alignment.result', '候选时间轴状态=' + timeline.status + '，偏移=' + (timeline.offsetSeconds ?? '?') + '秒，原因=' + (timeline.reason || '无'),
          { bvid: c.bvid, cid: c.cid, status: timeline.status, reason: timeline.reason, offsetSeconds: timeline.offsetSeconds, validRange: timeline.validRange, durationMs: Math.round(performance.now() - started) });
        if (timeline.status === 'verified') result.accepted.push({ cid: c.cid, comments, timeline });
      } catch (e) {
        c.timeline = { status: 'pending', reason: e.message };
        logger('candidate.failure', '候选处理失败：' + c.bvid + '，' + e.message,
          { bvid: c.bvid, cid: c.cid, reason: signal?.aborted ? 'timeout' : e.message, durationMs: Math.round(performance.now() - started) }, 'warn');
        if (signal?.aborted) break;
      }
    }
    result.timedOut = Boolean(signal?.aborted);
    return result;
  }

  async function supplement(context, base, options = {}) {
    const started = performance.now(), logger = options.logger || createUgcLogger(context);
    const budgetMs = options.budgetMs ?? 10000;
    logger('start', '开始UGC补充，原弹幕 ' + base.length + ' 条，预算 ' + budgetMs + 'ms', { originalCount: base.length, budgetMs });
    const key = JSON.stringify(['ugc-v1', context, options.rangeSeconds ?? null, options.maxCandidates ?? 8]);
    const entry = cache.get(key);
    let result, cacheState = 'miss';
    if (entry && entry.expires > Date.now()) {
      result = entry.result; cacheState = 'hit';
      logger('cache', '命中UGC校验缓存', { cacheState });
    } else {
      let task = pending.get(key);
      if (task) {
        cacheState = 'pending';
        logger('cache', '复用同集正在执行的UGC任务，关联流程=' + (task.ugcId || '未知'), { cacheState, sharedUgcId: task.ugcId });
      } else {
        logger('cache', 'UGC缓存未命中，启动检索校验', { cacheState });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), budgetMs);
        task = resolve(context, { ...options, logger, signal: controller.signal }).catch(e => {
          logger('failure', 'UGC流程失败：' + e.message, { reason: controller.signal.aborted ? 'timeout' : e.message }, 'warn');
          return { candidates: [], accepted: [], failures: [{ reason: controller.signal.aborted ? 'timeout' : e.message }] };
        }).then(result => {
          if (cache.size >= 128) cache.delete(cache.keys().next().value);
          cache.set(key, { result, expires: Date.now() + (result.accepted.length ? 3600000 : 60000) }); return result;
        }).finally(() => { clearTimeout(timeout); pending.delete(key); });
        task.ugcId = logger.ugcId;
        pending.set(key, task);
      }
      result = await Promise.race([task, new Promise(resolve => {
        const t = setTimeout(() => resolve(null), budgetMs);
        task.finally(() => clearTimeout(t));
      })]);
    }
    const durationMs = Math.round(performance.now() - started);
    if (!result) {
      logger('end', 'UGC超时，保留原弹幕；新增0条，耗时 ' + durationMs + 'ms',
        { status: 'timeout', originalCount: base.length, addedCount: 0, finalCount: base.length, durationMs, budgetMs, cacheState }, 'warn');
      return base;
    }
    const merged = result.accepted.length ? mergeUgcComments(base, result.accepted) : base;
    const failures = [...result.failures.map(x => x.reason), ...result.candidates.map(c => c.timeline?.reason).filter(Boolean)];
    if (result.timedOut && !failures.includes('timeout')) failures.push('timeout');
    const status = failures.includes('timeout') ? 'timeout' : merged.length > base.length ? 'supplemented' : 'unchanged';
    logger('end', 'UGC结束：候选 ' + result.candidates.length + ' 个，接受 ' + result.accepted.length + ' 个，新增 ' + (merged.length - base.length) + ' 条，耗时 ' + durationMs + 'ms' + (failures.length ? '，失败原因=' + failures.join(',') : ''),
      { status, candidates: result.candidates.length, accepted: result.accepted.length, failures, originalCount: base.length, addedCount: merged.length - base.length, finalCount: merged.length, durationMs, cacheState }, status === 'timeout' ? 'warn' : 'info');
    return merged;
  }
  return { resolve, supplement, clear: () => cache.clear() };
}

export const ugcSupplement = createUgcSupplement();
