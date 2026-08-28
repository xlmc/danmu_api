import { convertCommentsToDanmux } from '../danmu_api/utils/danmux-adapter.js';
import { simulateDanmuxPlayer } from '../danmu_api/utils/danmux-player-simulator.js';

const response = convertCommentsToDanmux({
  comments: [{
    p: '12.5,1,16777215,[bilibili]',
    m: 'DanmuX v1 渐变生效测试',
    cid: 1001,
  }],
}, {
  sourceLabel: 'danmu_api',
  gradientAngle: 0,
  gradientStops: [
    { position: 0, color: '#FB7299', alpha: 0.85 },
    { position: 1, color: '#33B8FF', alpha: 0.85 },
  ],
});

const wire = response.comments[0];
const player = simulateDanmuxPlayer(wire);

console.log('DanmuX v1 downstream simulation');
console.log(`1. p/m legacy accepted: ${player.legacyAccepted ? 'PASS' : 'FAIL'}`);
console.log(`2. danmux gradient accepted: ${player.enhancedAccepted ? 'PASS' : 'FAIL'}`);
console.log(`3. simulated render mode: ${player.renderMode}`);
console.log(`   CSS: ${player.cssBackground}`);
console.log('\nWire payload:');
console.log(JSON.stringify(wire, null, 2));
