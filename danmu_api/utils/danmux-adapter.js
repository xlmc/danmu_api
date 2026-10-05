import {
  createDanmuX,
  fromBilibili,
  applyGradient,
  toCompatibilityWire,
  validateGradientEffect,
  canonicalizeGradientEffect,
} from 'danmux';
import { DANMUX_GRADIENT_META } from './danmux-meta.js';

const NATIVE_GRADIENT_FIELDS = ['color_v2', 'colorV2', 'colorfulSrc', 'colorful_src', 'gradient'];

function hasNativeGradient(comment) {
  return NATIVE_GRADIENT_FIELDS.some((field) => comment?.[field] !== undefined);
}

// Enrich legacy JSON in place structurally, without rebuilding its Base or envelope.
// Return new objects only for selected comments; never mutate cached comments.
export function appendDanmuxGradients(danmuData, { gradientEnabled = false, gradientChance = 0 } = {}) {
  if (!gradientEnabled || gradientChance <= 0 || !Array.isArray(danmuData?.comments)) return danmuData;
  const comments = danmuData.comments.map(comment => {
    const selected = comment?.[DANMUX_GRADIENT_META];
    if (!selected || hasNativeGradient(comment)) return comment;
    try {
      const effect = {
        type: 'gradient', origin: 'generated', target: 'fill',
        source: { type: 'linear', angle: selected.angle, stops: selected.stops },
      };
      if (!validateGradientEffect(effect).ok) return comment;
      return {
        ...comment,
        danmux: { extensionVersion: 1, effects: [canonicalizeGradientEffect(effect)] },
      };
    } catch {
      // Optional effect failure must not discard the comment or fail the response.
      return comment;
    }
  });
  return { ...danmuData, comments };
}

function parseComment(comment, sourceLabel) {
  const fields = String(comment.p ?? '').split(',');
  const xmlProfile = fields.length >= 8;
  const colorIndex = xmlProfile ? 3 : 2;
  const fontSize = xmlProfile ? Number(fields[2]) : 25;
  const result = fromBilibili({
    id: comment.cid ?? `${sourceLabel}:${fields[0] ?? '0'}:${comment.m ?? ''}`,
    time: Number(fields[0]),
    mode: Number(fields[1]),
    fontSize,
    color: fields[colorIndex],
    content: String(comment.m ?? ''),
  });
  if (!result.value) return result;
  const normalized = createDanmuX({
    ...result.value,
    source: { platform: sourceLabel, id: String(comment.cid ?? result.value.id) },
  });
  return {
    ...normalized,
    diagnostics: [...(result.diagnostics ?? []), ...(normalized.diagnostics ?? [])],
  };
}

export function parseDanmuxGradientStops(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function convertCommentsToDanmux(danmuData, {
  sourceLabel = 'danmu_api',
  gradientStops,
  gradientAngle = 0,
  applyGradientToAll = true,
} = {}) {
  const comments = Array.isArray(danmuData?.comments) ? danmuData.comments : [];
  const diagnostics = [];
  const converted = [];
  for (let index = 0; index < comments.length; index++) {
    const comment = comments[index];
    const nativeGradient = hasNativeGradient(comment);
    const commentSourceLabel = sourceLabel;
    const parsed = parseComment(comment, String(commentSourceLabel).slice(0, 64) || 'danmu_api');
    diagnostics.push(...(parsed.diagnostics ?? []).map((entry) => ({ ...entry, index })));
    if (!parsed.value) continue;
    let item = parsed.value;
    const selectedGradient = comment[DANMUX_GRADIENT_META];
    const stops = nativeGradient
      ? undefined
      : selectedGradient
        ? (gradientStops ?? selectedGradient.stops)
        : (applyGradientToAll ? gradientStops : undefined);
    if (stops !== undefined) {
      const generated = applyGradient(item, { angle: selectedGradient?.angle ?? gradientAngle, stops });
      diagnostics.push(...(generated.diagnostics ?? []).map((entry) => ({ ...entry, index })));
      item = generated.value ?? item;
    }
    const wire = toCompatibilityWire(item);
    converted.push({
      ...wire,
      ...(comment.cid !== undefined ? { cid: comment.cid } : {}),
      ...(comment.like !== undefined ? { like: comment.like } : {}),
    });
  }
  return {
    format: 'danmux',
    schemaVersion: 1,
    count: converted.length,
    comments: converted,
    diagnostics,
  };
}
