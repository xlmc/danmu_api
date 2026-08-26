const apiUrl = document.getElementById('apiUrl');
const sampleButton = document.getElementById('sampleButton');
const fetchButton = document.getElementById('fetchButton');
const status = document.getElementById('status');
const summary = document.getElementById('summary');
const perfSummary = document.getElementById('perfSummary');
const comments = document.getElementById('comments');
const rawOutput = document.getElementById('rawOutput');
const textureCache = new Map();
let renderMetrics = null;

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
  return `<span class="native-bili-text"><canvas class="native-bili-canvas" data-fill-uri="${escapeHtml(fillUrl ?? '')}" data-stroke-uri="${escapeHtml(strokeUrl ?? '')}" data-text="${escapeHtml(text)}" aria-label="${escapeHtml(text)}"></canvas></span>`;
}

function standardGradientMarkup(effects, text) {
  const fill = effects.find((effect) => effect.target === 'fill' && effect.source?.type === 'linear');
  const stroke = effects.find((effect) => effect.target === 'stroke' && effect.source?.type === 'linear');
  if (!fill && !stroke) return null;
  return `<canvas class="standard-gradient-canvas" data-fill-effect="${escapeHtml(JSON.stringify(fill?.source ?? null))}" data-stroke-effect="${escapeHtml(JSON.stringify(stroke?.source ?? null))}" data-text="${escapeHtml(text)}" aria-label="${escapeHtml(text)}"></canvas>`;
}

function loadTexture(uri) {
  if (textureCache.has(uri)) return textureCache.get(uri);
  const promise = new Promise((resolve) => {
    const started = performance.now();
    if (!uri) {
      resolve({ image: null, duration: 0, failed: false });
      return;
    }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve({ image, duration: performance.now() - started, failed: false });
    image.onerror = () => resolve({ image: null, duration: performance.now() - started, failed: true });
    image.src = uri;
  });
  textureCache.set(uri, promise);
  return promise;
}

function measureCanvas(canvas) {
  const text = canvas.dataset.text ?? '';
  const font = '700 17px Inter, ui-sans-serif, system-ui, sans-serif';
  const measureCanvas = document.createElement('canvas');
  const measureContext = measureCanvas.getContext('2d');
  measureContext.font = font;
  return { text, font, width: Math.max(80, Math.ceil(measureContext.measureText(text).width + 10)), height: 30 };
}

function updatePerformanceSummary() {
  if (!renderMetrics) return;
  const nativeLoad = renderMetrics.textureLoaded || renderMetrics.textureFailures ? `${renderMetrics.textureLoadMs.toFixed(1)}ms${renderMetrics.textureFailures ? '（失败）' : ''}` : '加载中';
  const nativeState = renderMetrics.textureFailures ? `失败 ${renderMetrics.textureFailures}，使用回退` : `${renderMetrics.textureLoaded}/${renderMetrics.textureRequests} 已加载`;
  const warning = renderMetrics.textureFailures ? '<span>注意：原生纹理未下载成功，原生列当前不是有效的真实纹理性能结果</span>' : '';
  perfSummary.innerHTML = `<span>性能基线：<strong>p/m 单色</strong>（无纹理）</span><span>原生 texture：<strong>${nativeState}</strong>，加载 ${nativeLoad}，绘制 ${renderMetrics.nativeDrawMs.toFixed(2)}ms</span><span>标准 linear：<strong>${renderMetrics.linearStops} stops</strong>，绘制 ${renderMetrics.standardDrawMs.toFixed(2)}ms，无图片下载</span>${warning}`;
}

function drawNativeCanvas(canvas, fillImage, strokeImage) {
  const started = performance.now();
  const { text, font, width, height } = measureCanvas(canvas);
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');
  context.scale(pixelRatio, pixelRatio);
  context.font = font;
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  const fallbackStroke = context.createLinearGradient(0, 0, width, 0);
  fallbackStroke.addColorStop(0, '#f2509e');
  fallbackStroke.addColorStop(0.5, '#8671b9');
  fallbackStroke.addColorStop(1, '#308bcd');
  context.lineWidth = 4;
  context.strokeStyle = strokeImage ? context.createPattern(strokeImage, 'repeat') : fallbackStroke;
  context.fillStyle = fillImage ? context.createPattern(fillImage, 'repeat') : '#ffffff';
  context.strokeText(text, 5, height / 2);
  context.fillText(text, 5, height / 2);
  return performance.now() - started;
}

function addStops(gradient, source) {
  if (!source?.stops?.length) return false;
  source.stops.forEach((stop) => {
    const alpha = stop.alpha === undefined || stop.alpha >= 1 ? '' : Math.round(stop.alpha * 255).toString(16).padStart(2, '0');
    gradient.addColorStop(stop.position, `${stop.color}${alpha}`);
  });
  return true;
}

