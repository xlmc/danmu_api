import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { systemSettingsJsContent } from './ui/js/systemsettings.js';
import { BLOCKED_WORD_PRESETS } from './utils/blocked-word-presets.js';

function settingsContext() {
  const context = vm.createContext({ window: { addEventListener() {} }, document: { body: { dataset: {} }, querySelectorAll() { return []; }, getElementById(id) { return id === 'env-form' ? { addEventListener() {} } : null; }, addEventListener() {} } });
  vm.runInContext(systemSettingsJsContent, context);
  return context;
}

test('generated settings script is executable and classifies only exact presets', () => {
  const context = settingsContext();
  const classify = context.blockedWordKind;
  assert.equal(classify('打卡'), '普通词');
  assert.equal(classify('/foo{1,3}/i'), '其他正则');
  assert.equal(classify('/时间|地区/u'), '其他正则');
  for (const value of BLOCKED_WORD_PRESETS.dates) assert.equal(classify(value), '日期时间正则');
  for (const value of BLOCKED_WORD_PRESETS.regions) assert.equal(classify(value), '地区正则');
  assert.equal(classify(BLOCKED_WORD_PRESETS.dates[0].replace('/u', '/i')), '其他正则');
});

test('grouping preserves original edit indexes and serialized order', () => {
  const context = settingsContext();
  const rows = ['/foo{1,3}/i', '打卡', BLOCKED_WORD_PRESETS.dates[1], '签到', '前排', '来了'];
  const groups = context.groupBlockedWords(rows);
  assert.deepEqual(Array.from(groups, g => g.kind), ['普通词', '日期时间正则', '其他正则']);
  assert.deepEqual(Array.from(groups[0].entries, entry => entry.index), [1, 3, 4, 5]);
  assert.deepEqual(Array.from(context.splitBlockedWords(context.serializeBlockedWords(rows))), rows);
});
