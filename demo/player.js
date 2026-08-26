const apiUrl = document.getElementById('apiUrl');
const sampleButton = document.getElementById('sampleButton');
const fetchButton = document.getElementById('fetchButton');
const status = document.getElementById('status');
const summary = document.getElementById('summary');
const comments = document.getElementById('comments');
const rawOutput = document.getElementById('rawOutput');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function colorFromP(p) {
  const fields = String(p ?? '').split(',');
  const value = Number(fields.length >= 8 ? fields[3] : fields[2]);
  return Number.isInteger(value) && value >= 0 && value <= 0xffffff ? `#${value.toString(16).padStart(6, '0')}` : '#ffffff';
}

function safeTextureUrl(value) {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function gradientCss(effect) {
  if (effect?.source?.type !== 'linear') return null;
  const stops = effect.source.stops.map((stop) => `${stop.color}${stop.alpha < 1 ? Math.round(stop.alpha * 255).toString(16).padStart(2, '0') : ''} ${stop.position * 100}%`).join(', ');
  return `linear-gradient(${effect.source.angle}deg, ${stops})`;
}

function nativeTextureMarkup(effects, text) {
  const fill = effects.find((effect) => effect.target === 'fill' && effect.source?.type === 'texture');
  const stroke = effects.find((effect) => effect.target === 'stroke' && effect.source?.type === 'texture');
  const fillUrl = safeTextureUrl(fill?.source?.uri);
  const strokeUrl = safeTextureUrl(stroke?.source?.uri);
  if (!fillUrl && !strokeUrl) return null;
  const fillStyle = ` style="background-color:#ffffff;${fillUrl ? `background-image:url('${escapeHtml(fillUrl)}')` : ''}"`;
  const strokeStyle = ` style="background-color:#f2509e;${strokeUrl ? `background-image:url('${escapeHtml(strokeUrl)}')` : ''}"`;
  return `<span class="native-bili-text"><span class="native-bili-layer native-bili-stroke"${strokeStyle}>${escapeHtml(text)}</span><span class="native-bili-layer native-bili-fill"${fillStyle}>${escapeHtml(text)}</span></span>`;
}

function renderComment(comment) {
  const effects = Array.isArray(comment.danmux?.effects) ? comment.danmux.effects : [];
  const effect = effects.find((entry) => entry.type === 'gradient' && entry.target === 'fill');
  const gradient = gradientCss(effect);
  const text = comment.m ?? '';
  const nativeMarkup = nativeTextureMarkup(effects, text);
  const enhancedMarkup = nativeMarkup ?? `<span class="render-text"${gradient ? ` style="background-image:${gradient}"` : ''}>${escapeHtml(text)}</span>`;
  const effectLabel = nativeMarkup ? 'danmux.effects ✓ · B站原生纹理' : `danmux.effects${gradient ? ' ✓ · 人工 linear' : ' —'}`;
  return `<article class="comment"><span class="comment-time">${escapeHtml(comment.p?.split(',')[0] ?? '-')}s</span><div class="render-box solid"><span class="render-label">p / m fallback</span><span class="render-text" style="color:${colorFromP(comment.p)}">${escapeHtml(text)}</span></div><div class="render-box enhanced"><span class="render-label">${effectLabel}</span>${enhancedMarkup}</div></article>`;
}

function renderPayload(payload, { noCommentsResponse = false, source = 'danmu_api' } = {}) {
  const items = Array.isArray(payload.comments) ? payload.comments.slice(0, 10) : [];
  const enhancedCount = items.filter((comment) => comment.danmux?.effects?.some((effect) => effect.type === 'gradient')).length;
  comments.innerHTML = items.length ? items.map(renderComment).join('') : '<p class="hint">没有返回弹幕</p>';
  rawOutput.textContent = JSON.stringify(payload, null, 2);
  summary.innerHTML = `<span>抓取：<strong>${items.length}</strong> 条</span><span>包含 DanmuX 渐变：<strong>${enhancedCount}</strong> 条</span><span>旧播放器可显示：<strong>${items.every((comment) => typeof comment.p === 'string' && typeof comment.m === 'string') ? '是' : '否'}</strong></span>`;
  if (noCommentsResponse) {
    status.textContent = '接口已连接，但这个 commentId 没有弹幕，请换一个真实的 commentId';
    status.className = 'status error';
  } else if (enhancedCount) {
    status.textContent = `${source}：增强播放器已识别渐变`;
    status.className = 'status';
  } else {
    status.textContent = `${source}：当前数据没有 DanmuX 渐变，请检查 format=danmux 和 stops 配置`;
    status.className = 'status error';
  }
}

async function loadData(url, source) {
  status.className = 'status';
  status.textContent = '正在抓取…';
  sampleButton.disabled = true;
  fetchButton.disabled = true;
  try {
    const response = await fetch(url);
    const payload = await response.json();
    const noCommentsResponse = response.status === 404 && Array.isArray(payload.comments) && payload.comments.length === 0;
    if (!response.ok && !noCommentsResponse) throw new Error(`HTTP ${response.status}`);
    renderPayload(payload, { noCommentsResponse, source });
  } catch (error) {
    status.className = 'status error';
    status.textContent = `${source}失败：${error.message}。请确认地址、端口和跨域设置。`;
    comments.innerHTML = '<p class="hint">无法加载</p>';
    summary.textContent = '';
    rawOutput.textContent = JSON.stringify({ error: error.message }, null, 2);
  } finally {
    sampleButton.disabled = false;
    fetchButton.disabled = false;
  }
}

function loadSample() {
  return loadData('/sample', '本地模拟');
}

sampleButton.addEventListener('click', loadSample);
fetchButton.addEventListener('click', () => loadData(apiUrl.value.trim(), '真实 API'));
loadSample();
