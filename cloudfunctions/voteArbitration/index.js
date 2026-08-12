const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 业务常量单一来源：cloudfunctions/_shared/config.js
const { VOTE_BOND_MIN, ACTIVE_ARBITRATION_LIMIT: ACTIVE_LIMIT } = require('./common-config');

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const arbitrationId = String(event.arbitrationId || '');
  const side = event.side;
  const bond = Math.floor(Number(event.bond) || 0);

  if (!arbitrationId || (side !== 'support' && side !== 'oppose')) return { ok: false, err: '参数不合法' };
  if (bond < VOTE_BOND_MIN) return { ok: false, err: `附议保证金至少 ${VOTE_BOND_MIN} 爻` };

  try {
    // 资格/同时参与检查放事务外（官方文档：事务仅附议单记录操作）
    const settledBets = (await db.collection('bets').where({ openid: OPENID, status: _.in(['won', 'lost', 'refunded']) }).count()).total;
    const settledPks = (await db.collection('pks').where({ status: 'settled', participantIds: OPENID }).count()).total;
    const myVoteRes = await db.collection('arbitration_votes').where({ openid: OPENID }).get();
    const myArbIds = [...new Set(myVoteRes.data.map(v => v.arbitrationId))].filter(id => id && id !== arbitrationId);
    let activeCount = 0;
    if (myArbIds.length) {
      const activeRes = await db.collection('arbitrations')
        .where({ status: 'pending', _id: _.in(myArbIds) })
        .count();
      activeCount = activeRes.total;
    }

    const result = await db.runTransaction(async t => {
      const arbRef = t.collection('arbitrations').doc(arbitrationId);
      let arb;
      try {
        arb = (await arbRef.get()).data;
      } catch (e) {
        throw new Error('公断不存在');
      }
      if (arb.status !== 'pending') throw new Error('公断已结束');
      if (Date.now() > (arb.endsAt || 0)) throw new Error('公断昭示期已结束');

      const userRef = t.collection('users').doc(OPENID);
      const user = (await userRef.get()).data;
      if (!user) throw new Error('用户不存在');

      // 资格：已结卦应卦 ≥ 5 或已结卦 对弈 ≥ 3（won/lost/refunded 均算已结卦）
      if (settledBets < 5 && settledPks < 3) {
        throw new Error('公断参与资格：需已结卦应卦 ≥ 5 次或已结卦 对弈 ≥ 3 场');
      }

      // 一人一票
      const voteId = `${arbitrationId}_${OPENID}`;
      let existing;
      try {
        existing = (await t.collection('arbitration_votes').doc(voteId).get()).data;
      } catch (e) { /* 未附议 */ }
      if (existing) throw new Error('您已投过票');

      // 同时参与上限（已在事务外统计）
      if (activeCount >= ACTIVE_LIMIT) throw new Error('您同时只能参与 1 个公断');

      if (user.points < bond) throw new Error('爻不足');

      await t.collection('arbitration_votes').doc(voteId).set({
        data: {
          arbitrationId,
          marketId: arb.marketId,
          openid: OPENID,
          side,
          bond,
          isChallenger: false,
          createdAt: db.serverDate()
        }
      });
      await userRef.update({ data: { points: _.inc(-bond), updatedAt: db.serverDate() } });

      const poolField = side === 'support' ? 'supportPool' : 'opposePool';
      const countField = side === 'support' ? 'supportVotes' : 'opposeVotes';
      await arbRef.update({
        data: {
          [poolField]: _.inc(bond),
          [countField]: _.inc(1),
          updatedAt: db.serverDate()
        }
      });
      return { ok: true };
    });
    return result;
  } catch (e) {
    return { ok: false, err: e.message || '附议失败' };
  }
};
