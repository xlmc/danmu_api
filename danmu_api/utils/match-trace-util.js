import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const matchContext = new AsyncLocalStorage();

export function runWithMatchTrace(fn) {
  return matchContext.run({ id: randomUUID().slice(0, 8) }, fn);
}

export function getMatchTracePrefix() {
  const context = matchContext.getStore();
  return context ? `[match-id=${context.id}] ` : '';
}

export async function traceMatchStep(log, name, fn) {
  if (!matchContext.getStore()) return fn();
  const startedAt = performance.now();
  const source = name.match(/^来源 (\S+) /)?.[1] || null;
  log('info', `[system] [match-timing] ${name} 开始`, { __logEvent: 'step.start', data: { name, source } });
  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - startedAt);
    log('info', `[system] [match-timing] ${name} 完成，耗时 ${durationMs}ms`, { __logEvent: 'step.end', data: { name, source, durationMs, status: 'completed' } });
    return result;
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    log('warn', `[system] [match-timing] ${name} 失败，耗时 ${durationMs}ms`, { __logEvent: 'step.end', data: { name, source, durationMs, status: 'failed' } });
    throw error;
  }
}
