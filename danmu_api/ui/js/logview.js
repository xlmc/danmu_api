import { logConsoleJsContent } from './log-console.js';
// language=JavaScript
export const logviewJsContent = /* javascript */ `
// 日志全局过滤状态
let currentLogFilter = 'ALL';

// 获取日志的严格归属分类
function getLogCategory(message) {
    // 匹配行首的连续方括号标签 (需双重转义)
    const prefixMatch = message.match(/^(?:\\s*\\[[^\\]]+\\])+/);
    if (!prefixMatch) {
        // 无标签行作为续行继承上一行的分类
        return '_inherit_';
    }
    
    const tags = prefixMatch[0].match(/\\[([^\\]]+)\\]/g).map(t => t.replace(/[\\[\\]]/g, '').trim());
    
    if (tags.some(t => t.toLowerCase() === 'ugc')) return 'match';

    // 归类合并工具日志
    // 只要行首包含 Merge，或者包含合并映射独有的子标签，强行将其收束至 Merge 专属分类
    if (tags.some(t => t.toLowerCase() === 'merge' || ['匹配', '落单', '补全', '合集', '略过', 'Merge-Check'].some(key => t.includes(key)))) {
        return 'merge';
    }

    // 远程映射表日志专属分类（仅远程表下载、匹配成功/失败日志）
    if (tags.some(t => t === 'remote-mapping')) {
        return 'remote-mapping';
    }
    // 本机/通用剧名映射日志分类
    if (tags.some(t => t === 'title-mapping')) {
        return 'title-mapping';
    }
    if (tags.some(t => ['blocked-words', 'person-filter', 'person-metadata', 'domestic-filter'].includes(t))) {
        return 'blocked-words';
    }
    
    // 排除时间戳和底层无意义标签，抓取真正的业务源
    const validTags = tags.filter(t => 
        !t.startsWith('match-id=') &&
        !/^\\d{4}-\\d{2}-\\d{2}[T ]/.test(t) && // 排除 ISO 时间戳格式（YYYY-MM-DDTHH:MM:SS）
        !/^\\d{2}:\\d{2}(:\\d{2})?$/.test(t) &&  // 排除 HH:MM:SS 时间格式（JSON 续行）
        !t.includes('08:00') &&
        t !== '请求模拟' && 
        t !== '网络请求'
    );
    
    if (validTags.length === 0) {
        // 全部标签被时间戳等过滤规则排除，作为续行继承上一行的分类
        return '_inherit_';
    }
    
    // 统一转换为小写，确保大小写变体(如 Bahamut 和 bahamut)收束至同一内部标识符
    let category = validTags[0].toLowerCase();
    
    // 标签归一化：将变体标签映射到标准分类
    const normalizationMap = {
        'vod fastest mode': 'vod',
        'custom source': 'custom',
        'bilibili-proxy': 'bilibili',
        'tmdb-source': 'tmdb',
        'path check': 'system',
        'path fix': 'system',
        'base': 'system',
        'fongmi': 'system',
    };
    if (normalizationMap[category]) {
        category = normalizationMap[category];
    }
    
    return category;
}

${logConsoleJsContent}
`;