function drawStandardCanvas(canvas) {
  const started = performance.now();
  const { text, font, width, height } = measureCanvas(canvas);
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');
  context.scale(pixelRatio, pixelRatio);
  context.font = font;
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  const fillSource = JSON.parse(canvas.dataset.fillEffect || 'null');
  const strokeSource = JSON.parse(canvas.dataset.strokeEffect || 'null');
  const fillGradient = context.createLinearGradient(0, 0, width, 0);
  const strokeGradient = context.createLinearGradient(0, 0, width, 0);
  addStops(fillGradient, fillSource);
  addStops(strokeGradient, strokeSource);
  context.lineWidth = 4;
  context.strokeStyle = strokeSource ? strokeGradient : '#ffffff';
  context.fillStyle = fillSource ? fillGradient : '#ffffff';
  context.strokeText(text, 5, height / 2);
  context.fillText(text, 5, height / 2);
  renderMetrics.linearStops += (fillSource?.stops?.length ?? 0) + (strokeSource?.stops?.length ?? 0);
  return performance.now() - started;
}

function renderNativeCanvases() {
  renderMetrics = { nativeDrawMs: 0, standardDrawMs: 0, textureRequests: 0, textureLoaded: 0, textureLoadMs: 0, textureFailures: 0, linearStops: 0, textureSeen: new Set(), textureSettled: new Set() };
  document.querySelectorAll('.native-bili-canvas').forEach((canvas) => {
    renderMetrics.nativeDrawMs += drawNativeCanvas(canvas, null, null);
    const sources = [canvas.dataset.fillUri, canvas.dataset.strokeUri];
    const newUrls = sources.filter((uri) => uri && !renderMetrics.textureSeen.has(uri));
    newUrls.forEach((uri) => renderMetrics.textureSeen.add(uri));
    renderMetrics.textureRequests += newUrls.length;
    Promise.all(sources.map(loadTexture))
      .then(([fillResult, strokeResult]) => {
        sources.forEach((uri, index) => {
          if (!uri || renderMetrics.textureSettled.has(uri)) return;
          renderMetrics.textureSettled.add(uri);
          const result = [fillResult, strokeResult][index];
          if (result.image) renderMetrics.textureLoaded += 1;
          if (result.failed) renderMetrics.textureFailures += 1;
        renderMetrics.textureLoadMs += result.duration;
        });
        renderMetrics.nativeDrawMs += drawNativeCanvas(canvas, fillResult.image, strokeResult.image);
        const label = canvas.closest('.render-box')?.querySelector('.render-label');
        if (label && (fillResult.failed || strokeResult.failed)) label.textContent = 'texture ⚠ · 下载失败，显示回退';
        if (label && !fillResult.failed && !strokeResult.failed) label.textContent = 'texture ✓ · 已下载并绘制';
        updatePerformanceSummary();
      });
  });
  document.querySelectorAll('.standard-gradient-canvas').forEach((canvas) => {
    renderMetrics.standardDrawMs += drawStandardCanvas(canvas);
  });
  updatePerformanceSummary();
}

function renderComment(nativeComment, portableComment = nativeComment) {
  const nativeEffects = Array.isArray(nativeComment.danmux?.effects) ? nativeComment.danmux.effects : [];
  const portableEffects = Array.isArray(portableComment?.danmux?.effects) ? portableComment.danmux.effects : [];
  const text = nativeComment.m ?? '';
  const nativeMarkup = nativeTextureMarkup(nativeEffects, text);
  const standardMarkup = standardGradientMarkup(portableEffects, text);
  const nativeLabel = nativeMarkup ? 'texture ✓ · 原生纹理' : 'texture —';
  const standardLabel = standardMarkup ? 'linear ✓ · 上游 stops' : 'linear —';
  return `<article class="comment"><span class="comment-time">${escapeHtml(nativeComment.p?.split(',')[0] ?? '-')}s</span><div class="render-box solid"><span class="render-label">p / m 单色</span><span class="render-text" style="color:${colorFromP(nativeComment.p)}">${escapeHtml(text)}</span></div><div class="render-box enhanced"><span class="render-label">${nativeLabel}</span>${nativeMarkup ?? '<span class="hint">播放器不支持纹理</span>'}</div><div class="render-box enhanced"><span class="render-label">${standardLabel}</span>${standardMarkup ?? '<span class="hint">上游未提供 stops</span>'}</div></article>`;
}

function renderPayload(payload, { noCommentsResponse = false, source = 'danmu_api' } = {}) {
  const items = Array.isArray(payload.comments) ? payload.comments.slice(0, 10) : [];
  const nativeItems = Array.isArray(payload.comparison?.nativeComments) ? payload.comparison.nativeComments.slice(0, 10) : items;
  const portableItems = Array.isArray(payload.comparison?.portableComments) ? payload.comparison.portableComments.slice(0, 10) : items;
  const enhancedCount = items.filter((comment) => comment.danmux?.effects?.some((effect) => effect.type === 'gradient')).length;
  comments.innerHTML = nativeItems.length ? nativeItems.map((comment, index) => renderComment(comment, portableItems[index])).join('') : '<p class="hint">没有返回弹幕</p>';
  renderNativeCanvases();
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
