#!/usr/bin/env node
// =========================================================
// 云函数公共配置同步脚本
//   node scripts/sync-common.js            # 同步（拷贝到各消费函数目录）
//   node scripts/sync-common.js --verify   # 校验模式：有漂移则退出码 1（供 CI 使用）
// 原因：微信云函数 CLI 打包不支持跨目录 require，公共模块必须物理拷贝
// 到各函数目录（common-config.js）。本文件是唯一同步入口。
// =========================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'cloudfunctions', '_shared', 'config.js');
const DEST_NAME = 'common-config.js';

// 消费公共配置的函数（新增引用时在这里登记）
const CONSUMERS = [
  'login',
  'placeBet',
  'createPk',
  'checkIn',
  'claimAdTask',
  'adRewardCallback',
  'claimRelief',
  'createArbitration',
  'voteArbitration',
  'createMarket'
];

const verify = process.argv.includes('--verify');
const src = fs.readFileSync(SRC, 'utf8');
const stale = [];

for (const name of CONSUMERS) {
  const dest = path.join(ROOT, 'cloudfunctions', name, DEST_NAME);
  if (verify) {
    if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== src) stale.push(name);
  } else {
    fs.writeFileSync(dest, src);
    console.log(`  synced ${name}/${DEST_NAME}`);
  }
}

if (verify) {
  if (stale.length) {
    console.error(`[sync-common] 漂移：${stale.join(', ')} 的 common-config.js 与 _shared/config.js 不一致，请运行 npm run sync:common`);
    process.exit(1);
  }
  console.log('[sync-common] 校验通过：全部拷贝与单一来源一致');
}
