// =========================================================
// 全局配置：切换「本地模拟」与「云开发」两种运行模式
// 爻经济数值（INIT_POINTS / RELIEF_* / INVITE_*）以 constants.js 为单一来源，
// 此处引用导出，避免两处定义漂移；云端对应 cloudfunctions/_shared/config.js
// =========================================================
const {
  INIT_POINTS,
  RELIEF_POINTS,
  RELIEF_COOLDOWN_MS,
  INVITE_INVITER_POINTS,
  INVITE_INVITEE_POINTS,
  INVITE_DAILY_CAP
} = require('./constants');

module.exports = {
  // true = 使用本地模拟数据（无需后端，打开开发者工具即可预览）
  // false = 接入微信云开发（需要先开通云开发并部署云函数）
  USE_MOCK: false,

  // 云开发环境 ID（USE_MOCK 为 false 时必填）
  CLOUD_ENV: 'cloud1-d0gyxil2hba0873d3',

  // 审核模式：
  //   'full'       = 完整卦题市场（爻、卦池、天榜）
  //   'compliance' = 纯民意问卷（隐藏积分交互，用于微信提审）
  APP_MODE: 'full',

  // 新用户初始爻（来源于 constants.js）
  INIT_POINTS,

  // 「热门」标签门槛：总池（YES+NO 爻和）≥ 该值的事件进入热门榜，按总爻降序
  HOT_POOL_THRESHOLD: 200,

  // 破产补助：每次发放额度与冷却时间（毫秒）（来源于 constants.js）
  RELIEF_POINTS,
  RELIEF_COOLDOWN_MS,

  // 管理员 openid 列表（只有这些账号可以录入判定 / 结算）
  // 部署时替换为真实管理员 openid，可在云开发控制台查询
  ADMIN_OPENIDS: ['on_9q3ZeefaZ4CBTZBg8cFrc7srQ'],

  // 激励视频广告位 ID（留空 = 直接领取补助，不强制看广告）
  REWARDED_VIDEO_AD_UNIT_ID: '',

  // 邀请裂变（来源于 constants.js）
  INVITE_INVITER_POINTS,
  INVITE_INVITEE_POINTS,
  INVITE_DAILY_CAP,

  // 判定结果录入后的异议公示期（毫秒），以 README 与服务端为准：默认 5 小时。
  // 注意：权威值在云函数环境变量 DISPUTE_WINDOW_HOURS（resolveMarket/resolver 使用），
  // 此处仅用于前端文案展示，修改时请保持一致
  DISPUTE_WINDOW_MS: 5 * 60 * 60 * 1000,

  // 订阅消息模板 ID（在微信公众平台「订阅消息」申请后填写）
  // 留空 = 不请求订阅，不影响主流程
  SUBSCRIBE_JUDGE_TMPL: '',       // 判定结果通知（表态用户）
  SUBSCRIBE_ARBITRATION_TMPL: ''  // 仲裁结果通知（仲裁参与用户）
};
