const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 管理员 openid（部署时在云函数环境变量配置 ADMIN_OPENIDS，逗号分隔；空 = 仅 Mock 可进后台）
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

// 定时候选状态流转：pending → accepted（采用）/ rejected（忽略）
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!ADMIN_OPENIDS.includes(OPENID)) return { ok: false, err: '无权限操作' };

  const id = String((event && event.id) || '');
  const status = event && event.status;
  if (!id || !['accepted', 'rejected'].includes(status)) return { ok: false, err: '参数不合法' };

  try {
    await db.collection('topic_candidates').doc(id).update({
      data: { status, updatedAt: db.serverDate() }
    });
    return { ok: true, id, status };
  } catch (e) {
    return { ok: false, err: e.message || '更新失败' };
  }
};
