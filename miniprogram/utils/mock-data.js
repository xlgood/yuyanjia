// =========================================================
// 本地模拟数据层：与云函数返回结构保持一致，
// 使小程序在未接入后端时即可完整预览 / 测试全部流程。
// 状态持久化在 wx.storage，模拟数据仅存在于本机。
// =========================================================
const config = require('./config');
const { validateNickname, validateArbitrationReason } = require('./validate');
const fmt = require('./format');
const {
  HONORS,
  CHECKIN_BASE_POINTS, CHECKIN_STREAK_BONUS, CHECKIN_STREAK_CAP,
  AD_TASK_POINTS, AD_TASK_LIMIT,
  MIN_BET_AMOUNT,
  VOTE_BOND_MIN,
  INVITE_INVITER_POINTS, INVITE_INVITEE_POINTS, INVITE_DAILY_CAP
} = require('./constants');

const STORAGE_KEY = 'oracle_mock_state_v1';
const MOCK_OPENID = 'MOCK_USER';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function now() {
  return Date.now();
}

function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function last7Days() {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now() - i * DAY);
    out.push({
      key: dayKey(d.getTime()),
      label: (d.getMonth() + 1) + '月' + d.getDate() + '日',
      count: 0
    });
  }
  return out;
}

function seedState() {
  const markets = [
    {
      _id: 'M001',
      category: '影视娱乐',
      title: '截至本周日 24:00，电影《星际远征》在“猫眼专业版”上的累计综合票房是否突破 5.00 亿元？',
      deadline: now() + 3 * DAY,
      sourceOfTruth: '以猫眼专业版 App 官方数据为准，精确到个位数。最终票房 ≥ 5.00 亿则“应验”，否则“未应验”。',
      yesPool: 120,
      noPool: 80,
      status: 'open',
      result: null,
      hasDispute: false,
      disputeCount: 0
    },
    {
      _id: 'M002',
      category: '科技数码',
      title: '在下周二下午的品牌新品发布会上，官方正式亮相的下一代旗舰手机起步售价是否低于 5999 元？',
      deadline: now() + 4 * DAY + 6 * HOUR,
      sourceOfTruth: '以品牌官方直播、官网售价页为准。起步价 < 5999 元则“应验”，否则“未应验”。',
      yesPool: 50,
      noPool: 150,
      status: 'open',
      result: null,
      hasDispute: false,
      disputeCount: 0
    },
    {
      _id: 'M003',
      category: '游戏电竞',
      title: '在今晚 19:00 的 LPL 职业联赛第一局中，A 队能否在开局 15 分钟内击杀第一条大龙？',
      deadline: now() + 5 * HOUR,
      sourceOfTruth: '以 LPL 官方赛事数据面板为准。15 分钟内击杀则“应验”，否则“未应验”。',
      yesPool: 30,
      noPool: 120,
      status: 'open',
      result: null,
      hasDispute: false,
      disputeCount: 0
    },
    {
      _id: 'M004',
      category: '体育竞技',
      title: '在明早进行的 NBA 焦点战中，球星詹姆斯单场最终个人得分是否大于 25.5 分？',
      deadline: now() + 18 * HOUR,
      sourceOfTruth: '以 NBA 官方赛后数据统计为准。得分 ≥ 26 分则“应验”，否则“未应验”。',
      yesPool: 100,
      noPool: 90,
      status: 'open',
      result: null,
      hasDispute: false,
      disputeCount: 0
    },
    {
      _id: 'M005',
      category: '趣味民生',
      title: '根据中央气象局官方实况，明天 14:00 北京市南郊观象台整点实时气温是否达到或超过 35.0 摄氏度？',
      deadline: now() + 24 * HOUR,
      sourceOfTruth: '以中国气象网官方实况数据为准。温度 ≥ 35.0℃ 则“应验”，否则“未应验”。',
      yesPool: 140,
      noPool: 60,
      status: 'open',
      result: null,
      hasDispute: false,
      disputeCount: 0
    },
    {
      _id: 'M006',
      category: '影视娱乐',
      title: '本周五开播的年度大剧《长安十二时辰外传》在豆瓣的官方开分是否 ≥ 8.0 分？',
      deadline: now() + 2 * DAY,
      sourceOfTruth: '以豆瓣官方评分页为准（开分后 24 小时内的首个稳定分值）。≥ 8.0 分则“应验”，否则“未应验”。',
      yesPool: 220,
      noPool: 80,
      status: 'open',
      result: null,
      hasDispute: false,
      disputeCount: 0
    },
    {
      _id: 'M007',
      category: '科技数码',
      title: '下周旗舰发布会官方是否宣布搭载自研端侧 AI 大模型（以发布会 PPT 画面为准）？',
      deadline: now() + 5 * DAY,
      sourceOfTruth: '以品牌官方直播发布会 PPT 画面 / 官网参数页为准。出现“自研端侧 AI 大模型”字样则“应验”，否则“未应验”。',
      yesPool: 360,
      noPool: 40,
      status: 'open',
      result: null,
      hasDispute: false,
      disputeCount: 0
    },
    {
      _id: 'M008',
      category: '体育竞技',
      title: '本周末中超焦点战，上海海港主场对阵北京国安，主队是否获胜？',
      deadline: now() + 2 * DAY + 12 * HOUR,
      sourceOfTruth: '以中超联赛官方赛后数据面板为准。常规时间主队获胜则“应验”，否则“未应验”。',
      yesPool: 180,
      noPool: 120,
      status: 'open',
      result: null,
      hasDispute: false,
      disputeCount: 0
    },
    {
      _id: 'M009',
      category: '科技数码',
      title: '某头部手机品牌是否于本月内官宣下一代旗舰机型的发布日期（以官方微博/官网公告为准）？',
      deadline: now() - HOUR,
      sourceOfTruth: '以品牌官方微博或官网公告为准。出现官方发布日期声明则“应验”，否则“未应验”。',
      yesPool: 0,
      noPool: 0,
      status: 'open',
      result: null,
      hasDispute: false,
      disputeCount: 0,
      needsManualReview: true,
      resolutionSpec: {
        version: 1,
        dataSource: { type: 'manual', provider: '官方公告' },
        humanReadable: '以品牌官方微博或官网公告为准。出现官方发布日期声明则“应验”，否则“未应验”。'
      }
    },
    {
      _id: 'M010',
      category: '趣味民生',
      title: '历史示例：昨日 14:00 北京南郊观象台整点气温是否 ≥ 35.0℃？',
      deadline: now() - DAY,
      createdAt: now() - 2 * DAY,
      sourceOfTruth: '以中国气象网官方实况数据为准，≥ 35.0℃ 则“应验”，否则“未应验”。',
      yesPool: 90,
      noPool: 110,
      status: 'resolved',
      result: 'NO',
      hasDispute: false,
      disputeCount: 0,
      resolutionSpec: {
        version: 1,
        dataSource: { type: 'api', provider: '中国气象网', url: 'http://www.weather.com.cn/data/sk/101010100.html', field: 'weatherinfo.temp', transform: 'int' },
        condition: { operator: '>=', value: 35, unit: '℃' },
        humanReadable: '以中国气象网官方实况数据为准，≥ 35.0℃ 则“应验”，否则“未应验”。'
      },
      resolutionMethod: 'auto_api',
      resolutionAttempts: 1,
      needsManualReview: false,
      resolvedAt: now() - DAY + HOUR
    },
    {
      _id: 'M011',
      category: '财经宏观',
      title: '历史示例：昨日人民币兑美元中间价是否低于 7.10？',
      deadline: now() - DAY,
      createdAt: now() - 3 * DAY,
      sourceOfTruth: '以中国人民银行官网当日中间价为准，< 7.10 则“应验”，否则“未应验”。',
      yesPool: 120,
      noPool: 80,
      status: 'resolved',
      result: 'YES',
      hasDispute: false,
      disputeCount: 0,
      resolutionSpec: {
        version: 1,
        dataSource: { type: 'api', provider: '人民银行人民币汇率中间价', url: 'https://www.pbc.gov.cn/rmyh/rmhq/index.html', field: 'rate', transform: 'float' },
        condition: { operator: '<', value: 7.1 },
        humanReadable: '以中国人民银行官网当日中间价为准，< 7.10 则“应验”，否则“未应验”。'
      },
      resolutionMethod: 'auto_api',
      resolutionAttempts: 1,
      needsManualReview: false,
      resolvedAt: now() - DAY + 2 * HOUR
    }
  ];

  // 为演示市场补齐 createdAt（近 7 天发题趋势）
  markets.forEach((m, i) => {
    if (!m.createdAt) m.createdAt = now() - i * DAY;
  });

  const users = [
    { _id: 'u1', nickname: '问卦局·诸葛', avatarUrl: '', streak: 12, bestStreak: 15, weekPoints: 3200, monthPoints: 12800, totalPoints: 45600, points: 3200, inviteRewardDate: '', inviteRewardToday: 0 },
    { _id: 'u2', nickname: '数码极客阿杰', avatarUrl: '', streak: 9, bestStreak: 11, weekPoints: 2850, monthPoints: 10400, totalPoints: 38900, points: 2850, inviteRewardDate: '', inviteRewardToday: 0 },
    { _id: 'u3', nickname: '猫眼老影迷', avatarUrl: '', streak: 8, bestStreak: 9, weekPoints: 2400, monthPoints: 9600, totalPoints: 33200, points: 2400, inviteRewardDate: '', inviteRewardToday: 0 },
    { _id: 'u4', nickname: '篮球先知老王', avatarUrl: '', streak: 7, bestStreak: 8, weekPoints: 2100, monthPoints: 8800, totalPoints: 30100, points: 2100, inviteRewardDate: '', inviteRewardToday: 0 },
    { _id: 'u5', nickname: 'LPL 观察员', avatarUrl: '', streak: 6, bestStreak: 7, weekPoints: 1900, monthPoints: 7200, totalPoints: 26800, points: 1900, inviteRewardDate: '', inviteRewardToday: 0 },
    { _id: 'u6', nickname: '气象小达人', avatarUrl: '', streak: 5, bestStreak: 6, weekPoints: 1600, monthPoints: 6500, totalPoints: 22400, points: 1600, inviteRewardDate: '', inviteRewardToday: 0 },
    { _id: 'u7', nickname: '吃瓜群众甲', avatarUrl: '', streak: 4, bestStreak: 5, weekPoints: 1200, monthPoints: 5100, totalPoints: 18700, points: 1200, inviteRewardDate: '', inviteRewardToday: 0 },
    { _id: 'u8', nickname: '理性分析菌', avatarUrl: '', streak: 3, bestStreak: 5, weekPoints: 900, monthPoints: 4300, totalPoints: 15600, points: 900, inviteRewardDate: '', inviteRewardToday: 0 },
    { _id: 'u9', nickname: '都市夜猫子', avatarUrl: '', streak: 2, bestStreak: 4, weekPoints: 600, monthPoints: 3200, totalPoints: 12100, points: 600, inviteRewardDate: '', inviteRewardToday: 0 },
    { _id: 'u10', nickname: '初入道上路', avatarUrl: '', streak: 1, bestStreak: 2, weekPoints: 300, monthPoints: 1800, totalPoints: 7600, points: 300, inviteRewardDate: '', inviteRewardToday: 0 }
  ];

  const dataSources = [
    { _id: 'SRC-WEATHER-CMA', name: '中国气象网实时天气', category: '趣味民生', type: 'api', access: 'free', url: 'http://www.weather.com.cn/data/sk/101010100.html', notes: '免费公开接口，断卦时抓取整点实况并存证', status: 'verified' },
    { _id: 'SRC-FX-PBOC', name: '人民银行人民币汇率中间价', category: '财经宏观', type: 'api', access: 'free', url: 'https://www.pbc.gov.cn/rmyh/rmhq/index.html', notes: '官网公开数据，节假日停发需按日历处理', status: 'verified' },
    { _id: 'SRC-STATS-NBS', name: '国家统计局数据发布', category: '财经宏观', type: 'api', access: 'free', url: 'https://data.stats.gov.cn', notes: 'CPI/PMI 等定期发布，接口解析成本较高', status: 'trial' },
    { _id: 'SRC-SPORTS-FEED', name: '体育赛事数据商', category: '体育竞技', type: 'api', access: 'paid', url: '', notes: '一个供应商覆盖篮球足球电竞多个赛事，需商务授权', status: 'pending' },
    { _id: 'SRC-MOVIE-BOXOFFICE', name: '猫眼/灯塔专业版票房', category: '影视娱乐', type: 'api', access: 'paid', url: '', notes: '无公开 API，需商务授权；未接入前用官方票房页截图+人工录入', status: 'pending' },
    { _id: 'SRC-DOUBAN-SCORE', name: '豆瓣评分页', category: '影视娱乐', type: 'web', access: 'free', url: 'https://movie.douban.com', notes: '页面稳定但反爬较强，断卦时抓一次并截图存证', status: 'trial' },
    { _id: 'SRC-LAUNCH-PAGE', name: '品牌发布会/官网参数页', category: '科技数码', type: 'web', access: 'free', url: '', notes: '事实型卦题，抓一次存证即可，也可人工录入+铁证链接', status: 'verified' },
    { _id: 'SRC-EVENT-FACT', name: '官方公告/官宣（通用）', category: '全品类', type: 'manual', access: 'free', url: '', notes: '事实型卦题通用通道：运营录入官方断卦 + 官方链接/截图铁证', status: 'verified' }
  ];

  const me = {
      _id: MOCK_OPENID,
      nickname: '卦中新客',
      avatarUrl: '',
      avatar: '🔮',
      points: config.INIT_POINTS,
      streak: 0,
      bestStreak: 0,
      weekPoints: 0,
      monthPoints: 0,
      totalPoints: 0,
      lastReliefAt: 0,
      lastCheckInDate: '',
      checkInStreak: 0,
      checkInTotal: 0,
      adTaskDate: '',
      adTaskCount: 0,
      avatarFrame: '',
      title: '',
      badges: [],
      honors: [],
      betCount: 0,
      pkCount: 0,
      // 邀友裂变字段
      invitedBy: '',
      inviteRewarded: false,
      inviteCount: 0,
      inviteRewardDate: '',
      inviteRewardToday: 0,
      // 对弈 对战字段
      pkOpen: true,
      pkWins: 0,
      pkLosses: 0
    };

  // 模拟“昨日排名快照”：与今日实时排名形成对比，便于演示 up/down/equal 箭头
  const yesterday = dayKey(now() - DAY);
  const yRank = (arr, val) => arr.filter(v => v > val).length + 1;
  const snapshotFor = (type, valueOf, yPos) => {
    const vals = users.map(u => valueOf(u)).filter(v => v > 0);
    const myYesterday = Math.max(0, valueOf(me) + (yPos >= 0 ? 0 : 0));
    const rank = yPos >= 0 ? yPos : yRank(vals, myYesterday);
    const list = users.map((u, i) => ({ openid: u._id, rank: i + 1, value: valueOf(u) }));
    list.push({ openid: MOCK_OPENID, rank, value: myYesterday });
    return { type, date: yesterday, rankings: list };
  };
  const snapshots = {
    streak: snapshotFor('streak', u => u.streak || 0, 7),
    week: snapshotFor('week', u => u.weekPoints || 0, 13),
    month: snapshotFor('month', u => u.monthPoints || 0, 4),
    total: snapshotFor('total', u => u.totalPoints || 0, 4)
  };

  return {
    user: me,
    markets,
    users,
    dataSources,
    bets: {},
    disputes: {},
    arbitrations: [],
    arbitrationVotes: {},
    invites: [],
    inviteeSeq: 0,
    pks: [],
    pkSeq: 0,
    rankSnapshots: snapshots
  };
}

