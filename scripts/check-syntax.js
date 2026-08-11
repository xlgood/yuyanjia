#!/usr/bin/env node
// =========================================================
// 全仓库 JS 语法检查（node --check）
// 覆盖：cloudfunctions（含 _shared）、miniprogram、scripts
// 任一个文件语法错误 → 退出码 1（供 CI 使用）
// =========================================================
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['cloudfunctions', 'miniprogram', 'scripts'];

const files = [];
for (const dir of DIRS) {
  const base = path.join(ROOT, dir);
  if (!fs.existsSync(base)) continue;
  const walk = d => {
    for (const name of fs.readdirSync(d)) {
      if (name === 'node_modules') continue;
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.js')) files.push(p);
    }
  };
  walk(base);
}

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    failed += 1;
    console.error(`✗ 语法错误: ${path.relative(ROOT, f)}`);
  }
}

if (failed) {
  console.error(`[check-syntax] ${failed} 个文件语法错误`);
  process.exit(1);
}
console.log(`[check-syntax] 全部通过（${files.length} 个 JS 文件）`);
