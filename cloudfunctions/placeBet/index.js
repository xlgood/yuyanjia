const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 业务常量单一来源（cloudfunctions/_shared/config.js，npm run sync:common 同步）；
// 邀友奖励附议环境变量覆盖（login/placeBet/inviteStats 共用）
const { INVITE_INVITER_POINTS, INVITE_DAILY_CAP, MIN_BET_AMOUNT } = require('./common-config');
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
  if (!Number.isInteger(amount) || amount < MIN_BET_AMOUNT || amount > 100000) {
    return { ok: false, err: `每卦至少注爻 ${MIN_BET_AMOUNT} 爻` };
  }

  try {
    // 已有 对弈（发起或应弈）则不能普通应卦，反之亦然。
    // 查询放事务外（官方文档：事务仅附议单记录操作）；核心防重仍靠 betId 唯一文档
    const myPkRes = await db.collection('pks')
      .where({
        marketId,
        participantIds: OPENID,
        status: _.in(['pending', 'accepted'])
      })
      .limit(1)
      .get();
    if (myPkRes.data.length) {
      return { ok: false, err: '您已参与该卦题的对弈邀弈，不能重复应卦' };
    }

    const result = await db.runTransaction(async t => {
      const marketRef = t.collection('markets').doc(marketId);
      const market = (await marketRef.get()).data;
      if (!market || market.status !== 'open') {
        throw new Error('该卦题已截止或正在结卦');
      }
      // 截止时间是硬约束：防止结果出炉后、状态切换前的窗口期内信息套利
      if (market.deadline && Number(market.deadline) <= Date.now()) {
        throw new Error('该卦题已过截止时间，停止接收应卦');
      }
      if (market.needsManualReview) {
        throw new Error('该卦题已停止接收应卦');
      }

      // bets._id = openid_marketId，天然唯一，避免同一人重复应卦
      const betId = `${OPENID}_${marketId}`;
      const betRef = t.collection('bets').doc(betId);
      let existing = null;
      try {
        existing = (await betRef.get()).data;
      } catch (e) { /* 不存在 */ }
      if (existing) throw new Error('您已参与过该卦题');

      const userRef = t.collection('users').doc(OPENID);
      const user = (await userRef.get()).data;
      if (!user) throw new Error('用户不存在，请稍后重试');
      if (user.points < amount) throw new Error('爻不足');

      const poolField = choice === 'YES' ? 'yesPool' : 'noPool';
      await marketRef.update({
        data: { [poolField]: _.inc(amount), totalPool: _.inc(amount), updatedAt: db.serverDate() }
      });
      await userRef.update({ data: { points: _.inc(-amount), updatedAt: db.serverDate() } });

      // 邀友裂变：被邀友人完成首次应卦，邀友人获得奖励（每日上限防刷）
      let inviteRewardGranted = 0;
      if (user.invitedBy && !user.inviteRewarded) {
        const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
        const inviterRef = t.collection('users').doc(user.invitedBy);
        const inviter = (await inviterRef.get()).data;
        if (inviter) {
          const dailyUsed = inviter.inviteRewardDate === today ? (inviter.inviteRewardToday || 0) : 0;
          // 无论当日奖励额度是否用完，都计入累计有效邀友（邀友卦勋据此解锁）
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
          } else {
            // 当日已达上限：仍记有效邀友（inviteCount 照常 +1，荣誉可解锁），
            // 但标记 rewardSkipped，避免邀友记录永远显示「待发奖」误导统计
            await t.collection('invites').doc(`${user.invitedBy}_${OPENID}`).update({
              data: { rewardSkipped: true, skippedAt: db.serverDate(), updatedAt: db.serverDate() }
            });
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
