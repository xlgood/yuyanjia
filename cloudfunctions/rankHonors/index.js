const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 周期天榜卦勋：周榜 / 月榜切换前，为当前 top 3 / top 10 发放卦勋
exports.main = async (event) => {
  // 发榜卦勋属高危操作：仅允许定时触发器 / 云间调用 / 管理员
  const { OPENID, SOURCE } = cloud.getWXContext();
  const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (SOURCE === 'wx_client' && !ADMIN_OPENIDS.includes(OPENID)) {
    return { ok: false, err: '无权限操作' };
  }

  const type = event && event.type;
  if (type !== 'week' && type !== 'month') return { ok: false, err: '参数不合法' };

  const field = type === 'week' ? 'weekPoints' : 'monthPoints';
  const top = await db.collection('users').orderBy(field, 'desc').limit(10).get();
  const top3 = top.data.slice(0, 3);
  const top10 = top.data.slice(3, 10);
  const honorTop3 = `rank_${type}_top3`;
  const honorTop10 = `rank_${type}_top10`;

  const granted = [];
  for (const u of top3) {
    const honors = u.honors || [];
    if (honors.indexOf(honorTop3) < 0) {
      honors.push(honorTop3);
      await db.collection('users').doc(u._id).update({ data: { honors, updatedAt: db.serverDate() } });
      granted.push({ openid: u._id, honor: honorTop3 });
    }
  }
  for (const u of top10) {
    const honors = u.honors || [];
    if (honors.indexOf(honorTop10) < 0) {
      honors.push(honorTop10);
      await db.collection('users').doc(u._id).update({ data: { honors, updatedAt: db.serverDate() } });
      granted.push({ openid: u._id, honor: honorTop10 });
    }
  }
  return { ok: true, granted };
};
