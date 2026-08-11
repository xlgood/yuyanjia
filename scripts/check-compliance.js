// =========================================================
// 合规词汇自查：扫描用户端代码中的禁用词（博彩/竞猜语义）
// 用法：
//   node scripts/check-compliance.js                  # 检查 miniprogram + cloudfunctions
//   node scripts/check-compliance.js miniprogram       # 只检查前端
// 退出码：前端（miniprogram）发现违规词时返回 1，可接入 CI
// =========================================================
const fs = require('fs');
const path = require('path');

const FORBIDDEN = ['下注', '投注', '竞猜', '赔率', '庄家', '筹码', '提现', '充值', '赌博', '博彩', '返水'];
// WORD_MAP 对照表与敏感词黑名单属于“自查/拦截”用途，不算违规
// mock-data.js 内含本地演示用的敏感词黑名单（MOCK_SENSITIVE），同理豁免
const SKIP_FILES = ['utils/constants.js', 'utils/mock-data.js'];
const SKIP_DIRS = ['node_modules', '.git'];
const EXTENSIONS = new Set(['.js', '.json', '.wxml', '.wxss', '.md']);

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.includes(name)) continue;
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      walk(p, out);
    } else if (EXTENSIONS.has(path.extname(p))) {
      out.push(p);
    }
  }
  return out;
}

const roots = process.argv.slice(2);
if (!roots.length) roots.push('miniprogram', 'cloudfunctions');

let frontendViolations = 0;
let total = 0;

for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  const files = walk(root, []);
  for (const file of files) {
    const rel = path.relative('.', file);
    if (SKIP_FILES.some(s => rel.includes(s))) continue;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (const word of FORBIDDEN) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.indexOf(word) >= 0) {
          total += 1;
          const isFrontend = rel.startsWith('miniprogram');
          if (isFrontend) frontendViolations += 1;
          console.log(`${isFrontend ? '[前端]' : '[后端]'} ${rel}:${i + 1} 命中「${word}」→ ${line.trim().slice(0, 60)}`);
        }
      }
    }
  }
}

if (total === 0) {
  console.log('✅ 未发现禁用词');
} else {
  console.log(`\n共 ${total} 处命中（前端 ${frontendViolations} 处）。`);
  if (frontendViolations > 0) {
    console.log('❌ 前端存在违规词，请修复后再提审。');
    process.exit(1);
  } else {
    console.log('前端无违规（后端命中均为代码注释/内部逻辑，可选择性清理）。');
  }
}
