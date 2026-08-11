const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 业务常量单一来源（cloudfunctions/_shared/config.js，npm run sync:common 同步）；
// 邀请奖励支持环境变量覆盖（login/placeBet/inviteStats 共用）
const { INVITE_INVITER_POINTS, INVITE_DAILY_CAP } = require('./common-config');
const INVITER_POINTS = Number(process.env.INVITE_INVITER_POINTS) || INVITE_INVITER_POINTS;
const DAILY_CAP = Number(process.env.INVITE_DAILY_CAP) || INVITE_DAILY_CAP;

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
    // 已有 PK（发起或应战）则不能普通表态，反之亦然。
    // 查询放事务外（官方文档：事务仅支持单记录操作）；核心防重仍靠 betId 唯一文档
    const myPkRes = await db.collection('pks')
      .where({
        marketId,
        participantIds: OPENID,
        status: _.in(['pending', 'accepted'])
      })
      .limit(1)
      .get();
    if (myPkRes.data.length) {
      return { ok: false, err: '您已参与该预言的 PK 挑战，不能重复表态' };
    }

    const result = await db.runTransaction(async t => {
      const marketRef = t.collection('markets').doc(marketId);
      const market = (await marketRef.get()).data;
      if (!market || market.status !== 'open') {
        throw new Error('该预言已截止或正在结算');
      }
      // 截止时间是硬约束：防止结果出炉后、状态切换前的窗口期内信息套利
      if (market.deadline && Number(market.deadline) <= Date.now()) {
        throw new Error('该预言已过截止时间，停止接收表态');
      }
      if (market.needsManualReview) {
        throw new Error('该预言已停止接收表态');
      }

      // bets._id = openid_marketId，天然唯一，避免同一人重复表态
      const betId = `${OPENID}_${marketId}`;
      const betRef = t.collection('bets').doc(betId);
      let existing = null;
      try {
        existing = (await betRef.get()).data;
      } catch (e) { /* 不存在 */ }
      if (existing) throw new Error('您已参与过该预言');

      const userRef = t.collection('users').doc(OPENID);
      const user = (await userRef.get()).data;
      if (!user) throw new Error('用户不存在，请稍后重试');
      if (user.points < amount) throw new Error('能量不足');

      const poolField = choice === 'YES' ? 'yesPool' : 'noPool';
      await marketRef.update({
        data: { [poolField]: _.inc(amount), totalPool: _.inc(amount), updatedAt: db.serverDate() }
      });
      await userRef.update({ data: { points: _.inc(-amount), updatedAt: db.serverDate() } });

      // 邀请裂变：被邀请人完成首次表态，邀请人获得奖励（每日上限防刷）
      let inviteRewardGranted = 0;
      if (user.invitedBy && !user.inviteRewarded) {
        const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
        const inviterRef = t.collection('users').doc(user.invitedBy);
        const inviter = (await inviterRef.get()).data;
        if (inviter) {
          const dailyUsed = inviter.inviteRewardDate === today ? (inviter.inviteRewardToday || 0) : 0;
          // 无论当日奖励额度是否用完，都计入累计有效邀请（邀请荣誉据此解锁）
          const inviterData = { inviteCount: _.inc(1), updatedAt: db.serverDate() };
          if (dailyUsed < DAILY_CAP) {
            Object.assign(inviterData, {
              points: _.inc(INVITER_POINTS),
              totalPoints: _.inc(INVITER_POINTS),
              weekPoints: _.inc(INVITER_POINTS),
              monthPoints: _.inc(INVITER_POINTS),
              inviteRewardDate: today,
              inviteRewardToday: dailyUsed + 1
            });
            await t.collection('invites').doc(`${user.invitedBy}_${OPENID}`).update({
              data: { inviterRewarded: true, rewardedAt: db.serverDate(), updatedAt: db.serverDate() }
            });
            inviteRewardGranted = INVITER_POINTS;
          }
          await inviterRef.update({ data: inviterData });
          await userRef.update({ data: { inviteRewarded: true, updatedAt: db.serverDate() } });
        }
      }

      const myBet = {
        marketId,
        openid: OPENID,
        choice,
        amount,
        marketTitle: market.title,
        marketCategory: market.category,
        marketDeadline: market.deadline,
        status: 'active',
        payout: 0,
        createdAt: db.serverDate()
      };
      await betRef.set({ data: myBet });

      return {
        market: (await marketRef.get()).data,
        user: (await userRef.get()).data,
        myBet: Object.assign({}, myBet, { _id: betId, createdAt: Date.now() }),
        inviteRewardGranted
      };
    });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, err: e.message || '操作失败' };
  }
};
