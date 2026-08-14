// =========================================================
// 前后端关键常量/口径一致性校验（防回归）
// 背景：冒烟测试只走 mock-data.js，测不出真实云函数与前端/文档的
// 口径漂移（曾发生：VOTE_BOND_MIN 前端 100/后端 10、migratePoints 默认 50 vs 5、
// settleMarket 榜分按毛值累计、仲裁页硬编码 100）。
// 本脚本用「require 公共配置 + 静态断言」交叉核对关键数值，接入 npm run check。
// =========================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`✅ ${name}`);
  } else {
    failed += 1;
    console.error(`❌ ${name}：${detail}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ---- 1) VOTE_BOND_MIN：前端 constants 必须存在且与云端 _shared/config 一致 ----
let constants = null;
let shared = null;
try {
  constants = require(path.join(ROOT, 'miniprogram/utils/constants.js'));
} catch (e) { /* 下方统一报错 */ }
try {
  shared = require(path.join(ROOT, 'cloudfunctions/_shared/config.js'));
} catch (e) { /* 下方统一报错 */ }
check('constants.js 可加载', !!constants, 'require 失败');
check('_shared/config.js 可加载', !!shared, 'require 失败');
if (constants && shared) {
  check(
    'VOTE_BOND_MIN 前端已定义',
    typeof constants.VOTE_BOND_MIN === 'number',
    'miniprogram/utils/constants.js 缺少 VOTE_BOND_MIN（mock-data 会解构到 undefined，校验静默失效）'
  );
  check(
    'VOTE_BOND_MIN 前后端一致',
    constants.VOTE_BOND_MIN === shared.VOTE_BOND_MIN,
    `前端 ${constants.VOTE_BOND_MIN} vs 云端 ${shared.VOTE_BOND_MIN}`
  );
}

// ---- 2) 仲裁页不再硬编码保证金阈值 ----
const arbSrc = read('miniprogram/pages/arbitration/arbitration.js');
check(
  '仲裁页不硬编码 VOTE_BOND_MIN',
  !/const\s+VOTE_BOND_MIN\s*=\s*100/.test(arbSrc),
  'arbitration.js 硬编码 100，与云端 10 冲突'
);

// ---- 3) migratePoints 邀友奖励默认值与 config 一致（曾误写 50）----
const migrateSrc = read('cloudfunctions/migratePoints/index.js');
check(
  'migratePoints 默认邀友奖励为 5',
  /Number\(process\.env\.INVITE_INVITER_POINTS\)\s*\|\|\s*5\b/.test(migrateSrc) && !/\|\|\s*50\b/.test(migrateSrc),
  'migratePoints 默认值非 5（会导致迁移把邀友榜分虚增 10 倍）'
);

// ---- 4) settleMarket 天榜分必须按净收益 profit 累计（曾按毛 payout 刷榜）----
const settleSrc = read('cloudfunctions/settleMarket/index.js');
check(
  'settleMarket 周/月/总榜用 profit（净收益）',
  /weekPoints:\s*_\.inc\(profit\)/.test(settleSrc) && /totalPoints:\s*_\.inc\(profit\)/.test(settleSrc),
  'settleMarket 仍按毛 payout 累计榜分（含本金/退款刷榜）'
);

// ---- 5) 总榜口径统一：getLeaderboard/rankSnapshot/checkHonors 均用 points ----
const lbSrc = read('cloudfunctions/getLeaderboard/index.js');
const honorSrc = read('cloudfunctions/checkHonors/index.js');
check(
  'getLeaderboard 总榜用 points',
  /total:\s*'points'/.test(lbSrc),
  'getLeaderboard FIELD_MAP.total 不是 points'
);
check(
  'checkHonors 总榜卦勋用 points',
  /total:\s*'points'/.test(honorSrc),
  'checkHonors 总榜卦勋字段与榜单不一致'
);

// ---- 6) login 邀请加成落库（points 与周/月同步 +10）----
const loginSrc = read('cloudfunctions/login/index.js');
check(
  'login 邀请加成写入 points',
  /points:\s*INIT_POINTS\s*\+\s*\(inviteFrom\s*\?\s*INVITEE_POINTS\s*:\s*0\)/.test(loginSrc),
  'login 未把被邀请人加成写入 points（响应 110 / 落库 100）'
);

// ---- 7) resolver 有调用来源门禁 ----
const resolverSrc = read('cloudfunctions/resolver/index.js');
check(
  'resolver 有 wx_client 门禁',
  /SOURCE\s*===\s*'wx_client'/.test(resolverSrc),
  'resolver 无调用来源门禁（任意客户端可触发全量断卦扫描）'
);

// ---- 8) 签到/广告/补助不再计入周/月榜（净收益口径）----
const checkInSrc = read('cloudfunctions/checkIn/index.js');
const adSrc = read('cloudfunctions/claimAdTask/index.js');
const reliefSrc = read('cloudfunctions/claimRelief/index.js');
check(
  '签到不计周/月榜',
  !/weekPoints:\s*_\.inc\(granted\)/.test(checkInSrc),
  'checkIn 仍把签到爻计入周/月榜'
);
check(
  '广告任务不计周/月榜',
  !/weekPoints:\s*_\.inc\(AD_TASK_POINTS\)/.test(adSrc),
  'claimAdTask 仍把广告爻计入周/月榜'
);
check(
  '破产补助不计周/月榜',
  !/weekPoints:\s*_\.inc\(RELIEF_POINTS\)/.test(reliefSrc),
  'claimRelief 仍把补助计入周/月榜'
);

if (failed > 0) {
  console.error(`\n❌ 一致性校验失败 ${failed} 项，请修复后再提交。`);
  process.exit(1);
}
console.log('\n✅ 一致性校验全部通过');
