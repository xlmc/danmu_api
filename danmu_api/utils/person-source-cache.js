import { globals } from '../configs/globals.js';
import { log } from './log-util.js';

const entries = new Map(), pending = new Map();
const DAY = 86400000, RETRY = 300000, LIMIT = 400;
let initialized = null, disk = null, writes = Promise.resolve();

async function initialize() {
  if (initialized) return initialized;
  initialized = (async () => {
    if (globals.deployPlatform !== 'node') return;
    try {
      const fs = await import('node:fs/promises'), path = await import('node:path');
      const file = path.resolve(process.cwd(), '.cache', 'person-sources-v1.json');
      disk = { fs, path, file };
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      if (data.version === 1 && Array.isArray(data.entries)) {
        for (const [key, entry] of data.entries.slice(-LIMIT)) {
          if (typeof key === 'string' && entry && Number.isFinite(entry.expiresAt)
            && Number.isFinite(entry.retryAt)) {
            if (entry.value && Array.isArray(entry.value.actorNames) && Array.isArray(entry.value.characterNames)
              && entry.value.actorNames.length + entry.value.characterNames.length === 0) {
              continue;
            }
            entries.set(key, entry);
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') log('warn', `[system] [person-metadata] 人物缓存读取失败，重新获取: ${error.message}`);
    }
  })();
  return initialized;
}

export async function clearPersonSourceCache() {
  entries.clear();
  pending.clear();
  if (disk) {
    try {
      await disk.fs.unlink(disk.file);
    } catch (_) {}
  }
}

async function persist() {
  if (!disk) return;
  const snapshot = JSON.stringify({ version: 1, entries: [...entries] });
  writes = writes.catch(() => {}).then(async () => {
    const { fs, path, file } = disk;
    const tmp = `${file}.tmp`;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, file);
    } catch (error) {
      await fs.unlink(tmp).catch(() => {});
      log('warn', `[system] [person-metadata] 人物缓存保存失败，继续使用内存名单: ${error.message}`);
    }
  });
  await writes;
}

/** Cache providers independently. Valid stale data returns immediately while one refresh runs. */
export async function cachedPersonSource(key, loader, usable, complete = () => true) {
  await initialize();
  let entry = entries.get(key);
  if (entry && entry.value != null && !usable(entry.value)) {
    entries.delete(key);
    entry = null;
  }
  const good = entry && usable(entry.value);
  const now = Date.now();
  const copy = value => value == null ? value : structuredClone(value);
  if (entry && now < Math.max(entry.expiresAt, entry.retryAt)) {
    if (good) return { value: copy(entry.value), stale: Boolean(entry.partial) || now >= entry.expiresAt };
    return { value: null, stale: true };
  }
  let task = pending.get(key);
  if (!task) {
    task = (async () => {
      try {
        const value = await loader();
        if (!usable(value)) throw new Error('资料为空或不完整');
        entries.delete(key);
        const partial = !complete(value);
        entries.set(key, { value: copy(value), expiresAt: Date.now() + (partial ? RETRY : DAY), retryAt: 0, partial });
        return { value, stale: partial };
      } catch (error) {
        entries.set(key, { value: good ? entry.value : null, expiresAt: good ? entry.expiresAt : 0, partial: true,
          retryAt: Date.now() + RETRY });
        log('warn', `[system] [person-metadata] 来源 ${key.split(':').at(-1)} 刷新失败${good ? '，继续使用有效旧名单' : ''}: ${error.message}`);
        return { value: good ? copy(entry.value) : null, stale: true };
      } finally {
        while (entries.size > LIMIT) entries.delete(entries.keys().next().value);
        await persist();
      }
    })();
    pending.set(key, task);
    task.finally(() => pending.delete(key)).catch(() => {});
  }
  if (good) return { value: copy(entry.value), stale: true };
  const result = await task;
  return { ...result, value: copy(result.value) };
}

/** Hash configuration credentials before using them in persisted cache keys. */
export async function personCacheIdentity(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
