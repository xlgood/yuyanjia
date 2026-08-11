const cloud = require('wx-server-sdk');

// 管理员 openid（部署时在云函数环境变量配置 ADMIN_OPENIDS，逗号分隔；空 = 仅 Mock 可进后台）
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!ADMIN_OPENIDS.includes(OPENID)) return { ok: false, err: '无权限操作' };

  const res = await db.collection('data_sources').limit(200).get();
  const priority = { frozen: 0, pending: 1, trial: 2, verified: 3 };
  const list = res.data.sort((a, b) => (priority[b.status] || 0) - (priority[a.status] || 0));
  return { ok: true, list };
};
