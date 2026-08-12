const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function toNumber(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return new Date(ts).getTime() || 0;
  if (ts.$date) return ts.$date;
  if (typeof ts.getTime === 'function') return ts.getTime();
  return 0;
}

// 邀友奖励配置：三个函数（login/placeBet/inviteStats）共用同一组环境变量，缺省值保持一致
const INVITE_DAILY_CAP = Number(process.env.INVITE_DAILY_CAP) || 10;

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, err: '获取用户身份失败' };

  try {
    const users = db.collection('users');
    const invites = db.collection('invites');
    const me = (await users.doc(OPENID).get()).data;

    // 我的邀友记录（按时间倒序，先全量拉取用于准确统计，再截取最近 50 条展示）
    const allInvites = [];
    let skip = 0;
    const PAGE = 100;
    while (true) {
      const page = await invites
        .where({ inviterId: OPENID })
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(PAGE)
        .get();
      allInvites.push(...page.data);
      if (page.data.length < PAGE) break;
      skip += PAGE;
    }
    const list = allInvites.slice(0, 50);

    // 统计基于全量记录，避免截断导致的数字失真
    const weekStart = Date.now() - 7 * 24 * 3600 * 1000;
    const rewardedCount = allInvites.filter(i => i.inviterRewarded).length;
    const weekRewarded = allInvites.filter(i => i.inviterRewarded && toNumber(i.rewardedAt) >= weekStart).length;
    const pendingCount = allInvites.filter(i => !i.inviterRewarded).length;

    // 补上邀友人道号（用于展示“我邀友了谁”）
    const inviteeIds = list.map(i => i.inviteeId);
    let nameMap = {};
    if (inviteeIds.length) {
      const userRes = await users.where({ _id: _.in(inviteeIds) }).field({ nickname: true, avatar: true }).get();
      userRes.data.forEach(u => { nameMap[u._id] = { nickname: u.nickname, avatar: u.avatar }; });
    }
    const decorated = list.map(i => Object.assign({}, i, {
      invitee: nameMap[i.inviteeId] || { nickname: '卦中新客', avatar: '🔮' }
    }));

    return {
      ok: true,
      stats: {
        totalInvites: allInvites.length,
        rewardedCount,
        pendingCount,
        weekRewarded,
        dailyCap: INVITE_DAILY_CAP,
        todayRewards: me.inviteRewardDate === new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
          ? (me.inviteRewardToday || 0)
          : 0
      },
      list: decorated
    };
  } catch (e) {
    return { ok: false, err: e.message || '加载邀友数据失败' };
  }
};
