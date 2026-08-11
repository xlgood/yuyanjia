const cloud = require('wx-server-sdk');

// 业务常量单一来源：cloudfunctions/_shared/config.js（与前端 utils/constants.js 数值一致）
const { AD_TASK_POINTS, AD_TASK_LIMIT } = require('./common-config');
// 严格模式：已接入微信广告「服务端奖励回调」（adRewardCallback）时置 true，
// 领取动作只返回 pending，真正发能量由服务端回调完成，防止改包伪造观看记录
const AD_SSV_ENABLED = String(process.env.AD_SSV_ENABLED || 'false') === 'true';

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function todayKey() {
  const t = Date.now() + 8 * 3600 * 1000;
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
  const count = user.adTaskDate === today ? (user.adTaskCount || 0) : 0;
  if (count >= AD_TASK_LIMIT) return { ok: false, err: '今日次数已用完' };

  // 严格模式（服务端回调到账）：这里不发放，仅返回 pending 由客户端提示
  if (AD_SSV_ENABLED) {
    return { ok: true, pending: true, user, adTask: { count, limit: AD_TASK_LIMIT, granted: AD_TASK_POINTS } };
  }

  // 普通模式：CAS 原子领取，并发重复请求只有一个能命中，防止双领
  const cond = user.adTaskDate === today
    ? { _id: OPENID, adTaskDate: today, adTaskCount: count }
    : { _id: OPENID, adTaskDate: _.neq(today) };
  const claim = await users.where(cond).update({
    data: {
      points: _.inc(AD_TASK_POINTS),
      adTaskDate: today,
      adTaskCount: _.inc(1),
      updatedAt: db.serverDate()
    }
  });
  if (!claim.stats || !claim.stats.updated) {
    return { ok: false, err: '今日次数已用完' };
  }

  user = (await users.doc(OPENID).get()).data;
  return {
    ok: true,
    user,
    adTask: { count: user.adTaskCount, limit: AD_TASK_LIMIT, granted: AD_TASK_POINTS }
  };
};
