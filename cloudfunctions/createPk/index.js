const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 业务常量单一来源（cloudfunctions/_shared/config.js，npm run sync:common 同步）
const { MIN_BET_AMOUNT } = require('./common-config');

const 对弈_EXPIRE_MS = 24 * 3600 * 1000; // 24 小时未应弈自动失效

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const marketId = String(event.marketId || '');
  const choice = event.choice;
  const amount = Number(event.amount);

  if (!marketId || (choice !== 'YES' && choice !== 'NO')) {
    return { ok: false, err: '参数不合法' };
  }
  if (!Number.isInteger(amount) || amount < MIN_BET_AMOUNT || amount > 100000) {
    return { ok: false, err: `邀弈至少注爻 ${MIN_BET_AMOUNT} 爻` };
  }

  try {
    const result = await db.runTransaction(async t => {
      const marketRef = t.collection('markets').doc(marketId);
      const market = (await marketRef.get()).data;
      if (!market || market.status !== 'open') {
        throw new Error('该卦题已截止或正在结卦');
      }
      if (market.deadline && Number(market.deadline) <= Date.now()) {
        throw new Error('该卦题已过截止时间，停止接收应卦');
      }
      if (market.needsManualReview) {
        throw new Error('该卦题已停止接收应卦');
      }

      const userRef = t.collection('users').doc(OPENID);
      const user = (await userRef.get()).data;
      if (!user) throw new Error('用户不存在，请稍后重试');
      if (user.points < amount) throw new Error('爻不足');

      // 同一卦题同一用户只能有一条应卦/对弈
      const betId = `${OPENID}_${marketId}`;
      let existingBet = null;
      try {
        existingBet = (await t.collection('bets').doc(betId).get()).data;
      } catch (e) { /* 不存在 */ }
      if (existingBet) throw new Error('您已参与过该卦题，不能重复发起 对弈');

      // 同一用户对同一卦题最多一个待应弈 对弈
      const pendingRes = await t.collection('pks')
        .where({ marketId, challengerId: OPENID, status: 'pending' })
        .limit(1)
        .get();
      if (pendingRes.data.length) throw new Error('您对该卦题已有未完成的 对弈 邀弈');

      const pkId = '对弈' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
      const nowTs = Date.now();
      const pk = {
        _id: pkId,
        marketId,
        marketTitle: market.title,
        challengerId: OPENID,
        challenger: {
          openid: OPENID,
          nickname: user.nickname || '卦中新客',
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
        expiresAt: nowTs + 对弈_EXPIRE_MS,
        updatedAt: db.serverDate()
      };
      await t.collection('pks').doc(pkId).set({ data: pk });

      await userRef.update({ data: { points: _.inc(-amount), updatedAt: db.serverDate() } });
      await t.collection('markets').doc(marketId).update({
        data: {
          [choice === 'YES' ? 'yesPool' : 'noPool']: _.inc(amount),
          totalPool: _.inc(amount),
          updatedAt: db.serverDate()
        }
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
        pk: Object.assign({}, pk, { _id: pkId, createdAt: nowTs, expiresAt: nowTs + 对弈_EXPIRE_MS }),
        user: (await userRef.get()).data
      };
    });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, err: e.message || '发起失败' };
  }
};
