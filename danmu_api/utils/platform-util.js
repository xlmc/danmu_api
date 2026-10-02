// 项目内统一使用源名称；旧平台名仅在输入边界作为别名接受。
export const PLATFORM_ALIASES = Object.freeze({ qq: 'tencent', qiyi: 'iqiyi', bilibili1: 'bilibili' });

export function canonicalPlatformName(value) {
  const name = String(value ?? '').trim();
  return PLATFORM_ALIASES[name.toLowerCase()] || name;
}

export function canonicalPlatformGroup(value) {
  return [...new Set(String(value ?? '').split(/[&＆]/).map(canonicalPlatformName).filter(Boolean))].join('&');
}

export function canonicalPlatformTitle(value) {
  return String(value ?? '').replace(/【([^】]+)】/g, (tag, names) => {
    const canonical = canonicalPlatformGroup(names);
    return canonical === names ? tag : `【${canonical}】`;
  });
}
