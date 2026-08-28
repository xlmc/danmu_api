function colorHex(value) {
  return `#${Number(value).toString(16).padStart(6, '0')}`;
}

function cssForGradient(effect) {
  if (effect?.source?.type !== 'linear') return null;
  const stops = effect.source.stops.map((stop) => `${stop.color}${stop.alpha < 1 ? Math.round(stop.alpha * 255).toString(16).padStart(2, '0') : ''} ${stop.position * 100}%`).join(', ');
  return `linear-gradient(${effect.source.angle}deg, ${stops})`;
}

export function simulateDanmuxPlayer(wire) {
  const legacyAccepted = typeof wire?.p === 'string' && typeof wire?.m === 'string';
  const gradient = wire?.danmux?.effects?.find((effect) => effect?.type === 'gradient' && effect?.target === 'fill');
  const enhancedAccepted = Boolean(gradient);
  return {
    legacyAccepted,
    enhancedAccepted,
    renderMode: enhancedAccepted ? 'gradient' : 'solid',
    text: wire?.m ?? '',
    baseColor: legacyAccepted ? colorHex(Number(wire.p.split(',')[2])) : null,
    cssBackground: cssForGradient(gradient),
  };
}
