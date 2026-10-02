import { parse } from 'parse5';
import { globals } from '../configs/globals.js';
import { httpGet } from './http-util.js';
import { simplized } from './zh-util.js';

let retryAfter = 0;

const normalized = value => simplized(String(value || '').normalize('NFKC')).replace(/[\s\p{P}\p{S}]/gu, '');
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value || '';
function text(node) {
  if (['script', 'style', 'sup'].includes(node.tagName)) return '';
  if (node.tagName === 'br') return '\n';
  return node.value || (node.childNodes || []).map(text).join('');
}
function descendants(node, tag, stopAtTable = false) {
  const result = [];
  for (const child of node.childNodes || []) {
    if (child.tagName === tag) result.push(child);
    if (!stopAtTable || child.tagName !== 'table') result.push(...descendants(child, tag, stopAtTable));
  }
  return result;
}
function rows(table) {
  const grid = [], spans = [];
  for (const row of descendants(table, 'tr', true)) {
    const cells = [];
    for (let i = 0; i < spans.length; i++) {
      if (spans[i]?.remaining > 0) { cells[i] = spans[i].cell; spans[i].remaining--; }
    }
    let column = 0;
    for (const cell of (row.childNodes || []).filter(n => ['td', 'th'].includes(n.tagName))) {
      while (cells[column]) column++;
      const width = Math.min(32, Math.max(1, Number(attr(cell, 'colspan')) || 1));
      const height = Math.min(500, Math.max(1, Number(attr(cell, 'rowspan')) || 1));
      for (let i = 0; i < width; i++) {
        cells[column] = cell;
        spans[column++] = { cell, remaining: height - 1 };
      }
    }
    grid.push(cells);
  }
  return grid;
}
function names(cell, actor = false) {
  let value = text(cell || {}).normalize('NFKC');
  value = actor ? value.replace(/[()]/g, '\n') : value.replace(/\([^)]*\)/g, '');
  return value.split(/[\/、,，;；\n]+/).map(name => name.trim()
    .replace(/^(?:童年|少年|青年|成年|老年|幼年|饰演?|配音)\s*[:：]?\s*/, '')
    .replace(/\s+/g, '')).filter(name => /^[\p{Script=Han}·・]{2,24}$/u.test(name)
      && !/^(?:演员|角色|主演|本人|自己|未知|待定|不详|未公布|青年|少年|童年|成年|老年)$/.test(name));
}

/** Only named columns in the current work's cast tables; never follow actor links. */
export function extractWikipediaPersonMetadata(page, { title, year = '' }) {
  if (!page || page.properties?.disambiguation !== undefined) throw new Error('维基条目不存在或是消歧义页');
  const root = parse(typeof page.text === 'string' ? page.text : page.text?.['*'] || '');
  const tables = descendants(root, 'table');
  const infobox = tables.find(table => attr(table, 'class').split(/\s+/).includes('infobox'));
  if (!infobox) throw new Error('维基条目缺少作品信息栏');
  const info = rows(infobox);
  const aliases = info.filter(row => /^(?:别名|又名|原名)$/.test(normalized(text(row[0] || {}))))
    .flatMap(row => text(row[1] || {}).split(/[\n、,，\/]+/));
  if (![page.title, ...aliases].some(value => normalized(value) === normalized(title))) throw new Error('维基作品名不一致');
  const releaseRows = info.filter(row => /^(?:播出日期|首播日期|首播|上映日期|上映时间|发行日期|播放期间)$/.test(normalized(text(row[0] || {}))));
  const years = releaseRows.flatMap(row => text(row[1] || {}).match(/(?:19|20)\d{2}/g) || []);
  if (year && years[0] !== String(year)) throw new Error('维基作品年份不一致');
  const actorNames = new Set(), characterNames = new Set();
  for (const table of tables) {
    if (table === infobox) continue;
    let actorColumn = -1, roleColumn = -1;
    for (const row of rows(table)) {
      const labels = row.map(cell => normalized(text(cell)));
      const actor = labels.findIndex(label => /^(?:演员|饰演|饰演者|配音演员|配音员|声优)$/.test(label));
      const role = labels.findIndex(label => /^(?:角色|人物|角色名|角色名称)$/.test(label));
      if (actor >= 0 && role >= 0) { actorColumn = actor; roleColumn = role; continue; }
      if (actorColumn < 0 || roleColumn < 0 || row[actorColumn] === row[roleColumn]) continue;
      names(row[actorColumn], true).forEach(name => actorNames.add(name));
      names(row[roleColumn]).forEach(name => characterNames.add(name));
    }
  }
  return { actorNames: [...actorNames], characterNames: [...characterNames],
    sourceUrl: `https://zh.wikipedia.org/wiki/${encodeURIComponent(page.title)}`, revision: page.revid };
}

export async function getWikipediaPersonMetadata(title, year) {
  if (Date.now() < retryAfter) throw new Error('维基暂时限流，稍后重试');
  const params = new URLSearchParams({ action: 'parse', page: title, redirects: '1',
    prop: 'text|properties|revid', format: 'json', formatversion: '2', maxlag: '5' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await httpGet(globals.makeProxyUrl(`https://zh.wikipedia.org/w/api.php?${params}`), {
      signal: controller.signal, timeout: 5000,
      headers: { 'User-Agent': 'xdanmu (https://github.com/xlmc/danmu_api)' },
      validStatusCodes: [429, 503],
    });
    if ([429, 503].includes(response.status)) {
      const value = response.headers?.['retry-after'];
      const delay = /^\d+$/.test(value || '') ? Number(value) * 1000 : Date.parse(value) - Date.now();
      retryAfter = Date.now() + Math.max(60000, Number.isFinite(delay) ? delay : 0);
    }
    if (response.status !== 200) throw new Error(`维基请求失败 (${response.status})`);
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    if (data?.error?.code === 'missingtitle') return { actorNames: [], characterNames: [] };
    if (data?.error) throw new Error(`维基请求失败 (${data.error.code})`);
    return extractWikipediaPersonMetadata(data?.parse, { title, year });
  } finally { clearTimeout(timer); }
}
