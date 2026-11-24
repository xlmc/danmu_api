// Platforms expose full pilot episodes and pure editions alongside main episodes.
// Trailers and promotional clips remain outside this catalog extension.
export function isSupplementaryEpisode(value) {
  const title = String(value || '').normalize('NFKC');
  return /纯享|純享|先导|先導/.test(title) && !/预告|預告|宣传|宣傳|片花|\bPV\b/i.test(title);
}

export function isSupplementaryCategory(value) {
  return /^(?:纯享|純享|先导|先導)(?:片|版|篇|集|视频|視頻)?$/.test(String(value || '').trim());
}

export function isVarietyBonusTitle(value) {
  return /预告|預告|先导|先導|加更|熟人局|高光|特别篇|特別篇|特辑|特輯|番外|花絮|预热|預熱|精编|精編|抢先|搶先|抢鲜|搶鮮|纯享|純享|看点|看點|回顾|回顧|片段|彩蛋/i.test(value);
}

// Keep complementary platform title fields, omitting only exact duplicates and
// strings already contained in a more complete field.
export function mergeEpisodeTitles(...values) {
  const titles = [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
  return titles.filter(title => !titles.some(other => other !== title && other.includes(title))).join(' ');
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
    /抢鲜版|搶鮮版|抢先版|搶先版/.test(text) ? 'early' :
    /先导片|先導片/.test(text) ? 'pilot' : issue ? 'main' : null;
  if (!kind || (kind === 'early' && !issue)) return null;
  // 上下篇标记在三处都可能出现：期号后紧跟（第3期上：…）、冒号前末尾（先导片下：…）、
  // 以及冒号后副标题的末尾（第1期：初舞台（上）——芒果这类写法，截断后会把上下篇丢掉）。
  const stripped = raw.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  const part = issuePartMarker(raw) ||
    (/下(?:集|篇)?$/.test(text) ? 'lower' : /上(?:集|篇)?$/.test(text) ? 'upper' : '') ||
    (/下(?:集|篇)?$/.test(stripped) ? 'lower' : /上(?:集|篇)?$/.test(stripped) ? 'upper' : '');
  return `${kind}:${issue?.[1] || ''}:${part}`;
}
