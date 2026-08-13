module.exports = {
  CATEGORIES: ['影视娱乐', '科技数码', '游戏电竞', '体育竞技', '趣味民生', '财经宏观'],

  // 表态快捷档位（最低 10 爻，见 MIN_BET_AMOUNT）
  AMOUNT_PRESETS: [10, 20, 50, 100],

  // =========================================================
  // 爻经济常量（前端单一来源；云端对应 cloudfunctions/_shared/config.js，
  // 改数值后两处需同步，CI 的 sync-common --verify 只校验云端侧漂移）
  // 2026-08-12：单位由"能量"改为"爻"，整体量级缩减为原来的 1/10
  // =========================================================
  INIT_POINTS: 100,                        // 新用户初始爻
  RELIEF_POINTS: 50,                       // 破产补助单次发放
  RELIEF_COOLDOWN_MS: 24 * 60 * 60 * 1000, // 破产补助冷却
  MIN_BET_AMOUNT: 10,                      // 表态/PK 最低投入爻数

  // 系统预设头像（只允许从列表中选择，不允许用户上传，降低审核风险）
  // 国潮卦爻版：八卦卦象 × 太极 × 玄机符号；正式资源包为 SVG 卦爻头像
  AVATARS: ['☰', '☱', '☲', '☳', '☴', '☵', '☶', '☷', '☯', '🔮', '🏮', '🎋'],

  // 昵称长度上限（字）
  NICKNAME_MAX_LEN: 12,

  // 仲裁理由输入限制（必填，10-200 字）
  ARBITRATION_REASON_MIN_LEN: 10,
  ARBITRATION_REASON_MAX_LEN: 200,

  // 仲裁理由专属敏感词（比昵称更严：政治 / 黄赌毒 / 极端内容）
  ARBITRATION_SENSITIVE_WORDS: [
    '傻逼', '煞笔', '妈逼', '操你', '草你', '你妈', '贱人', '狗逼', '脑残',
    '垃圾', '滚蛋', '去死', '死全家', '嫖娼', '卖淫', '赌博', '博彩', '下注',
    '毒品', '冰毒', '海洛因', '摇头丸', '大麻', '贩毒', '吸毒',
    '枪支', '枪杀', '爆炸物', '恐怖', '恐怖袭击', '杀人', '强奸', '轮奸', '色情', '裸聊', '援交',
    '台独', '港独', '藏独', '疆独', '法轮功', '推翻', '颠覆', '暴动', '政变',
    'fuck', 'shit', 'bitch', 'porn', 'nigger', 'cunt'
  ],

  // 本地敏感词黑名单（MVP 基础版，正式环境建议叠加微信内容安全 msgSecCheck 扩展词库）
  SENSITIVE_WORDS: [
    '傻逼', '煞笔', '妈逼', '操你', '草你', '你妈', '贱人', '狗逼', '脑残',
    '垃圾', '滚蛋', '去死', '死全家', '嫖娼', '卖淫', '赌博', '博彩', '下注',
    'fuck', 'shit', 'bitch', 'porn', 'nigger', 'cunt'
  ],

  // 每日签到：基础爻 + 连续签到加成（连续第 7 天起封顶）
  CHECKIN_BASE_POINTS: 5,
  CHECKIN_STREAK_BONUS: 1,
  CHECKIN_STREAK_CAP: 7,

  // 广告任务：每天最多领取次数与单次爻
  AD_TASK_POINTS: 10,
  AD_TASK_LIMIT: 3,

  // 邀请裂变：双方奖励与每日上限（虚拟爻，防刷）
  INVITE_INVITER_POINTS: 5,    // 邀请人：被邀请人完成首次表态后发放
  INVITE_INVITEE_POINTS: 10,   // 被邀请人：首次打开邀请链接注册即得
  INVITE_DAILY_CAP: 10,        // 邀请人每日最多计次人数（防小号刷）

  // =========================================================
  // 卦勋体系（自动点亮，不消耗爻）· 国潮卦爻版
  // type: milestone = 成就里程碑 / rank = 榜上卦勋
  // rank 卦勋：tier 1 = 前三名专属，tier 2 = 4-10 名
  // emoji 为过渡占位，正式资源包为 SVG 印章徽章（docs/UI设计方案.md）
  // =========================================================
  HONORS: [
    // 成就里程碑
    { id: 'honor_first_bet', type: 'milestone', name: '初露锋芒', emoji: '🌟', desc: '完成首次应卦' },
    { id: 'honor_streak_3', type: 'milestone', name: '三连神算', emoji: '🔥', desc: '达成 3 连胜' },
    { id: 'honor_streak_7', type: 'milestone', name: '七曜连胜', emoji: '✨', desc: '达成 7 连胜' },
    { id: 'honor_streak_10', type: 'milestone', name: '十曜封神', emoji: '☀️', desc: '达成 10 连胜' },
    { id: 'honor_bet_50', type: 'milestone', name: '洞见行者', emoji: '👁️', desc: '累计应卦 50 次' },
    { id: 'honor_bet_200', type: 'milestone', name: '爻道宗师', emoji: '👑', desc: '累计应卦 200 次' },
    { id: 'honor_pk_first', type: 'milestone', name: '擂台新秀', emoji: '🛡️', desc: '完成首次对弈' },
    { id: 'honor_pk_10', type: 'milestone', name: '百战不殆', emoji: '⚔️', desc: '累计完成 10 场对弈' },
    { id: 'honor_invite_first', type: 'milestone', name: '一呼百应', emoji: '🤝', desc: '首次成功邀友' },
    { id: 'honor_invite_10', type: 'milestone', name: '众望所归', emoji: '📯', desc: '累计邀友 10 位' },

    // 榜上卦勋：连胜榜
    { id: 'rank_streak_top3', type: 'rank', rankType: 'streak', tier: 1, name: '连胜榜·前三甲', emoji: '🏆', desc: '连胜榜历史进入前三名' },
    { id: 'rank_streak_top10', type: 'rank', rankType: 'streak', tier: 2, name: '连胜榜·十强', emoji: '🎖️', desc: '连胜榜历史进入前十名' },
    // 周榜
    { id: 'rank_week_top3', type: 'rank', rankType: 'week', tier: 1, name: '周榜·本周之星', emoji: '🥇', desc: '周榜历史进入前三名' },
    { id: 'rank_week_top10', type: 'rank', rankType: 'week', tier: 2, name: '周榜·周十强', emoji: '🎗️', desc: '周榜历史进入前十名' },
    // 月榜
    { id: 'rank_month_top3', type: 'rank', rankType: 'month', tier: 1, name: '月榜·月度王者', emoji: '🌙', desc: '月榜历史进入前三名' },
    { id: 'rank_month_top10', type: 'rank', rankType: 'month', tier: 2, name: '月榜·月度十强', emoji: '🏅', desc: '月榜历史进入前十名' },
    // 总榜
    { id: 'rank_total_top3', type: 'rank', rankType: 'total', tier: 1, name: '总榜·巅峰王者', emoji: '💎', desc: '总榜历史进入前三名' },
    { id: 'rank_total_top10', type: 'rank', rankType: 'total', tier: 2, name: '总榜·百炼成钢', emoji: '🛡️', desc: '总榜历史进入前十名' },
    // PK 榜
    { id: 'rank_pk_top3', type: 'rank', rankType: 'pk', tier: 1, name: '弈榜·不败战神', emoji: '🗡️', desc: '对弈榜历史进入前三名' },
    { id: 'rank_pk_top10', type: 'rank', rankType: 'pk', tier: 2, name: '弈榜·擂台十强', emoji: '🛡️', desc: '对弈榜历史进入前十名' }
  ],

  CHOICE_TEXT: {
    YES: '正',
    NO: '反'
  },

  BET_STATUS: {
    active: '进行中',
    won: '应验',
    lost: '未应验',
    refunded: '已退回',
    disputed: '公断中'
  },

  MARKET_STATUS: {
    open: '进行中',
    locked: '等待断卦',
    dispute_window: '昭示中',
    resolved: '已结卦'
  },

  // 词汇「马甲化」对照表（用于文案自查与审核口径）
  WORD_MAP: {
    '下注/投注/竞猜': '应卦/参与/附议',
    '赔率/胜率': '卦意占比/共识指数/弈绩',
    '筹码/积分余额': '爻/卦资/卦豆',
    '输/赢/庄家': '应验/未应验/官方断卦',
    '奖金/彩金/返水': '卦资/结卦返还/卦勋',
    '中奖/中彩': '应验/达成所愿',
    '博彩/赌博/对赌': '预测互动/观点交锋/邀弈'
  }
};
