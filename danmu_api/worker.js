import { handleMappingShare } from './utils/mapping-share-util.js';
import { initializePersistentCaches } from './utils/persistent-cache-util.js';
import { Globals } from './configs/globals.js';
import { jsonResponse } from './utils/http-util.js';
import { log, formatLogMessage } from './utils/log-util.js'

import { cleanupExpiredIPs, findUrlById, getCommentCache, judgeLocalCacheValid } from "./utils/cache-util.js";
import { formatDanmuResponse } from "./utils/danmu-util.js";

import { getBangumi, getComment, getCommentByUrl, getSegmentComment, matchAnime, searchAnime, searchEpisodes } from "./apis/player-api.js";

import { getFongmiDanmaku } from "./apis/clients/fongmi-api.js";
import { handleConfig, handleUI, handleLogs, handleClearLogs, handleClearCache, handleCacheAnimes, handleRemoteMappingLogs, handleRemoteMappingRefresh, handleRemoteAutoMatchMappingRefresh } from "./apis/system-api.js";

import { handleSetEnv, handleAddEnv, handleDelEnv } from './apis/env-api.js';


import { Segment } from "./models/player-model.js"
import {
    handleCookieStatus,
    handleCookieVerify,
    handleQRGenerate,
    handleQRCheck,
    handleCookieSave
} from "./utils/cookie-util.js";

let globals;

