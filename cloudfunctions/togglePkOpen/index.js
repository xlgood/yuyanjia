const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, err: '获取用户身份失败' };
  const open = !!event.open;

  try {
    await db.collection('users').doc(OPENID).update({
      data: { pkOpen: open, updatedAt: db.serverDate() }
    });
    const user = (await db.collection('users').doc(OPENID).get()).data;
    return { ok: true, user };
  } catch (e) {
    return { ok: false, err: e.message || '设置失败' };
  }
};
