// language=JavaScript
export const dashboardJsContent = `
(function() {
    let dashboardData = null;
    let currentTrendMode = 'hourly';
    let loading = false;
    const number = value => value === null ? '—' : value.toLocaleString();
    const setText = (id, value) => { document.getElementById(id).textContent = value; };

    function describePoint(point) {
        if (!point.collected) return point.label + ' · 未采集';
        return point.label + ' · ' + number(point.requests) + ' 次请求 · ' +
            number(point.responses) + ' 次非空弹幕响应 · ' + number(point.comments) +
            ' 条弹幕 · 缓存命中 / 未命中 ' + number(point.hits) + ' / ' + number(point.misses) +
            ' · 命中率 ' + (point.hitRate === null ? '暂无查询' : point.hitRate + '%');
    }

    window.renderDashboardTrend = function(mode) {
        if (mode) currentTrendMode = mode;
        document.querySelectorAll('.dash-trend-tab-btn').forEach(button => {
            button.classList.toggle('active', button.dataset.mode === currentTrendMode);
        });
        const container = document.getElementById('dash-trend-bars');
        const axis = document.getElementById('dash-trend-axis');
        container.replaceChildren();
        axis.replaceChildren();
        if (!dashboardData) return;
        const data = dashboardData[currentTrendMode];
        const max = Math.max(0, ...data.map(point => point.requests));
        const peak = data.find(point => point.collected && point.requests === max);
        setText('dash-chart-info', peak ? describePoint(peak) : '暂无采集数据');
        data.forEach((point, index) => {
            const wrap = document.createElement('div');
            wrap.className = 'dash-chart-bar-wrap';
            wrap.tabIndex = 0;
            wrap.setAttribute('aria-label', describePoint(point));
            const bar = document.createElement('div');
            bar.className = 'dash-chart-bar' + (max > 0 && point.requests === max ? ' peak' : '');
            bar.style.height = (max ? point.requests / max * 100 : 0) + '%';
            bar.style.minHeight = '0';
            wrap.appendChild(bar);
            wrap.addEventListener('mouseenter', () => setText('dash-chart-info', describePoint(point)));
            wrap.addEventListener('focus', () => setText('dash-chart-info', describePoint(point)));
            container.appendChild(wrap);
            if (currentTrendMode === 'daily' || index % 4 === 0 || index === data.length - 1) {
                const tick = document.createElement('span');
                tick.textContent = point.label;
                axis.appendChild(tick);
            }
        });
    };

    window.copyDashboardEndpoint = function() {
        copyApiEndpoint();
    };

    async function loadDashboard() {
        if (loading) return;
        loading = true;
        const dot = document.getElementById('dash-service-dot');
        try {
            const response = await fetch(buildApiUrl('/api/dashboard', true), {
                cache: 'no-store', signal: AbortSignal.timeout(8000)
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const data = await response.json();
            if (!data.today || !Array.isArray(data.hourly) || !Array.isArray(data.daily) || !data.latency) {
                throw new Error('统计接口返回格式错误');
            }
            dashboardData = data;
            dot.className = 'dash-status-dot normal';
            dot.title = '统计接口正常';
            setText('dash-service-text', '服务正常');
            setText('dash-port-val', window.location.port || (window.location.protocol === 'https:' ? '443' : '80'));
            setText('dash-latency', number(data.latency.average));
            setText('dash-latency-detail', '播放器请求耗时 · 最近 ' + data.latency.samples +
                ' 个样本 · P95: ' + number(data.latency.p95) + 'ms · P99: ' + number(data.latency.p99) + 'ms');
            const minutes = Math.floor(data.uptimeSeconds / 60);
            setText('dash-uptime', '在线时长: ' + Math.floor(minutes / 1440) + '天 ' +
                Math.floor(minutes % 1440 / 60) + '小时 ' + minutes % 60 + '分');
            setText('dash-requests', number(data.today.requests));
            setText('dash-since', '播放器接口请求，含失败响应');
            setText('dash-peak', '今日峰值吞吐: ' + number(data.today.peakRps) + ' req/s');
            setText('dash-comments', number(data.today.comments) + ' 条');
            setText('dash-responses', '成功非空弹幕响应: ' + number(data.today.responses) + ' 次');
            setText('dash-hit-rate', data.today.hitRate === null ? '暂无查询' : data.today.hitRate + '%');
            setText('dash-cache-counts', '命中 / 未命中: ' + number(data.today.hits) + ' / ' + number(data.today.misses));
            const since = new Date(data.startedAt).toLocaleString('zh-CN', { timeZone: data.timezone });
            setText('dash-coverage', '统计自 ' + since + '（' + data.timezone + '）开始，重启清零；最多保留近 7 天。刷新于 ' +
                new Date(data.serverTime).toLocaleTimeString() + '。');
            window.renderDashboardTrend();
        } catch (error) {
            dashboardData = null;
            dot.className = 'dash-status-dot abnormal';
            dot.title = error.message;
            setText('dash-service-text', '统计不可用');
            for (const id of ['dash-latency', 'dash-requests', 'dash-comments', 'dash-hit-rate']) setText(id, '—');
            setText('dash-latency-detail', '暂无有效耗时数据');
            setText('dash-uptime', '在线时长: —');
            setText('dash-since', '等待统计数据');
            setText('dash-peak', '峰值吞吐: —');
            setText('dash-responses', '成功非空弹幕响应: —');
            setText('dash-cache-counts', '命中 / 未命中: —');
            setText('dash-coverage', '统计加载失败：' + error.message + '，10 秒后重试。');
            window.renderDashboardTrend();
            setText('dash-chart-info', '暂无有效统计数据');
        } finally {
            loading = false;
        }
    }

    function initDashboard() {
        loadDashboard();
        setInterval(loadDashboard, 10000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDashboard);
    else initDashboard();
})();
`;
