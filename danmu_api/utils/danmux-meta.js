// Internal selection metadata. JSON writers explicitly emit the optional
// DanmuX extension; XML and other formats keep their single-color fallback.
export const DANMUX_GRADIENT_META = Symbol('danmux-gradient-meta');

export function copyDanmuxGradientMeta(source, target) {
  const descriptor = Object.getOwnPropertyDescriptor(source, DANMUX_GRADIENT_META);
  if (descriptor) Object.defineProperty(target, DANMUX_GRADIENT_META, descriptor);
  return target;
}
