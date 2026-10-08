import BilibiliSource from '../sources/bilibili.js';
import { globals } from '../configs/globals.js';
import { httpGet } from './http-util.js';
import { logEvent } from './log-util.js';
import { convertChineseNumber, extractAnimeInfo, extractYear, matchMediaType, workIdentityConflict } from './common-util.js';
import { decodeHtmlEntities } from './codec-util.js';
import { isDomesticTmdbProduction } from './tmdb-util.js';
import { simplized, traditionalized } from './zh-util.js';

const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', Referer: 'https://www.bilibili.com/' };
const normalize = s => simplized(String(s || '')).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
const clean = s => decodeHtmlEntities(String(s || '').replace(/<[^>]*>/g, ''));
const number = s => /^\d+$/.test(s) ? Number(s) : convertChineseNumber(s);
const excluded = /reaction|第一次看|首看|一口气看|解说|讲解|混剪|预告|花絮|片段|标题卡|测评|玩具|有声|小说|网盘|资源分享|\bMAD\b|\bCUT\b|纯\s*(?:OP|ED)/iu;
const versions = /精编|(?<!未)删减|重制|英文|日语|粤语|配音|特别版|特別版|番外|续集/g;
export const MIN_UGC_TITLE_PRECISION = 0.6;
const RELEASE_DECORATORS = /(?:1080p|720p|4k|2160p|60帧|60fps|高码率|超清|高清|标清|蓝光|bd(?:rip)?|web-?dl|hdr|hevc|h264|h265|x264|x265|aac|中字|简中|繁中|双语|国语|粤语|日语|英语|中英双字|中文字幕|双语字幕|无字|生肉|熟肉|(?:未删减|完整|公映|纯净)+(?:版)?|正片|电影|剧场版|全集|合集|完结|最终话|大结局|自制|搬运|自压|压制|(?:\d{1,2}月)?新番|[^\s【】\[\]()（）]+(?:字幕组|字幕社|汉化组|译制组|压制组|工作组|制作组)|(?:19|20)\d{2}(?:年|版)?|第\s*[\d一二三四五六七八九十百]+\s*[季期部集话回]|s\d+|e\d+|ep\d+|part\s*\d+|\b\d{1,3}\s*期|\b\d{1,3}\b)/gi;

