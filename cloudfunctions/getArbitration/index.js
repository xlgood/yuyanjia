const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function toNumber(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return new Date(ts).getTime() || 0;
  if (ts.$date) return ts.$date;
  if (typeof ts.getTime === 'function') return ts.getTime();
  return 0;
}

// 组装返回体（公断 + 我的投票 + 参与资格）
async function buildResult(arb, OPENID) {
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
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const marketId = String((event && event.marketId) || '');

  try {
    if (marketId) {
      // 指定卦题：最近一次公断
      const res = await db.collection('arbitrations')
        .where({ marketId })
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      const arb = res.data[0];
      if (!arb) return { ok: true, arbitration: null, myVote: null, eligible: false };
      return buildResult(arb, OPENID);
    }

    // 无卦题（「公断阁」入口）：加载我最近参与的公断（发起或附议过）
    const mineByChallenger = await db.collection('arbitrations')
      .where({ 'challenger.openid': OPENID })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    let arb = mineByChallenger.data[0] || null;
    if (!arb) {
      // 附议过的公断：按 createdAt 取最近一条（内存取最大，避免依赖复合索引）
      const myVoteRes = await db.collection('arbitration_votes')
        .where({ openid: OPENID })
        .limit(100)
        .get();
      if (myVoteRes.data.length) {
        const latest = myVoteRes.data.reduce((a, b) =>
          (toNumber(b.createdAt) > toNumber(a.createdAt) ? b : a), myVoteRes.data[0]);
        try {
          arb = (await db.collection('arbitrations').doc(latest.arbitrationId).get()).data;
        } catch (e) { /* 公断可能已删除 */ }
      }
    }
    if (!arb) return { ok: true, arbitration: null, myVote: null, eligible: false };
    return buildResult(arb, OPENID);
  } catch (e) {
    return { ok: false, err: e.message || '加载公断失败' };
  }
};
