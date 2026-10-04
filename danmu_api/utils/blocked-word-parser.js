/**
 * 将 BLOCKED_WORDS 字符串切分为词条数组：
 * - /pattern/flags 正则词条整体识别，其内部的逗号不作为分隔符
 * - 兼容中文全角逗号（，）与英文逗号（,），以及逗号前后的空格
 * - 识别失败时（如字符类中的裸 / ）将 / 作为普通字符处理
 */
export function splitBlockedWords(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const normalized = raw.replace(/，/g, ',');

  // 尝试从 start（指向 '/'）消费一个完整的 /pattern/flags 词条，
  // 成功返回词条结束位置（分隔符处或末尾），失败返回 -1
  const tryConsumeRegexToken = (start) => {
    let j = start + 1;
    while (j < normalized.length) {
      if (normalized[j] === '\\') { j += 2; continue; }
      if (normalized[j] === '/') {
        // 候选闭合点：其后须为可选 flags（后跟分隔符或结尾）才构成完整词条
        const rest = normalized.slice(j + 1);
        const flagMatch = rest.match(/^([a-z]*)(\s*)(?:,|$)/);
        if (flagMatch) {
          // 仅消费 flags 与空白，分隔符留给主循环处理
          return j + 1 + flagMatch[1].length + flagMatch[2].length;
        }
      }
      j++;
    }
    return -1;
  };

  const segments = [];
  let buf = '';
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (ch === '/') {
      const end = tryConsumeRegexToken(i);
      if (end !== -1) {
        buf += normalized.slice(i, end);
        i = end;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }
    if (ch === ',') {
      segments.push(buf);
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim() !== '') segments.push(buf);
  return segments.map(s => s.trim()).filter(s => s !== '');
}

/** 保证逐条编辑后的逗号配置仍能无损还原为相同词条。 */
export function serializeBlockedWords(rows) {
  const value = rows.join(',');
  const parsed = splitBlockedWords(value);
  if (parsed.length !== rows.length || parsed.some((part, index) => part !== rows[index])) {
    throw new Error('无法准确分隔这些条目，请检查正则的起止斜杠和分隔逗号。');
  }
  return value;
}

