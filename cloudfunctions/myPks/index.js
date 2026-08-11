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

const CLEANUP_BATCH = 20;

// 单条过期 PK 清理（事务）：并发清理只有一个能成功，防止双倍退款。
// 挑战方注单若已随市场结算（won/lost/refunded），只标记失效、不退款不删注不动池。
async function expireOnePk(pk) {
  try {
    await db.runTransaction(async t => {
      const pkRef = t.collection('pks').doc(pk._id);
      const cur = (await pkRef.get()).data;
      if (!cur || cur.status !== 'pending') return;

      const betRef = t.collection('bets').doc(pk.challengerBetId);
      let bet = null;
      try {
        bet = (await betRef.get()).data;
      } catch (e) { bet = null; }
      const refund = bet && bet.status === 'active';
      if (refund) {
        await t.collection('users').doc(pk.challengerId).update({
          data: { points: _.inc(pk.challenger.amount), updatedAt: db.serverDate() }
        });
        await betRef.remove();
        const poolField = pk.challenger.choice === 'YES' ? 'yesPool' : 'noPool';
        await t.collection('markets').doc(pk.marketId).update({
          data: { [poolField]: _.inc(-pk.challenger.amount), updatedAt: db.serverDate() }
        });
      }
      await pkRef.update({
        data: { status: 'expired', expiredAt: Date.now(), updatedAt: db.serverDate() }
      });
    });
  } catch (e) {
    console.error('清理过期 PK 失败', pk._id, e.message || e);
  }
}

async function sweepExpiredPks(limit) {
  const expired = await db.collection('pks')
    .where({ status: 'pending', expiresAt: _.lt(Date.now()) })
    .limit(limit || CLEANUP_BATCH)
    .get();
  for (const pk of expired.data) {
    await expireOnePk(pk);
  }
  return expired.data.length;
}

exports.main = async (event) => {
  const { OPENID, SOURCE } = cloud.getWXContext();

  // 定时触发器兜底：用户不开 PK 页也会定期清理过期挑战（每 10 分钟）
  if (SOURCE === 'wx_timer') {
    await sweepExpiredPks(100);
    return { ok: true, swept: true };
  }

  if (!OPENID) return { ok: false, err: '获取用户身份失败' };
  const page = Math.max(Number((event && event.page) || 1), 1);
  const pageSize = Math.min(Math.max(Number((event && event.pageSize) || 20), 1), 50);

  try {
    const pks = db.collection('pks');
    // 惰性清理：过期的待应战挑战自动失效并退回挑战者能量
    await sweepExpiredPks(CLEANUP_BATCH);

    const inboxRes = await pks
      .where({ opponentId: '', status: 'pending' })
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    const inbox = inboxRes.data.filter(pk => pk.challengerId !== OPENID);

    const mineRes = await pks
      .where(_.or([
        { challengerId: OPENID },
        { opponentId: OPENID }
      ]))
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();
    const mineCount = await pks
      .where(_.or([
        { challengerId: OPENID },
        { opponentId: OPENID }
      ]))
      .count();

    // 补充对手昵称/头像（老数据 opponent 可能缺失）
    const users = db.collection('users');
    const ids = new Set();
    [...inbox, ...mineRes.data].forEach(pk => {
      ids.add(pk.challengerId);
      if (pk.opponentId) ids.add(pk.opponentId);
    });
    const nameMap = {};
    if (ids.size) {
      const userRes = await users.where({ _id: _.in([...ids]) }).field({ nickname: true, avatar: true }).get();
      userRes.data.forEach(u => { nameMap[u._id] = { nickname: u.nickname, avatar: u.avatar }; });
    }

    const decorate = pk => Object.assign({}, pk, {
      challenger: pk.challenger || {
        openid: pk.challengerId,
        nickname: (nameMap[pk.challengerId] || {}).nickname || '预言新人',
        avatar: (nameMap[pk.challengerId] || {}).avatar || '🔮'
      },
      opponent: pk.opponent || (pk.opponentId ? {
        openid: pk.opponentId,
        nickname: (nameMap[pk.opponentId] || {}).nickname || '预言新人',
        avatar: (nameMap[pk.opponentId] || {}).avatar || '🔮'
      } : null),
      expiresIn: Math.max(0, (pk.expiresAt || 0) - Date.now())
    });

    return {
      ok: true,
      inbox: inbox.map(decorate),
      list: mineRes.data.map(decorate),
      total: mineCount.total,
      page,
      pageSize,
      hasMore: page * pageSize < mineCount.total
    };
  } catch (e) {
    return { ok: false, err: e.message || '加载失败' };
  }
};
