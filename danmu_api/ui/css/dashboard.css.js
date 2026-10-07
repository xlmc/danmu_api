// language=CSS
export const dashboardCssContent = `
/* ==============================================================
   Xdanmu 首页控制台 (Dashboard) 样式
   遵循项目统一设计令牌体系，深度适配明暗模式与七色强调色
   ============================================================== */

/* 主栅格与卡片基础 */
.dash-grid-4 {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 18px;
    margin-bottom: 22px;
}

@media (max-width: 1080px) {
    .dash-grid-4 {
        grid-template-columns: repeat(2, 1fr);
    }
}

@media (max-width: 640px) {
    .dash-grid-4 {
        grid-template-columns: 1fr;
    }
}

.dash-card {
    background: var(--theme-container-bg);
    border: 1px solid var(--theme-border);
    border-radius: var(--app-radius-shell);
    padding: 22px 24px;
    box-shadow: var(--app-shadow-sm);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    transition: all 0.24s var(--app-ease-smooth);
    position: relative;
    overflow: hidden;
}

.dash-card:hover {
    box-shadow: var(--app-shadow-md);
    border-color: rgba(var(--app-primary-rgb), 0.28);
    transform: translateY(-2px);
}

/* 卡片顶部行 */
.dash-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
}

.dash-card-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--theme-muted);
    letter-spacing: 0.02em;
}

.dash-card-pill {
    font-size: 11px;
    font-weight: 700;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--theme-panel-strong);
    color: var(--theme-accent);
}

/* 状态指示点：绿点表示正常，红点表示异常 */
.dash-status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
    transition: all 0.3s ease;
    flex-shrink: 0;
}

.dash-status-dot.normal {
    background-color: #10b981;
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2), 0 0 8px rgba(16, 185, 129, 0.4);
}

.dash-status-dot.abnormal {
    background-color: #ef4444;
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.25), 0 0 8px rgba(239, 68, 68, 0.6);
    animation: dashDotPulse 1.5s infinite;
}

@keyframes dashDotPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(1.15); }
}

/* 卡片中心核心数值区 */
.dash-card-body {
    margin: 8px 0 16px 0;
}

.dash-big-text {
    font-size: 26px;
    font-weight: 900;
    color: var(--theme-text);
    letter-spacing: -0.02em;
    line-height: 1.15;
}

.dash-big-num {
    font-size: 32px;
    font-weight: 900;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: var(--theme-text);
    letter-spacing: -0.03em;
    line-height: 1.1;
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
}

.dash-big-unit {
    font-size: 14px;
    font-weight: 700;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: var(--theme-muted);
}

.dash-sub-line {
    font-size: 12px;
    margin-top: 6px;
    color: var(--theme-muted);
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
}

.dash-trend-up {
    color: #10b981;
    font-weight: 700;
}

/* 延迟悬浮 Tooltip 容器 */
.dash-latency-trigger {
    display: inline-flex;
    align-items: baseline;
    cursor: help;
    position: relative;
    border-radius: 8px;
    padding: 2px 4px;
    margin: -2px -4px;
    transition: background 0.2s ease;
}

.dash-latency-trigger:hover {
    background: var(--theme-panel-strong);
}

.dash-latency-tooltip {
    visibility: hidden;
    opacity: 0;
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%) translateY(4px);
    background: #1e1e24;
    color: #f7f3ff;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 11px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-weight: 500;
    white-space: nowrap;
    z-index: 99;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
    pointer-events: none;
    transition: all 0.2s cubic-bezier(0.2, 0.9, 0.3, 1);
}

.dash-latency-tooltip::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    margin-left: -5px;
    border-width: 5px;
    border-style: solid;
    border-color: #1e1e24 transparent transparent transparent;
}

.dash-latency-trigger:hover .dash-latency-tooltip {
    visibility: visible;
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}

body[data-color-scheme="dark"] .dash-latency-tooltip {
    background: #2e303b;
    border: 1px solid rgba(255, 255, 255, 0.12);
}
body[data-color-scheme="dark"] .dash-latency-tooltip::after {
    border-color: #2e303b transparent transparent transparent;
}

/* 卡片底部辅助行 */
.dash-card-footer {
    border-top: 1px solid var(--theme-border);
    padding-top: 12px;
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: var(--theme-muted);
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.dash-card-btn {
    background: transparent;
    border: none;
    color: var(--theme-accent);
    font-weight: 700;
    cursor: pointer;
    font-size: 11px;
    padding: 0;
    transition: opacity 0.2s ease;
}

.dash-card-btn:hover {
    opacity: 0.8;
    text-decoration: underline;
}

/* ==============================================================
   请求趋势模块 (Request Trend Chart)
   ============================================================== */
.dash-trend-section {
    background: var(--theme-container-bg);
    border: 1px solid var(--theme-border);
    border-radius: var(--app-radius-shell);
    padding: 24px 28px;
    box-shadow: var(--app-shadow-sm);
    margin-bottom: 22px;
    transition: all 0.24s var(--app-ease-smooth);
}

.dash-trend-section:hover {
    box-shadow: var(--app-shadow-md);
}

.dash-trend-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18px;
    flex-wrap: wrap;
    gap: 12px;
}

.dash-trend-title-box {
    display: flex;
    align-items: baseline;
    gap: 14px;
}

.dash-trend-title {
    font-size: 17px;
    font-weight: 800;
    color: var(--theme-text);
    margin: 0;
}

.dash-trend-summary-text {
    font-size: 12px;
    color: var(--theme-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.dash-trend-controls {
    display: flex;
    gap: 4px;
    background: var(--theme-panel-strong);
    padding: 3px;
    border-radius: 999px;
}

.dash-trend-tab-btn {
    border: none;
    background: transparent;
    padding: 5px 14px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    color: var(--theme-muted);
    cursor: pointer;
    transition: all 0.2s ease;
}

.dash-trend-tab-btn.active {
    background: var(--theme-container-bg);
    color: var(--theme-text);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

/* 图表悬浮信息详情条 */
.dash-chart-tooltip-bar {
    min-height: 22px;
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: var(--theme-muted);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.dash-chart-tooltip-bar strong {
    color: var(--theme-text);
}

/* 趋势柱状图容器 */
.dash-chart-container {
    height: 180px;
    width: 100%;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding-top: 16px;
    position: relative;
    border-bottom: 1px solid var(--theme-border);
}

.dash-chart-bar-wrap {
    flex: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    position: relative;
    cursor: pointer;
}

.dash-chart-bar {
    width: 100%;
    max-width: 32px;
    border-radius: 8px 8px 3px 3px;
    background: linear-gradient(180deg, rgba(var(--app-primary-rgb), 0.75) 0%, rgba(var(--app-primary-rgb), 0.35) 100%);
    transition: all 0.2s cubic-bezier(0.2, 0.9, 0.3, 1);
    min-height: 4px;
}

.dash-chart-bar-wrap:hover .dash-chart-bar,
.dash-chart-bar.peak {
    background: linear-gradient(180deg, var(--theme-accent) 0%, rgba(var(--app-primary-rgb), 0.8) 100%);
    box-shadow: 0 2px 10px rgba(var(--app-primary-rgb), 0.35);
    transform: scaleY(1.03);
}

.dash-chart-axis-x {
    display: flex;
    justify-content: space-between;
    padding-top: 8px;
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: var(--theme-muted);
}
`;
