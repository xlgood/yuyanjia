const cloud = require('wx-server-sdk');

// 与前端 utils/constants.js 保持一致
const CHECKIN_BASE_POINTS = 50;
const CHECKIN_STREAK_BONUS = 10;
const CHECKIN_STREAK_CAP = 7;

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function todayKey(offsetDays) {
  const t = Date.now() + 8 * 3600 * 1000 + (offsetDays || 0) * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const users = db.collection('users');
  let user;
  try {
    user = (await users.doc(OPENID).get()).data;
  } catch (e) {
    return { ok: false, err: '用户不存在' };
  }

  const today = todayKey();
  const yesterday = todayKey(-1);
  if (user.lastCheckInDate === today) return { ok: false, err: '今日已签到' };

  const streak = user.lastCheckInDate === yesterday ? (user.checkInStreak || 0) + 1 : 1;
  const bonus = Math.min(Math.max(streak - 1, 0), CHECKIN_STREAK_CAP - 1) * CHECKIN_STREAK_BONUS;
  const granted = CHECKIN_BASE_POINTS + bonus;

  // 原子抢占「今日签到名额」：并发重复请求只有一个能命中，防止双领
  const claim = await users
    .where({ _id: OPENID, lastCheckInDate: _.neq(today) })
    .update({
      data: {
        points: _.inc(granted),
        lastCheckInDate: today,
        checkInStreak: streak,
        checkInTotal: _.inc(1),
        updatedAt: db.serverDate()
      }
    });
  if (!claim.stats || !claim.stats.updated) {
    return { ok: false, err: '今日已签到' };
  }

  user = (await users.doc(OPENID).get()).data;
  return {
    ok: true,
    user,
    checkIn: { streak, total: user.checkInTotal, granted, checked: true }
  };
};
