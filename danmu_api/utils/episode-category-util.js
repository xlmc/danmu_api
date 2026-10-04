// Platforms expose full pilot episodes and pure editions alongside main episodes.
// Trailers and promotional clips remain outside this catalog extension.
export function isSupplementaryEpisode(value) {
  const title = String(value || '').normalize('NFKC');
  return /纯享|純享|先导|先導/.test(title) && !/预告|預告|宣传|宣傳|片花|\bPV\b/i.test(title);
}

export function isSupplementaryCategory(value) {
  return /^(?:纯享|純享|先导|先導)(?:片|版|篇|集|视频|視頻)?$/.test(String(value || '').trim());
}
