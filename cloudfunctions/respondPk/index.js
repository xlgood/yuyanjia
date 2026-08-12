const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const pkId = String(event.pkId || '');
  const accept = !!event.accept;

  if (!pkId) return { ok: false, err: '参数不合法' };

  try {
    const result = await db.runTransaction(async t => {
      const pkRef = t.collection('pks').doc(pkId);
      let pk;
      try {
        pk = (await pkRef.get()).data;
      } catch (e) {
        throw new Error('挑战不存在');
      }
      if (pk.status !== 'pending') throw new Error('该挑战已处理');
      if (Date.now() > (pk.expiresAt || 0)) throw new Error('挑战已过期');

      const marketRef = t.collection('markets').doc(pk.marketId);
      const market = (await marketRef.get()).data;
      if (!market || market.status !== 'open') throw new Error('该预言已截止');
      if (market.deadline && Number(market.deadline) <= Date.now()) throw new Error('该预言已过截止时间');

      const userRef = t.collection('users').doc(OPENID);
      const user = (await userRef.get()).data;
      if (!user) throw new Error('用户不存在');

      if (!accept) {
        // 拒绝：退回挑战者爻
        await pkRef.update({ data: { status: 'declined', updatedAt: db.serverDate() } });
        await t.collection('users').doc(pk.challengerId).update({
          data: { points: _.inc(pk.challenger.amount), updatedAt: db.serverDate() }
        });
        await t.collection('bets').doc(pk.challengerBetId).remove();
        await t.collection('markets').doc(pk.marketId).update({
          data: {
            [pk.challenger.choice === 'YES' ? 'yesPool' : 'noPool']: _.inc(-pk.challenger.amount),
            totalPool: _.inc(-pk.challenger.amount),
            updatedAt: db.serverDate()
          }
        });
        return { ok: true, status: 'declined' };
      }

      if (pk.challengerId === OPENID) throw new Error('不能应战自己发起的挑战');

      // 接受：锁定反向立场
      const oppChoice = pk.challenger.choice === 'YES' ? 'NO' : 'YES';
      const amount = pk.challenger.amount;
      if (user.points < amount) throw new Error('爻不足，无法应战');

      const betId = `${OPENID}_${pk.marketId}`;
      let existing = null;
      try {
        existing = (await t.collection('bets').doc(betId).get()).data;
      } catch (e) { /* 不存在 */ }
      if (existing) throw new Error('您已参与过该预言，不能应战');

      await userRef.update({ data: { points: _.inc(-amount), updatedAt: db.serverDate() } });
      await marketRef.update({
        data: {
          [oppChoice === 'YES' ? 'yesPool' : 'noPool']: _.inc(amount),
          totalPool: _.inc(amount),
          updatedAt: db.serverDate()
        }
      });
      await t.collection('bets').doc(betId).set({
        data: {
          marketId: pk.marketId,
          openid: OPENID,
          choice: oppChoice,
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

      await pkRef.update({
        data: {
          status: 'accepted',
          opponentId: OPENID,
          participantIds: [pk.challengerId, OPENID],
          opponent: {
            openid: OPENID,
            nickname: user.nickname || '预言新人',
            avatar: user.avatar || '🔮',
            choice: oppChoice,
            amount
          },
          opponentBetId: betId,
          acceptedAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      });

      return { ok: true, status: 'accepted', pkId };
    });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, err: e.message || '操作失败' };
  }
};