function ugcEpisodeTitles(context) {
  const title = String(context.episodeTitle || '').replace(/【[^】]+】/g, '')
    .replace(/第\s*[\d一二三四五六七八九十百]+\s*[集话期回]|^(?:S\d+\s*)?E(?:P)?\s*\d+\s*[:：._-]?/gi, '').trim();
  if (/^(?:[上下]\s*[:：]?)?\s*(?:正片|完整版|movie|full)?$/i.test(title)) return [];
  const names = [title];
  // 文件名同时提供中英文单集名时，两种写法都可确认内容，不依赖顺序或标点。
  if (/\p{Script=Han}/u.test(title) && /[a-z]/i.test(title) && !/[\u3040-\u30ff]/u.test(title)) {
    names.push((title.match(/\p{Script=Han}+/gu) || []).join(''),
      (title.match(/[a-z]+(?:[\s'’:&-]+[a-z]+)*/gi) || []).join(' '));
  }
  return [...new Set(names.filter(name => normalize(name).length >= 2))];
}

function ugcTitleInfo(title) {
  const baseTitle = String(title || '').trim();
  // 合集名称是检索装饰，年代范围不等于单集年份；续作等真实副标题仍保留。
  const range = baseTitle.normalize('NFKC').match(/\(((?:19|20)\d{2})\s*[-~～—–]\s*((?:19|20)\d{2})\)\s*$/u);
  const withoutRange = range ? baseTitle.replace(/[（(][^）)]*[）)]\s*$/u, '').trim() : baseTitle;
  const searchTitle = withoutRange.replace(/[:：\s]*(?:(?:黄金时代|黄金|经典|珍藏|典藏|精选|完整|全系列)\s*)?(?:合集|全集|收藏版)\s*$/u, '').trim();
  const collectionTitle = searchTitle.length >= 2 && searchTitle !== withoutRange ? baseTitle : null;
  return { title: collectionTitle ? searchTitle : baseTitle, collectionTitle,
    yearRange: collectionTitle && range ? [Number(range[1]), Number(range[2])] : null };
}

/**
 * 计算投稿标题相对目标作品的匹配准确率（核心字符覆盖率），排除弱相关解说/影评/盘点等杂音视频。
 */
export function calculateUgcTitlePrecision(candidateTitle, context) {
  if (!candidateTitle || !context) return 0;
  const rawTitle = clean(candidateTitle);
  const aliases = [context.title, ...(context.aliases || [])].filter(Boolean);

  let working = simplized(rawTitle).normalize('NFKC').toLowerCase().replace(/[【】《》\[\]\(\)（）「」『』]/g, ' ');

  const sortedAliases = [...new Set(aliases.filter(s => s && String(s).trim().length >= 2))]
    .sort((a, b) => normalize(b).length - normalize(a).length);

  let matchedTitleLength = 0;
  for (const name of sortedAliases) {
    const normName = normalize(name);
    if (!normName) continue;
    const normWorking = normalize(working);
    if (normWorking.includes(normName)) {
      matchedTitleLength += normName.length;
      const flexiblePattern = normName
        .split('')
        .map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s\\p{P}]*');
      working = working.replace(new RegExp(flexiblePattern, 'iu'), ' ');
    }
  }

  if (matchedTitleLength === 0) return 0;

  for (const epName of ugcEpisodeTitles(context)) {
    if (normalize(working).includes(normalize(epName))) matchedTitleLength += normalize(epName).length;
    const pattern = normalize(epName).split('').map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\p{P}]*');
    working = working.replace(new RegExp(pattern, 'giu'), ' ');
  }

  working = working.replace(RELEASE_DECORATORS, ' ');

  const leftoverNoise = normalize(working);
  const leftoverLength = leftoverNoise.length;

  return matchedTitleLength / (matchedTitleLength + leftoverLength);
}

// 投稿自身弹幕量过少时多为花絮/搬运/广告素材，补充进来只会稀释弹幕质量。
// 仅在搜索结果给出 stat 时判定；缺少统计字段时不做限制（部分接口不返回 stat）。
const MIN_CANDIDATE_DANMAKU = 20;
// UGC 补充弹幕中的引流广告文本。平台主源弹幕仍完全由用户屏蔽词规则处理。
// 除「点点关注/一键三连」外，B站投稿常见的 QQ/微信群号广告（如「动漫聊天群965056896欢迎」）也要拦。
const UGC_PROMO = /点\s*点?\s*关注|关注\s*(?:我|一下|主播|UP|up)|一键三连|求\s*(?:三连|关注|点赞|投币)|点赞投币|记得关注|加个关注|素质三连|三连一下|(?:QQ|qq|微信|威信|vx|VX|企鹅)\s*(?:群|号|號|裙)?\s*[:：]?\s*[A-Za-z0-9_-]{5,}|(?:交流|聊天|粉丝|资源|动漫|影视|追剧|福利|学习)\s*(?:群|裙)|(?:加|进|入)\s*(?:我|群|裙)|(?:群|裙)\s*(?:号|號)?\s*[:：]?\s*\d{5,}|(?:看|进)\s*我?\s*(?:主页|空间)|公众号/u;
// 单独发送的群号就是一条 6~12 位纯数字（用户看到的「没有意义的数字」）；
// 但 666 / 6666666 这类连续同数字是网络梗，不算广告，保留。
const isUgcPromo = value => {
  const text = String(value ?? '');
  if (UGC_PROMO.test(text)) return true;
  const trimmed = text.trim();
  return /^\d{6,12}$/.test(trimmed) && !/^(\d)\1+$/.test(trimmed);
};
// 单次检索与分P详情并发度；B 站 wbi 接口按此并发调用，避免串行等待叠加超时。
const SEARCH_CONCURRENCY = 3;
const DETAIL_CONCURRENCY = 3;
const COMMENT_CONCURRENCY = 2;

const commentText = item => String(item?.m ?? item?.content ?? item?.text ?? '');

/** 「第8期下」这类上下篇标记；仅比较明确的期/集相邻标记，避免误伤普通标题。 */
function partMarker(text) {
  const value = String(text || '').normalize('NFKC');
  const adjacent = value.match(/第\s*[\d一二三四五六七八九十百零两]+\s*[期集话回]\s*([上下])/);
  if (adjacent) return adjacent[1] === '下' ? 'lower' : 'upper';
  if (/[（(【\[]\s*下\s*[）)】\]]|下\s*[集篇]\s*$/.test(value)) return 'lower';
  if (/[（(【\[]\s*上\s*[）)】\]]|上\s*[集篇]\s*$/.test(value)) return 'upper';
  return '';
}

/** 外部中断信号到达时立即让等待中的网络请求结束，避免并发任务悬挂到超时。 */
function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); });
  });
}

