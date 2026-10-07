// language=JavaScript
export const dashboardJsContent = `
/* ==============================================================
   Xdanmu 首页控制台 (Dashboard) 交互逻辑
   ============================================================== */

(function() {
    // 趋势图仿真数据集
    const HOURLY_DATA = [
        { hour: '00:00', req: 310, ep: 18, danmu: 2.1, miss: 4, hitRate: 98.7 },
        { hour: '01:00', req: 180, ep: 10, danmu: 1.2, miss: 2, hitRate: 98.9 },
        { hour: '02:00', req: 120, ep: 6,  danmu: 0.8, miss: 1, hitRate: 99.2 },
        { hour: '03:00', req: 95,  ep: 4,  danmu: 0.5, miss: 1, hitRate: 98.9 },
        { hour: '04:00', req: 70,  ep: 3,  danmu: 0.4, miss: 0, hitRate: 100.0 },
        { hour: '05:00', req: 110, ep: 5,  danmu: 0.7, miss: 1, hitRate: 99.1 },
        { hour: '06:00', req: 240, ep: 14, danmu: 1.6, miss: 3, hitRate: 98.8 },
        { hour: '07:00', req: 520, ep: 31, danmu: 3.8, miss: 7, hitRate: 98.7 },
        { hour: '08:00', req: 980, ep: 62, danmu: 7.2, miss: 11, hitRate: 98.9 },
        { hour: '09:00', req: 1120, ep: 70, danmu: 8.5, miss: 14, hitRate: 98.8 },
        { hour: '10:00', req: 1140, ep: 74, danmu: 8.9, miss: 12, hitRate: 98.9 },
        { hour: '11:00', req: 1350, ep: 89, danmu: 11.2, miss: 15, hitRate: 98.9 },
        { hour: '12:00', req: 1280, ep: 85, danmu: 10.6, miss: 13, hitRate: 99.0 },
        { hour: '13:00', req: 1190, ep: 78, danmu: 9.8, miss: 11, hitRate: 99.1 },
        { hour: '14:00', req: 1220, ep: 80, danmu: 10.1, miss: 12, hitRate: 99.0 },
        { hour: '15:00', req: 1310, ep: 88, danmu: 11.5, miss: 14, hitRate: 98.9 },
        { hour: '16:00', req: 1560, ep: 105, danmu: 13.8, miss: 16, hitRate: 99.0 },
        { hour: '17:00', req: 1890, ep: 128, danmu: 16.5, miss: 19, hitRate: 99.0 },
        { hour: '18:00', req: 2320, ep: 160, danmu: 20.4, miss: 22, hitRate: 99.1 },
        { hour: '19:00', req: 2580, ep: 182, danmu: 23.2, miss: 24, hitRate: 99.1 },
        { hour: '20:00', req: 2310, ep: 164, danmu: 20.8, miss: 21, hitRate: 99.1 },
        { hour: '21:00', req: 1620, ep: 115, danmu: 14.6, miss: 15, hitRate: 99.1 },
        { hour: '22:00', req: 980,  ep: 68, danmu: 8.9, miss: 9, hitRate: 99.1 },
        { hour: '23:00', req: 450,  ep: 28, danmu: 3.8, miss: 4, hitRate: 99.1 }
    ];

    const DAILY_DATA = [
        { label: '周一', req: 22100, ep: 1520, danmu: 186.5, miss: 210, hitRate: 99.0 },
        { label: '周二', req: 23450, ep: 1610, danmu: 198.2, miss: 230, hitRate: 99.0 },
        { label: '周三', req: 24850, ep: 1698, danmu: 210.3, miss: 248, hitRate: 99.0 },
        { label: '周四', req: 21800, ep: 1480, danmu: 182.1, miss: 205, hitRate: 99.1 },
        { label: '周五', req: 26900, ep: 1840, danmu: 228.6, miss: 260, hitRate: 99.0 },
        { label: '周六', req: 31200, ep: 2150, danmu: 265.4, miss: 302, hitRate: 99.0 },
        { label: '周日', req: 29800, ep: 2040, danmu: 252.0, miss: 288, hitRate: 99.0 }
    ];

    let currentTrendMode = 'hourly';

    // 渲染趋势柱状图
    window.renderDashboardTrend = function(mode) {
        if (mode) currentTrendMode = mode;
        const container = document.getElementById('dash-trend-bars');
        const axisX = document.getElementById('dash-trend-axis');
        const infoBar = document.getElementById('dash-chart-info');
        if (!container || !axisX) return;

        // 更新按钮激活态
        document.querySelectorAll('.dash-trend-tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === currentTrendMode);
        });

        const data = currentTrendMode === 'hourly' ? HOURLY_DATA : DAILY_DATA;
        const maxReq = Math.max(...data.map(d => d.req));

        container.innerHTML = '';
        axisX.innerHTML = '';

        data.forEach((d) => {
            const barWrap = document.createElement('div');
            barWrap.className = 'dash-chart-bar-wrap';

            const heightPct = Math.max(8, Math.round((d.req / maxReq) * 100));
            const bar = document.createElement('div');
            bar.className = 'dash-chart-bar' + (d.req === maxReq ? ' peak' : '');
            bar.style.height = heightPct + '%';

            barWrap.appendChild(bar);

            // 悬浮事件
            barWrap.addEventListener('mouseenter', () => {
                if (infoBar) {
                    const timeLabel = currentTrendMode === 'hourly' ? d.hour : d.label;
                    infoBar.innerHTML = '<strong>' + timeLabel + '</strong> · <span>' +
                        d.req.toLocaleString() + ' 次请求</span> · <span>' +
                        d.ep + ' 集弹幕</span> · <span>' +
                        d.danmu + ' 万条弹幕</span> · <span>回源 ' +
                        d.miss + '</span> · <span style="color:#10b981;font-weight:700;">命中率 ' +
                        d.hitRate + '%</span>';
                }
            });

            container.appendChild(barWrap);
        });

        // X轴刻度
        if (currentTrendMode === 'hourly') {
            const ticks = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '23:00'];
            ticks.forEach(t => {
                const s = document.createElement('span');
                s.textContent = t.split(':')[0];
                axisX.appendChild(s);
            });
        } else {
            DAILY_DATA.forEach(d => {
                const s = document.createElement('span');
                s.textContent = d.label;
                axisX.appendChild(s);
            });
        }

        // 默认显示峰值时段信息
        const peakItem = data.reduce((max, cur) => cur.req > max.req ? cur : max, data[0]);
        if (infoBar && peakItem) {
            const timeLabel = currentTrendMode === 'hourly' ? peakItem.hour : peakItem.label;
            infoBar.innerHTML = '<strong>' + timeLabel + ' (峰值)</strong> · <span>' +
                peakItem.req.toLocaleString() + ' 次请求</span> · <span>' +
                peakItem.ep + ' 集弹幕</span> · <span>' +
                peakItem.danmu + ' 万条弹幕</span> · <span>回源 ' +
                peakItem.miss + '</span> · <span style="color:#10b981;font-weight:700;">命中率 ' +
                peakItem.hitRate + '%</span>';
        }
    };

    // 复制 API 端点
    window.copyDashboardEndpoint = function() {
        if (typeof copyApiEndpoint === 'function') {
            copyApiEndpoint();
            return;
        }
        const endpoint = window.location.origin + '/' + (window.originalToken || '');
        navigator.clipboard.writeText(endpoint).then(() => {
            if (typeof customAlert === 'function') {
                customAlert('API 端点已复制到剪贴板：\\n' + endpoint, '复制成功');
            } else {
                alert('API 端点已复制：' + endpoint);
            }
        });
    };

    // 健康检查与右上角指示灯（绿点表示正常，红点表示异常）
    async function checkDashboardHealth() {
        const dot = document.getElementById('dash-service-dot');
        const text = document.getElementById('dash-service-text');
        try {
            const res = await fetch('/api/config');
            if (res.ok) {
                if (dot) {
                    dot.className = 'dash-status-dot normal';
                    dot.title = '服务正常运行';
                }
                if (text) text.textContent = '服务正常';
            } else {
                if (dot) {
                    dot.className = 'dash-status-dot abnormal';
                    dot.title = '服务响应异常 (HTTP ' + res.status + ')';
                }
                if (text) text.textContent = '服务异常';
            }
        } catch (e) {
            if (dot) {
                dot.className = 'dash-status-dot abnormal';
                dot.title = '服务连接失败';
            }
            if (text) text.textContent = '服务不可用';
        }
    }

    // 动态端口与初始化
    function initDashboard() {
        const portSpan = document.getElementById('dash-port-val');
        if (portSpan) {
            portSpan.textContent = window.location.port || '9321';
        }

        checkDashboardHealth();
        setInterval(checkDashboardHealth, 10000);

        window.renderDashboardTrend('hourly');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDashboard);
    } else {
        initDashboard();
    }
})();
`;