// 为旧缓存补齐模拟快照（演示天榜趋势箭头用）
function buildMockSnapshots(me, users) {
  const yesterday = dayKey(now() - DAY);
  const mk = (type, valueOf, yPos) => {
    const rankings = users.map((u, i) => ({ openid: u._id, rank: i + 1, value: valueOf(u) }));
    rankings.push({ openid: me._id || MOCK_OPENID, rank: yPos, value: valueOf(me) });
    return { type, date: yesterday, rankings };
  };
  return {
    streak: mk('streak', u => u.streak || 0, 7),
    week: mk('week', u => u.weekPoints || 0, 13),
    month: mk('month', u => u.monthPoints || 0, 4),
    total: mk('total', u => u.totalPoints || 0, 4)
  };
}

function load() {
  const raw = wx.getStorageSync(STORAGE_KEY);
  if (raw) {
    // 版本迁移：旧缓存缺少新功能字段时自动补齐，避免 undefined 报错
    if (!Array.isArray(raw.invites)) raw.invites = [];
    if (typeof raw.inviteeSeq !== 'number') raw.inviteeSeq = 0;
    if (!Array.isArray(raw.pks)) raw.pks = [];
    if (typeof raw.pkSeq !== 'number') raw.pkSeq = 0;
    if (!Array.isArray(raw.arbitrations)) raw.arbitrations = [];
    if (!raw.arbitrationVotes || typeof raw.arbitrationVotes !== 'object') raw.arbitrationVotes = {};
    if (!raw.rankSnapshots || typeof raw.rankSnapshots !== 'object' || !Object.keys(raw.rankSnapshots).length) {
      raw.rankSnapshots = buildMockSnapshots(raw.user || {}, raw.users || []);
    }
    if (raw.user) {
      if (typeof raw.user.invitedBy !== 'string') raw.user.invitedBy = '';
      if (typeof raw.user.inviteRewarded !== 'boolean') raw.user.inviteRewarded = false;
      if (typeof raw.user.inviteCount !== 'number') raw.user.inviteCount = 0;
      if (typeof raw.user.inviteRewardDate !== 'string') raw.user.inviteRewardDate = '';
      if (typeof raw.user.inviteRewardToday !== 'number') raw.user.inviteRewardToday = 0;
      if (typeof raw.user.pkOpen !== 'boolean') raw.user.pkOpen = true;
      if (typeof raw.user.pkWins !== 'number') raw.user.pkWins = 0;
      if (typeof raw.user.pkLosses !== 'number') raw.user.pkLosses = 0;
    }
    wx.setStorageSync(STORAGE_KEY, raw);
    return raw;
  }
  const state = seedState();
  wx.setStorageSync(STORAGE_KEY, state);
  return state;
}

