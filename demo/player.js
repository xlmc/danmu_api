const apiUrl = document.getElementById('apiUrl');
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

function gradientCss(effect) {
  if (effect?.source?.type !== 'linear') return null;
  const stops = effect.source.stops.map((stop) => `${stop.color}${stop.alpha < 1 ? Math.round(stop.alpha * 255).toString(16).padStart(2, '0') : ''} ${stop.position * 100}%`).join(', ');
  return `linear-gradient(${effect.source.angle}deg, ${stops})`;
}

function renderComment(comment) {
  const effect = comment.danmux?.effects?.find((entry) => entry.type === 'gradient' && entry.target === 'fill');
  const gradient = gradientCss(effect);
  const enhancedStyle = gradient ? ` style="background-image:${gradient}"` : '';
  return `<article class="comment"><span class="comment-time">${escapeHtml(comment.p?.split(',')[0] ?? '-')}s</span><div class="render-box solid"><span class="render-label">p / m fallback</span><span class="render-text" style="color:${colorFromP(comment.p)}">${escapeHtml(comment.m ?? '')}</span></div><div class="render-box enhanced"><span class="render-label">danmux.effects${gradient ? ' ✓' : ' —'}</span><span class="render-text"${enhancedStyle}>${escapeHtml(comment.m ?? '')}</span></div></article>`;
}

async function fetchComments() {
  status.className = 'status';
  status.textContent = '正在抓取…';
  fetchButton.disabled = true;
  try {
    const response = await fetch(apiUrl.value.trim());
    const payload = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const items = Array.isArray(payload.comments) ? payload.comments.slice(0, 10) : [];
    const enhancedCount = items.filter((comment) => comment.danmux?.effects?.some((effect) => effect.type === 'gradient')).length;
    comments.innerHTML = items.length ? items.map(renderComment).join('') : '<p class="hint">没有返回弹幕</p>';
    rawOutput.textContent = JSON.stringify(payload, null, 2);
    summary.innerHTML = `<span>抓取：<strong>${items.length}</strong> 条</span><span>包含 DanmuX 渐变：<strong>${enhancedCount}</strong> 条</span><span>旧播放器可显示：<strong>${items.every((comment) => typeof comment.p === 'string' && typeof comment.m === 'string') ? '是' : '否'}</strong></span>`;
    status.textContent = enhancedCount ? '抓取成功：增强播放器已识别渐变' : '抓取成功：当前数据没有 DanmuX 渐变，请检查 format=danmux 和 stops 配置';
    if (!enhancedCount) status.className = 'status error';
  } catch (error) {
    status.className = 'status error';
    status.textContent = `抓取失败：${error.message}。请确认 danmu_api 已启动且允许跨域访问。`;
    comments.innerHTML = '<p class="hint">无法加载</p>';
    summary.textContent = '';
    rawOutput.textContent = JSON.stringify({ error: error.message }, null, 2);
  } finally {
    fetchButton.disabled = false;
  }
}

fetchButton.addEventListener('click', fetchComments);
fetchComments();
