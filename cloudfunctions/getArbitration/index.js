const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const marketId = String(event.marketId || '');

  try {
    // 查找该卦题进行中或最近的公断
    const res = await db.collection('arbitrations')
      .where({ marketId })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    const arb = res.data[0];
    if (!arb) return { ok: true, arbitration: null };

    const myVoteRes = await db.collection('arbitration_votes')
      .where({ arbitrationId: arb._id, openid: OPENID })
      .limit(1)
      .get();
    const myVote = myVoteRes.data[0] || null;

    // 参与资格断卦（前端展示用；won/lost/refunded 均算已结卦应卦）
    let eligible = false;
    const settledBets = await db.collection('bets').where({ openid: OPENID, status: _.in(['won', 'lost', 'refunded']) }).count();
    const settledPks = await db.collection('pks').where({ status: 'settled', participantIds: OPENID }).count();
    eligible = settledBets.total >= 5 || settledPks.total >= 3;

    return {
      ok: true,
      arbitration: Object.assign({}, arb, {
        remainingMs: Math.max(0, (arb.endsAt || 0) - Date.now())
      }),
      myVote,
      eligible
    };
  } catch (e) {
    return { ok: false, err: e.message || '加载公断失败' };
  }
};
