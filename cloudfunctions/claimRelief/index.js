const cloud = require('wx-server-sdk');

// 业务常量单一来源：cloudfunctions/_shared/config.js
const { RELIEF_POINTS, RELIEF_COOLDOWN_MS: COOLDOWN_MS } = require('./common-config');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const users = db.collection('users');
  const ref = users.doc(OPENID);

  const nowTs = Date.now();
  // 原子抢占：爻 ≤ 0 且距上次领取超过冷却才发放，并发只能命中一次
  const claim = await users
    .where({
      _id: OPENID,
      points: _.lte(0),
      lastReliefAt: _.lte(nowTs - COOLDOWN_MS)
    })
    .update({
      data: { points: _.inc(RELIEF_POINTS), lastReliefAt: nowTs, updatedAt: db.serverDate() }
    });
  if (claim.stats && claim.stats.updated) {
    const user = (await ref.get()).data;
    return { ok: true, user };
  }

  // 未命中：区分「爻充足」还是「冷却中」，给出准确提示
  let user;
  try {
    user = (await ref.get()).data;
  } catch (e) {
    return { ok: false, err: '用户不存在' };
  }
  if (user.points > 0) return { ok: false, err: '爻充足，无需补助' };
  const left = COOLDOWN_MS - (nowTs - (user.lastReliefAt || 0));
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  return { ok: false, err: h > 0 ? `${h}小时${m}分后可再次领取` : `${m}分钟后可再次领取` };
};
