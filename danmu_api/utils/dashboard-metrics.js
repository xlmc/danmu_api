import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();
const startedAt = Date.now();
const hours = new Map();
const latencySamples = [];
const hourMs = 3600000;

function emptyBucket() {
  return { requests: 0, responses: 0, comments: 0, hits: 0, misses: 0, peakRps: 0 };
}

function bucketAt(now) {
  const hour = new Date(now);
  hour.setMinutes(0, 0, 0);
  const key = +hour;
  for (const time of hours.keys()) if (time < key - 8 * 24 * hourMs) hours.delete(time);
  if (!hours.has(key)) hours.set(key, emptyBucket());
  return hours.get(key);
}

// Only authenticated player traffic activates a measurement. Dashboard polling is excluded.
export function activateDashboardMeasurement(path, method) {
  const state = context.getStore();
  if (!state || !['GET', 'POST'].includes(method)) return;
  if (path !== '/danmaku' && !/^\/api\/v2\/(?:search\/(?:anime|episodes)|bangumi(?:\/|$)|(?:extcomment|comment|segmentcomment)(?:\/|$)|match$|fongmi\/danmaku$)/.test(path)) return;
  state.bucket = bucketAt(Date.now());
  state.commentRequest = /^\/api\/v2\/(?:extcomment|comment|segmentcomment)(?:\/|$)/.test(path);
  state.bucket.requests++;
  const second = Math.floor(Date.now() / 1000);
  if (state.bucket.second !== second) {
    state.bucket.second = second;
    state.bucket.secondRequests = 0;
  }
  state.bucket.peakRps = Math.max(state.bucket.peakRps, ++state.bucket.secondRequests);
}

export function measureCommentCache(key, hit) {
  const state = context.getStore();
  if (!state?.bucket || state.cacheKeys.has(key)) return;
  state.cacheKeys.add(key);
  state.bucket[hit ? 'hits' : 'misses']++;
}

export function measureCommentResponse(count) {
  const state = context.getStore();
  if (state?.commentRequest) state.commentCount = count;
}

export function withDashboardMeasurement(task) {
  const state = { cacheKeys: new Set(), commentCount: 0 };
  return context.run(state, async () => {
    const start = performance.now();
    let response;
    try {
      response = await task();
      return response;
    } finally {
      if (state.bucket) {
        const duration = performance.now() - start;
        latencySamples.push(duration);
        if (latencySamples.length > 2048) latencySamples.shift();
        if (response?.ok && state.commentCount > 0) {
          state.bucket.responses++;
          state.bucket.comments += state.commentCount;
        }
      }
    }
  });
}

function summarize(buckets) {
  const result = emptyBucket();
  for (const bucket of buckets) {
    for (const key of ['requests', 'responses', 'comments', 'hits', 'misses']) result[key] += bucket[key];
    result.peakRps = Math.max(result.peakRps, bucket.peakRps);
  }
  const queries = result.hits + result.misses;
  result.hitRate = queries ? Math.round(result.hits / queries * 1000) / 10 : null;
  return result;
}

export function getDashboardMetrics(now = Date.now()) {
  // Calendar boundaries follow the server timezone, including DST changes.
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const daily = [];
  for (let offset = 6; offset >= 0; offset--) {
    const start = new Date(today);
    start.setDate(start.getDate() - offset);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const buckets = [...hours].filter(([time]) => time >= +start && time < +end).map(([, bucket]) => bucket);
    daily.push({ label: (start.getMonth() + 1) + '/' + start.getDate(),
      collected: +end > startedAt && +start <= now, ...summarize(buckets) });
  }
  const hourly = [];
  for (let time = +today; time < +today + 26 * hourMs; time += hourMs) {
    const date = new Date(time);
    if (date.getDate() !== today.getDate()) break;
    hourly.push({ label: String(date.getHours()).padStart(2, '0') + ':00',
      collected: time + hourMs > startedAt && time <= now,
      ...summarize(hours.has(time) ? [hours.get(time)] : []) });
  }
  const sorted = [...latencySamples].sort((a, b) => a - b);
  const percentile = p => sorted.length ? Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 10) / 10 : null;
  return {
    startedAt, serverTime: now, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    uptimeSeconds: Math.floor(process.uptime()),
    today: daily[daily.length - 1], hourly, daily,
    latency: { samples: sorted.length, average: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length * 10) / 10 : null,
      p95: percentile(0.95), p99: percentile(0.99) },
  };
}