function save(state) {
  wx.setStorageSync(STORAGE_KEY, state);
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function findMarket(state, id) {
  return state.markets.find(m => m._id === id);
}

function findUser(state, id) {
  return state.users.find(u => u._id === id);
}

// 演示用：确保虚拟用户存在于 state.users，避免结卦/分卦时找不到人而错发给当前用户
function ensureMockUser(state, id, nickname) {
  if (state.users.some(u => u._id === id)) return;
  state.users.push({
    _id: id,
    nickname: nickname || '虚拟用户',
    avatar: '🔮',
    points: 100,
    streak: 0,
    bestStreak: 0,
    weekPoints: 0,
    monthPoints: 0,
    totalPoints: 0,
    pkWins: 0,
    pkLosses: 0,
    honors: []
  });
}

function findInvite(state, inviterId, inviteeId) {
  return state.invites.find(i => i.inviterId === inviterId && i.inviteeId === inviteeId);
}

function buildInviteStats(state) {
  const mine = state.invites.filter(i => i.inviterId === MOCK_OPENID);
  const today = dayKey(now());
  const todayRewards = state.user.inviteRewardDate === today ? (state.user.inviteRewardToday || 0) : 0;
  return {
    totalInvites: mine.length,
    rewardedCount: mine.filter(i => i.inviterRewarded).length,
    pendingCount: mine.filter(i => !i.inviterRewarded).length,
    weekRewarded: mine.filter(i => i.inviterRewarded && now() - i.rewardedAt < 7 * DAY).length,
    dailyCap: INVITE_DAILY_CAP,
    todayRewards
  };
}

// 惰性清理：过期的待应弈 对弈 退回邀弈者爻
function expirePks(state) {
  const nowTs = now();
  let changed = false;
  state.pks.forEach(pk => {
    if (pk.status === 'pending' && pk.expiresAt && nowTs > pk.expiresAt) {
      pk.status = 'expired';
      const user = pk.challengerId === state.user._id ? state.user : findUser(state, pk.challengerId);
      if (user) user.points += pk.challenger.amount;
      const market = findMarket(state, pk.marketId);
      if (market) {
        const poolField = pk.challenger.choice === 'YES' ? 'yesPool' : 'noPool';
        market[poolField] = Math.max(0, (market[poolField] || 0) - pk.challenger.amount);
      }
      const betKey = `${pk.challengerId}_${pk.marketId}`;
      delete state.bets[betKey];
      changed = true;
    }
  });
  if (changed) save(state);
}

function pkOpponentInfo(state, pk, meId) {
  if (!pk) return null;
  const otherId = pk.challengerId === meId ? pk.opponentId : pk.challengerId;
  const side = pk.challengerId === meId ? pk.opponent : pk.challenger;
  if (side) return side;
  const u = findUser(state, otherId);
  return u ? { openid: otherId, nickname: u.nickname, avatar: u.avatar, choice: '', amount: 0 } : null;
}

// 卦勋自动断卦：里程碑 + 实时天榜（连胜/总榜）
function checkHonorsForState(state) {
  const me = state.user;
  if (!me.honors) me.honors = [];
  me.betCount = me.betCount || 0;
  me.pkCount = me.pkCount || 0;
  const unlocked = [];
  const owned = me.honors;
  const rankOf = field => {
    const val = me[field] || 0;
    return state.users.filter(u => (u[field] || 0) > val).length + 1;
  };
  HONORS.forEach(h => {
    let earned = false;
    if (h.type === 'milestone') {
      switch (h.id) {
        case 'honor_first_bet': earned = me.betCount >= 1; break;
        case 'honor_streak_3': earned = me.bestStreak >= 3; break;
        case 'honor_streak_7': earned = me.bestStreak >= 7; break;
        case 'honor_streak_10': earned = me.bestStreak >= 10; break;
        case 'honor_bet_50': earned = me.betCount >= 50; break;
        case 'honor_bet_200': earned = me.betCount >= 200; break;
        case 'honor_pk_first': earned = me.pkCount >= 1; break;
        case 'honor_pk_10': earned = me.pkCount >= 10; break;
        case 'honor_invite_first': earned = (me.inviteCount || 0) >= 1; break;
        case 'honor_invite_10': earned = (me.inviteCount || 0) >= 10; break;
      }
    } else if (h.type === 'rank') {
      const fieldMap = { streak: 'streak', total: 'totalPoints' };
      const field = fieldMap[h.rankType];
      if (field) {
        const r = rankOf(field);
        earned = h.tier === 1 ? r <= 3 : r <= 10;
      }
    }
    if (earned && owned.indexOf(h.id) < 0) {
      owned.push(h.id);
      unlocked.push(h.id);
    }
  });
  return unlocked;
}

function settleMarketState(state, marketId) {
  const market = findMarket(state, marketId);
  if (!market || market.status !== 'dispute_window') {
    return { ok: false, err: '当前状态不可结卦' };
  }
  if (state.arbitrations.some(a => a.marketId === marketId && a.status === 'pending')) {
    return { ok: false, err: '该卦题有进行中的公断，请等待公断公示期结束' };
  }
  const totalPool = (market.yesPool || 0) + (market.noPool || 0);
  const winningPool = market.result === 'YES' ? market.yesPool || 0 : market.noPool || 0;
  const refundAll = totalPool <= 0 || winningPool <= 0;
  const settledPks = {};

  Object.keys(state.bets).forEach(betId => {
    const bet = state.bets[betId];
    if (bet.marketId !== marketId || bet.status !== 'active') return;
    const won = bet.choice === market.result;
    let payout = 0;
    if (refundAll) {
      payout = bet.amount;
      bet.status = 'refunded';
    } else {
      if (won) payout = Math.floor((bet.amount / winningPool) * totalPool);
      bet.status = won ? 'won' : 'lost';
    }
    bet.payout = payout;
    bet.settledAt = now();

    if (bet.pkId) {
      const entry = settledPks[bet.pkId] || (settledPks[bet.pkId] = { wonOpenids: [], allOpenids: [] });
      entry.allOpenids.push(bet.openid);
      if (won && !refundAll) entry.wonOpenids.push(bet.openid);
    }

    if (bet.openid === MOCK_OPENID) {
      const u = state.user;
      const newStreak = won && !refundAll ? u.streak + 1 : 0;
      const profit = won && !refundAll ? Math.max(payout - bet.amount, 0) : 0;
      u.points += payout;
      u.streak = newStreak;
      u.bestStreak = Math.max(u.bestStreak, newStreak);
      u.weekPoints += profit;
      u.monthPoints += profit;
      u.totalPoints += profit;
    }
  });

  // 结卦 对弈：断卦胜负、更新双方统计
  Object.keys(settledPks).forEach(pkId => {
    const entry = settledPks[pkId];
    const pk = state.pks.find(p => p._id === pkId);
    if (!pk || pk.status === 'settled') return;
    // 与云端一致：未应弈（pending）的 对弈 直接作废，不进入 对弈 榜统计
    if (pk.status !== 'accepted') {
      pk.status = 'expired';
      pk.expiredAt = now();
      return;
    }
    pk.status = 'settled';
    pk.winnerId = entry.wonOpenids.length === 1 ? entry.wonOpenids[0] : '';
    pk.settledAt = now();
    entry.allOpenids.forEach(uid => {
      const u = findUser(state, uid);
      if (!u) return;
      const win = !!pk.winnerId && pk.winnerId === uid;
      if (win) u.pkWins = (u.pkWins || 0) + 1;
      else u.pkLosses = (u.pkLosses || 0) + 1;
    });
  });

  market.status = 'resolved';
  market.settledAt = now();
  checkHonorsForState(state);
  return { ok: true, market: clone(market) };
}

function call(name, data = {}) {
  const state = load();

  switch (name) {
    case 'login': {
      const inviteCode = String((data && data.invite) || '');
      // 邀友链接进入：模拟“新用户通过邀友链接首次打开”（切换到新的被邀友人档案）
      if (inviteCode && inviteCode !== MOCK_OPENID) {
        const inviter = findUser(state, inviteCode);
        if (inviter && !findUser(state, 'MOCK_INVITEE')) {
          const invitee = {
            _id: 'MOCK_INVITEE',
            nickname: '受邀新人',
            avatarUrl: '',
            avatar: '🦉',
            points: config.INIT_POINTS + INVITE_INVITEE_POINTS,
            streak: 0,
            bestStreak: 0,
            weekPoints: 0,
            monthPoints: 0,
            totalPoints: 0,
            lastReliefAt: 0,
            lastCheckInDate: '',
            checkInStreak: 0,
            checkInTotal: 0,
            adTaskDate: '',
            adTaskCount: 0,
            avatarFrame: '',
            title: '',
            badges: [],
            invitedBy: inviteCode,
            inviteRewarded: false,
            inviteCount: 0,
            inviteRewardDate: '',
            inviteRewardToday: 0,
            inviteBonus: INVITE_INVITEE_POINTS
          };
          state.users.push(invitee);
          state.user = invitee;
          state.invites.unshift({
            inviterId: inviteCode,
            inviteeId: invitee._id,
            inviteeNickname: invitee.nickname,
            rewardToInviter: INVITE_INVITER_POINTS,
            inviterRewarded: false,
            source: 'friend',
            createdAt: now()
          });
        }
      }
      return { ok: true, user: clone(state.user) };
    }

    case 'simulateInvite': {
      // 开发/演示用：模拟一位好友通过分享链接注册并完成首次应卦
      state.inviteeSeq = (state.inviteeSeq || 0) + 1;
      const inviteeId = 'MOCK_INVITEE_' + state.inviteeSeq;
      const invitee = {
        _id: inviteeId,
        nickname: '测试好友' + state.inviteeSeq,
        avatarUrl: '',
        avatar: ['🐼', '🦊', '🐯', '🦁'][(state.inviteeSeq - 1) % 4],
        points: 0,
        streak: 0,
        bestStreak: 0,
        weekPoints: 0,
        monthPoints: 0,
        totalPoints: 0,
        invitedBy: MOCK_OPENID,
        inviteRewarded: true,
        inviteCount: 0,
        inviteRewardDate: '',
        inviteRewardToday: 0
      };
      state.users.push(invitee);

      const today = dayKey(now());
      const dailyUsed = state.user.inviteRewardDate === today ? (state.user.inviteRewardToday || 0) : 0;
      const granted = dailyUsed < INVITE_DAILY_CAP ? INVITE_INVITER_POINTS : 0;
      if (granted) {
        state.user.points += INVITE_INVITER_POINTS;
        state.user.totalPoints += INVITE_INVITER_POINTS;
        state.user.weekPoints += INVITE_INVITER_POINTS;
        state.user.monthPoints += INVITE_INVITER_POINTS;
        state.user.inviteRewardDate = today;
        state.user.inviteRewardToday = dailyUsed + 1;
      }
      state.user.inviteCount = (state.user.inviteCount || 0) + 1;
      state.invites.unshift({
        inviterId: MOCK_OPENID,
        inviteeId,
        inviteeNickname: invitee.nickname,
        rewardToInviter: INVITE_INVITER_POINTS,
        inviterRewarded: !!granted,
        rewardedAt: granted ? now() : 0,
        source: 'group',
        createdAt: now()
      });
      save(state);
      return {
        ok: true,
        stats: buildInviteStats(state),
        list: clone(state.invites.filter(i => i.inviterId === MOCK_OPENID)),
        granted
      };
    }

    case 'createPk': {
      const marketId = String(data.marketId || '');
      const choice = data.choice;
      const amount = Number(data.amount);
      const market = findMarket(state, marketId);
      if (!market || market.status !== 'open') return { ok: false, err: '该卦题已截止或正在结卦' };
      if (market.needsManualReview) return { ok: false, err: '该卦题已停止接收应卦' };
      if (choice !== 'YES' && choice !== 'NO') return { ok: false, err: '参数不合法' };
      if (!Number.isInteger(amount) || amount < MIN_BET_AMOUNT) return { ok: false, err: `至少投入 ${MIN_BET_AMOUNT} 爻` };
      if (state.user.points < amount) return { ok: false, err: '爻不足' };
      const betKey = `${state.user._id}_${marketId}`;
      if (state.bets[betKey]) return { ok: false, err: '您已参与过该卦题，不能重复发起 对弈' };
      if (state.pks.some(p => p.marketId === marketId && p.challengerId === state.user._id && p.status === 'pending')) {
        return { ok: false, err: '您对该卦题已有未完成的 对弈 邀弈' };
      }

      state.pkSeq = (state.pkSeq || 0) + 1;
      const pkId = '对弈' + state.pkSeq;
      const nowTs = now();
      const pk = {
        _id: pkId,
        marketId,
        marketTitle: market.title,
        challengerId: state.user._id,
        challenger: {
          openid: state.user._id,
          nickname: state.user.nickname,
          avatar: state.user.avatar,
          choice,
          amount
        },
        opponentId: '',
        opponent: null,
        participantIds: [state.user._id],
        status: 'pending',
        winnerId: '',
        challengerBetId: betKey,
        opponentBetId: '',
        createdAt: nowTs,
        expiresAt: nowTs + 24 * 3600 * 1000
      };
      state.pks.unshift(pk);
      state.user.points -= amount;
      if (choice === 'YES') market.yesPool += amount;
      else market.noPool += amount;
      state.bets[betKey] = {
        _id: betKey,
        marketId,
        openid: state.user._id,
        choice,
        amount,
        marketTitle: market.title,
        marketCategory: market.category,
        marketDeadline: market.deadline,
        status: 'active',
        payout: 0,
        pkId,
        createdAt: nowTs
      };
      save(state);
      return { ok: true, pk: clone(pk), user: clone(state.user) };
    }

    case 'respondPk': {
      const pkId = String(data.pkId || '');
      const accept = !!data.accept;
      expirePks(state);
      const pk = state.pks.find(p => p._id === pkId);
      if (!pk) return { ok: false, err: '邀弈不存在' };
      if (pk.status !== 'pending') return { ok: false, err: '该邀弈已处理' };
      if (accept && pk.challengerId === state.user._id) return { ok: false, err: '不可应弈自己发起的邀弈' };
      const market = findMarket(state, pk.marketId);
      if (!market || market.status !== 'open') return { ok: false, err: '该卦题已截止' };

      if (!accept) {
        pk.status = 'declined';
        const challenger = pk.challengerId === state.user._id ? state.user : findUser(state, pk.challengerId);
        if (challenger) challenger.points += pk.challenger.amount;
        const poolField = pk.challenger.choice === 'YES' ? 'yesPool' : 'noPool';
        market[poolField] = Math.max(0, (market[poolField] || 0) - pk.challenger.amount);
        delete state.bets[pk.challengerBetId];
        save(state);
        return { ok: true, status: 'declined' };
      }

      const oppChoice = pk.challenger.choice === 'YES' ? 'NO' : 'YES';
      const amount = pk.challenger.amount;
      if (state.user.points < amount) return { ok: false, err: '爻不足，无法应弈' };
      const betKey = `${state.user._id}_${pk.marketId}`;
      if (state.bets[betKey]) return { ok: false, err: '您已参与过该卦题，不能应弈' };

      state.user.points -= amount;
      if (oppChoice === 'YES') market.yesPool += amount;
      else market.noPool += amount;
      state.bets[betKey] = {
        _id: betKey,
        marketId: pk.marketId,
        openid: state.user._id,
        choice: oppChoice,
        amount,
        marketTitle: market.title,
        marketCategory: market.category,
        marketDeadline: market.deadline,
        status: 'active',
        payout: 0,
        pkId,
        createdAt: now()
      };
      pk.status = 'accepted';
      pk.opponentId = state.user._id;
      pk.participantIds = [pk.challengerId, state.user._id];
      pk.opponent = {
        openid: state.user._id,
        nickname: state.user.nickname,
        avatar: state.user.avatar,
        choice: oppChoice,
        amount
      };
      pk.opponentBetId = betKey;
      pk.acceptedAt = now();
      state.user.pkCount = (state.user.pkCount || 0) + 1;
      checkHonorsForState(state);
      save(state);
      return { ok: true, status: 'accepted', pkId, user: clone(state.user) };
    }

    case 'myPks': {
      expirePks(state);
      const me = state.user._id;
      const page = Math.max(Number(data.page) || 1, 1);
      const pageSize = Math.min(Math.max(Number(data.pageSize) || 20, 1), 50);
      const inbox = state.pks
        .filter(p => p.status === 'pending' && p.challengerId !== me)
        .map(p => Object.assign({}, p, {
          expiresIn: Math.max(0, (p.expiresAt || 0) - now())
        }));
      const allMine = state.pks
        .filter(p => p.challengerId === me || p.opponentId === me)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const total = allMine.length;
      const list = allMine
        .slice((page - 1) * pageSize, page * pageSize)
        .map(p => {
          const other = pkOpponentInfo(state, p, me);
          return Object.assign({}, p, { opponent: other, expiresIn: Math.max(0, (p.expiresAt || 0) - now()) });
        });
      return { ok: true, inbox, list, total, page, pageSize, hasMore: page * pageSize < total };
    }

    case 'pkLeaderboard': {
      const stats = {};
      state.pks.filter(p => p.status === 'settled').forEach(p => {
        [p.challengerId, p.opponentId].forEach(uid => {
          if (!uid) return;
          if (!stats[uid]) stats[uid] = { wins: 0, losses: 0, total: 0 };
          stats[uid].total += 1;
          if (p.winnerId === uid) stats[uid].wins += 1;
          else stats[uid].losses += 1;
        });
      });
      let list = Object.keys(stats)
        .filter(id => stats[id].total > 0)
        .map(id => {
          const u = findUser(state, id);
          return {
            openid: id,
            nickname: (u && u.nickname) || '卦中新客',
            avatar: (u && u.avatar) || '🔮',
            wins: stats[id].wins,
            losses: stats[id].losses,
            total: stats[id].total,
            winRate: Math.round((stats[id].wins / stats[id].total) * 100)
          };
        })
        .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || a.total - b.total)
        .slice(0, 50);

      // 追赶提示
      const meIdx = list.findIndex(x => x.openid === state.user._id);
      if (meIdx > 0) {
        list[meIdx] = Object.assign({}, list[meIdx], {
          gapToNext: list[meIdx - 1].winRate - list[meIdx].winRate
        });
      }
      if (meIdx >= 0) list[meIdx] = Object.assign({}, list[meIdx], { isMe: true });

      // 排名变化：与最近一份快照对比
      const snap = state.rankSnapshots.pk;
      const prevRankMap = {};
      if (snap) {
        snap.rankings.forEach(r => { prevRankMap[r.openid] = r.rank; });
      }
      list = list.map((item, i) => {
        const prev = prevRankMap[item.openid];
        let trend = '';
        if (prev !== undefined) {
          trend = i + 1 < prev ? 'up' : (i + 1 > prev ? 'down' : 'same');
        } else if (Object.keys(prevRankMap).length) {
          trend = 'new';
        }
        return Object.assign({}, item, { rank: i + 1, trend });
      });
      return { ok: true, list };
    }

    case 'togglePkOpen': {
      state.user.pkOpen = !!data.open;
      save(state);
      return { ok: true, user: clone(state.user) };
    }

    case 'simulatePkChallenge': {
      // 开发/演示用：模拟一位好友发起 对弈 邀弈
      const marketId = String(data.marketId || 'M003');
      const market = findMarket(state, marketId);
      if (!market || market.status !== 'open') return { ok: false, err: '该卦题不可邀弈' };
      if (state.pks.some(p => p.marketId === marketId && p.status === 'pending' && p.challengerId !== state.user._id)) {
        return { ok: false, err: '该卦题已有待处理的邀弈' };
      }
      state.pkSeq = (state.pkSeq || 0) + 1;
      const pkId = '对弈' + state.pkSeq;
      const nowTs = now();
      const challenger = {
        openid: 'MOCK_CHALLENGER',
        nickname: data.challenger && data.challenger.nickname || '测试邀弈者',
        avatar: data.challenger && data.challenger.avatar || '🐯',
        choice: data.challenger && data.challenger.choice || 'YES',
        amount: data.challenger && data.challenger.amount || 100
      };
      state.pks.unshift({
        _id: pkId,
        marketId,
        marketTitle: market.title,
        challengerId: challenger.openid,
        challenger,
        opponentId: '',
        opponent: null,
        participantIds: [challenger.openid],
        status: 'pending',
        winnerId: '',
        challengerBetId: '',
        opponentBetId: '',
        createdAt: nowTs,
        expiresAt: nowTs + 24 * 3600 * 1000
      });
      save(state);
      return { ok: true, pkId };
    }

    case 'inviteStats': {
      const stats = buildInviteStats(state);
      const list = clone(state.invites.filter(i => i.inviterId === MOCK_OPENID));
      list.forEach(i => {
        const u = findUser(state, i.inviteeId);
        i.invitee = u ? { nickname: u.nickname, avatar: u.avatar } : { nickname: '卦中新客', avatar: '🔮' };
      });
      return { ok: true, stats, list };
    }

    case 'updateProfile': {
      if (data.nickname !== undefined) {
        const check = validateNickname(data.nickname);
        if (!check.ok) return { ok: false, err: check.err };
        state.user.nickname = check.value;
      }
      if (data.avatarUrl !== undefined) state.user.avatarUrl = String(data.avatarUrl || '').slice(0, 500);
      if (data.avatar !== undefined) state.user.avatar = String(data.avatar);
      if (data.title !== undefined) state.user.title = String(data.title || '').slice(0, 64);
      save(state);
      return { ok: true, user: clone(state.user) };
    }

    case 'getMarkets': {
      if (data.hot) {
        const min = Number(data.minTotal) || 0;
        const list = state.markets
          .filter(m => ['open', 'locked'].includes(m.status) && !m.needsManualReview && (m.yesPool || 0) + (m.noPool || 0) >= min)
          .sort((a, b) => ((b.yesPool || 0) + (b.noPool || 0)) - ((a.yesPool || 0) + (a.noPool || 0)));
        return { ok: true, list: clone(list) };
      }
      const category = data.category || '';
      const list = state.markets.filter(m => ['open', 'locked'].includes(m.status) && !m.needsManualReview && (!category || m.category === category));
      list.sort((a, b) => a.deadline - b.deadline);
      return { ok: true, list: clone(list) };
    }

    case 'getMarketDetail': {
      const market = findMarket(state, data.marketId);
      if (!market) return { ok: false, err: '卦题不存在' };
      const myBet = state.bets[`${state.user._id}_${data.marketId}`] || null;
      const myDispute = state.disputes[`${state.user._id}_${data.marketId}`] || null;
      const participantCount = Object.keys(state.bets).filter(k => state.bets[k].marketId === data.marketId).length;
      const activeArb = state.arbitrations.find(a => a.marketId === data.marketId && a.status === 'pending') || null;
      return {
        ok: true,
        market: clone(market),
        myBet: clone(myBet),
        myDispute: clone(myDispute),
        participantCount,
        activeArbitration: activeArb ? clone(activeArb) : null
      };
    }

    case 'createArbitration': {
      const marketId = String(data.marketId || '');
      const reasonCheck = validateArbitrationReason(data.reason);
      if (!reasonCheck.ok) return { ok: false, err: reasonCheck.err };
      const reason = reasonCheck.value;
      const market = findMarket(state, marketId);
      if (!market) return { ok: false, err: '卦题不存在' };
      if (market.status !== 'dispute_window') return { ok: false, err: '当前不在断卦公示期，无法发起公断' };
      const participantCount = Object.keys(state.bets).filter(k => state.bets[k].marketId === marketId).length;
      if (participantCount < 10) return { ok: false, err: `该卦题应卦人数不足 10 人，暂反对社区公断（当前 ${participantCount} 人）` };

      // 资格：已结卦应卦 ≥ 5 或 已结卦 对弈 ≥ 3
      const settledBets = Object.keys(state.bets).filter(k => state.bets[k].openid === state.user._id && state.bets[k].status === 'won').length;
      const settledPks = state.pks.filter(p => p.status === 'settled' && p.participantIds && p.participantIds.includes(state.user._id)).length;
      if (settledBets < 5 && settledPks < 3) {
        return { ok: false, err: '公断参与资格：需已结卦应卦 ≥ 5 次或已结卦 对弈 ≥ 3 场' };
      }

      const bond = state.user.points;
      if (bond < VOTE_BOND_MIN) return { ok: false, err: `爻不足，发起公断需要至少 ${VOTE_BOND_MIN} 爻` };
      if (state.arbitrations.some(a => a.marketId === marketId && a.status === 'pending')) {
        return { ok: false, err: '该卦题已有进行中的公断' };
      }
      if (state.arbitrations.some(a => a.status === 'pending' && a.challenger.openid === state.user._id)) {
        return { ok: false, err: '您同时只能参与 1 个公断' };
      }
      const lastArb = state.arbitrations
        .filter(a => a.challenger.openid === state.user._id)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (lastArb && lastArb.status === 'pending' && now() - lastArb.createdAt < 24 * 3600 * 1000) {
        return { ok: false, err: '24 小时内只能发起 1 次公断' };
      }

      const arbId = 'ARB' + (state.arbitrations.length + 1);
      const nowTs = now();
      const arb = {
        _id: arbId,
        marketId,
        marketTitle: market.title,
        reason,
        challenger: { openid: state.user._id, nickname: state.user.nickname, avatar: state.user.avatar, bond },
        challengerBond: bond,
        supportPool: bond,
        opposePool: 0,
        supportVotes: 1,
        opposeVotes: 0,
        participantCount,
        minVotes: Math.max(Math.ceil(participantCount * 0.1), 2),
        status: 'pending',
        winner: '',
        createdAt: nowTs,
        endsAt: nowTs + 24 * 3600 * 1000
      };
      state.arbitrations.unshift(arb);
      state.arbitrationVotes[`${arbId}_${state.user._id}`] = {
        arbitrationId: arbId, marketId, openid: state.user._id, side: 'support', bond, isChallenger: true, createdAt: nowTs
      };
      state.user.points -= bond;
      market.status = 'arbitration_window';
      market.arbitrationId = arbId;
      save(state);
      return { ok: true, arbitration: clone(arb), user: clone(state.user) };
    }

    case 'getArbitration': {
      const marketId = String(data.marketId || '');
      const arb = state.arbitrations.filter(a => a.marketId === marketId).sort((a, b) => b.createdAt - a.createdAt)[0] || null;
      if (!arb) return { ok: true, arbitration: null, myVote: null, eligible: false };
      const myVote = state.arbitrationVotes[`${arb._id}_${state.user._id}`] || null;
      const settledBets = Object.keys(state.bets).filter(k => state.bets[k].openid === state.user._id && state.bets[k].status === 'won').length;
      const settledPks = state.pks.filter(p => p.status === 'settled' && p.participantIds && p.participantIds.includes(state.user._id)).length;
      return {
        ok: true,
        arbitration: Object.assign({}, clone(arb), { remainingMs: Math.max(0, (arb.endsAt || 0) - now()) }),
        myVote: clone(myVote),
        eligible: settledBets >= 5 || settledPks >= 3
      };
    }

    case 'voteArbitration': {
      const arbId = String(data.arbitrationId || '');
      const side = data.side;
      const bond = Math.floor(Number(data.bond) || 0);
      const arb = state.arbitrations.find(a => a._id === arbId);
      if (!arb) return { ok: false, err: '公断不存在' };
      if (arb.status !== 'pending') return { ok: false, err: '公断已结束' };
      if (now() > arb.endsAt) return { ok: false, err: '公断公示期已结束' };
      if (side !== 'support' && side !== 'oppose') return { ok: false, err: '参数不合法' };
      if (bond < VOTE_BOND_MIN) return { ok: false, err: '附议保证金至少 ' + VOTE_BOND_MIN + ' 爻' };

      const settledBets = Object.keys(state.bets).filter(k => state.bets[k].openid === state.user._id && state.bets[k].status === 'won').length;
      const settledPks = state.pks.filter(p => p.status === 'settled' && p.participantIds && p.participantIds.includes(state.user._id)).length;
      if (settledBets < 5 && settledPks < 3) {
        return { ok: false, err: '公断参与资格：需已结卦应卦 ≥ 5 次或已结卦 对弈 ≥ 3 场' };
      }
      const voteKey = `${arbId}_${state.user._id}`;
      if (state.arbitrationVotes[voteKey]) return { ok: false, err: '您已投过票' };
      const activeArbs = state.arbitrations.filter(a => a.status === 'pending');
      for (const a of activeArbs) {
        if (state.arbitrationVotes[`${a._id}_${state.user._id}`]) {
          return { ok: false, err: '您同时只能参与 1 个公断' };
        }
      }
      if (state.user.points < bond) return { ok: false, err: '爻不足' };

      state.arbitrationVotes[voteKey] = {
        arbitrationId: arbId, marketId: arb.marketId, openid: state.user._id, side, bond, isChallenger: false, createdAt: now()
      };
      state.user.points -= bond;
      if (side === 'support') {
        arb.supportPool += bond;
        arb.supportVotes += 1;
      } else {
        arb.opposePool += bond;
        arb.opposeVotes += 1;
      }
      save(state);
      return { ok: true, user: clone(state.user) };
    }

    case 'settleArbitration': {
      const arbId = String(data.arbitrationId || '');
      const arb = state.arbitrations.find(a => a._id === arbId);
      if (!arb) return { ok: false, err: '公断不存在' };
      if (arb.status !== 'pending') return { ok: false, err: '公断已结束' };

      const wins = arb.supportVotes > arb.opposeVotes
        && (arb.supportVotes + arb.opposeVotes) >= arb.minVotes
        && arb.supportVotes >= 2
        && arb.opposeVotes >= 1;
      const winnerSide = wins ? 'support' : 'oppose';
      const loserSide = wins ? 'oppose' : 'support';
      const loserPool = winnerSide === 'support' ? (arb.opposePool || 0) : (arb.supportPool || 0);
      const votes = Object.keys(state.arbitrationVotes)
        .filter(k => state.arbitrationVotes[k].arbitrationId === arbId)
        .map(k => state.arbitrationVotes[k]);
      const winners = votes.filter(v => v.side === winnerSide);
      const winnerBondTotal = winners.reduce((s, v) => s + (v.bond || 0), 0);

      // 无对赌兜底：某一方 0 票时全额退回所有保证金
      if (winners.length === 0 || (votes.length - winners.length) === 0) {
        votes.forEach(v => {
          const u = v.openid === state.user._id ? state.user : findUser(state, v.openid);
          if (u) u.points += (v.bond || 0);
        });
        arb.status = 'settled';
        arb.winner = 'no_bet';
        arb.settledAt = now();
        const m = findMarket(state, arb.marketId);
        if (m) {
          m.status = 'dispute_window';
          m.arbitrationResult = 'no_bet';
        }
        save(state);
        return { ok: true, wins: false, noBet: true, refunded: true };
      }

      winners.forEach(v => {
        const share = winnerBondTotal > 0 ? Math.floor(((v.bond || 0) / winnerBondTotal) * loserPool) : 0;
        const u = v.openid === state.user._id ? state.user : findUser(state, v.openid);
        if (!u) return;
        u.points += (v.bond || 0) + share;
        u.weekPoints = (u.weekPoints || 0) + share;
        u.monthPoints = (u.monthPoints || 0) + share;
        u.totalPoints = (u.totalPoints || 0) + share;
      });

      arb.status = 'settled';
      arb.winner = wins ? 'support' : 'oppose';
      arb.settledAt = now();
      const market = findMarket(state, arb.marketId);
      if (market) {
        if (wins && market.result) {
          market.result = market.result === 'YES' ? 'NO' : 'YES';
        }
        market.status = 'dispute_window';
        market.arbitrationResult = wins ? 'overturned' : 'upheld';
      }
      save(state);
      return { ok: true, wins, winnerSide, flipped: wins };
    }

    case 'mockSeedArbitration': {
      // 开发/演示用：为指定市场注入多人应卦，满足发起公断的参与人数门槛
      const marketId = String(data.marketId || 'M001');
      const market = findMarket(state, marketId);
      if (!market) return { ok: false, err: '卦题不存在' };
      const existingCount = Object.keys(state.bets).filter(k => state.bets[k].marketId === marketId).length;
      if (existingCount >= 10) return { ok: true, participantCount: existingCount };

      for (let i = 1; i <= 12; i++) {
        const uid = 'MOCK_PARTICIPANT_' + i;
        const key = `${uid}_${marketId}`;
        if (state.bets[key]) continue;
        ensureMockUser(state, uid, '虚拟参与者 ' + i);
        state.bets[key] = {
          _id: key,
          marketId,
          openid: uid,
          choice: i % 2 === 0 ? 'YES' : 'NO',
          amount: 10,
          marketTitle: market.title,
          marketCategory: market.category,
          marketDeadline: market.deadline,
          status: i <= 6 ? 'won' : 'active',
          payout: 0,
          createdAt: now() - i * 3600 * 1000
        };
      }
      // 给当前用户补 5 条已结卦应卦，满足公断附议资格
      for (let i = 0; i < 5; i++) {
        const key = `${state.user._id}_SEED_WON_${i}`;
        if (state.bets[key]) continue;
        state.bets[key] = {
          _id: key,
          marketId: 'SEED' + i,
          openid: state.user._id,
          choice: 'YES',
          amount: 10,
          marketTitle: '历史结卦示例 ' + i,
          marketCategory: '科技数码',
          marketDeadline: 0,
          status: 'won',
          payout: 60,
          createdAt: now() - (10 + i) * 3600 * 1000
        };
      }
      state.user.betCount = Object.keys(state.bets).filter(k => state.bets[k].openid === state.user._id).length;
      save(state);
      return { ok: true, participantCount: Object.keys(state.bets).filter(k => state.bets[k].marketId === marketId).length };
    }

    case 'mockSeedVotes': {
      // 开发/演示用：为公断注入附议/反对附议（虚拟社区用户），演示分卦结卦
      const arbId = String(data.arbitrationId || '');
      const arb = state.arbitrations.find(a => a._id === arbId);
      if (!arb) return { ok: false, err: '公断不存在' };
      const supportN = Number(data.support) || 2;
      const opposeN = Number(data.oppose) || 1;
      for (let i = 1; i <= supportN; i++) {
        const uid = 'MOCK_VOTER_S' + i;
        const key = `${arbId}_${uid}`;
        if (state.arbitrationVotes[key]) continue;
        ensureMockUser(state, uid, '虚拟附议者 ' + i);
        state.arbitrationVotes[key] = {
          arbitrationId: arbId, marketId: arb.marketId, openid: uid, side: 'support', bond: 50, isChallenger: false, createdAt: now()
        };
        arb.supportPool += 50;
        arb.supportVotes += 1;
      }
      for (let i = 1; i <= opposeN; i++) {
        const uid = 'MOCK_VOTER_O' + i;
        const key = `${arbId}_${uid}`;
        if (state.arbitrationVotes[key]) continue;
        ensureMockUser(state, uid, '虚拟反对者 ' + i);
        state.arbitrationVotes[key] = {
          arbitrationId: arbId, marketId: arb.marketId, openid: uid, side: 'oppose', bond: 50, isChallenger: false, createdAt: now()
        };
        arb.opposePool += 50;
        arb.opposeVotes += 1;
      }
      save(state);
      return { ok: true, supportVotes: arb.supportVotes, opposeVotes: arb.opposeVotes };
    }

    case 'placeBet': {
      const market = findMarket(state, data.marketId);
      if (!market) return { ok: false, err: '卦题不存在' };
      if (market.status !== 'open') return { ok: false, err: '该卦题已截止或正在结卦' };
      if (market.needsManualReview) return { ok: false, err: '该卦题已停止接收应卦' };
      if (!data.choice || (data.choice !== 'YES' && data.choice !== 'NO')) return { ok: false, err: '参数不合法' };
      const amount = Number(data.amount);
      if (!Number.isInteger(amount) || amount < MIN_BET_AMOUNT) return { ok: false, err: `至少投入 ${MIN_BET_AMOUNT} 爻` };
      if (state.user.points < amount) return { ok: false, err: '爻不足' };

      const betId = `${state.user._id}_${market._id}`;
      if (state.bets[betId]) return { ok: false, err: '您已参与过该卦题' };
      if (state.pks.some(p => p.marketId === market._id && p.participantIds && p.participantIds.includes(state.user._id) && (p.status === 'pending' || p.status === 'accepted'))) {
        return { ok: false, err: '您已参与该卦题的 对弈 邀弈，不能重复应卦' };
      }

      state.user.points -= amount;
      if (data.choice === 'YES') market.yesPool += amount;
      else market.noPool += amount;
      state.user.betCount = (state.user.betCount || 0) + 1;
      checkHonorsForState(state);

      const myBet = {
        _id: betId,
        marketId: market._id,
        openid: state.user._id,
        choice: data.choice,
        amount,
        marketTitle: market.title,
        marketCategory: market.category,
        marketDeadline: market.deadline,
        status: 'active',
        payout: 0,
        createdAt: now()
      };
      state.bets[betId] = myBet;

      // 邀友裂变：被邀友人首次应卦 → 邀友人得奖励
      let inviteRewardGranted = 0;
      if (state.user.invitedBy && !state.user.inviteRewarded) {
        const inviter = findUser(state, state.user.invitedBy);
        if (inviter) {
          const today = dayKey(now());
          const dailyUsed = inviter.inviteRewardDate === today ? (inviter.inviteRewardToday || 0) : 0;
          if (dailyUsed < INVITE_DAILY_CAP) {
            inviter.points += INVITE_INVITER_POINTS;
            inviter.totalPoints += INVITE_INVITER_POINTS;
            inviter.weekPoints += INVITE_INVITER_POINTS;
            inviter.monthPoints += INVITE_INVITER_POINTS;
            inviter.inviteRewardDate = today;
            inviter.inviteRewardToday = dailyUsed + 1;
            inviteRewardGranted = INVITE_INVITER_POINTS;
          }
        }
        state.user.inviteRewarded = true;
        const invite = findInvite(state, state.user.invitedBy, state.user._id);
        if (invite) invite.inviterRewarded = true;
      }

      save(state);
      return { ok: true, market: clone(market), user: clone(state.user), myBet: clone(myBet), inviteRewardGranted };
    }

    case 'getMyRecords': {
      const list = Object.keys(state.bets).map(k => state.bets[k]);
      list.sort((a, b) => b.createdAt - a.createdAt);
      const page = Math.max(Number(data.page) || 1, 1);
      const pageSize = Math.min(Math.max(Number(data.pageSize) || 20, 1), 50);
      const total = list.length;
      const pageList = list.slice((page - 1) * pageSize, page * pageSize);
      return {
        ok: true,
        list: clone(pageList),
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total
      };
    }

    case 'getDataSources': {
      const list = clone(state.dataSources);
      const priority = { frozen: 0, pending: 1, trial: 2, verified: 3 };
      list.sort((a, b) => (priority[b.status] || 0) - (priority[a.status] || 0));
      return { ok: true, list };
    }

    case 'upsertDataSource': {
      const name = String(data.name || '').trim();
      if (!name) return { ok: false, err: '名称不能为空' };
      if (name.length > 50) return { ok: false, err: '数据源名称过长（最多 50 字）' };
      const notes = String(data.notes || '');
      const MOCK_SENSITIVE = ['傻逼', '赌博', '博彩', '下注', '色情', '毒品', '台独', '法轮功', '<script>'];
      const hitName = MOCK_SENSITIVE.find(w => name.toLowerCase().indexOf(w) >= 0);
      if (hitName) return { ok: false, err: '数据源名称包含敏感内容，请修改' };
      const hitNotes = MOCK_SENSITIVE.find(w => notes.toLowerCase().indexOf(w) >= 0);
      if (hitNotes) return { ok: false, err: '数据源备注包含敏感内容，请修改' };
      const id = String(data.id || '');
      const doc = {
        name,
        category: String(data.category || '全品类'),
        type: String(data.type || 'api'),
        access: String(data.access || 'free'),
        url: String(data.url || ''),
        notes,
        status: String(data.status || 'trial')
      };
      if (id) {
        const idx = state.dataSources.findIndex(s => s._id === id);
        if (idx >= 0) state.dataSources[idx] = Object.assign({}, state.dataSources[idx], doc);
        else state.dataSources.push(Object.assign({ _id: id }, doc));
      } else {
        const newId = 'SRC-' + Math.random().toString(36).slice(2, 8).toUpperCase();
        state.dataSources.push(Object.assign({ _id: newId }, doc));
      }
      save(state);
      return { ok: true, list: clone(state.dataSources) };
    }

    case 'createMarket': {
      const category = String(data.category || '');
      const title = String(data.title || '').trim();
      const sourceOfTruth = String(data.sourceOfTruth || '').trim();
      const deadline = Number(data.deadline);
      const spec = data.resolutionSpec;
      if (!['影视娱乐', '科技数码', '游戏电竞', '体育竞技', '趣味民生', '财经宏观'].includes(category)) return { ok: false, err: '分类不合法' };
      if (title.length < 10) return { ok: false, err: '标题过短' };
      if (!['是否', '能否', '会不会', '能不能', '有没有', '是否达到', '是否超过', '是否低于', '是否突破'].some(w => title.indexOf(w) >= 0)) {
        return { ok: false, err: '标题必须二值化（请使用“是否/能否/是否达到”等表述）' };
      }
      const sensitive = ['选举', '大选', '总统', '审判', '开庭', '判决', '起诉', '游行', '抗议', '疫情', '确诊', '封控'].find(w => title.indexOf(w) >= 0);
      if (sensitive) return { ok: false, err: `标题涉及敏感红线（${sensitive}），禁止发布` };
      if (!deadline || deadline <= now()) return { ok: false, err: '截止时间必须晚于当前时间' };
      if (!spec || !spec.dataSource || !spec.dataSource.type) return { ok: false, err: '缺少断卦规范' };
      // 与云端一致：api/weather 必须引用注册数据源并提供 url/field/transform；
      // 断卦说明中不得同时出现多个已注册数据源名称
      const sourceType = spec.dataSource.type;
      const sourceName = String(spec.dataSource.name || spec.dataSource.provider || '').trim();
      const sourceUrl = String(spec.dataSource.url || '').trim();
      if (sourceType !== 'manual') {
        const matched = state.dataSources.some(s =>
          (sourceName && (s.name === sourceName || (s._id || s.id) === sourceName)) ||
          (sourceUrl && s.url === sourceUrl)
        );
        if (!matched) {
          return { ok: false, err: `数据源未注册：请先在数据源注册表登记「${sourceName || sourceUrl || sourceType}」` };
        }
        if (!sourceUrl || !String(spec.dataSource.field || '').trim()) {
          return { ok: false, err: 'api/weather 类型必须提供数据源 url 与取值字段 field' };
        }
        if (!['int', 'float', 'string'].includes(spec.dataSource.transform)) {
          return { ok: false, err: 'transform 仅附议 int / float / string' };
        }
      }
      if (spec.humanReadable) {
        const hr = String(spec.humanReadable);
        const hitNames = state.dataSources.filter(s => s.name && hr.indexOf(s.name) >= 0).map(s => s.name);
        if (hitNames.length > 1) {
          return { ok: false, err: `断卦说明出现多个数据源（${hitNames.join('、')}），只能指定一个结卦源` };
        }
      }
      const marketId = 'M' + String(state.markets.length + 1).padStart(3, '0');
      state.markets.push({
        _id: marketId,
        category,
        title,
        sourceOfTruth: spec.humanReadable || sourceOfTruth,
        deadline,
        yesPool: 0,
        noPool: 0,
        status: 'open',
        result: null,
        hasDispute: false,
        disputeCount: 0,
        resolutionSpec: spec,
        resolutionMethod: '',
        resolutionAttempts: 0,
        needsManualReview: false,
        createdAt: now()
      });
      save(state);
      return { ok: true, marketId };
    }

    case 'getPendingReviews': {
      const nowTs = now();
      const SOON_MS = 2 * 3600 * 1000;
      const list = state.markets
        .filter(m => {
          if (m.status === 'dispute_window') return true;
          if (m.needsManualReview) return true;
          // manual 类型已过截止（或即将截止）
          const isManual = m.resolutionSpec && m.resolutionSpec.dataSource && m.resolutionSpec.dataSource.type === 'manual';
          return isManual && m.status === 'open' && m.deadline <= nowTs + SOON_MS;
        })
        .map(m => {
          const reviewType = m.status === 'dispute_window' ? 'dispute' : (m.needsManualReview ? 'manual_fail' : 'manual_deadline');
          const remainingMs = (m.deadline || 0) - nowTs;
          const urgency = remainingMs < 0 ? 'urgent' : (remainingMs <= SOON_MS ? 'soon' : 'normal');
          return Object.assign({}, clone(m), { reviewType, remainingMs, urgency });
        });
      const order = { urgent: 0, soon: 1, normal: 2 };
      list.sort((a, b) => (order[a.urgency] - order[b.urgency]) || ((a.deadline || 0) - (b.deadline || 0)));
      return { ok: true, list };
    }

    case 'getDashboardStats': {
      const markets = state.markets;
      const stats = {
        total: markets.length,
        open: 0,
        dispute_window: 0,
        resolved: 0,
        manual: 0,
        dailyCreated: last7Days(),
        methodDist: { auto_api: 0, manual: 0, none: 0 },
        autoStats: {},
        pending: { manual: 0, dispute: 0, disputes: Object.keys(state.disputes).length }
      };
      const dayIndex = {};
      stats.dailyCreated.forEach(d => { dayIndex[d.key] = d; });

      markets.forEach(m => {
        if (m.status === 'open') stats.open++;
        else if (m.status === 'dispute_window') stats.dispute_window++;
        else if (m.status === 'resolved') stats.resolved++;
        if (m.needsManualReview) stats.manual++;

        const dk = dayKey(m.createdAt || m.deadline || 0);
        if (dayIndex[dk]) dayIndex[dk].count++;

        const provider = (m.resolutionSpec && m.resolutionSpec.dataSource && m.resolutionSpec.dataSource.provider) || '未配置数据源';
        if (!stats.autoStats[provider]) stats.autoStats[provider] = { ok: 0, fail: 0 };

        if (m.status === 'resolved' && m.resolutionMethod) {
          stats.methodDist[m.resolutionMethod]++;
          stats.autoStats[provider].ok++;
        } else if (m.needsManualReview) {
          stats.methodDist.manual++;
          stats.autoStats[provider].fail++;
        } else if (m.status === 'resolved') {
          stats.methodDist.manual++;
        } else {
          stats.methodDist.none++;
        }
      });

      stats.pending.manual = stats.manual;
      stats.pending.dispute = stats.dispute_window;
      stats.maxDaily = Math.max(1, ...stats.dailyCreated.map(d => d.count));
      stats.autoStats = Object.keys(stats.autoStats)
        .map(provider => {
          const s = stats.autoStats[provider];
          const total = s.ok + s.fail;
          return {
            label: provider,
            ok: s.ok,
            fail: s.fail,
            rate: total > 0 ? Math.round((s.ok / total) * 100) : 0
          };
        })
        .sort((a, b) => b.ok - a.ok);
      stats.methodDist = [
        { method: 'auto_api', label: 'API 自动断卦', count: stats.methodDist.auto_api || 0 },
        { method: 'manual', label: '人工录入断卦', count: stats.methodDist.manual || 0 },
        { method: 'none', label: '未断卦', count: stats.methodDist.none || 0 }
      ];
      return { ok: true, stats };
    }

    case 'getLeaderboard': {
      const fieldMap = { streak: 'streak', week: 'weekPoints', month: 'monthPoints', total: 'totalPoints' };
      const field = fieldMap[data.type] || 'streak';
      const type = data.type || 'streak';
      const limit = Math.min(Math.max(Number(data.limit) || 50, 10), 200);
      const meVal = state.user[field] || 0;
      const all = state.users.map(u => ({
        openid: u._id,
        nickname: u.nickname,
        avatarUrl: u.avatarUrl || '',
        value: u[field] || 0,
        isMe: false
      }));
      const myRank = all.filter(u => u.value > meVal).length + 1;
      all.push({
        openid: state.user._id,
        nickname: state.user.nickname,
        avatarUrl: state.user.avatarUrl || '',
        value: meVal,
        isMe: true
      });
      all.sort((a, b) => b.value - a.value);
      let list = all.slice(0, limit).map((u, i) => ({
        openid: u.openid,
        rank: i + 1,
        nickname: u.nickname,
        avatarUrl: u.avatarUrl,
        value: u.value,
        isMe: u.isMe
      }));

      // 追赶提示：榜内第一个 value 大于我的（即我的上一名）
      let gapToNext = 0;
      const beforeMe = list.filter(x => x.value > meVal);
      if (beforeMe.length) {
        gapToNext = beforeMe[beforeMe.length - 1].value - meVal;
      }
      list = list.map(item => item.isMe ? Object.assign({}, item, { gapToNext }) : item);
      if (!list.some(x => x.isMe)) {
        list.push({
          openid: state.user._id,
          rank: myRank,
          nickname: state.user.nickname,
          avatarUrl: state.user.avatarUrl || '',
          value: meVal,
          isMe: true,
          gapToNext
        });
      }

      // 排名变化：与最近一份快照对比
      const snap = state.rankSnapshots[type];
      const prevRankMap = {};
      if (snap) {
        snap.rankings.forEach(r => { prevRankMap[r.openid] = r.rank; });
      }
      list = list.map(item => {
        const prev = prevRankMap[item.openid];
        let trend = '';
        if (prev !== undefined) {
          trend = item.rank < prev ? 'up' : (item.rank > prev ? 'down' : 'same');
        } else if (Object.keys(prevRankMap).length) {
          trend = 'new';
        }
        return Object.assign({}, item, { trend });
      });
      return { ok: true, list, myRank, limit, totalCount: state.users.length };
    }

    case 'claimRelief': {
      if (state.user.points > 0) return { ok: false, err: '爻充足，无需补助' };
      const nowTs = now();
      if (state.user.lastReliefAt && nowTs - state.user.lastReliefAt < config.RELIEF_COOLDOWN_MS) {
        const left = config.RELIEF_COOLDOWN_MS - (nowTs - state.user.lastReliefAt);
        const h = Math.floor(left / 3600000);
        const m = Math.floor((left % 3600000) / 60000);
        return { ok: false, err: h > 0 ? `${h}小时${m}分后可再次领取` : `${m}分钟后可再次领取` };
      }
      state.user.points += config.RELIEF_POINTS;
      state.user.lastReliefAt = nowTs;
      save(state);
      return { ok: true, user: clone(state.user) };
    }

    case 'submitDispute': {
      const market = findMarket(state, data.marketId);
      if (!market) return { ok: false, err: '卦题不存在' };
      if (market.status !== 'dispute_window') return { ok: false, err: '当前不在异议公示期' };
      const betId = `${state.user._id}_${market._id}`;
      if (!state.bets[betId]) return { ok: false, err: '您未参与该卦题' };
      const reason = String(data.reason || '').trim();
      if (reason.length < 5) return { ok: false, err: '请填写至少 5 个字的异议理由' };
      if (state.disputes[betId]) return { ok: false, err: '您已提交过申诉' };

      state.disputes[betId] = {
        _id: betId,
        marketId: market._id,
        openid: state.user._id,
        reason,
        createdAt: now()
      };
      market.hasDispute = true;
      market.disputeCount = (market.disputeCount || 0) + 1;
      save(state);
      return { ok: true, myDispute: clone(state.disputes[betId]) };
    }

    case 'resolveMarket': {
      const market = findMarket(state, data.marketId);
      if (!market) return { ok: false, err: '卦题不存在' };
      if (!['open', 'locked'].includes(market.status)) return { ok: false, err: '该卦题已进入断卦或已结卦' };
      if (!data.result || (data.result !== 'YES' && data.result !== 'NO')) return { ok: false, err: '参数不合法' };
      market.status = 'dispute_window';
      market.result = data.result;
      market.evidenceUrl = String(data.evidenceUrl || '');
      market.resolvedAt = now();
      // 本地演示：公示期缩短为 1 分钟，便于快速验证
      market.disputeEndsAt = now() + 60 * 1000;
      save(state);
      return { ok: true, market: clone(market) };
    }

    case 'settleMarket': {
      const market = findMarket(state, data.marketId);
      if (!market) return { ok: false, err: '卦题不存在' };
      if (market.status !== 'dispute_window') return { ok: false, err: '该卦题不在公示期' };
      if (market.hasDispute && !data.force) {
        return { ok: false, err: '存在申诉，需人工复核后再结卦（可传 force=true 强制结卦）' };
      }
      const r = settleMarketState(state, market._id);
      if (r.ok) save(state);
      return r;
    }

    case 'aiDraftSpec': {
      // Mock 模拟：按标题关键词生成草稿，方便无 API Key 时预览完整流程
      const title = String(data.title || '');
      const sources = Array.isArray(data.sources) ? data.sources : [];
      if (/气温|温度|天气/.test(title)) {
        const src = sources.find(s => /气象/.test(s.name || '')) || { name: '中国气象网' };
        return {
          ok: true,
          spec: {
            mode: 'numeric',
            provider: src.name,
            field: 'weatherinfo.temp',
            transform: 'int',
            operator: '>=',
            value: 35,
            unit: '℃',
            humanReadable: `根据「${src.name}」官方实况，断卦时点整点气温 ≥ 35.0℃ 则“应验”，否则“未应验”；数据缺失时爻原路退回。（Mock 示例草稿，正式环境由 DeepSeek 生成）`
          }
        };
      }
      return {
        ok: true,
        spec: {
          mode: 'manual',
          provider: '官方公告',
          humanReadable: '以品牌官方公告/官微为准，出现明确官方声明则“应验”，否则“未应验”；数据缺失时爻原路退回。（Mock 示例草稿，正式环境由 DeepSeek 生成）'
        }
      };
    }

    case 'aiSuggestTopics': {
      // Mock 模拟：返回固定候选清单（已标注五项约束检查），方便无 API Key 时预览完整流程
      return {
        ok: true,
        list: [
          {
            _id: 'c0',
            title: '明天 14:00 北京南郊观象台整点气温是否 ≥ 35.0℃？',
            category: '趣味民生',
            reason: '气象局官方实况接口可自动断卦（Mock 示例，正式环境由 DeepSeek 生成）',
            dataSource: '中国气象网',
            suggestedDeadline: '明天 14:00',
            verifiable: true,
            probability: 30,
            constraintCheck: { binary: true, singleSource: true, hardDeadline: true, noSensitive: true, hasSuspense: true }
          },
          {
            _id: 'c1',
            title: '某头部手机品牌是否于本月内官宣下一代旗舰的发布日期？',
            category: '科技数码',
            reason: '发布会/官微公告类卦题，热度高（Mock 示例）',
            dataSource: '官方公告',
            suggestedDeadline: '本月最后一天 24:00',
            verifiable: true,
            probability: 55,
            constraintCheck: { binary: true, singleSource: true, hardDeadline: true, noSensitive: true, hasSuspense: true }
          },
          {
            _id: 'c2',
            title: '本周末热映新片首日综合票房是否突破 8000 万元？',
            category: '影视娱乐',
            reason: '需票房数据商授权，未接入前建议人工断卦（Mock 示例）',
            dataSource: '',
            suggestedDeadline: '本周日 24:00',
            verifiable: false
          },
          {
            _id: 'c3',
            title: '本周 LPL 焦点战获胜方是否以 2:0 结束系列赛？',
            category: '游戏电竞',
            reason: '官方赛果面板可验证（Mock 示例）',
            dataSource: '体育赛事数据商',
            suggestedDeadline: '比赛结束日 24:00',
            verifiable: true
          }
        ]
      };
    }

    case 'checkIn': {
      const today = fmt.todayKey();
      const yesterday = fmt.todayKey(-1);
      const u = state.user;
      if (u.lastCheckInDate === today) return { ok: false, err: '今日问签已定' };
      const streak = u.lastCheckInDate === yesterday ? (u.checkInStreak || 0) + 1 : 1;
      const bonus = Math.min(Math.max(streak - 1, 0), CHECKIN_STREAK_CAP - 1) * CHECKIN_STREAK_BONUS;
      const granted = CHECKIN_BASE_POINTS + bonus;
      u.points += granted;
      u.lastCheckInDate = today;
      u.checkInStreak = streak;
      u.checkInTotal = (u.checkInTotal || 0) + 1;
      save(state);
      return {
        ok: true,
        user: clone(u),
        checkIn: { streak, total: u.checkInTotal, granted, checked: true }
      };
    }

    case 'claimAdTask': {
      const today = fmt.todayKey();
      const u = state.user;
      const count = u.adTaskDate === today ? (u.adTaskCount || 0) : 0;
      if (count >= AD_TASK_LIMIT) return { ok: false, err: '今日次数已用完' };
      u.points += AD_TASK_POINTS;
      u.adTaskDate = today;
      u.adTaskCount = count + 1;
      save(state);
      return {
        ok: true,
        user: clone(u),
        adTask: { count: u.adTaskCount, limit: AD_TASK_LIMIT, granted: AD_TASK_POINTS }
      };
    }

    case 'checkHonors': {
      const unlocked = checkHonorsForState(state);
      save(state);
      return { ok: true, unlocked, honors: clone(state.user.honors || []) };
    }

    default:
      return { ok: false, err: `未知接口: ${name}` };
  }
}

module.exports = { call, MOCK_OPENID };
