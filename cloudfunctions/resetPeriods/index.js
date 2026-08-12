const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  // 全表清零属高危操作：仅允许定时触发器 / 云间调用 / 管理员
  const { OPENID, SOURCE } = cloud.getWXContext();
  const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (SOURCE === 'wx_client' && !ADMIN_OPENIDS.includes(OPENID)) {
    return { ok: false, err: '无权限操作' };
  }

  const type = event.type || 'all';
  const data = {};

  // 周期卦勋：清零前为本周/本月天榜 top 3 / top 10 发放卦勋
  try {
    if (type === 'week' || type === 'all') {
      await cloud.callFunction({ name: 'rankHonors', data: { type: 'week' } });
    }
    if (type === 'month' || type === 'all') {
      await cloud.callFunction({ name: 'rankHonors', data: { type: 'month' } });
    }
  } catch (e) { /* 卦勋发放失败不影响周期重置 */ }

  if (type === 'week' || type === 'all') data.weekPoints = 0;
  if (type === 'month' || type === 'all') data.monthPoints = 0;
  if (!Object.keys(data).length) return { ok: false, err: '参数不合法' };

  const res = await db.collection('users').where({ _id: _.exists(true) }).update({ data });
  return { ok: true, updated: res.stats.updated };
};
