const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const marketId = String(event.marketId || '');
  if (!marketId) return { ok: false, err: '缺少卦题 ID' };

  let market = null;
  try {
    market = (await db.collection('markets').doc(marketId).get()).data;
  } catch (e) {
    return { ok: false, err: '卦题不存在' };
  }

  let myBet = null;
  try {
    myBet = (await db.collection('bets').doc(`${OPENID}_${marketId}`).get()).data;
  } catch (e) { /* 未应卦 */ }

  // 参与人数 = 该事件下应卦记录数（按 marketId 统计）
  let participantCount = 0;
  try {
    participantCount = (await db.collection('bets').where({ marketId }).count()).total;
  } catch (e) { /* 集合不存在等异常时按 0 处理 */ }

  // 进行中的公断：详情页需要据此切换“发起公断 / 查看进展”
  let activeArbitration = null;
  try {
    const arbRes = await db.collection('arbitrations')
      .where({ marketId, status: 'pending' })
      .limit(1)
      .get();
    activeArbitration = arbRes.data[0] || null;
  } catch (e) { /* 集合不存在等异常时按无公断处理 */ }

  return { ok: true, market, myBet, participantCount, activeArbitration };
};