/** 有界并发执行，保持结果顺序；任一任务失败即整体失败。 */
async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

let ugcLogSequence = 0;
export function createUgcLogger(context = {}) {
  const ugcId = Date.now().toString(36) + '-' + (++ugcLogSequence).toString(36);
  const logger = (event, message, data = {}, level = 'info') => logEvent(level, 'ugc.' + event,
    '[ugc] [ugc-id=' + ugcId + '] 「' + (context.title || '未知作品') + '」第' + (context.episode ?? '?') + '集 ' + message,
    { ...data, ugcId, identity: context.identity, title: context.title, year: context.year, mediaType: context.mediaType, season: context.season, episode: context.episode });
  logger.ugcId = ugcId;
  return logger;
}

export function buildUgcContext(resolved) {
  if (!resolved?.anime || !resolved.link) return null;
  const { anime, link, index } = resolved;
  if (anime.type === 'B站投稿') return null;
  const titleInfo = ugcTitleInfo(String(anime.animeTitle).replace(/\s+from\s+.+$/i, '').replace(/【[^】]*】/g, '').trim());
  const parsed = extractAnimeInfo(titleInfo.title, link.title);
  const mediaType = anime.tmdbIdentity?.mediaType || matchMediaType([anime.type, anime.typeDescription].join(' '));
  // 综艺等以「第N期」编号的作品无法被通用集数解析器识别；先用分集标题自身的期/集号，
  // 再退回解析器结果，最后才用目录下标。目录下标并不等于作品集号，直接采用会检索到错误的一期。
  const fromTitle = episodeNumber(link.title);
  const episode = fromTitle ?? parsed.episode ?? index + 1;
  if (!parsed.baseTitle || !Number.isInteger(episode) || episode < 1) return null;
  return {
    identity: `${anime.source}:${anime.animeId}:${anime.bangumiId}`,
    ...titleInfo, title: parsed.baseTitle,
    aliases: [...new Set([...(titleInfo.collectionTitle ? [titleInfo.collectionTitle] : []), ...(anime.aliases || []), ...(anime.tmdbIdentity?.aliases || [])])],
    year: Number(String(anime.startDate || '').slice(0, 4)) || extractYear(anime.animeTitle),
    season: parsed.season ?? anime.tmdbIdentity?.seasonNumber ?? (mediaType === 'tv' ? 1 : null),
    mediaType,
    episode, episodeSource: fromTitle !== null ? 'episode-title' : parsed.episode !== null ? 'catalog-title' : 'catalog-index',
    episodeTitle: link.title, referenceUrl: link.url,
    type: anime.typeDescription || anime.type || '',
    tmdbIdentity: anime.tmdbIdentity || null,
  };
}

export function buildUgcQueries(context) {
  const n = context.episode, padded = String(n).padStart(2, '0');
  const aliases = [...new Set([...(context.aliases || []), ...(context.tmdbIdentity?.aliases || [])].filter(Boolean).map(name => ugcTitleInfo(name).title))]
    .filter(name => name !== context.title);
  // B站优先搜索中文别名；其他已确认别名仍参与，不因列表位置被截断。
  const chinese = name => /[\u3400-\u9fff]/u.test(name) && !/[\u3040-\u30ff]/u.test(name);
  aliases.sort((a, b) => Number(chinese(b)) - Number(chinese(a)));
  const names = [...new Set([context.title, ...aliases].filter(Boolean).flatMap(name => [name, simplized(name), traditionalized(name)]))];
  const broadNames = new Set([context.title, ...aliases.slice(0, 2)].filter(Boolean).flatMap(name => [name, simplized(name), traditionalized(name)]));
  if (context.year) { names.unshift(`${context.title} ${context.year}`); broadNames.add(names[0]); }
  const season = context.season ? ` 第${context.season}季` : '';
  // 综艺用「第N期」，剧集用「第N集」；两种编号都检索，避免用错单位而漏掉真实投稿。
  const units = /第\s*[\d一二三四五六七八九十百零两]+\s*期/.test(String(context.episodeTitle || '')) ? ['期', '集'] : ['集'];
  const episodeTitles = ugcEpisodeTitles(context);
  const episodeQueries = [...broadNames].filter(name => !context.year || name !== `${context.title} ${context.year}`)
    .flatMap(name => [...episodeTitles.map(episodeTitle => `${name} ${episodeTitle}`), ...(episodeTitles.length ? [`${name} 合集`] : [])]);
  return [...new Set([...episodeQueries, ...names.flatMap(name =>
    [...units.map(unit => `${name}${season} 第${n}${unit}`), ...(broadNames.has(name) ? [`${name}${season} ${padded}`, `${name}${season} 合集`] : [])])])];
}

