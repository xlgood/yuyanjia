const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const page = Math.max(Number((event && event.page) || 1), 1);
  const pageSize = Math.min(Math.max(Number((event && event.pageSize) || 20), 1), 50);

  const countRes = await db.collection('bets').where({ openid: OPENID }).count();
  const total = countRes.total;
  const res = await db.collection('bets')
    .where({ openid: OPENID })
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();
  return {
    ok: true,
    list: res.data,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total
  };
};
