import { globals } from '../configs/globals.js';
import { httpGet } from './http-util.js';
import { normalizeMappingSourceUrl, logRemoteMapping } from './title-mapping-url-util.js';
import { mergeAutoMatchMappingRules, parseAutoMatchMappingRules } from './auto-match-mapping-util.js';

const REFRESH_HOUR_BEIJING = 5;
const REFRESH_MINUTE_BEIJING = 30;
const state = {
  url: '',
  rules: [],
  diskLoadedUrl: '',
  initialAttemptedUrl: '',
  fetching: null,
  refreshTimer: null,
  localRulesRef: null,
  remoteRulesRef: null,
  mergedRules: []
};

async function cachePaths() {
  if (typeof process === 'undefined' || !process.cwd) return null;
  const { default: path } = await import('node:path');
  return {
    dir: path.join(process.cwd(), '.cache'),
    text: path.join(process.cwd(), '.cache', 'auto-match-mapping-remote.txt'),
    meta: path.join(process.cwd(), '.cache', 'auto-match-mapping-remote.json')
  };
}

function parseVerifiedRemoteRules(text) {
  const { rules, warnings } = parseAutoMatchMappingRules(text, globals.allowedPlatforms);
  warnings.forEach(message => logRemoteMapping('warn', `[system] [remote-mapping] [remote-season] ${message}`));
  // 远程开放规则会无限向后换算，风险过高；只允许本机显式配置开放规则。
  const verified = rules.filter(rule => rule.bounded);
  const skipped = rules.length - verified.length;
  if (skipped > 0) {
    logRemoteMapping('warn', `[system] [remote-mapping] [remote-season] 已跳过 ${skipped} 条无结束集的远程开放规则`);
  }
  return verified;
}

async function loadDisk(url) {
  if (state.diskLoadedUrl === url) return false;
  state.diskLoadedUrl = url;
  try {
    const paths = await cachePaths();
    if (!paths) return false;
    const { default: fs } = await import('node:fs/promises');
    const meta = JSON.parse(await fs.readFile(paths.meta, 'utf8'));
    if (meta.url !== url) return false;
    const text = await fs.readFile(paths.text, 'utf8');
    const rules = parseVerifiedRemoteRules(text);
    if (rules.length === 0) return false;
    state.url = url;
    state.rules = rules;
    state.localRulesRef = null;
    logRemoteMapping('info', `[system] [remote-mapping] [remote-season] 已加载本机缓存: ${rules.length} 条规则`);
    return true;
  } catch {
    return false;
  }
}

async function saveDisk(url, text) {
  try {
    const paths = await cachePaths();
    if (!paths) return;
    const { default: fs } = await import('node:fs/promises');
    await fs.mkdir(paths.dir, { recursive: true });
    const temp = `${paths.text}.${process.pid || 'current'}.tmp`;
    await fs.writeFile(temp, text, 'utf8');
    await fs.rename(temp, paths.text);
    await fs.writeFile(paths.meta, JSON.stringify({ url, fetchedAt: Date.now(), ruleCount: state.rules.length }), 'utf8');
  } catch (error) {
    logRemoteMapping('warn', `[system] [remote-mapping] [remote-season] 写入本机缓存失败: ${error?.message || error}`);
  }
}

async function fetchRemote(url) {
  const response = await httpGet(url, { timeout: 5000, retries: 0 });
  const text = typeof response?.data === 'string' ? response.data : String(response?.data || '');
  const rules = parseVerifiedRemoteRules(text);
  if (rules.length === 0) throw new Error('远程季集映射表没有可安全启用的有限范围规则');
  state.url = url;
  state.rules = rules;
  state.localRulesRef = null;
  await saveDisk(url, text);
  logRemoteMapping('info', `[system] [remote-mapping] [remote-season] 远程规则已更新并写入本机: ${rules.length} 条`);
  return rules.length;
}

function scheduleRefresh(url) {
  if (state.refreshTimer || !url || typeof setTimeout !== 'function') return;
  const now = new Date();
  const target = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    REFRESH_HOUR_BEIJING - 8, REFRESH_MINUTE_BEIJING
  ));
  if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
  const delay = Math.max(1000, target.getTime() - now.getTime());
  state.refreshTimer = setTimeout(async () => {
    state.refreshTimer = null;
    try {
      await fetchRemote(url);
    } catch (error) {
      logRemoteMapping('warn', `[system] [remote-mapping] [remote-season] 定时更新失败，继续使用本机缓存: ${error?.message || error}`);
    }
    scheduleRefresh(url);
  }, delay);
  if (typeof state.refreshTimer?.unref === 'function') state.refreshTimer.unref();
  logRemoteMapping('info', '[system] [remote-mapping] [remote-season] 已安排每日北京时间 05:30 更新');
}

export async function ensureRemoteAutoMatchMapping() {
  const url = normalizeMappingSourceUrl(globals.autoMatchMappingTableUrl);
  if (!url) return;
  scheduleRefresh(url);
  if (state.url === url && state.rules.length > 0) return;
  await loadDisk(url);
}

/** 启动阶段初始化：先装入磁盘缓存；只有磁盘不存在时才联网建立首份缓存。 */
export async function initializeRemoteAutoMatchMapping() {
  const url = normalizeMappingSourceUrl(globals.autoMatchMappingTableUrl);
  if (!url) return;
  scheduleRefresh(url);
  await loadDisk(url);
  if ((state.url !== url || state.rules.length === 0) && state.initialAttemptedUrl !== url) {
    state.initialAttemptedUrl = url;
    state.fetching ||= fetchRemote(url).catch(error => {
      logRemoteMapping('warn', `[system] [remote-mapping] [remote-season] 启动更新失败，继续使用现有本机配置: ${error?.message || error}`);
      return 0;
    }).finally(() => { state.fetching = null; });
    await state.fetching;
  }
}

export function getEffectiveAutoMatchMappingRules(localRules = globals.autoMatchMappingTable) {
  const configuredUrl = normalizeMappingSourceUrl(globals.autoMatchMappingTableUrl);
  const remoteRules = configuredUrl && state.url === configuredUrl ? state.rules : [];
  if (state.localRulesRef !== localRules || state.remoteRulesRef !== remoteRules) {
    state.localRulesRef = localRules;
    state.remoteRulesRef = remoteRules;
    state.mergedRules = mergeAutoMatchMappingRules(localRules, remoteRules);
  }
  return state.mergedRules;
}

export function getCachedRemoteAutoMatchMappingRules() {
  const configuredUrl = normalizeMappingSourceUrl(globals.autoMatchMappingTableUrl);
  return configuredUrl && state.url === configuredUrl ? state.rules : [];
}

export async function refreshRemoteAutoMatchMappingNow() {
  const url = normalizeMappingSourceUrl(globals.autoMatchMappingTableUrl);
  if (!url) return { success: false, count: state.rules.length, error: '未配置 AUTO_MATCH_MAPPING_TABLE_URL' };
  try {
    const count = await fetchRemote(url);
    return { success: true, count };
  } catch (error) {
    return { success: false, count: state.rules.length, error: error?.message || String(error) };
  }
}
