const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PK_EXPIRE_MS = 24 * 3600 * 1000; // 24 小时未应战自动失效

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const marketId = String(event.marketId || '');
  const choice = event.choice;
  const amount = Number(event.amount);

  if (!marketId || (choice !== 'YES' && choice !== 'NO')) {
    return { ok: false, err: '参数不合法' };
  }
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1000000) {
    return { ok: false, err: '能量值不合法' };
  }

  try {
    const result = await db.runTransaction(async t => {
      const marketRef = t.collection('markets').doc(marketId);
      const market = (await marketRef.get()).data;
      if (!market || market.status !== 'open') {
        throw new Error('该预言已截止或正在结算');
      }
      if (market.deadline && Number(market.deadline) <= Date.now()) {
        throw new Error('该预言已过截止时间，停止接收表态');
      }
      if (market.needsManualReview) {
        throw new Error('该预言已停止接收表态');
      }

      const userRef = t.collection('users').doc(OPENID);
      const user = (await userRef.get()).data;
      if (!user) throw new Error('用户不存在，请稍后重试');
      if (user.points < amount) throw new Error('能量不足');

      // 同一事件同一用户只能有一条表态/PK
      const betId = `${OPENID}_${marketId}`;
      let existingBet = null;
      try {
        existingBet = (await t.collection('bets').doc(betId).get()).data;
      } catch (e) { /* 不存在 */ }
      if (existingBet) throw new Error('您已参与过该预言，不能重复发起 PK');

      // 同一用户对同一事件最多一个待应战 PK
      const pendingRes = await t.collection('pks')
        .where({ marketId, challengerId: OPENID, status: 'pending' })
        .limit(1)
        .get();
      if (pendingRes.data.length) throw new Error('您对该预言已有未完成的 PK 挑战');

      const pkId = 'PK' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
      const nowTs = Date.now();
      const pk = {
        _id: pkId,
        marketId,
        marketTitle: market.title,
        challengerId: OPENID,
        challenger: {
          openid: OPENID,
          nickname: user.nickname || '预言新人',
          avatar: user.avatar || '🔮',
          choice,
          amount
        },
        opponentId: '',
        opponent: null,
        participantIds: [OPENID],
        status: 'pending',
        winnerId: '',
        challengerBetId: betId,
        opponentBetId: '',
        createdAt: nowTs,
        expiresAt: nowTs + PK_EXPIRE_MS,
        updatedAt: db.serverDate()
      };
      await t.collection('pks').doc(pkId).set({ data: pk });

      await userRef.update({ data: { points: _.inc(-amount), updatedAt: db.serverDate() } });
      await t.collection('markets').doc(marketId).update({
        data: { [choice === 'YES' ? 'yesPool' : 'noPool']: _.inc(amount), updatedAt: db.serverDate() }
      });
      await t.collection('bets').doc(betId).set({
        data: {
          marketId,
          openid: OPENID,
          choice,
          amount,
          marketTitle: market.title,
          marketCategory: market.category,
          marketDeadline: market.deadline,
          status: 'active',
          payout: 0,
          pkId,
          createdAt: db.serverDate()
        }
      });

      return {
        pk: Object.assign({}, pk, { _id: pkId, createdAt: nowTs, expiresAt: nowTs + PK_EXPIRE_MS }),
        user: (await userRef.get()).data
      };
    });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, err: e.message || '发起失败' };
  }
};