// 匹配阶段还没有官方分集，只能用请求本身给出的身份构造 UGC context；
// 集号来自请求的 SxxExx，集标题有则更有利于分P身份校验。
export function buildUgcRequestContext({ title, aliases = [], year = null, season = null, episode = null, episodeTitle = '', type = '', tmdbIdentity = null } = {}) {
  const baseTitle = String(title || '').trim();
  if (!baseTitle || !Number.isInteger(episode) || episode < 1) return null;
  const titleInfo = ugcTitleInfo(baseTitle);
  return {
    identity: 'request:' + baseTitle,
    ...titleInfo,
    aliases: [...new Set([...(titleInfo.collectionTitle ? [baseTitle] : []), ...aliases, ...(tmdbIdentity?.aliases || [])].filter(Boolean))],
    year: Number.isInteger(year) ? year : null,
    season: Number.isInteger(season) ? season : null,
    episode, episodeSource: 'request',
    episodeTitle: String(episodeTitle || ''),
    referenceUrl: null, type: String(type || ''), mediaType: tmdbIdentity?.mediaType || matchMediaType(type), tmdbIdentity: tmdbIdentity || null
  };
}

// 匹配只能返回一个分集：优先标题与目标集完全一致的候选，优先高准确率，再比弹幕数。
export function pickUgcEpisode(candidates = []) {
  if (!candidates.length) return null;
  const exact = candidates.filter(candidate => candidate.evidence?.episodeTitleMatched);
  const pool = exact.length ? exact : candidates;
  return [...pool].sort((a, b) => {
    const precDiff = (b.precision || b.evidence?.titlePrecision || 0) - (a.precision || a.evidence?.titlePrecision || 0);
    if (Math.abs(precDiff) > 0.05) return precDiff;
    return (Number(b.searchCount) || 0) - (Number(a.searchCount) || 0);
  })[0];
}

// UGC 面向官方平台没有正片、或弹幕本来就少的作品：番剧/国外剧、国外平台。
// 判据按优先级独立生效，前四条都不依赖 TMDB；只有候选与来源都看不出类型时，
// 才用 TMDB 画像（动画 genre 16 / 非国产）补判；仍然判不出来就保守不参与。
const UGC_OVERSEAS_SOURCES = new Set(['bahamut', 'hanjutv', 'renren']);
const DOMESTIC_OFFICIAL_SOURCES = new Set(['bilibili', 'tencent', 'iqiyi', 'youku', 'imgo', 'sohu', 'leshi', 'migu', 'hongguo']);
const ANIMATION_TYPE = /动漫|番剧|动画|anime/i;
export function isUgcApplicable({ identity = null, source = null, sources = [], type = '', types = [], hasBilibiliPgc = false } = {}) {
  const sourceKeys = [source, ...sources].map(value => String(value || '').toLowerCase()).filter(Boolean);
  // 1) B站已有正片：弹幕充足，投稿没有增益。
  if (hasBilibiliPgc) return false;
  if (identity?.isAnimation === true) return true;
  // 2) 命中的是弹幕本就少的国外平台（巴哈/韩剧TV/人人）。
  if (sourceKeys.some(key => UGC_OVERSEAS_SOURCES.has(key))) return true;
  const typeText = [type, ...types].filter(Boolean).join(' ');
  // 3) 候选自带的类型就是番剧/动画。
  if (ANIMATION_TYPE.test(typeText)) return true;
  // 4) 只在国内官方平台上、且候选类型不是动画：官方弹幕足够，不需要投稿。
  if (typeText && sourceKeys.length && sourceKeys.every(key => DOMESTIC_OFFICIAL_SOURCES.has(key))) return false;
  // 5) 前面都判不出来时才看 TMDB 画像。
  if (!identity) return false;
  if (identity.isAnimation === true) return true;
  const originCountry = Array.isArray(identity.originCountry) ? identity.originCountry : [];
  const originalLanguage = String(identity.originalLanguage || '');
  if (!originCountry.length && !originalLanguage) return false;
  return !isDomesticTmdbProduction({ origin_country: originCountry, original_language: originalLanguage });
}

function episodeNumber(text) {
  const paired = String(text).normalize('NFKC').match(/(?<![a-z0-9])S\d{1,3}\s*E0*(\d{1,3})(?!\d)/iu);
  if (paired) return number(paired[1]);
  const m = String(text).normalize('NFKC').match(/第\s*([\d一二三四五六七八九十百零两]+)\s*[集话期回]|(?:\bEP?\s*|[\[【(（])0*(\d{1,3})(?:\b|[\]】)）])|(?:^|\s|_)0*(\d{1,3})\s*(?:[集话期回]|[.、_\s]|$)/iu);
  return m ? number(m[1] || m[2] || m[3]) : null;
}

