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
  return simplized(value.normalize('NFKC')).replace(/\([^)]*\)|（[^）]*）/g, '')
    .split(/[/、,，;；\n\s]+/).map(name => name.trim().replace(/\s+/g, ''))
    .filter(name => /^[\p{Script=Han}·・]{2,24}$/u.test(name)
      && !/^(?:本人|自己|未知|待定|不详|未公布|演员|角色|主持|主持人|司仪|主评委|见证人|嘉宾|常驻嘉宾|队长|成员|选手|哥哥|弟弟|.*(?:成员|選手|选手|阶段|公演|对决|战队|阵营|部落|诞生|名单|淘汰|退赛|晋级|成团|危险).*|第[0-9一二三四五六七八九十百]+.*)$/u.test(name));
}
function isWorkDescription(description, mediaType) {
  if (/小说|游戏|歌曲|舞台剧|话剧/.test(description)) return false;
  const variety = /综艺|真人秀|竞演|晚会|脱口秀|音乐节目|选秀|演艺节目/.test(description);
  const movie = /电影|影片|(?:科幻|动作|剧情|喜剧|爱情|恐怖|纪录|惊悚|战争|悬疑|犯罪|灾难|奇幻|武侠|冒险)片/.test(description);
  if (mediaType === 'movie') return movie;
  if (mediaType === 'tv') return (/剧|动画|动漫/.test(description) || variety) && !movie;
  return movie || /剧|动画|动漫/.test(description) || variety;
}

/** Accept only this work's cast list; ignore synopsis, crew and actor biographies. */
export function extractBaiduPersonMetadata(html, { title, year = '', mediaType = '', sourceUrl = '' }) {
  const { root, heading } = page(html);
  const info = basicInfo(root);
  const match = /^(.*?)（(.*?)）_百度百科$/.exec(heading) || /^(.*?)\((.*?)\)_百度百科$/.exec(heading);
  const headingTitle = (match ? match[1] : heading.replace(/_百度百科$/, '')).trim();
  const headingDesc = match ? match[2] : (info.get(normalized('类型')) || info.get(normalized('类别')) || '');
  const aliases = (info.get(normalized('别名')) || '').split(/[\s、,，;；/]+/);
  const cnName = info.get(normalized('中文名')) || '';
  const titles = [headingTitle, cnName, ...aliases].map(normalized).filter(Boolean);

  if (!titles.includes(normalized(title)) || (headingDesc && !isWorkDescription(headingDesc, mediaType))) {
    throw new Error('百度百科作品名称或类型不一致');
  }
  const release = info.get(normalized('首播时间')) || info.get(normalized('首播日期')) || info.get('上映时间') || info.get('上映日期') || match?.[2] || '';
  if (year && release.match(/(?:19|20)\d{2}/)?.[0] !== String(year)) throw new Error('百度百科作品年份不一致');
  const region = normalized(info.get(normalized('制片地区')) || info.get(normalized('出品地区')) || info.get(normalized('制作国家地区')) || info.get(normalized('国家地区')) || '');
  if (!/中国|大陆|内地|香港|台湾|澳门/.test(region)) {
    throw new Error('百度百科未确认国产或港台作品');
  }
  const actorNames = new Set(), characterNames = new Set();
  const items = descendants(root, 'div').filter(node => attr(node, 'class').split(/\s+/).some(name => name.startsWith('actorItem_')));
  for (const item of items) {
    for (const dt of descendants(item, 'dt')) {
      const parts = text(dt).normalize('NFKC').split(/\s+饰\s+/);
      if (parts.length === 2) {
        chineseNames(parts[0]).forEach(name => actorNames.add(name));
        chineseNames(parts[1]).forEach(name => characterNames.add(name));
      } else if (parts.length === 1) {
        chineseNames(parts[0]).forEach(name => actorNames.add(name));
      }
    }
  }
  for (const key of ['主持人', '主持', '主要嘉宾', '嘉宾', '参演嘉宾', '滚烫家族', '常驻嘉宾', '主演', '领衔主演', '部分成员']) {
    const val = info.get(normalized(key));
    if (val) {
      chineseNames(val).forEach(name => actorNames.add(name));
    }
  }
  const tables = descendants(root, 'table');
  for (const table of tables) {
    const trs = descendants(table, 'tr');
    let actorCol = -1, roleCol = -1;
    for (const tr of trs) {
      const cells = tr.childNodes.filter(n => ['td', 'th'].includes(n.tagName));
      const labels = cells.map(c => normalized(text(c)));
      if (actorCol < 0) {
        const found = labels.findIndex(l => /^(?:演员|饰演者|配音|姓名|成员|嘉宾|选手)$/.test(l));
        const foundRole = labels.findIndex(l => /^(?:角色|人物|角色名)$/.test(l));
        if (found >= 0) {
          actorCol = found;
          roleCol = foundRole;
          continue;
        }
      }
      if (actorCol >= 0 && cells[actorCol]) {
        chineseNames(text(cells[actorCol])).forEach(name => actorNames.add(name));
        if (roleCol >= 0 && cells[roleCol]) {
          chineseNames(text(cells[roleCol])).forEach(name => characterNames.add(name));
        }
      }
      for (const cell of cells) {
        const cellText = text(cell);
        const m = cellText.match(/^(?:主持人|主持|见证人|滚烫见证人|常驻嘉宾)[·:：\s]+([\p{Script=Han}·・]{2,20})/u);
        if (m) {
          chineseNames(m[1]).forEach(name => actorNames.add(name));
        }
      }
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
  } finally { clearTimeout(timer); }
}
