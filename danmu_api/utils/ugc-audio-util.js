import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';

// Radix-2 FFT; shared by spectral discovery and sample-level offset refinement.
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len *= 2) {
    const a = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let xr = 1, xi = 0;
      for (let j = 0; j < len / 2; j++) {
        const p = i + j, q = p + len / 2;
        const r = re[q] * xr - im[q] * xi, s = re[q] * xi + im[q] * xr;
        re[q] = re[p] - r; im[q] = im[p] - s; re[p] += r; im[p] += s;
        const next = xr * wr - xi * wi; xi = xr * wi + xi * wr; xr = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function features(samples, sr) {
  const hop = sr / 4, window = sr / 2, bands = 16;
  const size = 2 ** Math.ceil(Math.log2(window));
  const rows = [], mean = new Float64Array(bands), variance = new Float64Array(bands);
  for (let start = 0; start + window <= samples.length; start += hop) {
    const re = new Float64Array(size), im = new Float64Array(size);
    for (let j = 0; j < window; j++) re[j] = samples[start + j] * (.5 - .5 * Math.cos(2 * Math.PI * j / (window - 1)));
    fft(re, im);
    const row = new Float64Array(bands);
    for (let b = 0; b < bands; b++) {
      const lo = Math.ceil(100 * (sr * .475 / 100) ** (b / bands) * size / sr);
      const hi = Math.ceil(100 * (sr * .475 / 100) ** ((b + 1) / bands) * size / sr);
      let sum = 0;
      for (let k = lo; k < hi; k++) sum += re[k] ** 2 + im[k] ** 2;
      row[b] = Math.log1p(sum / Math.max(1, hi - lo)); mean[b] += row[b];
    }
    rows.push(row);
  }
  if (!rows.length) return rows;
  for (let b = 0; b < bands; b++) mean[b] /= rows.length;
  for (const row of rows) for (let b = 0; b < bands; b++) variance[b] += (row[b] - mean[b]) ** 2;
  for (const row of rows) {
    let norm = 0;
    for (let b = 0; b < bands; b++) { row[b] = (row[b] - mean[b]) / (Math.sqrt(variance[b] / rows.length) + 1e-6); norm += row[b] ** 2; }
    norm = Math.sqrt(norm) + 1e-6;
    for (let b = 0; b < bands; b++) row[b] /= norm;
  }
  return rows;
}

function waveform(ref, candidate, sr, start, rough, duration) {
  const begin = Math.round(start * sr), n = Math.round(duration * sr);
  const left = Math.max(0, Math.round((start + rough - 1) * sr));
  const right = Math.min(candidate.length, Math.round((start + rough + duration + 1) * sr));
  if (begin < 0 || begin + n > ref.length || right - left < n) return null;
  const m = right - left, size = 2 ** Math.ceil(Math.log2(n + m));
  const xr = new Float64Array(size), xi = new Float64Array(size), yr = new Float64Array(size), yi = new Float64Array(size);
  let mean = 0, energy = 0;
  for (let i = 0; i < n; i++) mean += ref[begin + i]; mean /= n;
  for (let i = 0; i < n; i++) { xr[i] = ref[begin + i] - mean; energy += xr[i] ** 2; }
  if (energy < 1e-8) return null;
  const sums = new Float64Array(m + 1), squares = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) { const v = candidate[left + i]; yr[i] = v; sums[i + 1] = sums[i] + v; squares[i + 1] = squares[i] + v * v; }
  fft(xr, xi); fft(yr, yi);
  for (let i = 0; i < size; i++) { const r = yr[i] * xr[i] + yi[i] * xi[i]; yi[i] = yi[i] * xr[i] - yr[i] * xi[i]; yr[i] = r; }
  fft(yr, yi, true);
  let best = -1, lag = 0;
  for (let j = 0; j <= m - n; j++) {
    const sum = sums[j + n] - sums[j];
    const variance = squares[j + n] - squares[j] - sum * sum / n;
    const score = Math.abs(yr[j]) / Math.sqrt(Math.max(variance, 1e-15) * energy);
    if (score > best) { best = score; lag = j; }
  }
  return { start, end: start + duration, correlation: Math.min(1, best), offsetSeconds: (left + lag) / sr - start };
}

export function validateAudioTimeline(reference, candidate, { sampleRate = 2000, duration, maxOffset = 120, threshold = .75, tolerance = .25 } = {}) {
  const requested = duration ?? reference.length / sampleRate;
  const available = reference.length / sampleRate;
  if (!(requested > 0) || requested - available > 3) return { status: 'pending', reason: 'reference-incomplete', requested, available };
  // Container duration includes encoder padding. Verify and clip to decoded audio;
  // never extend acceptance into an interval without reference samples.
  const seconds = Math.floor(Math.min(requested, available) * 4) / 4;
  const rf = features(reference, sampleRate), cf = features(candidate, sampleRate), blocks = [], intervals = [];
  for (let start = 0; start < seconds; start += 20) {
    const span = Math.min(20, seconds - start), i = Math.round(start * 4), count = Math.max(1, Math.floor((span - .5) * 4) + 1);
    if (count < 1 || i + count > rf.length) return { status: 'pending', reason: 'range-too-short', blocks };
    let best = -Infinity, rough = null;
    for (let j = Math.max(0, i - maxOffset * 4); j + count <= cf.length && j <= i + maxOffset * 4; j++) {
      let score = 0;
      for (let k = 0; k < count; k++) for (let b = 0; b < 16; b++) score += rf[i + k][b] * cf[j + k][b];
      if (score / count > best) { best = score / count; rough = (j - i) / 4; }
    }
    const wave = rough === null ? null : waveform(reference, candidate, sampleRate, start, rough, span);
    blocks.push({ start, end: start + span, spectralCorrelation: best, ...wave });
    if (wave?.correlation >= threshold) {
      intervals.push(wave);
    } else {
      for (let t = start; t < start + span; t += 2) {
        const sub = rough === null ? null : waveform(reference, candidate, sampleRate, t, rough, Math.min(2, start + span - t));
        if (sub?.correlation >= threshold) intervals.push(sub);
      }
    }
  }
  const reliable = intervals.filter(v => v && v.correlation >= threshold);
  const minRequired = Math.max(1, Math.floor(blocks.length * 0.7));
  if (reliable.length < minRequired) return { status: 'pending', reason: 'unverified-intervals', blocks, reliableCount: reliable.length, minRequired };
  const offsets = reliable.map(v => v.offsetSeconds).sort((a, b) => a - b);
  if (offsets.length && offsets.at(-1) - offsets[0] > tolerance) return { status: 'rejected', reason: 'variable-offset', blocks, offsetRange: [offsets[0], offsets.at(-1)] };
  return { status: 'verified', offsetSeconds: offsets[Math.floor(offsets.length / 2)], validRange: [0, seconds], blocks };
}

export async function decodeAudio(urls, { seconds, signal, ffmpeg = 'ffmpeg' } = {}) {
  const headers = 'User-Agent: Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36\r\nReferer: https://www.bilibili.com/\r\n';
  for (const url of [...urls].sort((a, b) => Number(a.includes('mcdn')) - Number(b.includes('mcdn')))) {
    signal?.throwIfAborted();
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(ffmpeg, ['-v', 'error', '-rw_timeout', '10000000', '-headers', headers, '-i', url, '-t', String(seconds), '-vn', '-ac', '1', '-ar', '2000', '-f', 'f32le', 'pipe:1'], { windowsHide: true });
        const chunks = []; let bytes = 0; const maxBytes = Math.ceil(seconds * 2000 * 4) + 8192;
        const abort = () => { child.kill(); reject(new Error('audio-aborted')); };
        const timer = setTimeout(abort, 30000);
        signal?.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', data => { bytes += data.length; if (bytes > maxBytes) abort(); else chunks.push(data); });
        child.stderr.resume();
        child.on('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
        child.on('close', code => {
          clearTimeout(timer); signal?.removeEventListener('abort', abort);
          if (code !== 0 || !bytes) { reject(new Error('audio-unavailable')); return; }
          const buf = Buffer.concat(chunks), samples = new Float32Array(Math.floor(buf.length / 4));
          for (let i = 0; i < samples.length; i++) samples[i] = buf.readFloatLE(i * 4);
          resolve(samples);
        });
      });
    } catch (error) { if (signal?.aborted || error.code === 'ENOENT') throw error; }
  }
  throw new Error('audio-unavailable');
}

export function validateAudioInWorker(reference, candidate, options = {}) {
  const { signal, ...settings } = options;
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ugc-audio-worker.js', import.meta.url), {
      workerData: { reference, candidate, settings }, execArgv: [],
    });
    const abort = () => { worker.terminate(); reject(new Error('timeline-aborted')); };
    const timer = setTimeout(abort, 30000);
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    worker.once('message', value => { cleanup(); resolve(value); });
    worker.once('error', error => { cleanup(); reject(error); });
    worker.once('exit', code => { cleanup(); if (code !== 0) reject(new Error('timeline-worker-failed')); });
  });
}