export function selectUgcPages(context, video, onReject = () => {}) {
  const reject = (reason, page) => { onReject(reason, page); return []; };
  const title = clean(video.title), aliases = [context.title, ...(context.aliases || [])];
  if (!aliases.some(name => normalize(name).length >= 2 && normalize(title).includes(normalize(name)))) return reject('title-mismatch');
  const precision = calculateUgcTitlePrecision(title, context);
  if (precision < MIN_UGC_TITLE_PRECISION) return reject('title-precision-low');
  const season = title.match(/第\s*([\d一二三四五六七八九十百]+)\s*季|(?<![a-z0-9])S(\d{1,3})(?=\s*E\d|\b)/i);
  if (season && (!context.season || number(season[1] || season[2]) !== context.season)) return reject('season-mismatch');
  const mediaType = context.mediaType || context.tmdbIdentity?.mediaType || matchMediaType(context.type || '');
  const conflict = workIdentityConflict({ ...video, title, type: [video.type, matchMediaType(title)].join(' ') }, { ...context, mediaType });
  if (conflict) return reject(conflict);
  const candidateYear = extractYear(title);
  if (context.yearRange && candidateYear && (candidateYear < context.yearRange[0] || candidateYear > context.yearRange[1])) return reject('year-mismatch');
  const contextText = [context.title, ...context.aliases || [], context.episodeTitle].join(' ');
  if ([...title.matchAll(versions)].some(m => !contextText.includes(m[0]))) return reject('version-mismatch');
  const titleEpisode = episodeNumber(title), pages = video.pages || [];
  if (!pages.length) return reject('no-pages');
  return pages.flatMap(p => {
    if (excluded.test(`${title} ${p.part}`)) return reject('non-content', p);
    const pageSeason = String(p.part).normalize('NFKC').match(/第\s*([\d一二三四五六七八九十百]+)\s*季|(?<![a-z0-9])S(\d{1,3})(?=\s*E\d|\b)/i);
    if (pageSeason && context.season && number(pageSeason[1] || pageSeason[2]) !== context.season) return reject('season-mismatch', p);
    if ([...String(p.part).matchAll(versions)].some(m => !contextText.includes(m[0]))) return reject('version-mismatch', p);
    // 上下篇：目标集是「第8期下」时，不能用「第8期上」的弹幕替代。
    const contextPart = partMarker(context.episodeTitle);
    const pagePart = partMarker(p.part) || (pages.length === 1 ? partMarker(title) : '');
    if (contextPart && pagePart && contextPart !== pagePart) return reject('part-mismatch', p);
    const pageEpisode = episodeNumber(p.part);
    const episodeTitles = ugcEpisodeTitles(context).map(title => {
      let name = normalize(title);
      for (const alias of aliases) name = name.replace(normalize(alias), '');
      return name;
    }).filter(name => name.length >= 2);
    // 单P的空名称/数字文件名可用投稿标题确认；多P仍必须逐P确认内容。
    const pageIdentityTitle = pages.length === 1 && /^(?:\d*|p\d+|正片)$/i.test(String(p.part || '').trim()) ? title : String(p.part);
    let pageTitle = normalize(pageIdentityTitle.replace(/第\s*[\d一二三四五六七八九十百]+\s*[集话期回]/g, '').replace(RELEASE_DECORATORS, ' '));
    for (const name of aliases) pageTitle = pageTitle.replace(normalize(name), '');
    const named = ugcEpisodeTitles({ ...context, episodeTitle: pageTitle }).some(name => episodeTitles.includes(normalize(name)));
    if (context.collectionTitle && context.episodeTitle && !named) return reject('episode-title-mismatch', p);
    // A page's position is not an episode number. Trailer/OP pages often precede E01.
    const episode = pageEpisode ?? (pages.length === 1 ? titleEpisode : null);
    const movie = (mediaType === 'movie' || (!mediaType && context.season === null && context.episode === 1)) && pages.length === 1 && episode === null;
    if (episode !== context.episode && !named && !movie) return reject('episode-unconfirmed-or-mismatch', p);
    if (pageEpisode !== null && pageEpisode !== context.episode) return reject('episode-mismatch', p);
    if (pages.length === 1 && titleEpisode !== null && titleEpisode !== context.episode) return reject('episode-mismatch', p);
    if (!(p.duration > 0) || !p.cid || !video.bvid) return reject('metadata-incomplete', p);
    if (movie && p.duration < 2400) return reject('movie-duration-too-short', p);
    return [{ bvid: video.bvid, aid: video.aid, cid: p.cid, page: p.page, duration: p.duration, title, part: p.part,
      precision, url: `https://www.bilibili.com/video/${video.bvid}/?p=${p.page}`, searchCount: video.stat?.danmaku || 0,
      evidence: { title, part: p.part, explicitEpisode: episode, episodeTitleMatched: named, titlePrecision: precision,
        expectedYear: context.year, candidateYear: extractYear(title), expectedType: mediaType,
        candidateType: matchMediaType(title), episodeBasis: movie ? 'movie-feature' : named ? 'episode-title' : 'explicit-episode' } }];
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
    if (cids.has(cid) || !['verified', 'metadata-matched'].includes(timeline?.status)) continue;
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

export function createUgcSupplement({ source = new BilibiliSource(), json = getJson } = {}) {
  const cache = new Map(), pending = new Map();
  let cacheGeneration = 0;
  // 检索投稿并做身份校验；独立兜底通过 prepare 继续确认非空弹幕。
  async function search(context, { signal, logger = createUgcLogger(context) } = {}) {
    const result = { candidates: [], failures: [] };
    logger('search.start', '开始检索投稿');
    const videos = new Map(), key = await source._getWbiMixinKey();
    const queries = buildUgcQueries(context).flatMap(keyword => ['totalrank', 'dm'].map(order => ({ keyword, order })));
    const workNames = [...new Set([context.title, ...(context.aliases || []), ...(context.tmdbIdentity?.aliases || [])]
      .filter(Boolean).flatMap(name => { const title = ugcTitleInfo(name).title; return [title, simplized(title), traditionalized(title)]; }))]
      .sort((a, b) => b.length - a.length);
    const chineseQuery = ({ keyword }) => {
      const name = workNames.find(name => keyword.startsWith(name + ' ')) || keyword;
      return /[\u3400-\u9fff]/u.test(name) && !/[\u3040-\u30ff]/u.test(name);
    };
    for (const queryGroup of [queries.filter(chineseQuery), queries.filter(query => !chineseQuery(query))]) {
    if (!queryGroup.length) continue;
    await mapConcurrent(queryGroup, SEARCH_CONCURRENCY, async ({ keyword, order }) => {
      signal?.throwIfAborted();
      logger('search.query', '检索关键词：' + keyword + '，排序=' + order, { keyword, order });
      const params = source._getWbiSignedParams({ keyword, search_type: 'video', page: 1, page_size: 20, order }, key);
      const data = await abortable(json('https://api.bilibili.com/x/web-interface/wbi/search/type?' + new URLSearchParams(params)), signal);
      if (data.code !== 0) throw new Error('ugc-search-' + data.code);
      const rows = data.data?.result || [];
      for (const v of rows) if (v.bvid && !videos.has(v.bvid)) videos.set(v.bvid, v);
      logger('search.result', '本次检索返回 ' + rows.length + ' 个投稿', { keyword, order, count: rows.length });
    });
    const ordered = [...videos.values()].filter(v => {
      const title = clean(v.title), ep = episodeNumber(title);
      // stat 缺失时不限制；给出弹幕数但过少的投稿通常是花絮/搬运/广告素材。
      const reported = v.stat ? Number(v.stat.danmaku) : null;
      const precision = calculateUgcTitlePrecision(title, context);
      v.precision = precision;
      const reason = ![context.title, ...context.aliases || []].some(name => normalize(title).includes(normalize(name))) ? 'title-mismatch'
        : precision < MIN_UGC_TITLE_PRECISION ? 'title-precision-low'
        : excluded.test(title) ? 'non-content'
        : !(ep === null || ep === context.episode || /合集|全集|全\s*\d+|1\s*[-~～]\s*\d+/.test(title)) ? 'episode-mismatch'
        : (reported !== null && Number.isFinite(reported) && reported < MIN_CANDIDATE_DANMAKU) ? 'low-danmaku' : null;
      if (reason) logger('candidate.reject', '投稿初筛拒绝：' + v.bvid + '，原因=' + reason, { bvid: v.bvid, candidateTitle: title, reason, precision, reportedDanmaku: reported });
      return !reason;
    }).sort((a, b) => {
      const precDiff = (b.precision || 0) - (a.precision || 0);
      if (Math.abs(precDiff) > 0.05) return precDiff;
      return (b.video_review || 0) - (a.video_review || 0);
    });
    logger('search.end', '检索去重 ' + videos.size + ' 个，初筛通过 ' + ordered.length + ' 个', { discovered: videos.size, eligible: ordered.length, metadataLimit: 30 });
    const details = await mapConcurrent(ordered.slice(0, 30), DETAIL_CONCURRENCY, async v => {
      signal?.throwIfAborted();
      try {
        logger('candidate.detail', '读取投稿分P：' + v.bvid, { bvid: v.bvid });
        const view = await abortable(json('https://api.bilibili.com/x/web-interface/view?bvid=' + v.bvid), signal);
        const selected = selectUgcPages(context, view.data || {}, (reason, page) => logger('candidate.reject',
          '投稿身份校验拒绝：' + v.bvid + '，原因=' + reason,
          { bvid: v.bvid, cid: page?.cid, page: page?.page, part: page?.part, candidateTitle: clean(view.data?.title), reason }));
        for (const c of selected) logger('candidate.select', '候选通过身份校验：' + c.bvid + ' P' + c.page + '，CID=' + c.cid,
          { bvid: c.bvid, cid: c.cid, page: c.page, candidateTitle: c.title, part: c.part, duration: c.duration, reportedComments: c.searchCount, evidence: c.evidence });
        return { selected };
      } catch (e) {
        logger('candidate.failure', '投稿详情获取失败：' + v.bvid + '，' + e.message, { bvid: v.bvid, reason: e.message }, 'warn');
        return { failure: { bvid: v.bvid, reason: e.message } };
      }
    });
    for (const detail of details) {
      result.candidates.push(...(detail.selected || []));
      if (detail.failure) result.failures.push(detail.failure);
    }
    result.candidates.sort((a, b) => Number(b.evidence.episodeTitleMatched) - Number(a.evidence.episodeTitleMatched)
      || b.searchCount - a.searchCount || b.precision - a.precision);
    logger('candidates.ready', '可用分P候选 ' + result.candidates.length + ' 个', { count: result.candidates.length });
    if (result.candidates.length) return result;
    }
    return result;
  }

  async function resolve(context, { signal, maxCandidates = 8, rangeSeconds, logger = createUgcLogger(context) } = {}) {
    const result = { candidates: [], accepted: [], failures: [] };
    const found = await search(context, { signal, logger });
    result.candidates = found.candidates;
    result.failures = found.failures;
    logger('mode', '仅匹配投稿元数据并获取弹幕，不请求音视频；时间轴未经音频校验', { mode: 'metadata-only', timelineVerified: false });
    const seen = new Set();
    const selected = result.candidates.filter(c => {
      if (seen.has(c.cid)) return false;
      seen.add(c.cid);
      return true;
    }).slice(0, maxCandidates);
    const fetched = await mapConcurrent(selected, COMMENT_CONCURRENCY, async c => {
      if (signal?.aborted) return { skipped: true };
      const started = performance.now();
      try {
        logger('candidate.fetch', '获取候选弹幕：' + c.bvid + ' P' + c.page, { bvid: c.bvid, cid: c.cid });
        const raw = await abortable(source.getEpisodeDanmu(c.url), signal);
        const all = source.formatComments(raw);
        // 投稿弹幕常含「点点关注」等引流内容；平台主源弹幕不受此规则影响。
        const comments = all.filter(item => !isUgcPromo(commentText(item)));
        if (comments.length !== all.length) logger('candidate.promo', '候选过滤引流弹幕 ' + (all.length - comments.length) + ' 条', { bvid: c.bvid, cid: c.cid, removed: all.length - comments.length, count: comments.length });
        signal?.throwIfAborted();
        c.fetchedCount = comments.length;
        logger('candidate.comments', '候选取得 ' + comments.length + ' 条弹幕', { bvid: c.bvid, cid: c.cid, count: comments.length });
        if (!comments.length) {
          c.timeline = { status: 'pending', reason: 'no-comments' };
          logger('candidate.reject', '候选没有弹幕', { bvid: c.bvid, cid: c.cid, reason: 'no-comments' });
          return { rejected: true };
        }
        const duration = Math.min(c.duration, rangeSeconds ?? c.duration);
        c.timeline = { status: 'metadata-matched', offsetSeconds: 0, validRange: [0, duration] };
        logger('candidate.accept', '候选身份匹配，保留原始弹幕时间戳；时间轴未经音频校验',
          { bvid: c.bvid, cid: c.cid, page: c.page, candidateTitle: c.title, part: c.part, evidence: c.evidence, status: 'metadata-matched', timelineVerified: false, offsetSeconds: 0, validRange: [0, duration], durationMs: Math.round(performance.now() - started) });
        return { accepted: { cid: c.cid, comments, timeline: c.timeline } };
      } catch (e) {
        const reason = signal?.aborted ? 'timeout' : e.message;
        c.timeline = { status: 'pending', reason };
        logger('candidate.failure', '候选弹幕获取失败：' + c.bvid + '，' + reason, { bvid: c.bvid, cid: c.cid, reason }, 'warn');
        return { failure: { bvid: c.bvid, reason } };
      }
    });
    for (const row of fetched) {
      if (row.accepted) result.accepted.push(row.accepted);
      if (row.failure) result.failures.push(row.failure);
    }
    result.timedOut = Boolean(signal?.aborted);
    return result;
  }

  // 检索与合并拆开：检索是 UGC 的真实耗时（缓存未命中时可达数秒），可以在抓主源弹幕之前
  // 并行发起；等弹幕到手后再合并，从而把这段耗时从串行路径里省掉。
  async function prepare(context, options = {}) {
    const started = performance.now(), logger = options.logger || createUgcLogger(context);
    const budgetMs = options.budgetMs ?? 10000;
    logger('start', options.prefetch ? '开始UGC补充（与主源弹幕并行检索），预算 ' + budgetMs + 'ms' : '开始UGC补充，预算 ' + budgetMs + 'ms',
      { budgetMs, prefetch: Boolean(options.prefetch) });
    const key = JSON.stringify(['ugc-metadata-v3', context, options.rangeSeconds ?? null, options.maxCandidates ?? 8]);
    const entry = cache.get(key);
    let result, cacheState = 'miss';
    if (entry && entry.expires > Date.now()) {
      result = entry.result; cacheState = 'hit';
      logger('cache', '命中UGC校验缓存', { cacheState });
      for (const accepted of result.accepted) {
        const candidate = result.candidates.find(item => item.cid === accepted.cid);
        logger('candidate.accept', '复用已校验投稿：' + candidate.title + '，' + candidate.bvid + ' P' + candidate.page,
          { cacheState, candidateTitle: candidate.title, bvid: candidate.bvid, cid: candidate.cid, page: candidate.page, part: candidate.part, evidence: candidate.evidence, timelineVerified: false });
      }
    } else {
      let task = pending.get(key);
      if (task) {
        cacheState = 'pending';
        logger('cache', '复用同集正在执行的UGC任务，关联流程=' + (task.ugcId || '未知'), { cacheState, sharedUgcId: task.ugcId });
      } else {
        logger('cache', 'UGC缓存未命中，启动检索校验', { cacheState });
        const generation = cacheGeneration;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), budgetMs);
        task = resolve(context, { ...options, logger, signal: controller.signal }).catch(e => {
          logger('failure', 'UGC流程失败：' + e.message, { reason: controller.signal.aborted ? 'timeout' : e.message }, 'warn');
          return { candidates: [], accepted: [], failures: [{ reason: controller.signal.aborted ? 'timeout' : e.message }] };
        }).then(result => {
          if (cache.size >= 128) cache.delete(cache.keys().next().value);
          if (generation === cacheGeneration) cache.set(key, { result, expires: Date.now() + (result.accepted.length ? 3600000 : 60000) }); return result;
        }).finally(() => { clearTimeout(timeout); if (pending.get(key) === task) pending.delete(key); });
        task.ugcId = logger.ugcId;
        pending.set(key, task);
      }
      result = await Promise.race([task, new Promise(resolve => {
        const t = setTimeout(() => resolve(null), budgetMs);
        task.finally(() => clearTimeout(t));
      })]);
    }
    return { result, cacheState, durationMs: Math.round(performance.now() - started), budgetMs, logger };
  }

  // 用已完成的检索结果合并到主源弹幕；base 此时才需要，所以并行预取不影响其它判断。
  async function settle(context, base, prepared) {
    const { result, cacheState, durationMs, budgetMs, logger } = prepared;
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

  // options.prepared 可以是先前 prepare() 的结果（并行预取），也可以是它的 Promise。
  async function supplement(context, base, options = {}) {
    const prepared = options.prepared ? await options.prepared : await prepare(context, options);
    return settle(context, base, prepared);
  }
  return { search, prepare, settle, resolve, supplement, clear: () => { cacheGeneration++; cache.clear(); pending.clear(); } };
}

export const ugcSupplement = createUgcSupplement();
