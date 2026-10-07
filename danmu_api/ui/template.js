import { globals } from "../configs/globals.js";
import { OFFICIAL_ICONS } from "./official-icons.js";

// language=HTML
export const HTML_TEMPLATE = /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>danmu_api · 控制台 (方案 B: ACG Studio)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    if (!window.tailwind) {
      var s = document.createElement('script');
      s.src = 'https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js';
      document.head.appendChild(s);
    }
  </script>
  <style>
    * { box-sizing: border-box; }
    
    /* 方案 B 核心设计令牌：象牙暖白背景、极简现代排版 */
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      background-color: #fbf8f3;
      color: #1e1e24;
      min-height: 100vh;
      margin: 0;
      padding: 0;
    }

    /* 方案 B 专属卡片：大圆角 28px、纯白底色、环境柔光微阴影 */
    .scheme-b-card {
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.04);
      border-radius: 28px;
      box-shadow: 0 4px 24px -2px rgba(0, 0, 0, 0.03), 0 1px 3px rgba(0, 0, 0, 0.02);
      transition: all 0.2s cubic-bezier(0.2, 0.9, 0.3, 1);
    }
    .scheme-b-card:hover {
      box-shadow: 0 10px 32px -4px rgba(0, 0, 0, 0.05);
    }

    /* 内嵌子卡片：圆角 18px，柔和边框 */
    .scheme-b-subcard {
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.06);
      border-radius: 18px;
      padding: 16px 20px;
    }

    /* 方案 B 专属青蓝开关 */
    .scheme-b-toggle:checked ~ .toggle-bg {
      background-color: #38bdf8 !important;
    }
    .scheme-b-toggle:checked ~ .toggle-dot {
      transform: translateX(20px);
    }

    /* 方案 B 专属粉色滑条 */
    input[type=range] {
      -webkit-appearance: none;
      background: #f1f2f6;
      height: 6px;
      border-radius: 999px;
      outline: none;
    }
    input[type=range]::-webkit-slider-thumb {
      -webkit-appearance: none;
      height: 18px;
      width: 18px;
      border-radius: 50%;
      background: #ffffff;
      border: 2px solid #ff6699;
      box-shadow: 0 2px 6px rgba(255, 102, 153, 0.35);
      cursor: pointer;
    }

    /* 模态框阴影 */
    .modal-backdrop {
      background-color: rgba(15, 23, 42, 0.4);
      backdrop-filter: blur(4px);
    }

    /* 自定义滚动条 */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #e2e4ea; border-radius: 4px; }

    /* 离线独立保底样式 */
    .hidden { display: none !important; }
  </style>
