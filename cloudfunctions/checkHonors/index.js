const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 里程碑卦勋：通过用户档案数据断卦
function milestoneChecks(user) {
  return {
    honor_first_bet: (user.betCount || 0) >= 1,
    honor_streak_3: (user.bestStreak || 0) >= 3,
    honor_streak_7: (user.bestStreak || 0) >= 7,
    honor_streak_10: (user.bestStreak || 0) >= 10,
    honor_bet_50: (user.betCount || 0) >= 50,
    honor_bet_200: (user.betCount || 0) >= 200,
    honor_pk_first: (user.pkCount || 0) >= 1,
    honor_pk_10: (user.pkCount || 0) >= 10,
    honor_invite_first: (user.inviteCount || 0) >= 1,
    honor_invite_10: (user.inviteCount || 0) >= 10
  };
}

// 历史排名快照中该用户的最好名次（0 表示从未上榜）
// 只扫描最近 N 份快照，避免快照累积后每次登录都全量遍历（HONOR_SNAPSHOT_LIMIT 可调）
async function bestRankInSnapshots(type, openid) {
  const MAX_SNAPSHOTS = Math.max(Number(process.env.HONOR_SNAPSHOT_LIMIT) || 60, 1);
  let best = 0;
  let skip = 0;
  const PAGE = 100;
  let scanned = 0;
  while (scanned < MAX_SNAPSHOTS) {
    const res = await db.collection('rank_snapshots')
      .where({ type })
      .orderBy('date', 'desc')
      .skip(skip)
      .limit(PAGE)
      .get();
    for (const s of res.data) {
      scanned += 1;
      if (scanned > MAX_SNAPSHOTS) break;
      for (const r of (s.rankings || [])) {
        if (r.openid === openid && (!best || r.rank < best)) best = r.rank;
      }
    }
    if (res.data.length < PAGE) break;
    skip += PAGE;
  }
  return best;
}

// 天榜卦勋：连胜/总榜实时断卦；周/月/对弈 按历史排名快照断卦“曾进入前十”
async function rankChecks(OPENID, user) {
  const FIELD_MAP = { streak: 'streak', total: 'totalPoints' };
  const out = {};
  for (const type of ['streak', 'total']) {
    const field = FIELD_MAP[type];
    const value = user[field] || 0;
    const above = await db.collection('users').where({ [field]: _.gt(value) }).count();
    const rank = above.total + 1;
    out[`rank_${type}_top3`] = rank <= 3;
    out[`rank_${type}_top10`] = rank <= 10;
  }
  for (const type of ['week', 'month', 'pk']) {
    const best = await bestRankInSnapshots(type, OPENID);
    out[`rank_${type}_top3`] = best > 0 && best <= 3;
    out[`rank_${type}_top10`] = best > 0 && best <= 10;
  }
  return out;
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, err: '获取用户身份失败' };

  try {
    const userRef = db.collection('users').doc(OPENID);
    const user = (await userRef.get()).data;

    // 统计字段补齐（老用户可能没有）
    const betCountRes = await db.collection('bets').where({ openid: OPENID }).count();
    const pkCountRes = await db.collection('pks').where({ status: 'settled', participantIds: OPENID }).count();
    const enriched = Object.assign({}, user, {
      betCount: betCountRes.total,
      pkCount: pkCountRes.total,
      inviteCount: user.inviteCount || 0,
      bestStreak: user.bestStreak || 0
    });

    const checks = Object.assign({}, milestoneChecks(enriched), await rankChecks(OPENID, enriched));
    const unlocked = [];
    const existing = user.honors || [];
    Object.keys(checks).forEach(honorId => {
      if (checks[honorId] && existing.indexOf(honorId) < 0) {
        existing.push(honorId);
        unlocked.push(honorId);
      }
    });

    // honorsCheckedAt 供 login 的卦勋检测节流判断（手动「检测」也刷新该时间戳）
    const patch = { honorsCheckedAt: Date.now(), updatedAt: db.serverDate() };
    if (unlocked.length) patch.honors = existing;
    await userRef.update({ data: patch });
    return { ok: true, unlocked, honors: existing };
  } catch (e) {
    return { ok: false, err: e.message || '卦勋断卦失败' };
  }
};
