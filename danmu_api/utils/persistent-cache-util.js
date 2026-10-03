import { globals } from '../configs/globals.js';
import { getLocalCaches, judgeLocalCacheValid } from './cache-util.js';
import { judgeLocalRedisValid, getLocalRedisCaches } from './local-redis-util.js';
import { log } from './log-util.js';
let initializing;
export async function initializePersistentCaches() {
  if (initializing) return initializing;
  const pending = initializing = (async () => {
    const restored = {};
    await judgeLocalRedisValid('/');
    if (globals.localRedisUrl) await getLocalRedisCaches(restored);
    await judgeLocalCacheValid('/', 'node');
    if (globals.localCacheValid) await getLocalCaches(restored);
    if (!globals.queryCacheInitialized) {
      globals.queryCacheInitialized = true;
      if (!restored.idFloorKnown && (restored.damagedIds || Object.values(globals.queryCacheWritable).includes(false))) {
        globals.episodeNum = Math.max(globals.episodeNum, Date.now());
        log('warn', '[cache] 持久化恢复不完整，失败后端写入暂停至重启');
      }
    }
    return true;
  })();
  try { return await pending; } finally { if (initializing === pending) initializing = null; }
}
