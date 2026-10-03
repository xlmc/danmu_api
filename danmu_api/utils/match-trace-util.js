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
  try {
    const result = await fn();
    log('info', `[system] [match-timing] ${name} 完成，耗时 ${Math.round(performance.now() - startedAt)}ms`);
    return result;
  } catch (error) {
    log('warn', `[system] [match-timing] ${name} 失败，耗时 ${Math.round(performance.now() - startedAt)}ms`);
    throw error;
  }
}
