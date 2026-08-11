// =========================================================
// 云函数公共配置 · 单一来源（唯一维护点）
//
// 使用方法：
//   1. 改这里的业务常量；
//   2. 运行 `npm run sync:common`，脚本会把本文件拷贝为各消费函数的
//      `common-config.js`（CLI 打包不支持跨目录 require，必须物理拷贝）；
//   3. CI 的 `npm run check` 会用 --verify 模式校验拷贝是否与源同步（防漂移）。
//
// 与前端 `miniprogram/utils/constants.js` / `config.js` 保持数值一致；
// 部署时可继续用环境变量覆盖个别值（见各函数内的 env 优先逻辑）。
// =========================================================
module.exports = {
  // ---- 能量经济 ----
  INIT_POINTS: 1000,                  // 新用户初始能量（login）
  RELIEF_POINTS: 500,                 // 破产补助单次发放（claimRelief）
  RELIEF_COOLDOWN_MS: 24 * 3600 * 1000, // 破产补助冷却（claimRelief）

  // ---- 每日签到（checkIn）----
  CHECKIN_BASE_POINTS: 50,
  CHECKIN_STREAK_BONUS: 10,
  CHECKIN_STREAK_CAP: 7,

  // ---- 激励广告任务（claimAdTask / adRewardCallback）----
  AD_TASK_POINTS: 100,                // 单次发放能量（服务端常量，不信任客户端透传）
  AD_TASK_LIMIT: 3,                   // 每日限次

  // ---- 邀请裂变（login / placeBet）----
  INVITE_INVITER_POINTS: 50,          // 邀请人：被邀请人首次表态后发放
  INVITE_INVITEE_POINTS: 100,         // 被邀请人：注册加成
  INVITE_DAILY_CAP: 10,               // 邀请人每日有效计次上限

  // ---- 社区仲裁（createArbitration / voteArbitration）----
  VOTE_BOND_MIN: 100,                 // 发起/投票最低保证金
  ACTIVE_ARBITRATION_LIMIT: 1,        // 同时最多参与仲裁数
  ARBITRATION_WINDOW_MS: 24 * 3600 * 1000,   // 仲裁公示期
  ARBITRATION_MIN_PARTICIPANTS: 10,   // 事件表态人数门槛
  ARBITRATION_COOLDOWN_MS: 24 * 3600 * 1000, // 发起冷却

  // ---- 发题基础校验（createMarket）----
  CATEGORIES: ['影视娱乐', '科技数码', '游戏电竞', '体育竞技', '趣味民生', '财经宏观'],
  OPERATORS: ['>=', '>', '<=', '<', '==', '!=', 'contains', 'in'],
  TRANSFORMS: ['int', 'float', 'string']
};