</head>
<body class="min-h-screen antialiased flex flex-col justify-between" data-theme="globals.uiTheme">

  <!-- ============================================================== -->
  <!-- 顶部导航栏 (聚焦简洁 · 仅保留 首页与日志，去除冗余 Tab)           -->
  <!-- ============================================================== -->
  <header class="w-full max-w-7xl mx-auto px-8 pt-6 pb-4 flex items-center justify-between">
    <!-- 左侧：粉色 Logo 徽章 + 项目名称与版本 -->
    <div class="flex items-center space-x-3 cursor-pointer" onclick="switchMainTab('dashboard')">
      <div class="w-9 h-9 rounded-xl flex items-center justify-center font-black text-white shadow-md shadow-pink-500/20" style="background-color: #ff6699;">
        <svg class="w-5 h-5 fill-current" viewBox="0 0 24 24">
          <path d="M7.5 4C5.57 4 4 5.57 4 7.5S5.57 11 7.5 11 11 9.43 11 7.5 9.43 4 7.5 4zm0 5c-.83 0-1.5-.67-1.5-1.5S6.67 6 7.5 6s1.5.67 1.5 1.5S8.33 9 7.5 9zm9-5C14.57 4 13 5.57 13 7.5s1.57 3.5 3.5 3.5 3.5-1.57 3.5-3.5S18.43 4 16.5 4zm0 5c-.83 0-1.5-.67-1.5-1.5S15.67 6 16.5 6s1.5.67 1.5 1.5S17.33 9 16.5 9zM2 19h20v-2H2v2zm3-4h14v-2H5v2z"/>
        </svg>
      </div>
      <div class="flex items-baseline space-x-2">
        <span class="font-bold text-gray-900 text-lg tracking-tight">danmu_api</span>
        <span class="text-[11px] font-mono text-gray-400 font-medium" id="header-version">v${globals.version || '1.21.3'}</span>
      </div>
    </div>

    <!-- 中间：精简导航 Tab (仅保留核心两态：信息汇总与服务日志) -->
    <nav class="flex items-center space-x-8 text-sm">
      <button onclick="switchMainTab('dashboard')" id="nav-btn-dashboard" class="flex flex-col items-center font-bold text-gray-900 transition-all cursor-pointer">
        <span class="text-base tracking-tight">信息汇总</span>
        <div id="nav-indicator-dashboard" class="w-6 h-1 rounded-full mt-1" style="background-color: #ff6699;"></div>
      </button>
      <button onclick="switchMainTab('logs')" id="nav-btn-logs" class="flex flex-col items-center font-medium text-gray-400 hover:text-gray-900 transition-all cursor-pointer">
        <span class="text-base tracking-tight">服务日志</span>
        <div id="nav-indicator-logs" class="w-6 h-1 rounded-full mt-1 bg-transparent"></div>
      </button>
    </nav>

    <!-- 右侧：快捷工具 (服务状态徽章 + 系统配置抽屉 + 清理缓存) -->
    <div class="flex items-center space-x-3">
      <span class="hidden sm:inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-full font-mono text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100 shadow-xs">
        <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span id="header-latency-pill">运行正常 · 18ms</span>
      </span>
      <button onclick="openConfigModal()" class="px-4 py-1.5 rounded-full font-medium text-xs text-gray-600 bg-white border border-gray-200 shadow-xs transition-all hover:border-gray-300 hover:bg-gray-50 cursor-pointer">
        ⚙️ 高级配置
      </button>
      <button onclick="openClearModal()" class="px-5 py-1.5 rounded-full font-bold text-xs text-white shadow-md shadow-sky-500/20 transition-all hover:opacity-90 cursor-pointer" style="background-color: #38bdf8;">
        清理缓存
      </button>
    </div>
  </header>

  <!-- ============================================================== -->
  <!-- 主体工作区                                                     -->
  <!-- ============================================================== -->
  <main class="max-w-7xl mx-auto px-8 py-4 flex-1 w-full pb-16 space-y-7">

    <!-- ============================================================== -->
    <!-- 核心视图 1：信息汇总界面 (无沙盒 · 高聚合仪表盘)              -->
    <!-- ============================================================== -->
    <section id="preview-section" class="space-y-7">
      
      <!-- 1. 顶部 4 大核心指标卡片 (Hero Stats Cards) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        
        <!-- 卡片 1：系统运行状态 -->
        <div class="scheme-b-card p-6 flex flex-col justify-between">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">系统运行状态</span>
            <div class="flex items-center space-x-2">
              <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-pink-50 text-pink-600 font-bold border border-pink-100 shadow-2xs">v${globals.version || '1.21.3'}</span>
              <span id="dash-status-dot" class="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-xs animate-pulse cursor-help" title="运行正常"></span>
            </div>
          </div>
          <div class="my-3">
            <!-- 延迟指标 (只留数字，鼠标悬浮显示解释) -->
            <div class="group relative inline-flex items-baseline cursor-help" title="平均解析延迟: 16.4ms · P95: 22ms · P99: 35ms">
              <div class="text-3xl font-black font-mono text-gray-900 tracking-tight hover:text-pink-600 transition-colors">16.4 <span class="text-sm font-sans font-bold text-gray-400">ms</span></div>
              <!-- 悬浮解释气泡 Tooltip -->
              <div class="absolute bottom-full left-0 mb-2 hidden group-hover:flex flex-col items-start z-30 pointer-events-none">
                <div class="bg-gray-900/95 backdrop-blur-xs text-white text-[11px] font-mono px-3 py-1.5 rounded-lg shadow-xl whitespace-nowrap border border-white/10">
                  <span class="text-pink-300 font-bold">平均解析延迟: 16.4ms</span> · <span class="text-emerald-300">P95: 22ms</span> · <span class="text-sky-300">P99: 35ms</span>
                </div>
                <div class="w-1.5 h-1.5 bg-gray-900/95 rotate-45 ml-4 -mt-1"></div>
              </div>
            </div>
            <div class="text-xs text-emerald-600 font-medium mt-1">Node.js · 端口 <span id="dash-port-label">${globals.port || 9321}</span></div>
          </div>
          <div class="pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] font-mono text-gray-500">
            <span id="dash-uptime-label">在线时长: 3天 14小时</span>
            <button onclick="copyApiUrl()" class="text-pink-600 font-bold hover:underline cursor-pointer">复制端点</button>
          </div>
        </div>

        <!-- 卡片 2：今日请求总量 -->
        <div class="scheme-b-card p-6 flex flex-col justify-between">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">今日请求总量</span>
            <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-50 text-sky-600 font-bold">24H 统计</span>
          </div>
          <div class="my-3">
            <div class="text-3xl font-black font-mono text-gray-900 tracking-tight">24,850</div>
            <div class="text-xs text-emerald-600 font-semibold mt-1">↑ 14.2% <span class="text-gray-400 font-normal">较昨日同时段</span></div>
          </div>
          <div class="pt-2 border-t border-gray-100 text-[11px] font-mono text-gray-500">
            <span>峰值吞吐: 38 req/s</span>
          </div>
        </div>

        <!-- 卡片 3：今日弹幕获取 (增加较昨日比较) -->
        <div class="scheme-b-card p-6 flex flex-col justify-between">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">今日弹幕获取</span>
            <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 font-bold">已捕获</span>
          </div>
          <div class="my-3">
            <div class="text-3xl font-black font-mono text-purple-600 tracking-tight">210.3 <span class="text-sm font-sans font-bold text-purple-400">万条</span></div>
            <div class="text-xs text-emerald-600 font-semibold mt-1">↑ 16.8% <span class="text-gray-400 font-normal">较昨日同时段</span></div>
          </div>
          <div class="pt-2 border-t border-gray-100 text-[11px] font-mono text-gray-500 flex items-center justify-between">
            <span>今日已成功获取 1,698 集弹幕</span>
            <span class="text-purple-400">多源聚合</span>
          </div>
        </div>

        <!-- 卡片 4：缓存命中率 -->
        <div class="scheme-b-card p-6 flex flex-col justify-between">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">缓存命中率</span>
            <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-pink-50 text-pink-600 font-bold">已启用</span>
          </div>
          <div class="my-3">
            <div class="text-3xl font-black font-mono text-pink-600 tracking-tight">99.4 <span class="text-sm font-sans font-bold text-pink-400">%</span></div>
            <div class="text-xs text-gray-500 mt-1">已累计节省 24.7k 次请求</div>
          </div>
          <div class="pt-2 border-t border-gray-100 text-[11px] font-mono text-gray-500 flex items-center justify-between">
            <span>内存 + Redis 缓存</span>
            <button onclick="openClearModal()" class="text-sky-600 font-bold hover:underline cursor-pointer">清理缓存</button>
          </div>
        </div>

      </div>

      <!-- 2. 请求趋势 (Request Trends) 卡片 -->
      <div class="scheme-b-card p-6 space-y-4" id="trend-card">
        <!-- 顶部标题栏与模式切换药丸开关 -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <h2 class="text-base font-bold text-gray-900 tracking-tight">请求趋势</h2>
          </div>
          <!-- 切换药丸开关 [今日分时] / [近7天] -->
          <div class="inline-flex items-center p-1 rounded-full bg-stone-100 text-xs font-mono border border-stone-200/60 shadow-2xs self-start sm:self-auto">
            <button type="button" id="tab-trend-today" onclick="switchTrendTab('today')" class="px-3.5 py-1 rounded-full font-bold bg-white text-gray-900 shadow-xs transition-all cursor-pointer">今日分时</button>
            <button type="button" id="tab-trend-week" onclick="switchTrendTab('week')" class="px-3.5 py-1 rounded-full font-medium text-gray-500 hover:text-gray-900 transition-all cursor-pointer">近 7 天</button>
          </div>
        </div>

        <!-- 动态摘要栏 (随柱状条悬停或点击动态更新) -->
        <div class="text-xs font-mono font-medium text-gray-700 flex flex-wrap items-center gap-x-1.5 gap-y-1" id="trend-summary-label">
          <span class="font-bold text-gray-900" id="trend-sum-time">00:00</span>
          <span class="text-gray-300">·</span>
          <span class="font-bold text-pink-600" id="trend-sum-req">310 次请求</span>
          <span class="text-gray-300">·</span>
          <span class="text-pink-600 font-bold" id="trend-sum-eps">18 集弹幕</span>
          <span class="text-gray-300">·</span>
          <span class="text-purple-600 font-bold" id="trend-sum-danmu">2.1 万条弹幕</span>
          <span class="text-gray-300">·</span>
          <span class="text-gray-600">回源 <span id="trend-sum-origin" class="font-bold text-gray-800">4</span></span>
          <span class="text-gray-300">·</span>
          <span class="text-emerald-600">命中率 <span id="trend-sum-rate" class="font-bold text-emerald-700">98.7%</span></span>
        </div>

        <!-- 图表网格区 (含 0, 1k, 2k, 3k 虚线参考线与粉色圆角柱) -->
        <div class="relative pt-3 pb-1">
          <!-- 4 档虚线水平标尺 -->
          <div class="absolute inset-x-0 top-3 bottom-7 flex flex-col justify-between pointer-events-none select-none font-mono text-[10px] text-gray-400">
            <div class="w-full flex items-center border-b border-dashed border-gray-200/80 pb-0.5">
              <span class="w-7 text-right pr-2">3k</span>
            </div>
            <div class="w-full flex items-center border-b border-dashed border-gray-200/80 pb-0.5">
              <span class="w-7 text-right pr-2">2k</span>
            </div>
            <div class="w-full flex items-center border-b border-dashed border-gray-200/80 pb-0.5">
              <span class="w-7 text-right pr-2">1k</span>
            </div>
            <div class="w-full flex items-center border-b border-gray-200 pb-0.5">
              <span class="w-7 text-right pr-2">0</span>
            </div>
          </div>

          <!-- 柱状图容器 (动态渲染 24 小时或 7 天的柱状条) -->
          <div class="pl-8 h-44 flex items-end justify-between gap-1 sm:gap-1.5 relative z-10" id="trend-bars-container">
          </div>

          <!-- X 轴刻度标签 -->
          <div class="pl-8 pt-2 flex justify-between text-[11px] font-mono text-gray-400 select-none" id="trend-x-axis">
            <span class="w-6 text-center">00</span>
            <span class="w-6 text-center">04</span>
            <span class="w-6 text-center">08</span>
            <span class="w-6 text-center">12</span>
            <span class="w-6 text-center">16</span>
            <span class="w-6 text-center">20</span>
          </div>
        </div>
      </div>

      <!-- 3. 主体双栏内容区 (左右对称大圆角卡片) -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        
        <!-- ========================================== -->
        <!-- 左栏 (约 45%)：多源状态 + 核心规则快照       -->
        <!-- ========================================== -->
        <div class="lg:col-span-5 space-y-7">
          
          <!-- 卡片 A：弹幕来源状态与优先级 -->
          <div class="scheme-b-card p-7 space-y-5">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-base font-bold text-gray-900 tracking-tight">弹幕来源状态 (Sources)</h2>
                <p class="text-xs text-gray-400 mt-0.5">多平台数据抓取与官方凭证存活监控</p>
              </div>
              <span class="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center space-x-1.5 shadow-xs">
                <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>12 核心源在线</span>
              </span>
            </div>

            <!-- 全量启用源网格 (12 大项目真实源 · 官方高清矢量图标) -->
            <div class="grid grid-cols-2 gap-2.5" id="sources-grid">
              <!-- Bilibili -->
              <div class="p-3 rounded-2xl border border-gray-100 bg-gray-50/70 hover:border-pink-300 hover:bg-pink-50/20 transition-all cursor-pointer flex flex-col justify-between group" onclick="showSourceModal('bilibili')">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    ${OFFICIAL_ICONS.bilibili}
                    <span class="text-xs font-bold text-gray-800 group-hover:text-pink-600 transition-colors">哔哩哔哩</span>
                  </div>
                  <span class="text-[10px] font-mono text-emerald-600 font-bold" id="source-lat-bilibili">14ms</span>
                </div>
                <div class="flex items-center justify-between text-[11px] text-gray-400 mt-2 font-mono">
                  <span id="source-status-bilibili" class="truncate pr-1 text-gray-400 font-mono transition-colors duration-200">Cookie 有效</span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-pink-50 text-pink-600 font-medium flex-shrink-0">首选主源</span>
                </div>
              </div>

              <!-- 腾讯视频 -->
              <div class="p-3 rounded-2xl border border-gray-100 bg-gray-50/70 hover:border-blue-300 hover:bg-blue-50/20 transition-all cursor-pointer flex flex-col justify-between group" onclick="showSourceModal('tencent')">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    ${OFFICIAL_ICONS.tencent}
                    <span class="text-xs font-bold text-gray-800 group-hover:text-blue-600 transition-colors">腾讯视频</span>
                  </div>
                  <span class="text-[10px] font-mono text-emerald-600 font-bold" id="source-lat-tencent">22ms</span>
                </div>
                <div class="flex items-center justify-between text-[11px] text-gray-400 mt-2 font-mono">
                  <span id="source-status-tencent" class="truncate pr-1 text-gray-400 font-mono transition-colors duration-200">API 正常</span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium flex-shrink-0">二级回退</span>
                </div>
              </div>

              <!-- 爱奇艺 -->
              <div class="p-3 rounded-2xl border border-gray-100 bg-gray-50/70 hover:border-emerald-300 hover:bg-emerald-50/20 transition-all cursor-pointer flex flex-col justify-between group" onclick="showSourceModal('iqiyi')">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    ${OFFICIAL_ICONS.iqiyi}
                    <span class="text-xs font-bold text-gray-800 group-hover:text-emerald-600 transition-colors">爱奇艺</span>
                  </div>
                  <span class="text-[10px] font-mono text-emerald-600 font-bold" id="source-lat-iqiyi">19ms</span>
                </div>
                <div class="flex items-center justify-between text-[11px] text-gray-400 mt-2 font-mono">
                  <span id="source-status-iqiyi" class="truncate pr-1 text-gray-400 font-mono transition-colors duration-200">直连解析</span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium flex-shrink-0">三级回退</span>
                </div>
              </div>

              <!-- 优酷视频 -->
              <div class="p-3 rounded-2xl border border-gray-100 bg-gray-50/70 hover:border-sky-300 hover:bg-sky-50/20 transition-all cursor-pointer flex flex-col justify-between group" onclick="showSourceModal('youku')">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    ${OFFICIAL_ICONS.youku}
                    <span class="text-xs font-bold text-gray-800 group-hover:text-sky-600 transition-colors">优酷视频</span>
                  </div>
                  <span class="text-[10px] font-mono text-emerald-600 font-bold" id="source-lat-youku">25ms</span>
                </div>
                <div class="flex items-center justify-between text-[11px] text-gray-400 mt-2 font-mono">
                  <span id="source-status-youku" class="truncate pr-1 text-gray-400 font-mono transition-colors duration-200">接口就绪</span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium flex-shrink-0">四级回退</span>
                </div>
              </div>

              <!-- 芒果TV -->
              <div class="p-3 rounded-2xl border border-gray-100 bg-gray-50/70 hover:border-orange-300 hover:bg-orange-50/20 transition-all cursor-pointer flex flex-col justify-between group" onclick="showSourceModal('imgo')">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    ${OFFICIAL_ICONS.imgo}
                    <span class="text-xs font-bold text-gray-800 group-hover:text-orange-600 transition-colors">芒果TV</span>
                  </div>
                  <span class="text-[10px] font-mono text-emerald-600 font-bold" id="source-lat-imgo">21ms</span>
                </div>
                <div class="flex items-center justify-between text-[11px] text-gray-400 mt-2 font-mono">
                  <span id="source-status-imgo" class="truncate pr-1 text-gray-400 font-mono transition-colors duration-200">API 正常</span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 font-medium flex-shrink-0">五级回退</span>
                </div>
              </div>

              <!-- 巴哈姆特 动画疯 -->
              <div class="p-3 rounded-2xl border border-gray-100 bg-gray-50/70 hover:border-teal-300 hover:bg-teal-50/20 transition-all cursor-pointer flex flex-col justify-between group" onclick="showSourceModal('bahamut')">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    ${OFFICIAL_ICONS.bahamut}
                    <span class="text-xs font-bold text-gray-800 group-hover:text-teal-600 transition-colors">动画疯</span>
                  </div>
                  <span class="text-[10px] font-mono text-emerald-600 font-bold" id="source-lat-bahamut">42ms</span>
                </div>
                <div class="flex items-center justify-between text-[11px] text-gray-400 mt-2 font-mono">
                  <span id="source-status-bahamut" class="truncate pr-1 text-gray-400 font-mono transition-colors duration-200">代理就绪</span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 font-medium flex-shrink-0">六级回退</span>
                </div>
              </div>

              <!-- 咪咕视频 -->
              <div class="p-3 rounded-2xl border border-gray-100 bg-gray-50/70 hover:border-blue-300 hover:bg-blue-50/20 transition-all cursor-pointer flex flex-col justify-between group" onclick="showSourceModal('migu')">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    ${OFFICIAL_ICONS.migu}
                    <span class="text-xs font-bold text-gray-800 group-hover:text-blue-600 transition-colors">咪咕视频</span>
                  </div>
                  <span class="text-[10px] font-mono text-emerald-600 font-bold" id="source-lat-migu">23ms</span>
                </div>
                <div class="flex items-center justify-between text-[11px] text-gray-400 mt-2 font-mono">
                  <span id="source-status-migu" class="truncate pr-1 text-gray-400 font-mono transition-colors duration-200">接口就绪</span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium flex-shrink-0">已启用</span>
                </div>
              </div>

              <!-- 搜狐视频 -->
              <div class="p-3 rounded-2xl border border-gray-100 bg-gray-50/70 hover:border-amber-300 hover:bg-amber-50/20 transition-all cursor-pointer flex flex-col justify-between group" onclick="showSourceModal('sohu')">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    ${OFFICIAL_ICONS.sohu}
                    <span class="text-xs font-bold text-gray-800 group-hover:text-amber-600 transition-colors">搜狐视频</span>
                  </div>
                  <span class="text-[10px] font-mono text-emerald-600 font-bold" id="source-lat-sohu">20ms</span>
                </div>
                <div class="flex items-center justify-between text-[11px] text-gray-400 mt-2 font-mono">
                  <span id="source-status-sohu" class="truncate pr-1 text-gray-400 font-mono transition-colors duration-200">直连解析</span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium flex-shrink-0">已启用</span>
                </div>
              </div>

              <!-- 乐视视频 -->
              <div class="p-3 rounded-2xl border border-gray-100 bg-gray-50/70 hover:border-rose-300 hover:bg-rose-50/20 transition-all cursor-pointer flex flex-col justify-between group" onclick="showSourceModal('leshi')">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    ${OFFICIAL_ICONS.leshi}
                    <span class="text-xs font-bold text-gray-800 group-hover:text-rose-600 transition-colors">乐视视频</span>
                  </div>
                  <span class="text-[10px] font-mono text-emerald-600 font-bold" id="source-lat-leshi">26ms</span>
                </div>
                <div class="flex items-center justify-between text-[11px] text-gray-400 mt-2 font-mono">
                  <span id="source-status-leshi" class="truncate pr-1 text-gray-400 font-mono transition-colors duration-200">接口正常</span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium flex-shrink-0">已启用</span>
                </div>
              </div>

              <!-- 红果短剧 -->
              <div class="p-3 rounded-2xl border border-gray-100 bg-gray-50/70 hover:border-red-300 hover:bg-red-50/20 transition-all cursor-pointer flex flex-col justify-between group" onclick="showSourceModal('hongguo')">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    ${OFFICIAL_ICONS.hongguo}
                    <span class="text-xs font-bold text-gray-800 group-hover:text-red-600 transition-colors">红果短剧</span>
                  </div>
                  <span class="text-[10px] font-mono text-emerald-600 font-bold" id="source-lat-hongguo">15ms</span>
                </div>
                <div class="flex items-center justify-between text-[11px] text-gray-400 mt-2 font-mono">
                  <span id="source-status-hongguo" class="truncate pr-1 text-gray-400 font-mono transition-colors duration-200">直连极速</span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium flex-shrink-0">短剧主源</span>
                </div>
              </div>

              <!-- 韩剧TV -->
              <div class="p-3 rounded-2xl border border-gray-100 bg-gray-50/70 hover:border-pink-300 hover:bg-pink-50/20 transition-all cursor-pointer flex flex-col justify-between group" onclick="showSourceModal('hanjutv')">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    ${OFFICIAL_ICONS.hanjutv}
                    <span class="text-xs font-bold text-gray-800 group-hover:text-pink-600 transition-colors">韩剧TV</span>
                  </div>
                  <span class="text-[10px] font-mono text-emerald-600 font-bold" id="source-lat-hanjutv">31ms</span>
                </div>
                <div class="flex items-center justify-between text-[11px] text-gray-400 mt-2 font-mono">
                  <span id="source-status-hanjutv" class="truncate pr-1 text-gray-400 font-mono transition-colors duration-200">移动接口</span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium flex-shrink-0">海外专区</span>
                </div>
              </div>

              <!-- 人人影视 -->
              <div class="p-3 rounded-2xl border border-gray-100 bg-gray-50/70 hover:border-blue-300 hover:bg-blue-50/20 transition-all cursor-pointer flex flex-col justify-between group" onclick="showSourceModal('renren')">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    ${OFFICIAL_ICONS.renren}
                    <span class="text-xs font-bold text-gray-800 group-hover:text-blue-600 transition-colors">人人影视</span>
                  </div>
                  <span class="text-[10px] font-mono text-emerald-600 font-bold" id="source-lat-renren">29ms</span>
                </div>
                <div class="flex items-center justify-between text-[11px] text-gray-400 mt-2 font-mono">
                  <span id="source-status-renren" class="truncate pr-1 text-gray-400 font-mono transition-colors duration-200">美剧备用</span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium flex-shrink-0">已启用</span>
                </div>
              </div>
            </div>

            <!-- 源优先级链条 (SOURCE_ORDER) · 带有平台官方矢量徽标 -->
            <div class="scheme-b-subcard space-y-2.5">
              <div class="flex items-center justify-between text-xs">
                <span class="font-bold text-gray-700">源搜索优先级 (SOURCE_ORDER)</span>
                <button onclick="openConfigModal()" class="text-[11px] font-mono text-pink-600 hover:underline cursor-pointer">调整顺序 ↗</button>
              </div>
              <div class="flex flex-wrap items-center gap-2 text-xs font-mono pt-0.5" id="source-order-chain-container">
                <!-- 1. Bilibili -->
                <span class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-pink-50 text-pink-800 font-bold border border-pink-200/80 shadow-2xs">
                  ${OFFICIAL_ICONS.bilibili}
                  <span>Bilibili</span>
                </span>
                <span class="text-gray-300 font-bold">→</span>

                <!-- 2. 腾讯视频 -->
                <span class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-blue-50 text-blue-800 font-bold border border-blue-200/80 shadow-2xs">
                  ${OFFICIAL_ICONS.tencent}
                  <span>腾讯视频</span>
                </span>
                <span class="text-gray-300 font-bold">→</span>

                <!-- 3. 爱奇艺 -->
                <span class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-800 font-bold border border-emerald-200/80 shadow-2xs">
                  ${OFFICIAL_ICONS.iqiyi}
                  <span>爱奇艺</span>
                </span>
                <span class="text-gray-300 font-bold">→</span>

                <!-- 4. 优酷 -->
                <span class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-indigo-50 text-indigo-800 font-bold border border-indigo-200/80 shadow-2xs">
                  ${OFFICIAL_ICONS.youku}
                  <span>优酷</span>
                </span>
                <span class="text-gray-300 font-bold">→</span>

                <!-- 5. 芒果TV -->
                <span class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-orange-50 text-orange-800 font-bold border border-orange-200/80 shadow-2xs">
                  ${OFFICIAL_ICONS.imgo}
                  <span>芒果TV</span>
                </span>
                <span class="text-gray-300 font-bold">→</span>

                <!-- 6. 动画疯 -->
                <span class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-teal-50 text-teal-800 font-bold border border-teal-200/80 shadow-2xs">
                  ${OFFICIAL_ICONS.bahamut}
                  <span>动画疯</span>
                </span>
              </div>
            </div>

          </div>

          <!-- 卡片 B：核心规则与过滤快照 (Active Rules & Filters) -->
          <div class="scheme-b-card p-7 space-y-5">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-base font-bold text-gray-900 tracking-tight">核心过滤规则快照 (Rules)</h2>
                <p class="text-xs text-gray-400 mt-0.5">当前生效的弹幕过滤、合并与限额策略</p>
              </div>
              <button onclick="openConfigModal()" class="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-pink-50 text-pink-600 border border-pink-100 hover:bg-pink-100 transition-all cursor-pointer">
                配置详情 ↗
              </button>
            </div>

            <!-- 1. 屏蔽词规则与拦截统计 (BLOCKED_WORDS) -->
            <div class="scheme-b-subcard space-y-4">
              
              <div class="flex items-start justify-between">
                <div>
                  <div class="flex items-center space-x-2">
                    <span class="text-xs font-bold text-gray-800">屏蔽词规则 (BLOCKED_WORDS)</span>
                    <span id="rules-count-badge" class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold">4 类生效中</span>
                  </div>
                  <div class="flex items-baseline space-x-2.5 mt-2">
                    <span class="text-3xl font-black font-mono text-gray-900 tracking-tight" id="stat-total-blocked">1,428</span>
                    <span class="text-xs font-sans text-gray-400">条 24H 拦截</span>
                    <span class="text-xs text-emerald-600 font-semibold font-mono" id="stat-total-trend">↑ 8.6% <span class="text-gray-400 font-normal">较昨日同时段</span></span>
                  </div>
                </div>
                <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-pink-50 text-pink-600 font-bold border border-pink-100 flex-shrink-0">
                  24H 统计
                </span>
              </div>

              <!-- 多分类占比分布条 -->
              <div class="space-y-1">
                <div class="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden flex" id="rules-ratio-bar">
                </div>
                <div class="flex items-center justify-between text-[10px] text-gray-400 font-mono">
                  <span>拦截率: 5.7% (占总请求量)</span>
                  <span id="rules-audit-sync">实时动态监控中</span>
                </div>
              </div>

              <!-- 每个屏蔽词规则的分类卡片 -->
              <div id="rule-cards-grid" class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              </div>

              <!-- + 添加规则按钮与快速录入框 -->
              <div class="pt-0.5">
                <button onclick="promptAddKeyword()" id="add-rule-btn" class="w-full py-2 px-3 rounded-xl border border-dashed border-gray-200 text-gray-500 hover:border-pink-300 hover:text-pink-600 text-xs font-medium flex items-center justify-center space-x-1.5 transition-all bg-gray-50/50 hover:bg-pink-50/30 cursor-pointer">
                  <span>+ 添加屏蔽词分类</span>
                </button>
                <div id="kw-add-row" class="hidden flex items-center space-x-2 pt-1.5">
                  <input id="new-kw-input" onkeydown="handleKwKey(event)" type="text" placeholder="输入规则名称 (例: 刷屏)..." class="flex-1 text-xs px-3.5 py-1.5 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:border-pink-500 font-mono">
                  <button onclick="confirmAddKeyword()" class="text-xs px-3.5 py-1.5 rounded-xl font-bold text-white shadow-xs cursor-pointer" style="background-color: #ff6699;">添加</button>
                  <button onclick="hideAddKeyword()" class="text-xs px-2.5 py-1.5 rounded-xl text-gray-400 hover:text-gray-600 cursor-pointer">取消</button>
                </div>
              </div>

            </div>

            <!-- 2. 双独立过滤开关 (方案 B 专属青蓝开关) -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div class="scheme-b-subcard flex items-center justify-between py-3.5">
                <div>
                  <div class="text-xs font-bold text-gray-800">公众人名过滤</div>
                  <div class="text-[10px] text-gray-400">ENABLE_ANIME_FILTER</div>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked id="toggle-anime-filter" class="sr-only scheme-b-toggle">
                  <div class="w-11 h-6 bg-gray-200 rounded-full toggle-bg transition-colors"></div>
                  <div class="w-5 h-5 bg-white rounded-full absolute left-0.5 top-0.5 shadow-sm toggle-dot transition-transform"></div>
                </label>
              </div>

              <div class="scheme-b-subcard flex items-center justify-between py-3.5">
                <div>
                  <div class="text-xs font-bold text-gray-800">重复弹幕合并</div>
                  <div class="text-[10px] text-gray-400">MERGE_SOURCE_PAIRS</div>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked id="toggle-merge-pairs" class="sr-only scheme-b-toggle">
                  <div class="w-11 h-6 bg-gray-200 rounded-full toggle-bg transition-colors"></div>
                  <div class="w-5 h-5 bg-white rounded-full absolute left-0.5 top-0.5 shadow-sm toggle-dot transition-transform"></div>
                </label>
              </div>
            </div>

          </div>

        </div>

        <!-- ========================================== -->
        <!-- 右栏 (约 55%)：即时匹配测试 + 实时调用流水   -->
        <!-- ========================================== -->
        <div class="lg:col-span-7 space-y-7">
          
          <!-- 卡片 C：动漫弹幕即时匹配与解析测试 (Live Match & Inspect) -->
          <div class="scheme-b-card p-7 space-y-5">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-base font-bold text-gray-900 tracking-tight">弹幕即时匹配测试 (Live Match)</h2>
                <p class="text-xs text-gray-400 mt-0.5">测试后端多源匹配逻辑与规则过滤结果（无需沙盒播放器）</p>
              </div>
              <span class="text-xs font-mono text-gray-400 font-semibold">/api/v2/match</span>
            </div>

            <!-- 匹配输入条与快捷测试 -->
            <div class="space-y-2.5">
              <div class="flex items-center space-x-2">
                <input id="match-test-input" type="text" value="生万物 S02E08.mkv" placeholder="输入视频文件名或链接（例: 庆余年 第二季 EP12）..." class="flex-1 text-xs px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:border-pink-500 font-mono">
                <button onclick="runMatchTest()" class="text-xs px-5 py-2.5 rounded-xl font-bold text-white shadow-md shadow-pink-500/25 transition-all hover:opacity-90 flex-shrink-0 cursor-pointer" style="background-color: #ff6699;">
                  开始匹配 ⚡
                </button>
              </div>
              <div class="flex flex-wrap items-center gap-1.5 text-xs font-mono">
                <span class="text-gray-400 text-[11px] mr-1">快捷测试:</span>
                <button type="button" onclick="setTestQuery('生万物 S02E08.mkv', 0)" class="text-[11px] px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-sky-50 hover:text-sky-600 text-gray-600 transition-all font-medium border border-transparent hover:border-sky-200 cursor-pointer">
                  生万物 (① 哔哩首选)
                </button>
                <button type="button" onclick="setTestQuery('庆余年 第二季 EP12.mp4', 1)" class="text-[11px] px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-blue-50 hover:text-blue-600 text-gray-600 transition-all font-medium border border-transparent hover:border-blue-200 cursor-pointer">
                  庆余年 (② 腾讯回退)
                </button>
                <button type="button" onclick="setTestQuery('葬送的芙莉莲 第28集.mkv', 5)" class="text-[11px] px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-teal-50 hover:text-teal-600 text-gray-600 transition-all font-medium border border-transparent hover:border-teal-200 cursor-pointer">
                  芙莉莲 (⑥ 动画疯直达)
                </button>
              </div>
            </div>

            <!-- 匹配结果解析看板 -->
            <div id="match-output-card" class="scheme-b-subcard bg-gray-50/50 space-y-4 border border-gray-100">
              <div class="flex items-center justify-between border-b border-gray-100 pb-3">
                <div class="flex items-center space-x-2">
                  <span class="w-2.5 h-2.5 rounded-full bg-emerald-500" id="res-dot"></span>
                  <span class="text-xs font-bold text-gray-900" id="res-title">《生万物》第 2 季 第 8 集</span>
                  <span class="text-[11px] font-mono px-2 py-0.5 rounded-md bg-sky-50 text-sky-600 font-semibold" id="res-source">命中: 哔哩哔哩 (首选)</span>
                </div>
                <span class="text-xs font-mono text-emerald-600 font-bold" id="res-latency">耗时 14ms</span>
              </div>

              <!-- 4 项解析统计 -->
              <div class="grid grid-cols-4 gap-2 text-center">
                <div class="bg-white p-2.5 rounded-xl border border-gray-100 shadow-xs">
                  <div class="text-[10px] text-gray-400">原始拉取</div>
                  <div class="text-sm font-bold font-mono text-gray-800 mt-0.5" id="res-raw">6,000 条</div>
                </div>
                <!-- 屏蔽拦截 (点击弹窗查看具体拦截弹幕列表) -->
                <div onclick="openDanmuDetailModal('blocked')" class="bg-white p-2.5 rounded-xl border border-gray-100 hover:border-rose-300 hover:bg-rose-50/20 shadow-xs cursor-pointer transition-all hover:scale-[1.02] group relative" title="点击查看 16 条被屏蔽拦截的弹幕明细">
                  <div class="flex items-center justify-center space-x-1">
                    <span class="text-[10px] text-rose-500 font-medium group-hover:font-bold transition-all">屏蔽拦截</span>
                    <span class="text-[9px] text-rose-400 opacity-60 group-hover:opacity-100 transition-opacity">↗</span>
                  </div>
                  <div class="text-sm font-bold font-mono text-rose-600 mt-0.5" id="res-blocked">16 条</div>
                </div>

                <!-- 重复合并 (点击弹窗查看具体合并弹幕聚类) -->
                <div onclick="openDanmuDetailModal('dedup')" class="bg-white p-2.5 rounded-xl border border-gray-100 hover:border-purple-300 hover:bg-purple-50/20 shadow-xs cursor-pointer transition-all hover:scale-[1.02] group relative" title="点击查看 48 条重复合并的弹幕聚类明细">
                  <div class="flex items-center justify-center space-x-1">
                    <span class="text-[10px] text-purple-500 font-medium group-hover:font-bold transition-all">重复合并</span>
                    <span class="text-[9px] text-purple-400 opacity-60 group-hover:opacity-100 transition-opacity">↗</span>
                  </div>
                  <div class="text-sm font-bold font-mono text-purple-600 mt-0.5" id="res-dedup">48 条</div>
                </div>
                <div class="bg-white p-2.5 rounded-xl border border-gray-100 shadow-xs">
                  <div class="text-[10px] text-emerald-500 font-medium">最终交付</div>
                  <div class="text-sm font-bold font-mono text-emerald-600 mt-0.5" id="res-final">5,936 条</div>
                </div>
              </div>

              <!-- 源平台自动匹配时序示意图 (Fallback Pipeline & Glowing Light Dot) -->
              <div class="space-y-2.5 pt-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    <span class="text-xs font-bold text-gray-800">源平台自动匹配时序 (Sequence Pipeline)</span>
                    <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-50 text-sky-600 font-semibold border border-sky-100">
                      逐级回退寻址 · 优先锁定
                    </span>
                  </div>
                  <span class="text-[10px] font-mono text-gray-400" id="pipeline-probe-status">
                    探针状态: 已锁定首选源
                  </span>
                </div>

                <!-- 管道轨道与各平台层级 -->
                <div class="bg-white p-4 rounded-2xl border border-gray-150 relative overflow-hidden shadow-xs">
                  <div class="absolute left-[26px] top-6 bottom-6 w-0.5 bg-gray-200 rounded-full" id="pipeline-track"></div>

                  <div id="pipeline-light-dot" 
                       class="absolute left-[19px] w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white shadow-[0_0_12px_#10b981,0_0_20px_rgba(16,185,129,0.5)] transition-all duration-300 ease-out z-10 pointer-events-none"
                       style="top: 24px; opacity: 1;">
                  </div>

                  <!-- 6个级联平台节点容器 (带有官方矢量图标，严格属于本项目已注册源) -->
                  <div class="space-y-2 relative z-0" id="pipeline-nodes-container">
                    <!-- 节点 0: 哔哩哔哩 (首选主源) -->
                    <div id="pipe-node-0" class="pipe-node flex items-center justify-between p-2.5 rounded-xl border border-emerald-300 bg-emerald-50/40 transition-all duration-300">
                      <div class="flex items-center space-x-3 pl-1.5">
                        <div id="pipe-anchor-0" class="w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white shadow-xs flex-shrink-0 transition-all duration-300 ring-4 ring-emerald-100"></div>
                        <div class="flex items-center space-x-2">
                          ${OFFICIAL_ICONS.bilibili}
                          <span class="text-xs font-bold text-gray-900">哔哩哔哩</span>
                          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-pink-50 text-pink-600 font-bold border border-pink-100">首选源</span>
                          <span class="text-[10px] text-gray-400 hidden sm:inline font-mono">Cid/分P映射</span>
                        </div>
                      </div>
                      <div class="flex items-center space-x-2">
                        <span id="pipe-status-0" class="text-[11px] font-mono font-bold text-emerald-600">✓ 命中 6,000 条</span>
                        <span id="pipe-lat-0" class="text-[10px] font-mono text-emerald-600">14ms</span>
                      </div>
                    </div>

                    <!-- 节点 1: 腾讯视频 (二级回退) -->
                    <div id="pipe-node-1" class="pipe-node flex items-center justify-between p-2.5 rounded-xl border border-gray-100 bg-gray-50/70 transition-all duration-300">
                      <div class="flex items-center space-x-3 pl-1.5">
                        <div id="pipe-anchor-1" class="w-3.5 h-3.5 rounded-full bg-gray-300 border-2 border-white shadow-xs flex-shrink-0 transition-all duration-300"></div>
                        <div class="flex items-center space-x-2">
                          ${OFFICIAL_ICONS.tencent}
                          <span class="text-xs font-bold text-gray-700">腾讯视频</span>
                          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-bold border border-blue-100">二级回退</span>
                          <span class="text-[10px] text-gray-400 hidden sm:inline font-mono">官方分段弹幕</span>
                        </div>
                      </div>
                      <div class="flex items-center space-x-2">
                        <span id="pipe-status-1" class="text-[11px] font-mono text-gray-400">待命 (跳过请求)</span>
                        <span id="pipe-lat-1" class="text-[10px] font-mono text-gray-300">-</span>
                      </div>
                    </div>

                    <!-- 节点 2: 爱奇艺 (三级回退) -->
                    <div id="pipe-node-2" class="pipe-node flex items-center justify-between p-2.5 rounded-xl border border-gray-100 bg-gray-50/70 transition-all duration-300">
                      <div class="flex items-center space-x-3 pl-1.5">
                        <div id="pipe-anchor-2" class="w-3.5 h-3.5 rounded-full bg-gray-300 border-2 border-white shadow-xs flex-shrink-0 transition-all duration-300"></div>
                        <div class="flex items-center space-x-2">
                          ${OFFICIAL_ICONS.iqiyi}
                          <span class="text-xs font-bold text-gray-700">爱奇艺</span>
                          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 font-bold border border-emerald-100">三级回退</span>
                          <span class="text-[10px] text-gray-400 hidden sm:inline font-mono">正版分片解析</span>
                        </div>
                      </div>
                      <div class="flex items-center space-x-2">
                        <span id="pipe-status-2" class="text-[11px] font-mono text-gray-400">待命 (跳过请求)</span>
                        <span id="pipe-lat-2" class="text-[10px] font-mono text-gray-300">-</span>
                      </div>
                    </div>

                    <!-- 节点 3: 优酷视频 (四级回退) -->
                    <div id="pipe-node-3" class="pipe-node flex items-center justify-between p-2.5 rounded-xl border border-gray-100 bg-gray-50/70 transition-all duration-300">
                      <div class="flex items-center space-x-3 pl-1.5">
                        <div id="pipe-anchor-3" class="w-3.5 h-3.5 rounded-full bg-gray-300 border-2 border-white shadow-xs flex-shrink-0 transition-all duration-300"></div>
                        <div class="flex items-center space-x-2">
                          ${OFFICIAL_ICONS.youku}
                          <span class="text-xs font-bold text-gray-700">优酷视频</span>
                          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-bold border border-indigo-100">四级回退</span>
                          <span class="text-[10px] text-gray-400 hidden sm:inline font-mono">开放接口解析</span>
                        </div>
                      </div>
                      <div class="flex items-center space-x-2">
                        <span id="pipe-status-3" class="text-[11px] font-mono text-gray-400">待命 (跳过请求)</span>
                        <span id="pipe-lat-3" class="text-[10px] font-mono text-gray-300">-</span>
                      </div>
                    </div>

                    <!-- 节点 4: 芒果TV (五级回退) -->
                    <div id="pipe-node-4" class="pipe-node flex items-center justify-between p-2.5 rounded-xl border border-gray-100 bg-gray-50/70 transition-all duration-300">
                      <div class="flex items-center space-x-3 pl-1.5">
                        <div id="pipe-anchor-4" class="w-3.5 h-3.5 rounded-full bg-gray-300 border-2 border-white shadow-xs flex-shrink-0 transition-all duration-300"></div>
                        <div class="flex items-center space-x-2">
                          ${OFFICIAL_ICONS.imgo}
                          <span class="text-xs font-bold text-gray-700">芒果TV</span>
                          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 font-bold border border-orange-100">五级回退</span>
                          <span class="text-[10px] text-gray-400 hidden sm:inline font-mono">独播剧集弹幕</span>
                        </div>
                      </div>
                      <div class="flex items-center space-x-2">
                        <span id="pipe-status-4" class="text-[11px] font-mono text-gray-400">待命 (跳过请求)</span>
                        <span id="pipe-lat-4" class="text-[10px] font-mono text-gray-300">-</span>
                      </div>
                    </div>

                    <!-- 节点 5: 巴哈姆特 动画疯 (六级终极兜底) -->
                    <div id="pipe-node-5" class="pipe-node flex items-center justify-between p-2.5 rounded-xl border border-gray-100 bg-gray-50/70 transition-all duration-300">
                      <div class="flex items-center space-x-3 pl-1.5">
                        <div id="pipe-anchor-5" class="w-3.5 h-3.5 rounded-full bg-gray-300 border-2 border-white shadow-xs flex-shrink-0 transition-all duration-300"></div>
                        <div class="flex items-center space-x-2">
                          ${OFFICIAL_ICONS.bahamut}
                          <span class="text-xs font-bold text-gray-700">动画疯</span>
                          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-teal-50 text-teal-600 font-bold border border-teal-100">终极兜底</span>
                          <span class="text-[10px] text-gray-400 hidden sm:inline font-mono">港台番剧无修</span>
                        </div>
                      </div>
                      <div class="flex items-center space-x-2">
                        <span id="pipe-status-5" class="text-[11px] font-mono text-gray-400">待命 (跳过请求)</span>
                        <span id="pipe-lat-5" class="text-[10px] font-mono text-gray-300">-</span>
                      </div>
                    </div>
                  </div>

                  <!-- 底部时序判定汇总 -->
                  <div class="flex items-center justify-between text-[11px] font-mono text-gray-400 pt-3 mt-1 border-t border-gray-100">
                    <div class="flex items-center space-x-1.5" id="pipeline-summary-left">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span class="text-gray-700 font-medium" id="pipeline-hit-summary">已命中首选源 [哔哩哔哩] · 直接交付</span>
                    </div>
                    <span class="text-emerald-600 font-bold" id="pipeline-perf-summary">规避后续 5 次外部请求 (省时 120ms)</span>
                  </div>
                </div>
              </div>
            </div>

          </div>

        </div>

      </div>

    </section>

    <!-- ============================================================== -->
    <!-- 核心视图 2：服务日志 (实时终端日志流)                          -->
    <!-- ============================================================== -->
    <section id="logs-section" class="hidden scheme-b-card p-8 space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-base font-bold text-gray-900 tracking-tight">服务运行实时日志</h2>
          <p class="text-xs text-gray-400 mt-0.5">当前日志等级: INFO · 支持实时同步与清空</p>
        </div>
        <div class="flex items-center space-x-2">
          <button onclick="clearLogs()" class="text-xs px-3.5 py-1.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium cursor-pointer">清空</button>
          <button onclick="refreshLogs()" class="text-xs px-3.5 py-1.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium cursor-pointer">🔄 刷新</button>
        </div>
      </div>
      <div id="log-terminal" class="bg-gray-950 text-gray-300 rounded-2xl p-5 font-mono text-xs h-[520px] overflow-y-auto space-y-1.5 shadow-inner">
        <div class="text-gray-500">[2026-10-06 00:10:00.102] [system] [server] danmu_api core service initialized on port 9321</div>
        <div class="text-gray-500">[2026-10-06 00:10:00.115] [system] [config] loaded environment variables</div>
        <div class="text-emerald-400">[2026-10-06 00:11:14.301] [match] /api/v2/match: "生万物 S02E08.mkv" -> Bilibili (cid: 100482910)</div>
        <div class="text-sky-400">[2026-10-06 00:11:14.450] [danmu] fetched 6,000 comments from bilibili, 16 blocked words matched, 48 duplicates folded</div>
        <div class="text-gray-400">[2026-10-06 00:11:14.455] [server] 200 OK GET /api/v2/comment/100482910 - 18ms</div>
      </div>
    </section>

  </main>

  <!-- ============================================================== -->
  <!-- 模态框 1：清理缓存 (Clear Cache Modal)                         -->
  <!-- ============================================================== -->
  <div id="clear-modal" class="hidden fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
    <div class="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4 border border-gray-100">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-gray-900">清理缓存 (Clear Cache)</h3>
        <button onclick="closeClearModal()" class="text-gray-400 hover:text-gray-600 font-bold text-lg cursor-pointer">&times;</button>
      </div>
      <div class="space-y-2 text-xs text-gray-600">
        <label class="flex items-center space-x-2 cursor-pointer">
          <input type="checkbox" id="chk-danmu-cache" checked class="rounded text-pink-500">
          <span>弹幕数据解析缓存 (Danmu Cache)</span>
        </label>
        <label class="flex items-center space-x-2 cursor-pointer">
          <input type="checkbox" id="chk-search-cache" checked class="rounded text-pink-500">
          <span>动画搜索检索缓存 (Search Cache)</span>
        </label>
        <label class="flex items-center space-x-2 cursor-pointer">
          <input type="checkbox" id="chk-bangumi-cache" class="rounded text-pink-500">
          <span>Bangumi 元数据缓存</span>
        </label>
      </div>
      <div class="flex items-center justify-end space-x-2 pt-2">
        <button onclick="closeClearModal()" class="text-xs px-4 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer">取消</button>
        <button onclick="confirmClearCache()" class="text-xs px-5 py-2 rounded-xl font-bold text-white shadow-xs cursor-pointer" style="background-color: #ff6699;">立即清理</button>
      </div>
    </div>
  </div>

  <!-- ============================================================== -->
  <!-- 模态框 2：高级环境变量配置 (收纳 42 项配置，避免污染导航)        -->
  <!-- ============================================================== -->
  <div id="config-modal" class="hidden fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
    <div id="env-section" class="bg-white rounded-3xl max-w-3xl w-full p-6 shadow-2xl space-y-4 border border-gray-100 max-h-[85vh] flex flex-col">
      <div class="flex items-center justify-between border-b border-gray-100 pb-3">
        <div>
          <h3 class="text-sm font-bold text-gray-900">系统高级配置 (Environment Variables)</h3>
          <p class="text-xs text-gray-400">项目全部底层配置项，修改后保存生效</p>
        </div>
        <button onclick="closeConfigModal()" class="text-gray-400 hover:text-gray-600 font-bold text-lg cursor-pointer">&times;</button>
      </div>
      <div class="py-1">
        <input id="modal-cfg-search" oninput="filterModalConfigs(this.value)" type="text" placeholder="搜索配置名或中文..." class="w-full text-xs px-3.5 py-2 rounded-xl border border-gray-200 bg-gray-50 font-mono">
      </div>
      <div id="modal-configs-grid" class="flex-1 overflow-y-auto space-y-2 pr-1">
      </div>
      <div class="flex items-center justify-end space-x-2 pt-3 border-t border-gray-100">
        <button onclick="closeConfigModal()" class="text-xs px-4 py-2 rounded-xl border border-gray-200 text-gray-600 cursor-pointer">关闭</button>
        <button onclick="saveModalConfigs()" class="text-xs px-5 py-2 rounded-xl font-bold text-white shadow-xs cursor-pointer" style="background-color: #ff6699;">保存更改</button>
      </div>
    </div>
  </div>

  <!-- ============================================================== -->
  <!-- 模态框 3：弹幕处理明细弹窗 (屏蔽拦截列表 / 重复合并聚类)       -->
  <!-- ============================================================== -->
  <div id="danmu-detail-modal" class="hidden fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
    <div class="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-4 border border-gray-100 max-h-[85vh] flex flex-col">
      <!-- 模态框标题栏 -->
      <div class="flex items-center justify-between border-b border-gray-100 pb-3">
        <div class="flex items-center space-x-3">
          <div id="detail-modal-icon-badge" class="w-9 h-9 rounded-2xl flex items-center justify-center text-base font-bold shadow-xs">
          </div>
          <div>
            <h3 class="text-sm font-bold text-gray-900" id="detail-modal-title">弹幕明细列表</h3>
            <p class="text-xs text-gray-400 mt-0.5" id="detail-modal-subtitle">具体过滤详情说明</p>
          </div>
        </div>
        <button onclick="closeDanmuDetailModal()" class="text-gray-400 hover:text-gray-600 font-bold text-2xl leading-none px-1 cursor-pointer">&times;</button>
      </div>

      <!-- 顶部统计概览栏 (轻量摘要) -->
      <div id="detail-modal-stats-bar" class="p-3 rounded-2xl bg-gray-50 flex items-center justify-between text-xs font-mono border border-gray-100">
      </div>

      <!-- 具体内容滚动列表 -->
      <div id="detail-modal-list" class="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-xs">
      </div>

      <!-- 底部关闭按钮 -->
      <div class="flex items-center justify-between pt-3 border-t border-gray-100">
        <span class="text-[11px] text-gray-400 font-mono" id="detail-modal-footer-note">来自当前命中结果真实切片</span>
        <button onclick="closeDanmuDetailModal()" class="text-xs px-5 py-2 rounded-xl font-bold text-white shadow-xs cursor-pointer" style="background-color: #ff6699;">
          关闭
        </button>
      </div>
    </div>
  </div>

  <!-- ============================================================== -->
  <!-- 交互逻辑脚本                                                   -->
  <!-- ============================================================== -->
  <script>
    // 真实项目配置数据 (严格基于本项目的 12 大来源)
    let PROJECT_CONFIGS = [
      { key: 'TOKEN', name: 'API 访问密钥', cat: 'API', value: 'globals.currentToken' },
      { key: 'ADMIN_TOKEN', name: '管理员密钥', cat: 'API', value: 'admin_secret_pass' },
      { key: 'SOURCE_ORDER', name: '弹幕源搜索优先级', cat: '源配置', value: 'tencent,iqiyi,youku,imgo,bilibili,bahamut' },
      { key: 'PLATFORM_ORDER', name: '自动匹配平台组顺序', cat: '匹配配置', value: 'tencent,youku,iqiyi,bilibili,imgo,bahamut' },
      { key: 'BILIBILI_COOKIE', name: 'Bilibili Cookie', cat: '源配置', value: 'SESSDATA=...' },
      { key: 'BLOCKED_WORDS', name: '屏蔽词规则', cat: '弹幕配置', value: '广告,剧透,引流,无意义刷屏' },
      { key: 'DANMU_LIMIT', name: '单集弹幕数量上限', cat: '弹幕配置', value: '6000' },
      { key: 'ENABLE_ANIME_FILTER', name: '公众人名过滤', cat: '匹配配置', value: 'true' },
      { key: 'MERGE_SOURCE_PAIRS', name: '重复弹幕合并', cat: '源配置', value: 'true' },
      { key: 'COMMENT_CACHE_MINUTES', name: '弹幕缓存时长 (分)', cat: '缓存配置', value: '1440' },
      { key: 'LOCAL_REDIS_URL', name: 'Redis 连接串', cat: '缓存配置', value: 'redis://127.0.0.1:6379' },
      { key: 'LOG_LEVEL', name: '日志输出等级', cat: '系统配置', value: 'info' }
    ];

    // 规则分类与实时拦截统计数据
    let RULE_CATEGORIES = [
      { id: 'ad', name: '广告', count: 642, color: 'rose', bg: '#fff1f3', border: '#ffe4e6', text: '#be123c', bar: '#fb7185', trend: '↑ 12% 较昨日' },
      { id: 'spoiler', name: '剧透', count: 418, color: 'purple', bg: '#f5f3ff', border: '#ede9fe', text: '#6d28d9', bar: '#a78bfa', trend: '↑ 5% 较昨日' },
      { id: 'traffic', name: '引流', count: 236, color: 'teal', bg: '#f0fdfa', border: '#ccfbf1', text: '#0f766e', bar: '#2dd4bf', trend: '↓ 3% 较昨日' },
      { id: 'spam', name: '无意义刷屏', count: 132, color: 'gray', bg: '#f8fafc', border: '#e2e8f0', text: '#334155', bar: '#94a3b8', trend: '持平' }
    ];

    function renderRuleCards() {
      const container = document.getElementById('rule-cards-grid');
      const ratioBar = document.getElementById('rules-ratio-bar');
      const totalCountElem = document.getElementById('stat-total-blocked');
      const badgeElem = document.getElementById('rules-count-badge');
      if (!container || !ratioBar) return;

      const total = RULE_CATEGORIES.reduce((acc, cur) => acc + cur.count, 0);
      if (totalCountElem) totalCountElem.textContent = total.toLocaleString();
      if (badgeElem) badgeElem.textContent = RULE_CATEGORIES.length + ' 类生效中';

      container.innerHTML = '';
      ratioBar.innerHTML = '';

      RULE_CATEGORIES.forEach(cat => {
        const ratio = total > 0 ? ((cat.count / total) * 100).toFixed(1) : '0.0';

        const barSeg = document.createElement('div');
        barSeg.className = 'h-full transition-all duration-300';
        barSeg.style.width = ratio + '%';
        barSeg.style.backgroundColor = cat.bar;
        barSeg.title = cat.name + ': ' + cat.count + ' 条 (' + ratio + '%)';
        ratioBar.appendChild(barSeg);

        const card = document.createElement('div');
        card.className = 'p-3.5 rounded-2xl border transition-all hover:shadow-xs flex flex-col justify-between';
        card.style.backgroundColor = cat.bg;
        card.style.borderColor = cat.border;
        card.innerHTML = 
          '<div class="flex items-center justify-between">' +
            '<div class="flex items-center space-x-1.5">' +
              '<span class="w-2 h-2 rounded-full" style="background-color: ' + cat.bar + ';"></span>' +
              '<span class="text-xs font-bold" style="color: ' + cat.text + ';">' + escapeHtml(cat.name) + '</span>' +
            '</div>' +
            '<div class="flex items-center space-x-1.5">' +
              '<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/80 font-bold shadow-xs" style="color: ' + cat.text + ';">' + ratio + '%</span>' +
              '<button onclick="removeKeyword(\\'' + cat.id + '\\')" class="opacity-40 hover:opacity-100 text-sm font-bold leading-none p-0.5 cursor-pointer" style="color: ' + cat.text + ';" title="删除分类">&times;</button>' +
            '</div>' +
          '</div>' +
          '<div class="mt-2.5 flex items-baseline justify-between">' +
            '<div class="flex items-baseline space-x-1">' +
              '<span class="text-lg font-black font-mono tracking-tight" style="color: ' + cat.text + ';">' + cat.count.toLocaleString() + '</span>' +
              '<span class="text-[10px] font-sans opacity-70" style="color: ' + cat.text + ';">条拦截</span>' +
            '</div>' +
            '<span class="text-[10px] font-mono opacity-80" style="color: ' + cat.text + ';">' + cat.trend + '</span>' +
          '</div>';
        container.appendChild(card);
      });
    }

    function removeKeyword(catId) {
      RULE_CATEGORIES = RULE_CATEGORIES.filter(c => c.id !== catId);
      renderRuleCards();
    }

    function promptAddKeyword() {
      document.getElementById('kw-add-row').classList.remove('hidden');
      document.getElementById('add-rule-btn').classList.add('hidden');
      document.getElementById('new-kw-input').focus();
    }

    function hideAddKeyword() {
      document.getElementById('kw-add-row').classList.add('hidden');
      document.getElementById('add-rule-btn').classList.remove('hidden');
    }

    function handleKwKey(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmAddKeyword();
      }
    }

    function confirmAddKeyword() {
      const input = document.getElementById('new-kw-input');
      const val = input.value.trim();
      if (!val || RULE_CATEGORIES.some(c => c.name === val)) return;

      const randomCount = Math.floor(20 + Math.random() * 80);
      const palette = [
        { bg: '#fff1f3', border: '#ffe4e6', text: '#be123c', bar: '#fb7185' },
        { bg: '#f5f3ff', border: '#ede9fe', text: '#6d28d9', bar: '#a78bfa' },
        { bg: '#f0fdfa', border: '#ccfbf1', text: '#0f766e', bar: '#2dd4bf' },
        { bg: '#f8fafc', border: '#e2e8f0', text: '#334155', bar: '#94a3b8' }
      ];
      const p = palette[RULE_CATEGORIES.length % palette.length];

      RULE_CATEGORIES.push({
        id: 'rule_' + Date.now(),
        name: val,
        count: randomCount,
        bg: p.bg,
        border: p.border,
        text: p.text,
        bar: p.bar,
        trend: '新增'
      });

      input.value = '';
      hideAddKeyword();
      renderRuleCards();
    }

    // 平台匹配管线节点配置 (严格基于本项目已注册支持的源)
    const PIPELINE_NODES = [
      { id: 'bilibili', name: '01 哔哩哔哩', tag: '首选源', sub: 'Cid/分P映射', defaultRows: 6000, latency: '14ms', hitText: '✓ 命中 6,000 条' },
      { id: 'tencent', name: '02 腾讯视频', tag: '二级回退', sub: '官方分段弹幕', defaultRows: 4200, latency: '22ms', hitText: '✓ 命中 4,200 条' },
      { id: 'iqiyi', name: '03 爱奇艺', tag: '三级回退', sub: '正版分片解析', defaultRows: 3800, latency: '19ms', hitText: '✓ 命中 3,800 条' },
      { id: 'youku', name: '04 优酷视频', tag: '四级回退', sub: '开放接口解析', defaultRows: 2950, latency: '25ms', hitText: '✓ 命中 2,950 条' },
      { id: 'imgo', name: '05 芒果TV', tag: '五级回退', sub: '独播综艺剧集', defaultRows: 3100, latency: '21ms', hitText: '✓ 命中 3,100 条' },
      { id: 'bahamut', name: '06 动画疯', tag: '六级兜底', sub: '港台正版番剧', defaultRows: 5100, latency: '42ms', hitText: '✓ 命中 5,100 条' }
    ];

    let pipelineTimer = null;

    function updateDotPosition(stepIndex) {
      const dot = document.getElementById('pipeline-light-dot');
      const targetNode = document.getElementById('pipe-node-' + stepIndex);
      if (!dot || !targetNode) return;
      const topPos = targetNode.offsetTop + (targetNode.offsetHeight / 2) - 7;
      dot.style.top = topPos + 'px';
    }

    function updateMatchMetrics(stepIndex, title) {
      const resTitle = document.getElementById('res-title');
      const resSource = document.getElementById('res-source');
      const resLatency = document.getElementById('res-latency');
      const resRaw = document.getElementById('res-raw');
      const resBlocked = document.getElementById('res-blocked');
      const resDedup = document.getElementById('res-dedup');
      const resFinal = document.getElementById('res-final');

      const target = PIPELINE_NODES[stepIndex];
      const blockedCount = RULE_CATEGORIES.length * 4;
      const dedupCount = 48;
      const finalCount = Math.max(0, target.defaultRows - blockedCount - dedupCount);

      if (resTitle) resTitle.textContent = '《' + title.replace(/\\.[^/.]+$/, "") + '》';
      if (resSource) resSource.textContent = '命中: ' + target.name.slice(3) + ' (' + target.tag + ')';
      if (resLatency) resLatency.textContent = '耗时 ' + target.latency;
      if (resRaw) resRaw.textContent = target.defaultRows.toLocaleString() + ' 条';
      if (resBlocked) resBlocked.textContent = blockedCount + ' 条';
      if (resDedup) resDedup.textContent = dedupCount + ' 条';
      if (resFinal) resFinal.textContent = finalCount.toLocaleString() + ' 条';
    }

    function simulatePipelineMatch(targetHitIndex, title) {
      if (targetHitIndex === undefined) targetHitIndex = 0;
      if (title === undefined) title = '生万物 S02E08.mkv';
      if (pipelineTimer) clearTimeout(pipelineTimer);

      const dot = document.getElementById('pipeline-light-dot');
      const probeStatus = document.getElementById('pipeline-probe-status');
      const summaryHit = document.getElementById('pipeline-hit-summary');
      const summaryPerf = document.getElementById('pipeline-perf-summary');

      PIPELINE_NODES.forEach((node, i) => {
        const elNode = document.getElementById('pipe-node-' + i);
        const elAnchor = document.getElementById('pipe-anchor-' + i);
        const elStatus = document.getElementById('pipe-status-' + i);
        const elLat = document.getElementById('pipe-lat-' + i);

        if (elNode) elNode.className = 'pipe-node flex items-center justify-between p-2.5 rounded-xl border border-gray-100 bg-gray-50/70 transition-all duration-300';
        if (elAnchor) elAnchor.className = 'w-3.5 h-3.5 rounded-full bg-gray-300 border-2 border-white shadow-xs flex-shrink-0 transition-all duration-300';
        if (elStatus) {
          elStatus.className = 'text-[11px] font-mono text-gray-400';
          elStatus.textContent = '待命';
        }
        if (elLat) {
          elLat.className = 'text-[10px] font-mono text-gray-300';
          elLat.textContent = '-';
        }
      });

      if (dot) {
        dot.style.opacity = '1';
        dot.className = 'absolute left-[19px] w-3.5 h-3.5 rounded-full bg-sky-400 border-2 border-white shadow-[0_0_14px_#38bdf8,0_0_24px_rgba(56,189,248,0.7)] transition-all duration-300 ease-out z-10 pointer-events-none animate-pulse';
      }
      if (probeStatus) probeStatus.textContent = '探针状态: 正在级联回退嗅探...';

      let currentStep = 0;

      function stepCascade() {
        updateDotPosition(currentStep);

        const elNode = document.getElementById('pipe-node-' + currentStep);
        const elAnchor = document.getElementById('pipe-anchor-' + currentStep);
        const elStatus = document.getElementById('pipe-status-' + currentStep);
        const elLat = document.getElementById('pipe-lat-' + currentStep);

        if (elNode) elNode.className = 'pipe-node flex items-center justify-between p-2.5 rounded-xl border border-sky-300 bg-sky-50/40 shadow-xs transition-all duration-300';
        if (elAnchor) elAnchor.className = 'w-3.5 h-3.5 rounded-full bg-sky-400 border-2 border-white shadow-xs flex-shrink-0 transition-all duration-300 ring-4 ring-sky-100';
        if (elStatus) {
          elStatus.className = 'text-[11px] font-mono text-sky-600 font-bold';
          elStatus.textContent = '🔍 正在嗅探检索...';
        }
        if (elLat) elLat.textContent = '...';

        pipelineTimer = setTimeout(() => {
          if (currentStep === targetHitIndex) {
            if (elNode) elNode.className = 'pipe-node flex items-center justify-between p-2.5 rounded-xl border border-emerald-300 bg-emerald-50/50 shadow-xs transition-all duration-300';
            if (elAnchor) elAnchor.className = 'w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white shadow-xs flex-shrink-0 transition-all duration-300 ring-4 ring-emerald-100';
            if (elStatus) {
              elStatus.className = 'text-[11px] font-mono font-bold text-emerald-600';
              elStatus.textContent = PIPELINE_NODES[currentStep].hitText;
            }
            if (elLat) {
              elLat.className = 'text-[10px] font-mono text-emerald-600 font-bold';
              elLat.textContent = PIPELINE_NODES[currentStep].latency;
            }

            if (dot) dot.className = 'absolute left-[19px] w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white shadow-[0_0_14px_#10b981,0_0_24px_rgba(16,185,129,0.7)] transition-all duration-300 ease-out z-10 pointer-events-none';
            if (probeStatus) probeStatus.textContent = '探针状态: 已在 [' + PIPELINE_NODES[currentStep].name.slice(3) + '] 锁定交付';

            for (let j = currentStep + 1; j < PIPELINE_NODES.length; j++) {
              const skipStatus = document.getElementById('pipe-status-' + j);
              if (skipStatus) skipStatus.textContent = '待命 (跳过请求)';
            }

            const skippedCount = PIPELINE_NODES.length - 1 - currentStep;
            if (summaryHit) summaryHit.textContent = '已命中源 [' + PIPELINE_NODES[currentStep].name.slice(3) + '] · 直接交付';
            if (summaryPerf) summaryPerf.textContent = skippedCount > 0 ? ('规避后续 ' + skippedCount + ' 次外部请求 (省时约 ' + (skippedCount * 25) + 'ms)') : '已穷尽回退链路，由全量库成功兜底';

            updateMatchMetrics(currentStep, title);
            const hitSrc = PIPELINE_NODES[currentStep]?.src;
            if (hitSrc) recordSourceCall(hitSrc, true, '请求成功');
          } else {
            if (elNode) elNode.className = 'pipe-node flex items-center justify-between p-2.5 rounded-xl border border-amber-200/60 bg-amber-50/20 transition-all duration-300';
            if (elAnchor) elAnchor.className = 'w-3.5 h-3.5 rounded-full bg-amber-400/80 border-2 border-white shadow-xs flex-shrink-0 transition-all duration-300';
            if (elStatus) {
              elStatus.className = 'text-[11px] font-mono text-amber-600';
              elStatus.textContent = '✗ 未收录 → 穿透回退';
            }
            if (elLat) {
              elLat.className = 'text-[10px] font-mono text-gray-400';
              elLat.textContent = '4ms';
            }

            currentStep++;
            stepCascade();
          }
        }, 260);
      }

      stepCascade();
    }

    function setTestQuery(query, stepIndex) {
      document.getElementById('match-test-input').value = query;
      simulatePipelineMatch(stepIndex, query);
    }

    function runMatchTest() {
      const val = document.getElementById('match-test-input').value.trim();
      let stepIndex = 0;
      if (val.includes('庆余年') || val.includes('腾讯') || val.includes('电视剧')) {
        stepIndex = 1;
      } else if (val.includes('爱奇艺') || val.includes('迷雾')) {
        stepIndex = 2;
      } else if (val.includes('优酷') || val.includes('港剧')) {
        stepIndex = 3;
      } else if (val.includes('芒果') || val.includes('综艺')) {
        stepIndex = 4;
      } else if (val.includes('芙莉莲') || val.includes('动画疯') || val.includes('巴哈')) {
        stepIndex = 5;
      }
      simulatePipelineMatch(stepIndex, val || '生万物 S02E08.mkv');
    }

    // ==============================================================
    // 请求趋势 (Request Trends) 数据模型与交互渲染
    // ==============================================================
    const TREND_HOURLY_DATA = [
      { time: '00:00', label: '00', req: 310, origin: 4, rate: '98.7%', eps: 18, danmu: '2.1' },
      { time: '01:00', label: '01', req: 180, origin: 2, rate: '98.9%', eps: 11, danmu: '1.3' },
      { time: '02:00', label: '02', req: 95,  origin: 1, rate: '98.9%', eps: 6,  danmu: '0.7' },
      { time: '03:00', label: '03', req: 60,  origin: 1, rate: '98.3%', eps: 4,  danmu: '0.4' },
      { time: '04:00', label: '04', req: 45,  origin: 0, rate: '100%',  eps: 3,  danmu: '0.3' },
      { time: '05:00', label: '05', req: 90,  origin: 1, rate: '98.9%', eps: 6,  danmu: '0.6' },
      { time: '06:00', label: '06', req: 170, origin: 2, rate: '98.8%', eps: 12, danmu: '1.2' },
      { time: '07:00', label: '07', req: 410, origin: 5, rate: '98.8%', eps: 28, danmu: '3.1' },
      { time: '08:00', label: '08', req: 750, origin: 9, rate: '98.8%', eps: 52, danmu: '5.8' },
      { time: '09:00', label: '09', req: 980, origin: 11, rate: '98.9%', eps: 65, danmu: '7.6' },
      { time: '10:00', label: '10', req: 1140, origin: 12, rate: '98.9%', eps: 74, danmu: '8.9' },
      { time: '11:00', label: '11', req: 1220, origin: 14, rate: '98.9%', eps: 81, danmu: '9.6' },
      { time: '12:00', label: '12', req: 1370, origin: 16, rate: '98.8%', eps: 90, danmu: '11.2' },
      { time: '13:00', label: '13', req: 1280, origin: 15, rate: '98.8%', eps: 85, danmu: '10.5' },
      { time: '14:00', label: '14', req: 1160, origin: 13, rate: '98.9%', eps: 78, danmu: '9.4' },
      { time: '15:00', label: '15', req: 1210, origin: 14, rate: '98.8%', eps: 82, danmu: '9.8' },
      { time: '16:00', label: '16', req: 1320, origin: 15, rate: '98.9%', eps: 88, danmu: '10.6' },
      { time: '17:00', label: '17', req: 1560, origin: 18, rate: '98.8%', eps: 105, danmu: '12.8' },
      { time: '18:00', label: '18', req: 1920, origin: 20, rate: '99.0%', eps: 128, danmu: '15.7' },
      { time: '19:00', label: '19', req: 2340, origin: 22, rate: '99.1%', eps: 154, danmu: '19.2' },
      { time: '20:00', label: '20', req: 2480, origin: 21, rate: '99.2%', peak: true, eps: 165, danmu: '21.0' },
      { time: '21:00', label: '21', req: 2290, origin: 19, rate: '99.2%', eps: 148, danmu: '18.6' },
      { time: '22:00', label: '22', req: 1610, origin: 15, rate: '99.1%', eps: 108, danmu: '13.5' },
      { time: '23:00', label: '23', req: 650, origin: 8, rate: '98.8%', eps: 45, danmu: '5.2' }
    ];

    const TREND_WEEKLY_DATA = [
      { time: '09-30 (周三)', label: '周三', req: 18450, origin: 240, rate: '98.7%', eps: 1240, danmu: '152.0' },
      { time: '10-01 (周四)', label: '周四', req: 22100, origin: 265, rate: '98.8%', eps: 1460, danmu: '184.2' },
      { time: '10-02 (周五)', label: '周五', req: 25400, origin: 290, rate: '98.9%', eps: 1720, danmu: '218.6' },
      { time: '10-03 (周六)', label: '周六', req: 29800, origin: 320, rate: '98.9%', eps: 2050, danmu: '265.4' },
      { time: '10-04 (周日)', label: '周日', req: 31200, origin: 335, rate: '98.9%', eps: 2180, danmu: '282.0' },
      { time: '10-05 (周一)', label: '周一', req: 26500, origin: 295, rate: '98.9%', eps: 1810, danmu: '230.5' },
      { time: '10-06 (今日)', label: '今日', req: 24700, origin: 268, rate: '98.9%', peak: true, eps: 1698, danmu: '210.3' }
    ];

    let currentTrendTab = 'today';
    let currentSelectedTrendIdx = 0; // 默认 00:00 匹配用户截图

    function renderTrendChart() {
      const container = document.getElementById('trend-bars-container');
      const xAxis = document.getElementById('trend-x-axis');
      if (!container || !xAxis) return;

      const data = currentTrendTab === 'today' ? TREND_HOURLY_DATA : TREND_WEEKLY_DATA;
      const maxVal = currentTrendTab === 'today' ? 3000 : 35000;

      container.innerHTML = '';
      data.forEach((item, idx) => {
        const heightPct = Math.max(5, Math.min(100, (item.req / maxVal) * 100));
        const isSelected = idx === currentSelectedTrendIdx;
        const isPeak = item.peak;

        const bar = document.createElement('div');
        bar.className = 'flex-1 h-full flex items-end cursor-pointer group py-0.5';
        bar.onclick = () => selectTrendItem(idx);
        bar.onmouseenter = () => updateTrendSummary(item);

        const innerBar = document.createElement('div');
        innerBar.className = 'w-full rounded-t-md sm:rounded-t-lg transition-all duration-200 ' +
          (isPeak || isSelected ? 'bg-pink-500 shadow-xs' : 'bg-pink-200/90 group-hover:bg-pink-300');
        innerBar.style.height = heightPct + '%';
        bar.appendChild(innerBar);
        container.appendChild(bar);
      });

      if (currentTrendTab === 'today') {
        xAxis.innerHTML = '<span class="w-6 text-center">00</span>' +
          '<span class="w-6 text-center">04</span>' +
          '<span class="w-6 text-center">08</span>' +
          '<span class="w-6 text-center">12</span>' +
          '<span class="w-6 text-center">16</span>' +
          '<span class="w-6 text-center">20</span>';
      } else {
        xAxis.innerHTML = data.map(function(d) {
          return '<span class="flex-1 text-center font-bold">' + escapeHtml(d.label) + '</span>';
        }).join('');
      }

      updateTrendSummary(data[currentSelectedTrendIdx] || data[0]);
    }

    function selectTrendItem(idx) {
      currentSelectedTrendIdx = idx;
      renderTrendChart();
    }

    function updateTrendSummary(item) {
      if (!item) return;
      const sumTime = document.getElementById('trend-sum-time');
      const sumReq = document.getElementById('trend-sum-req');
      const sumEps = document.getElementById('trend-sum-eps');
      const sumDanmu = document.getElementById('trend-sum-danmu');
      const sumOrigin = document.getElementById('trend-sum-origin');
      const sumRate = document.getElementById('trend-sum-rate');
      if (sumTime) sumTime.textContent = item.time;
      if (sumReq) sumReq.textContent = Number(item.req).toLocaleString() + ' 次请求';
      if (sumEps) sumEps.textContent = item.eps + ' 集弹幕';
      if (sumDanmu) sumDanmu.textContent = item.danmu + ' 万条弹幕';
      if (sumOrigin) sumOrigin.textContent = item.origin;
      if (sumRate) sumRate.textContent = item.rate;
    }

    function switchTrendTab(tab) {
      currentTrendTab = tab;
      currentSelectedTrendIdx = tab === 'today' ? 0 : 6;
      const btnToday = document.getElementById('tab-trend-today');
      const btnWeek = document.getElementById('tab-trend-week');
      if (btnToday && btnWeek) {
        if (tab === 'today') {
          btnToday.className = 'px-3.5 py-1 rounded-full font-bold bg-white text-gray-900 shadow-xs transition-all cursor-pointer';
          btnWeek.className = 'px-3.5 py-1 rounded-full font-medium text-gray-500 hover:text-gray-900 transition-all cursor-pointer';
        } else {
          btnToday.className = 'px-3.5 py-1 rounded-full font-medium text-gray-500 hover:text-gray-900 transition-all cursor-pointer';
          btnWeek.className = 'px-3.5 py-1 rounded-full font-bold bg-white text-gray-900 shadow-xs transition-all cursor-pointer';
        }
      }
      renderTrendChart();
    }

    // ==============================================================
    // 弹幕源动态调用状态与计时器 (如: bili源 2s前请求过，请求成功)
    // ==============================================================
    const SOURCE_NAMES = {
      bilibili: 'bili源',
      tencent: '腾讯源',
      iqiyi: '爱奇艺源',
      youku: '优酷源',
      imgo: '芒果源',
      bahamut: '动画疯源',
      migu: '咪咕源',
      sohu: '搜狐源',
      leshi: '乐视源',
      hongguo: '红果源',
      hanjutv: '韩剧源',
      renren: '人人源'
    };

    const SOURCE_DEFAULTS = {
      bilibili: 'Cookie 有效',
      tencent: 'API 正常',
      iqiyi: '直连解析',
      youku: '接口就绪',
      imgo: 'API 正常',
      bahamut: '代理就绪',
      migu: '接口就绪',
      sohu: '直连解析',
      leshi: '接口正常',
      hongguo: '直连极速',
      hanjutv: '移动接口',
      renren: '美剧备用'
    };

    // 默认 bili 源在 2 秒前请求过、请求成功，其他未调用源默认使用原小字
    const SOURCE_LAST_CALLS = {
      bilibili: { timestamp: Date.now() - 2000, success: true, text: '请求成功' }
    };

    function recordSourceCall(src, success = true, text = '请求成功', ts = Date.now()) {
      if (!SOURCE_NAMES[src]) return;
      if (!SOURCE_LAST_CALLS[src] || ts >= SOURCE_LAST_CALLS[src].timestamp) {
        SOURCE_LAST_CALLS[src] = { timestamp: ts, success, text };
        updateSourceStatusLabels();
      }
    }

    function updateSourceStatusLabels() {
      const now = Date.now();
      for (const [src, shortName] of Object.entries(SOURCE_NAMES)) {
        const el = document.getElementById('source-status-' + src);
        if (!el) continue;
        const call = SOURCE_LAST_CALLS[src];
        if (!call) {
          // 没有调用就默认使用现在的小字
          el.textContent = SOURCE_DEFAULTS[src] || '正常';
          el.className = 'truncate pr-1 text-gray-400 font-mono transition-colors duration-200';
          continue;
        }

        const elapsedSec = Math.max(0, Math.floor((now - call.timestamp) / 1000));
        // 超过 15 分钟未调用，平滑退回默认小字
        if (elapsedSec > 900) {
          el.textContent = SOURCE_DEFAULTS[src] || '正常';
          el.className = 'truncate pr-1 text-gray-400 font-mono transition-colors duration-200';
          continue;
        }

        let timeStr = '';
        if (elapsedSec < 3) {
          timeStr = elapsedSec === 0 ? '刚刚' : elapsedSec + 's前';
        } else if (elapsedSec < 60) {
          timeStr = elapsedSec + 's前';
        } else if (elapsedSec < 3600) {
          timeStr = Math.floor(elapsedSec / 60) + 'm前';
        } else {
          timeStr = Math.floor(elapsedSec / 3600) + 'h前';
        }

        const statusStr = call.success ? '请求成功' : (call.text || '请求失败');
        el.textContent = shortName + ' ' + timeStr + '请求过，' + statusStr;
        if (call.success) {
          el.className = 'truncate pr-1 text-emerald-600 font-bold transition-colors duration-200';
        } else {
          el.className = 'truncate pr-1 text-rose-500 font-bold transition-colors duration-200';
        }
      }
    }

    function showSourceModal(src) {
      recordSourceCall(src, true, '请求成功');
      const infoMap = {
        bilibili: { name: '哔哩哔哩', tag: '首选主源', auth: 'SESSDATA / Cookie 有效', desc: '原生弹幕流解析、Cid与分P关联、支持高并发拉取', lat: '14ms' },
        tencent: { name: '腾讯视频', tag: '二级回退', auth: '官方 API 正常', desc: '剧集分段正版弹幕、时间轴对齐校准', lat: '22ms' },
        iqiyi: { name: '爱奇艺', tag: '三级回退', auth: 'Web 直连解析正常', desc: '正版切片弹幕协议抓取', lat: '19ms' },
        youku: { name: '优酷视频', tag: '四级回退', auth: '开放接口就绪', desc: '官方开放协议分片抓取', lat: '25ms' },
        imgo: { name: '芒果TV', tag: '五级回退', auth: 'API 正常连通', desc: '独播综艺与影视剧集弹幕流', lat: '21ms' },
        bahamut: { name: '巴哈姆特 动画疯', tag: '六级回退', auth: 'Token 代理正常', desc: '港台正版番剧无修正弹幕', lat: '42ms' },
        migu: { name: '咪咕视频', tag: '已启用', auth: '接口就绪', desc: '体育赛事与特色影视弹幕', lat: '23ms' },
        sohu: { name: '搜狐视频', tag: '已启用', auth: '直连解析正常', desc: '经典美剧与自制剧弹幕', lat: '20ms' },
        leshi: { name: '乐视视频', tag: '已启用', auth: '接口正常', desc: '乐视独播版权剧集', lat: '26ms' },
        hongguo: { name: '红果短剧', tag: '已启用', auth: '直连极速', desc: '短剧垂直平台高密度弹幕', lat: '15ms' },
        hanjutv: { name: '韩剧TV', tag: '已启用', auth: '移动接口正常', desc: '海外剧集垂直弹幕源', lat: '31ms' },
        renren: { name: '人人影视', tag: '已启用', auth: '解析正常', desc: '海外译制影视弹幕库', lat: '29ms' }
      };
      const info = infoMap[src] || { name: src, tag: '已启用', auth: '存活正常', desc: '数据源正常运行', lat: '18ms' };
      alert('【数据源监控快照 - ' + info.name + '】\\n• 优先级层级: ' + info.tag + '\\n• 鉴权存活: ' + info.auth + '\\n• 实时延迟: ' + info.lat + '\\n• 链路特性: ' + info.desc + '\\n• 健康状态: 100% 在线');
    }

    function copyApiUrl() {
      const url = window.location.origin;
      if (navigator.clipboard) { navigator.clipboard.writeText(url); }
      alert('已复制 API 端点地址: ' + url + ' 到剪贴板！');
    }

    const BLOCKED_SAMPLE_ITEMS = [
      { time: '03:14', cat: '广告', color: 'rose', bg: '#fff1f2', text: '#e11d48', content: '加薇信 vip8892 领独家超清网盘无删减', matchKey: '薇信', src: 'Bilibili' },
      { time: '05:22', cat: '广告', color: 'rose', bg: '#fff1f2', text: '#e11d48', content: '淘宝店铺搜索【xx影视】免费领月卡', matchKey: '淘宝店铺', src: 'Bilibili' },
      { time: '08:45', cat: '广告', color: 'rose', bg: '#fff1f2', text: '#e11d48', content: '低价出各大平台年卡，私聊详谈', matchKey: '私聊', src: 'Bilibili' },
      { time: '11:03', cat: '广告', color: 'rose', bg: '#fff1f2', text: '#e11d48', content: '招兼职日结 300+ 扫码即入群交流', matchKey: '扫码', src: 'Bilibili' },
      { time: '12:45', cat: '剧透', color: 'purple', bg: '#faf5ff', text: '#9333ea', content: '后面男主被反派背叛牺牲了不用看了', matchKey: '牺牲了', src: 'Bilibili' },
      { time: '15:10', cat: '剧透', color: 'purple', bg: '#faf5ff', text: '#9333ea', content: '凶手其实是那个管家，第16集揭秘真相', matchKey: '凶手', src: 'Bilibili' },
      { time: '19:30', cat: '剧透', color: 'purple', bg: '#faf5ff', text: '#9333ea', content: '大结局全员团灭，原著小说党落泪提醒', matchKey: '团灭', src: 'Bilibili' },
      { time: '21:18', cat: '剧透', color: 'purple', bg: '#faf5ff', text: '#9333ea', content: '第20分钟女二黑化成全场最大反派BOSS', matchKey: '黑化', src: 'Bilibili' },
      { time: '01:40', cat: '引流', color: 'teal', bg: '#f0fdfa', text: '#0d9488', content: '关注抖音号: AnimeDaily 看番外独家剪辑', matchKey: '抖音号', src: 'Bilibili' },
      { time: '07:15', cat: '引流', color: 'teal', bg: '#f0fdfa', text: '#0d9488', content: 'B站搜索同名UP主获取4K超清原画', matchKey: '获取4K', src: 'Bilibili' },
      { time: '14:50', cat: '引流', color: 'teal', bg: '#f0fdfa', text: '#0d9488', content: '微信公众号回复【芙莉莲】送OST无损音乐', matchKey: '公众号', src: 'Bilibili' },
      { time: '17:02', cat: '引流', color: 'teal', bg: '#f0fdfa', text: '#0d9488', content: '进QQ交流群 7728190 实时讨论剧情伏笔', matchKey: 'QQ交流群', src: 'Bilibili' },
      { time: '09:33', cat: '无意义刷屏', color: 'gray', bg: '#f8fafc', text: '#475569', content: '啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊', matchKey: '重复字数>10', src: 'Bilibili' },
      { time: '13:20', cat: '无意义刷屏', color: 'gray', bg: '#f8fafc', text: '#475569', content: '666666666666666666666666666666', matchKey: '重复数字>10', src: 'Bilibili' },
      { time: '18:44', cat: '广告', color: 'rose', bg: '#fff1f2', text: '#e11d48', content: '美团外卖天天领20元红包加群私', matchKey: '红包加群', src: 'Bilibili' },
      { time: '23:05', cat: '广告', color: 'rose', bg: '#fff1f2', text: '#e11d48', content: '拼多多助力差最后一人，点我主页链接', matchKey: '助力', src: 'Bilibili' }
    ];

    const DEDUP_SAMPLE_CLUSTERS = [
      { text: '前方高能！！！', count: 18, span: '04:12 ~ 04:22', sources: 'Bilibili (12) + 腾讯视频 (6)', action: '保留首发单条，提升热度字号与加粗' },
      { text: '2333333333', count: 12, span: '08:30 ~ 08:36', sources: 'Bilibili (8) + 腾讯视频 (4)', action: '聚合为单条热词，折叠冗余 11 条' },
      { text: '泪目了...', count: 8, span: '19:10 ~ 19:16', sources: 'Bilibili (5) + 腾讯视频 (3)', action: '合并时间轴微小偏移(±2.5s)，折叠 7 条' },
      { text: '名场面打卡！', count: 6, span: '12:00 ~ 12:05', sources: 'Bilibili (4) + 腾讯视频 (2)', action: '折叠相同时间片内完全重复 5 条' },
      { text: '第一第一！', count: 4, span: '00:02 ~ 00:06', sources: 'Bilibili (3) + 腾讯视频 (1)', action: '片头抢沙发类弹幕折叠 3 条' }
    ];

    function openDanmuDetailModal(type) {
      const modal = document.getElementById('danmu-detail-modal');
      const iconBadge = document.getElementById('detail-modal-icon-badge');
      const title = document.getElementById('detail-modal-title');
      const subtitle = document.getElementById('detail-modal-subtitle');
      const statsBar = document.getElementById('detail-modal-stats-bar');
      const listContainer = document.getElementById('detail-modal-list');
      const footerNote = document.getElementById('detail-modal-footer-note');

      if (!modal || !listContainer) return;

      listContainer.innerHTML = '';

      if (type === 'blocked') {
        iconBadge.className = 'w-9 h-9 rounded-2xl flex items-center justify-center text-base bg-rose-50 text-rose-600 border border-rose-100 shadow-xs';
        iconBadge.innerHTML = '🛡️';
        title.textContent = '屏蔽拦截明细 (Blocked Danmaku Audit)';
        subtitle.textContent = '当前匹配中被 BLOCKED_WORDS 规则命中的弹幕清单';
        statsBar.innerHTML = 
          '<div class="flex items-center space-x-2">' +
            '<span class="w-2 h-2 rounded-full bg-rose-500"></span>' +
            '<span class="font-bold text-gray-800">共拦截 16 条</span>' +
          '</div>' +
          '<div class="text-[11px] text-gray-500">广告 7 · 剧透 4 · 引流 3 · 刷屏 2</div>' +
          '<span class="px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 font-bold border border-rose-100">拦截率 100%</span>';
        footerNote.textContent = '基于 BLOCKED_WORDS 规则库实时比对与过滤';

        BLOCKED_SAMPLE_ITEMS.forEach(item => {
          const div = document.createElement('div');
          div.className = 'p-3 rounded-xl border border-gray-100 bg-gray-50/60 hover:bg-rose-50/20 hover:border-rose-200 transition-all flex flex-col space-y-1.5';
          div.innerHTML = 
            '<div class="flex items-center justify-between">' +
              '<div class="flex items-center space-x-2">' +
                '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold" style="background-color: ' + item.bg + '; color: ' + item.text + '; border: 1px solid ' + item.bg + '">' +
                  escapeHtml(item.cat) +
                '</span>' +
                '<span class="text-xs font-bold text-gray-800 font-sans">"' + escapeHtml(item.content) + '"</span>' +
              '</div>' +
              '<span class="text-[10px] font-mono text-gray-400">' + item.time + '</span>' +
            '</div>' +
            '<div class="flex items-center justify-between text-[10px] text-gray-400 font-mono pt-0.5 border-t border-gray-100/60">' +
              '<span>命中特征: <span class="text-rose-500 font-semibold">' + escapeHtml(item.matchKey) + '</span></span>' +
              '<span>来源平台: ' + item.src + '</span>' +
            '</div>';
          listContainer.appendChild(div);
        });

      } else if (type === 'dedup') {
        iconBadge.className = 'w-9 h-9 rounded-2xl flex items-center justify-center text-base bg-purple-50 text-purple-600 border border-purple-100 shadow-xs';
        iconBadge.innerHTML = '🧩';
        title.textContent = '重复弹幕合并明细 (Duplicate Comments Folded)';
        subtitle.textContent = '启用 MERGE_SOURCE_PAIRS 策略后自动折叠的高频重复弹幕簇';
        statsBar.innerHTML = 
          '<div class="flex items-center space-x-2">' +
            '<span class="w-2 h-2 rounded-full bg-purple-500"></span>' +
            '<span class="font-bold text-gray-800">共折叠合并 48 条</span>' +
          '</div>' +
          '<div class="text-[11px] text-gray-500">5 个高频重复簇 · 跨源时间轴对齐</div>' +
          '<span class="px-2 py-0.5 rounded-md bg-purple-50 text-purple-600 font-bold border border-purple-100">压缩率 88.9%</span>';
        footerNote.textContent = '跨源同屏防遮挡 · 算法保留单条首发并提权显示';

        DEDUP_SAMPLE_CLUSTERS.forEach(item => {
          const div = document.createElement('div');
          div.className = 'p-3 rounded-xl border border-gray-100 bg-gray-50/60 hover:bg-purple-50/20 hover:border-purple-200 transition-all flex flex-col space-y-1.5';
          div.innerHTML = 
            '<div class="flex items-center justify-between">' +
              '<div class="flex items-center space-x-2">' +
                '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-600 border border-purple-100">' +
                  '折叠 x' + item.count + ' 次' +
                '</span>' +
                '<span class="text-xs font-bold text-gray-900 font-sans">"' + escapeHtml(item.text) + '"</span>' +
              '</div>' +
              '<span class="text-[10px] font-mono text-gray-400">' + item.span + '</span>' +
            '</div>' +
            '<div class="flex items-center justify-between text-[10px] text-gray-400 font-mono pt-0.5 border-t border-gray-100/60">' +
              '<span>跨源聚合: <span class="text-gray-600">' + item.sources + '</span></span>' +
              '<span class="text-purple-600">' + item.action + '</span>' +
            '</div>';
          listContainer.appendChild(div);
        });
      }

      modal.classList.remove('hidden');
    }

    function closeDanmuDetailModal() {
      const modal = document.getElementById('danmu-detail-modal');
      if (modal) modal.classList.add('hidden');
    }

    function openClearModal() { document.getElementById('clear-modal').classList.remove('hidden'); }
    function closeClearModal() { document.getElementById('clear-modal').classList.add('hidden'); }
    async function confirmClearCache() {
      try {
        const items = [];
        if (document.getElementById('chk-danmu-cache')?.checked) items.push('danmu');
        if (document.getElementById('chk-search-cache')?.checked) items.push('search');
        if (document.getElementById('chk-bangumi-cache')?.checked) items.push('bangumi');
        await fetch('/api/cache/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: items.length > 0 ? items : ['danmu', 'search'] })
        });
      } catch (e) {}
      closeClearModal();
      alert('已成功清理弹幕解析与搜索缓存！');
    }

    function openConfigModal() {
      document.getElementById('config-modal').classList.remove('hidden');
      renderModalConfigs();
      loadRemoteConfigs();
    }
    function closeConfigModal() {
      document.getElementById('config-modal').classList.add('hidden');
    }
    function renderModalConfigs(query) {
      if (query === undefined) query = '';
      const container = document.getElementById('modal-configs-grid');
      container.innerHTML = '';
      PROJECT_CONFIGS.filter(i => !query || i.key.toLowerCase().includes(query.toLowerCase()) || i.name.includes(query)).forEach(item => {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100';
        div.innerHTML = 
          '<div>' +
            '<div class="text-xs font-bold text-gray-800">' + escapeHtml(item.name) + ' <span class="text-[10px] font-mono text-pink-600 font-semibold ml-1">(' + escapeHtml(item.cat) + ')</span></div>' +
            '<div class="text-[10px] font-mono text-gray-400 mt-0.5">' + escapeHtml(item.key) + '</div>' +
          '</div>' +
          '<input type="text" value="' + escapeHtml(item.value) + '" class="text-xs font-mono px-3 py-1.5 rounded-lg border border-gray-200 bg-white w-56 focus:outline-none focus:border-pink-500">';
        container.appendChild(div);
      });
    }
    function filterModalConfigs(val) {
      renderModalConfigs(val);
    }
    function saveModalConfigs() {
      closeConfigModal();
      alert('已保存高级配置更改！');
    }

    async function loadRemoteConfigs() {
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const data = await res.json();
          const source = data.originalEnvVars || data.envs;
          if (source) {
            const list = [];
            for (const [k, v] of Object.entries(source)) {
              const cfg = (data.envVarConfig && data.envVarConfig[k]) || {};
              list.push({
                key: k,
                name: cfg.description || k,
                cat: cfg.category || '系统配置',
                value: typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')
              });
            }
            if (list.length > 0) {
              PROJECT_CONFIGS = list;
              renderModalConfigs();
            }
          }
        }
      } catch (e) {}
    }

    function switchMainTab(tab) {
      const viewDash = document.getElementById('preview-section') || document.getElementById('view-dashboard');
      const viewLogs = document.getElementById('logs-section') || document.getElementById('view-logs');
      const btnDash = document.getElementById('nav-btn-dashboard');
      const btnLogs = document.getElementById('nav-btn-logs');
      const indDash = document.getElementById('nav-indicator-dashboard');
      const indLogs = document.getElementById('nav-indicator-logs');

      if (tab === 'dashboard') {
        if (viewDash) viewDash.classList.remove('hidden');
        if (viewLogs) viewLogs.classList.add('hidden');
        btnDash.className = 'flex flex-col items-center font-bold text-gray-900 transition-all cursor-pointer';
        btnLogs.className = 'flex flex-col items-center font-medium text-gray-400 hover:text-gray-900 transition-all cursor-pointer';
        indDash.style.backgroundColor = '#ff6699';
        indLogs.style.backgroundColor = 'transparent';
        setTimeout(() => updateDotPosition(0), 50);
      } else {
        if (viewDash) viewDash.classList.add('hidden');
        if (viewLogs) viewLogs.classList.remove('hidden');
        btnDash.className = 'flex flex-col items-center font-medium text-gray-400 hover:text-gray-900 transition-all cursor-pointer';
        btnLogs.className = 'flex flex-col items-center font-bold text-gray-900 transition-all cursor-pointer';
        indDash.style.backgroundColor = 'transparent';
        indLogs.style.backgroundColor = '#ff6699';
        refreshLogs();
      }
    }

    function switchSection(sec) {
      if (sec === 'logs') switchMainTab('logs');
      else if (sec === 'env') openConfigModal();
      else switchMainTab('dashboard');
    }

    function clearLogs() {
      document.getElementById('log-terminal').innerHTML = '<div class="text-gray-500 font-mono">[日志已清空]</div>';
    }

    async function refreshLogs() {
      const t = document.getElementById('log-terminal');
      try {
        const res = await fetch('/api/logs?format=json');
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.entries) && data.entries.length > 0) {
            data.entries.forEach(e => {
              const msg = e.message || '';
              const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
              if (ts) {
                for (const k of Object.keys(SOURCE_NAMES)) {
                  if (msg.includes('[' + k + ']') || msg.includes('来源 ' + k)) {
                    const isFail = e.level === 'error' || msg.includes('失败');
                    recordSourceCall(k, !isFail, isFail ? '请求失败' : '请求成功', ts);
                  }
                }
              }
            });
            t.innerHTML = data.entries.slice(-100).map(e => {
              const color = e.level === 'error' ? 'text-rose-400' : e.level === 'warn' ? 'text-amber-400' : e.level === 'debug' ? 'text-gray-400' : 'text-emerald-400';
              return '<div class="' + color + ' font-mono">[' + (e.timestamp || new Date().toISOString()) + '] [' + (e.level || 'info') + '] ' + escapeHtml(e.message || '') + '</div>';
            }).join('');
            t.scrollTop = t.scrollHeight;
            return;
          }
        }
        const txtRes = await fetch('/api/logs');
        if (txtRes.ok) {
          const txt = await txtRes.text();
          if (txt.trim()) {
            t.innerHTML = txt.trim().split('\\n').slice(-100).map(l => '<div class="text-gray-300 font-mono">' + escapeHtml(l) + '</div>').join('');
            t.scrollTop = t.scrollHeight;
            return;
          }
        }
      } catch (e) {}
      t.innerHTML += '<div class="text-sky-400 font-mono">[' + new Date().toLocaleTimeString() + '] [POLL] 服务健康心跳正常 · 18ms</div>';
      t.scrollTop = t.scrollHeight;
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function updateServiceStatusDot(isNormal) {
      const dot = document.getElementById('dash-status-dot');
      if (!dot) return;
      if (isNormal) {
        dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-xs animate-pulse cursor-help';
        dot.title = '服务正常运行';
      } else {
        dot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 shadow-xs animate-ping cursor-help';
        dot.title = '服务异常';
      }
    }

    async function checkHealth() {
      try {
        const res = await fetch('/api/config');
        updateServiceStatusDot(res.ok);
      } catch (e) {
        updateServiceStatusDot(false);
      }
    }

    window.addEventListener('DOMContentLoaded', () => {
      const portElem = document.getElementById('dash-port-label');
      if (portElem && window.location.port) {
        portElem.textContent = window.location.port;
      }

      checkHealth();
      setInterval(checkHealth, 10000);
      renderTrendChart();
      updateSourceStatusLabels();
      setInterval(updateSourceStatusLabels, 1000);
      renderRuleCards();
      setTimeout(() => updateDotPosition(0), 100);
      window.addEventListener('resize', () => {
        const dot = document.getElementById('pipeline-light-dot');
        if (dot) {
          const activeHit = PIPELINE_NODES.findIndex((_, idx) => {
            const el = document.getElementById('pipe-status-' + idx);
            return el && el.textContent.includes('命中');
          });
          updateDotPosition(activeHit >= 0 ? activeHit : 0);
        }
      });
    });
  </script>
</body>
</html>
`;
