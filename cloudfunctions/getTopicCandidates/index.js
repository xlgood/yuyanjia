const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 管理员 openid（部署时在云函数环境变量配置 ADMIN_OPENIDS，逗号分隔；空 = 仅 Mock 可进后台）
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!ADMIN_OPENIDS.includes(OPENID)) return { ok: false, err: '无权限操作' };

  const limit = Math.min(Math.max(Number((event && event.limit) || 5), 1), 30);

  try {
    // 最近 N 天的定时候选（按日期倒序）
    const res = await db.collection('topic_candidates')
      .where({ source: 'auto' })
      .orderBy('date', 'desc')
      .limit(limit)
      .get();
    return { ok: true, list: res.data };
  } catch (e) {
    // 集合不存在等异常时返回空列表（首次部署尚未生成过）
    return { ok: true, list: [], err: e.message || '' };
  }
};
