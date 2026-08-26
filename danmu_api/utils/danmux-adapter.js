import {
  canonicalizeGradientEffect,
  createDanmuX,
  fromBilibili,
  applyGradient,
  toCompatibilityWire,
  validateGradientEffect,
} from 'danmux';
import { DANMUX_GRADIENT_META } from './danmux-meta.js';

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
    color_v2: comment.color_v2,
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
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : undefined;
}

/** Parse an explicit texture URI/asset ID to portable linear-gradient mapping. */
export function parseDanmuxTextureGradients(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = JSON.parse(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
}

function textureGradientConfig(source, mappings) {
  if (!mappings || !source) return undefined;
  if (source.uri && mappings[source.uri] !== undefined) return mappings[source.uri];
  if (source.assetId && mappings[`asset:${source.assetId}`] !== undefined) return mappings[`asset:${source.assetId}`];
  return undefined;
}

function normalizeNativeTextures(item, mappings, diagnostics, index, { linearOnly = false } = {}) {
  if ((!linearOnly && !mappings) || !Array.isArray(item.effects)) return item;
  let changed = false;
  const effects = [];
  for (const effect of item.effects) {
    if (effect?.type !== 'gradient' || effect.source?.type !== 'texture') {
      effects.push(effect);
      continue;
    }
    changed = true;
    const config = textureGradientConfig(effect.source, mappings);
    if (config === undefined) {
      diagnostics.push({
        code: 'native_texture_dropped',
        message: 'Native texture was omitted because no linear mapping was configured',
        path: `effects.${effect.target}`,
        index,
      });
      continue;
    }
    const candidate = {
      ...effect,
      source: { type: 'linear', angle: config?.angle ?? 0, stops: config?.stops },
    };
    const validation = validateGradientEffect(candidate);
    if (!validation.ok) {
      diagnostics.push(...validation.diagnostics.map((entry) => ({
        ...entry,
        code: `texture_mapping_${entry.code}`,
        index,
      })));
      continue;
    }
    const normalized = canonicalizeGradientEffect(candidate);
    effects.push(normalized);
  }
  if (!changed) return item;
  const recreated = createDanmuX({ ...item, effects });
  if (!recreated.value) {
    diagnostics.push(...(recreated.diagnostics ?? []).map((entry) => ({ ...entry, index })));
    return item;
  }
  return recreated.value;
}

export function convertCommentsToDanmux(danmuData, {
  sourceLabel = 'danmu_api',
  gradientStops,
  gradientAngle = 0,
  textureGradients,
  linearOnly = false,
  applyGradientToAll = true,
} = {}) {
  const comments = Array.isArray(danmuData?.comments) ? danmuData.comments : [];
  const diagnostics = [];
  const converted = [];
  for (let index = 0; index < comments.length; index++) {
    const comment = comments[index];
    const commentSourceLabel = comment.color_v2 !== undefined ? 'dandan' : sourceLabel;
    const parsed = parseComment(comment, String(commentSourceLabel).slice(0, 64) || 'danmu_api');
    diagnostics.push(...(parsed.diagnostics ?? []).map((entry) => ({ ...entry, index })));
    if (!parsed.value) continue;
    let item = normalizeNativeTextures(parsed.value, textureGradients, diagnostics, index, { linearOnly });
    const selectedGradient = comment[DANMUX_GRADIENT_META];
    const stops = selectedGradient
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
