import { parse } from 'parse5';
import { globals } from '../configs/globals.js';
import { httpGet } from './http-util.js';
import { simplized } from './zh-util.js';

const BASE = 'https://bkso.baidu.com';
const normalized = value => simplized(String(value || '').normalize('NFKC')).replace(/[\s\p{P}\p{S}]/gu, '');
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value || '';
function text(node) {
  if (['script', 'style', 'sup'].includes(node.tagName)) return '';
  return node.value || (node.childNodes || []).map(text).join('');
}
function descendants(node, tag) {
  return (node.childNodes || []).flatMap(child => [
    ...(child.tagName === tag ? [child] : []), ...descendants(child, tag),
  ]);
}
function page(html) {
  if (typeof html !== 'string') throw new Error('百度百科未返回网页');
  const root = parse(html);
  const heading = text(descendants(root, 'title')[0] || {});
  if (/安全验证|访问验证|验证码/.test(heading)) throw new Error('百度百科要求验证');
  return { root, heading };
}
function basicInfo(root) {
  const info = new Map();
  for (const div of descendants(root, 'div')) {
    const dt = div.childNodes?.find(node => node.tagName === 'dt' && /basicInfoItem/.test(attr(node, 'class')));
    const dd = div.childNodes?.find(node => node.tagName === 'dd');
    if (dt && dd) info.set(normalized(text(dt)), text(dd).trim());
  }
  return info;
}
function chineseNames(value) {
  return simplized(value.normalize('NFKC')).replace(/\([^)]*\)/g, '')
    .split(/[/、,，;；]+/).map(name => name.trim().replace(/\s+/g, ''))
    .filter(name => /^[\p{Script=Han}·・]{2,24}$/u.test(name)
      && !/^(?:本人|自己|未知|待定|不详|未公布|演员|角色)$/.test(name));
}
function isWorkDescription(description, mediaType) {
  if (/小说|游戏|歌曲|舞台剧|话剧/.test(description)) return false;
  const movie = /电影|影片|(?:科幻|动作|剧情|喜剧|爱情|恐怖|纪录|惊悚|战争|悬疑|犯罪|灾难|奇幻|武侠|冒险)片/.test(description);
  if (mediaType === 'movie') return movie;
  if (mediaType === 'tv') return /剧|动画|动漫/.test(description) && !movie;
  return movie || /剧|动画|动漫/.test(description);
}

/** Accept only this work's cast list; ignore synopsis, crew and actor biographies. */
export function extractBaiduPersonMetadata(html, { title, year = '', mediaType = '', sourceUrl = '' }) {
  const { root, heading } = page(html);
  const match = /^(.*?)（(.*?)）_百度百科$/.exec(heading) || /^(.*?)\((.*?)\)_百度百科$/.exec(heading);
  if (!match || normalized(match[1]) !== normalized(title) || !isWorkDescription(match[2], mediaType)) {
    throw new Error('百度百科作品名称或类型不一致');
  }
  const info = basicInfo(root);
  const release = info.get('首播时间') || info.get('首播日期') || info.get('上映时间') || info.get('上映日期') || match[2];
  if (year && release.match(/(?:19|20)\d{2}/)?.[0] !== String(year)) throw new Error('百度百科作品年份不一致');
  if (!/中国|大陆|香港|台湾|澳门/.test(normalized(info.get('制片地区') || info.get('出品地区') || ''))) {
    throw new Error('百度百科未确认国产或港台作品');
  }
  const actorNames = new Set(), characterNames = new Set();
  const items = descendants(root, 'div').filter(node => attr(node, 'class').split(/\s+/).some(name => name.startsWith('actorItem_')));
  for (const item of items) {
    for (const dt of descendants(item, 'dt')) {
      const parts = text(dt).normalize('NFKC').split(/\s+饰\s+/);
      if (parts.length !== 2) continue;
      chineseNames(parts[0]).forEach(name => actorNames.add(name));
      chineseNames(parts[1]).forEach(name => characterNames.add(name));
    }
  }
  if (actorNames.size + characterNames.size === 0) throw new Error('百度百科没有可解析的中文演员角色表');
  return { actorNames: [...actorNames], characterNames: [...characterNames], sourceUrl };
}

export async function getBaiduPersonMetadata(title, year = '', mediaType = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const read = async url => {
    const response = await httpGet(globals.makeProxyUrl(url), {
      timeout: 5000, signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });
    if (response.status !== 200) throw new Error(`百度百科请求失败 (${response.status})`);
    return response.data;
  };
  try {
    let url = `${BASE}/item/${encodeURIComponent(title)}`;
    let html = await read(url);
    const { root } = page(html);
    const links = descendants(root, 'a').filter(node => attr(node, 'href').includes('fromModule=disambiguation'));
    if (links.length) {
      const choices = new Set(links.filter(node => isWorkDescription(text(node), mediaType)
        && (!year || text(node).match(/(?:19|20)\d{2}/)?.[0] === String(year)))
        .map(node => new URL(attr(node, 'href'), BASE).href)
        .filter(href => { const target = new URL(href); return target.origin === BASE && /^\/item\/[^/]+\/\d+$/.test(target.pathname); }));
      if (choices.size !== 1) throw new Error('百度百科同名作品无法唯一匹配');
      url = [...choices][0];
      html = await read(url);
    }
    return extractBaiduPersonMetadata(html, { title, year, mediaType, sourceUrl: url });
  } finally {
    clearTimeout(timer);
  }
}