async function handleRequest(req, env, deployPlatform, clientIp) {
  // 加载全局变量和环境变量配置
  globals = Globals.init(env);

  const url = new URL(req.url);
  let path = url.pathname;
  const method = req.method;
  const isLogReadRequest = method === 'GET' && /(?:^|\/)api\/logs(?:\/remote-mapping)?\/?$/.test(path);

  globals.deployPlatform = deployPlatform;

  if (!isLogReadRequest) {
    log("debug", `[system] [server] request url: ${JSON.stringify(url)}`);
    log("debug", `[system] [server] request path: ${path}`);
    log("debug", `[system] [server] client ip: ${clientIp}`);
  }



  // --- 校验 token ---
  const parts = path.split("/").filter(Boolean); // 去掉空段

  const knownApiPaths = ["api", "v1", "v2", "search", "match", "bangumi", "comment", "danmaku"];

  const firstPart = parts[0] || "";
  const tokenAuthDisabled = globals.tokenAuthDisabled === true;
  const isDefaultToken = globals.token === "87654321";
  const isValidToken = tokenAuthDisabled || firstPart === globals.token || firstPart === globals.adminToken;
  const explicitToken = tokenAuthDisabled ? "" : (firstPart === globals.token || (globals.adminToken && firstPart === globals.adminToken)
    ? firstPart
    : "");

  globals.currentToken = tokenAuthDisabled ? "" : (
    isValidToken ? firstPart :
    isDefaultToken && (firstPart === "87654321" || knownApiPaths.includes(firstPart)) ?
      (firstPart === "87654321" ? firstPart : "87654321") :
    "");


  await initializePersistentCaches();

  // 检查路径是否包含指定的接口关键字
  

  

  // GET /
  if (path === "/" && method === "GET") {
    return handleUI();
  }

  if (path === "/favicon.ico" || path === "/robots.txt" || method === "OPTIONS") {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, User-Agent"
        }
    });
  }

  // 关闭 TOKEN 鉴权时允许直接访问所有路径；仍兼容携带 token 的旧入口。
  if (tokenAuthDisabled) {
    if (firstPart === globals.token || (globals.adminToken && firstPart === globals.adminToken)) {
      path = "/" + parts.slice(1).join("/");
    }
  // 如果 token 是默认值 87654321
  } else if (globals.token === "87654321") {
    if (parts.length > 0) {
      // 如果第一段是正确的默认 token
      if (parts[0] === "87654321" || parts[0] === globals.adminToken) {
        // 移除 token，继续处理
        path = "/" + parts.slice(1).join("/");
      } else if (!knownApiPaths.includes(parts[0])) {
        // 对于 /api/config 路径，我们允许无 token 访问，但返回有限信息
        if (path === "/api/config" && method === "GET") {
          return handleConfig(false); // 无权限
        }
        // 第一段不是已知的 API 路径，可能是错误的 token
        // 返回 401
        log("error", `[system] [server] Invalid token in path: ${path}`);
        return jsonResponse(
          { errorCode: 401, success: false, errorMessage: "Unauthorized" },
          401
        );
      }
      // 如果第一段是已知的 API 路径（如 "api"），允许直接访问
    }
  } else {
    // token 不是默认值，必须严格校验
    if (parts.length < 1 || (parts[0] !== globals.token && parts[0] !== globals.adminToken)) {
      // 对于 /api/config 路径，如果使用默认 token，我们允许无 token 访问，但返回有限信息
      if (path === "/api/config" && method === "GET") {
        return handleConfig(false); // 无权限
      }
      {
        log("error", `[system] [server] Invalid or missing token in path: ${path}`);
        return jsonResponse(
          { errorCode: 401, success: false, errorMessage: "Unauthorized" },
          401
        );
      }
    } else {
      // 移除 token 部分，剩下的才是真正的路径
      path = "/" + parts.slice(1).join("/");
    }
  }

  // 兼容部分客户端将自定义弹幕短地址再次拼接官方完整路径的情况
  // 例如: /danmaku/api/v2/fongmi/danmaku?name=...&episode=...
  if (path.endsWith("/danmaku/api/v2/fongmi/danmaku")) {
    log("debug", `[system] [path fix] Collapsed nested danmaku path: "${path}" -> "/danmaku"`);
    path = "/danmaku";
  }

  // GET /api/config - 获取配置信息 (需要 token)
  if (path === "/api/config" && method === "GET") {
    return handleConfig(true); // 有权限
  }

  if (method === 'POST' && (path.startsWith('/api/env/') || path === '/api/cache/clear' || path === '/api/cookie/save' || path === '/api/title-mapping/share')) {
    const configAdmin = tokenAuthDisabled || (globals.adminToken
      ? explicitToken === globals.adminToken
      : (explicitToken === globals.token || isDefaultToken));
    if (!configAdmin) return jsonResponse({ success: false, message: '需要 ADMIN_TOKEN 权限' }, 403);
  }

  

  if (!isLogReadRequest) log("debug", `[system] [server] ${path}`);

  // 智能处理API路径前缀，确保最终有一个正确的 /api/v2
  if (path !== "/" && path !== "/danmaku" && path !== "/api/logs" && !path.startsWith('/api/env') && !path.startsWith('/api/cache')
    && !path.startsWith('/api/cookie') && !path.startsWith('/api/config')
    && !path.startsWith('/api/title-mapping') && !path.startsWith('/api/auto-match-mapping')) {
      log("debug", `[system] [path check] Starting path normalization for: "${path}"`);
      const pathBeforeCleanup = path; // 保存清理前的路径检查是否修改

      // 清理：应对"用户填写/api/v2"+"客户端添加/api/v2"导致的重复前缀
      path = path.replace(/\/+/g, '/');
      while (path.startsWith('/api/v2/api/v2/')) {
          log("debug", `[system] [path check] Found redundant /api/v2 prefix. Cleaning...`);
          // 从第二个 /api/v2 的位置开始截取，相当于移除第一个
          path = path.substring('/api/v2'.length);
      }

      // 打印日志：只有在发生清理时才显示清理后的路径，否则显示"无需清理"
      if (path !== pathBeforeCleanup) {
          log("debug", `[system] [path check] Path after cleanup: "${path}"`);
      } else {
          log("debug", `[system] [path check] Path after cleanup: No cleanup needed.`);
      }

      // 补全：如果路径缺少前缀（例如请求原始路径为 /search/anime 或 /v2/search/anime），则智能补全
      const pathBeforePrefixCheck = path;
      if (!path.startsWith('/api/v2') && path !== '/' && !path.startsWith('/api/logs')
        && !path.startsWith('/api/env') && !path.startsWith('/api/cache')
        && !path.startsWith('/api/cookie') && !path.startsWith('/api/config')
        && !path.startsWith('/api/title-mapping') && !path.startsWith('/api/auto-match-mapping')) {
          if (path.startsWith('/v2/') || path === '/v2') {
              log("debug", `[system] [path check] Path is missing /api prefix. Adding /api...`);
              path = '/api' + path;
          } else if (path.startsWith('/api/') || path === '/api') {
              log("debug", `[system] [path check] Path is missing /v2 prefix. Adding /v2...`);
              path = '/api/v2' + path.substring(4);
          } else {
              log("debug", `[system] [path check] Path is missing /api/v2 prefix. Adding /api/v2...`);
              path = '/api/v2' + (path.startsWith('/') ? path : '/' + path);
          }
      }

      // 打印日志：只有在发生添加前缀时才显示添加后的路径，否则显示"无需补全"
      if (path === pathBeforePrefixCheck) {
          log("debug", `[system] [path check] Prefix Check: No prefix addition needed.`);
      }

      log("debug", `[system] [path check] Final normalized path: "${path}"`);
  }

  // GET /
  if (path === "/" && method === "GET") {
    return handleUI();
  }

  // GET /api/v2/search/anime
  if (path === "/api/v2/search/anime" && method === "GET") {
    return searchAnime(url, null, null, null, null, false, null, null, null, clientIp);
  }

  // GET /api/v2/search/episodes
  if (path === "/api/v2/search/episodes" && method === "GET") {
    return searchEpisodes(url, clientIp);
  }

  // GET|POST /api/v2/fongmi/danmaku
  if (path === "/api/v2/fongmi/danmaku" && (method === "GET" || method === "POST")) {
    return getFongmiDanmaku(url, req);
  }

  // GET|POST /danmaku
  if (path === "/danmaku" && (method === "GET" || method === "POST")) {
    return getFongmiDanmaku(url, req);
  }

  // GET /api/v2/match
  if (path === "/api/v2/match" && method === "POST") {
    return matchAnime(url, req, clientIp);
  }

  // GET /api/v2/bangumi/:animeId
  if (path.startsWith("/api/v2/bangumi/") && method === "GET") {
    return getBangumi(path, null, url.searchParams.get('source'));
  }

  // GET /api/v2/comment/:commentId or /api/v2/comment?url=xxx or /api/v2/extcomment?url=xxx
  if ((path.startsWith("/api/v2/comment") || path.startsWith("/api/v2/extcomment")) && method === "GET") {
    const queryFormat = url.searchParams.get('format');
    const videoUrl = url.searchParams.get('url');
    const segmentFlagParam = url.searchParams.get('segmentflag');
    const durationParam = url.searchParams.get('duration');
    const segmentFlag = segmentFlagParam === 'true' || segmentFlagParam === '1';
    const includeDuration = durationParam === 'true' || durationParam === '1';

    // ⚠️ 限流设计说明：
    // 1. 先检查缓存，缓存命中时直接返回，不计入限流次数
    // 2. 只有缓存未命中时才执行限流检查和网络请求
    // 3. 这样可以避免频繁访问同一弹幕时被限流，提高用户体验

    // 如果有url参数，则通过URL获取弹幕
    if (videoUrl) {
      // 先检查缓存
      const cachedComments = getCommentCache(videoUrl);
      if (cachedComments !== null) {
        log("info", `[system] [Rate Limit] Cache hit for URL: ${videoUrl}, skipping rate limit check`);
        return getCommentByUrl(videoUrl, queryFormat, segmentFlag, includeDuration, url.searchParams.get('animeTitle') || '');
      }

      // 缓存未命中，执行限流检查（如果 rateLimitMaxRequests > 0 则启用限流）
      if (globals.rateLimitMaxRequests > 0) {
        const currentTime = Date.now();
        const oneMinute = 60 * 1000;

        // 清理所有过期的 IP 记录
        cleanupExpiredIPs(currentTime);

        // 检查该 IP 地址的历史请求
        if (!globals.requestHistory.has(clientIp)) {
          globals.requestHistory.set(clientIp, []);
        }

        const history = globals.requestHistory.get(clientIp);
        const recentRequests = history.filter(timestamp => currentTime - timestamp <= oneMinute);

        // 如果最近 1 分钟内的请求次数超过限制，返回 429 错误
        if (recentRequests.length >= globals.rateLimitMaxRequests) {
          log("warn", `[system] [Rate Limit] IP ${clientIp} exceeded rate limit (${recentRequests.length}/${globals.rateLimitMaxRequests} requests in 1 minute)`);
          return jsonResponse(
            { errorCode: 429, success: false, errorMessage: "Too many requests, please try again later" },
            429
          );
        }

        // 记录本次请求时间戳
        recentRequests.push(currentTime);
        globals.requestHistory.set(clientIp, recentRequests);
        log("info", `[system] [Rate Limit] IP ${clientIp} request count: ${recentRequests.length}/${globals.rateLimitMaxRequests}`);
      }

      // 通过URL获取弹幕
      return getCommentByUrl(videoUrl, queryFormat, segmentFlag, includeDuration, url.searchParams.get('animeTitle') || '');
    }

    // 否则通过commentId获取弹幕
    if (!path.startsWith("/api/v2/comment/")) {
      log("error", "[system] [server] Missing commentId or url parameter");
      return jsonResponse(
        { errorCode: 400, success: false, errorMessage: "Missing commentId or url parameter" },
        400
      );
    }

    const commentId = parseInt(path.split("/").pop());
    let urlForComment = findUrlById(commentId);

    if (urlForComment) {
      // 检查弹幕缓存 - 缓存命中时直接返回，不计入限流
      const cachedComments = getCommentCache(urlForComment);
      if (cachedComments !== null) {
        log("info", `[system] [Rate Limit] Cache hit for URL: ${urlForComment}, skipping rate limit check`);
        return getComment(path, queryFormat, segmentFlag, clientIp, includeDuration);
      }
    }

    // 缓存未命中，执行限流检查（如果 rateLimitMaxRequests > 0 则启用限流）
    if (globals.rateLimitMaxRequests > 0) {
      // 获取当前时间戳（单位：毫秒）
      const currentTime = Date.now();
      const oneMinute = 60 * 1000;  // 1分钟 = 60000 毫秒

      // 清理所有过期的 IP 记录
      cleanupExpiredIPs(currentTime);

      // 检查该 IP 地址的历史请求
      if (!globals.requestHistory.has(clientIp)) {
        // 如果该 IP 地址没有请求历史，初始化一个空队列
        globals.requestHistory.set(clientIp, []);
      }

      const history = globals.requestHistory.get(clientIp);

      // 过滤掉已经超出 1 分钟的请求
      const recentRequests = history.filter(timestamp => currentTime - timestamp <= oneMinute);

      // 如果最近的请求数量大于等于配置的限制次数，则限制请求
      if (recentRequests.length >= globals.rateLimitMaxRequests) {
        log("warn", `[system] [Rate Limit] IP ${clientIp} exceeded rate limit (${recentRequests.length}/${globals.rateLimitMaxRequests} requests in 1 minute)`);
        return jsonResponse(
          { errorCode: 429, success: false, errorMessage: "Too many requests, please try again later" },
          429
        );
      }

      // 记录本次请求时间戳
      recentRequests.push(currentTime);
      globals.requestHistory.set(clientIp, recentRequests);
      log("info", `[system] [Rate Limit] IP ${clientIp} request count: ${recentRequests.length}/${globals.rateLimitMaxRequests}`);
    }

    return getComment(path, queryFormat, segmentFlag, clientIp, includeDuration);
  }

  // POST /api/v2/segmentcomment - 接收segment类的JSON请求体
 if (path.startsWith("/api/v2/segmentcomment") && method === "POST") {
    try {
      const queryFormat = url.searchParams.get('format');
      // 从请求体获取segment数据
      const requestBody = await req.json();
      let segment;

      // 尝试解析JSON
      try {
        segment = Segment.fromJson(requestBody);
      } catch (e) {
        log("error", "[system] [server] Invalid JSON in request body for segment");
        return jsonResponse(
          { errorCode: 400, success: false, errorMessage: "Invalid JSON in request body" },
          400
        );
      }

      // 通过URL和平台获取分段弹幕
      return getSegmentComment(segment, queryFormat);
    } catch (error) {
      log("error", `[system] [server] Error processing segmentcomment request: ${error.message}`);
      return jsonResponse(
        { errorCode: 500, success: false, errorMessage: "Internal server error" },
        500
      );
    }
  }

  // GET /api/logs
  if (path === "/api/logs" && method === "GET") {
    return handleLogs(url.searchParams.get('format'));
  }

  // GET /api/logs/remote-mapping - 远程映射表专用日志（独立缓冲区，不被源站日志冲掉）
  if (path === "/api/logs/remote-mapping" && method === "GET") {
    return handleRemoteMappingLogs();
  }

  // POST /api/title-mapping/share: protected by the same admin gate as config writes.
  if (path === '/api/title-mapping/share' && method === 'POST') {
    return handleMappingShare(req);
  }

  // POST /api/title-mapping/refresh - 管理员手动刷新远程映射表
  if (path === "/api/title-mapping/refresh" && method === "POST") {
    const configAdmin = tokenAuthDisabled || (globals.adminToken
      ? explicitToken === globals.adminToken
      : (explicitToken === globals.token || (isDefaultToken && knownApiPaths.includes(firstPart))));
    if (!configAdmin) {
      return jsonResponse({ success: false, errorMessage: "需要 ADMIN_TOKEN 权限" }, 403);
    }
    return handleRemoteMappingRefresh();
  }

  // POST /api/auto-match-mapping/refresh - 管理员手动刷新远程季集映射表
  if (path === "/api/auto-match-mapping/refresh" && method === "POST") {
    const configAdmin = tokenAuthDisabled || (globals.adminToken
      ? explicitToken === globals.adminToken
      : (explicitToken === globals.token || (isDefaultToken && knownApiPaths.includes(firstPart))));
    if (!configAdmin) {
      return jsonResponse({ success: false, errorMessage: "需要 ADMIN_TOKEN 权限" }, 403);
    }
    return handleRemoteAutoMatchMappingRefresh();
  }

  // POST /api/logs/clear
  if (path === "/api/logs/clear" && method === "POST") {
    return handleClearLogs();
  }

  // POST /api/env/set - 设置环境变量
  if (path === "/api/env/set" && method === "POST") {
    return handleSetEnv(req);
  }

  // POST /api/env/add - 添加环境变量
  if (path === "/api/env/add" && method === "POST") {
    return handleAddEnv(req);
  }

  // POST /api/env/del - 删除环境变量
  if (path === "/api/env/del" && method === "POST") {
    return handleDelEnv(req);
  }

  // POST /api/deploy - 重新部署


  // GET /api/cache/animes - 获取最近 animes 缓存
  if (path === "/api/cache/animes" && method === "GET") {
    return handleCacheAnimes();
  }

  // POST /api/cache/clear - 清理缓存
  if (path === "/api/cache/clear" && method === "POST") {
    return handleClearCache(req);
  }

  // ========== Cookie 管理 API ==========

  // GET /api/cookie/status - 获取Cookie状态
  if (path === "/api/cookie/status" && method === "GET") {
    return handleCookieStatus();
  }

  // POST /api/cookie/qr/generate - 生成登录二维码
  if (path === "/api/cookie/qr/generate" && method === "POST") {
    return handleQRGenerate();
  }

  // POST /api/cookie/qr/check - 检查二维码扫描状态
  if (path === "/api/cookie/qr/check" && method === "POST") {
    return handleQRCheck(req);
  }

  // POST /api/cookie/verify - 校验指定Cookie（用于前端实时检测）
  if (path === "/api/cookie/verify" && method === "POST") {
    return handleCookieVerify(req);
  }

  // POST /api/cookie/save - 保存Cookie
  if (path === "/api/cookie/save" && method === "POST") {
    return handleCookieSave(req);
  }





  return jsonResponse({ message: "Not found" }, 404);
}

export { handleRequest };
