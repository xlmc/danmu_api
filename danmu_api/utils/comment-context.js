import { AsyncLocalStorage } from 'node:async_hooks';
import { globals } from '../configs/globals.js';

// Keep color/gradient rules stable while an upstream request is in flight.
const commentContext = new AsyncLocalStorage();

export function getCommentTransformConfig() {
  return commentContext.getStore() ?? Object.freeze({
    gradientEnabled: globals.gradientEnabled,
    gradientChance: globals.gradientChance,
    convertColor: globals.convertColor,
    colorPool: globals.colorPool,
    convertTopBottomToScroll: globals.convertTopBottomToScroll,
    revision: globals.commentTransformRevision,
  });
}

export function runWithCommentTransform(task) {
  if (commentContext.getStore()) return task();
  return commentContext.run(getCommentTransformConfig(), task);
}
