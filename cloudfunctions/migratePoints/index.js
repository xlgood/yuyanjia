// =========================================================
// 一次性数据迁移：榜单积分改「净收益」口径 + inviteCount 历史回填
//
// 背景：旧版本 weekPoints/monthPoints/totalPoints 按含本金的 payout 累计，
//       inviteCount 从未在云端递增。本函数从 bets / arbitrations / invites
//       重建各用户的榜单分与邀请数（幂等，可重复执行）。
//
// 调用方式：云开发控制台 → 云函数 → migratePoints → 云端测试（需管理员身份或非客户端来源）
// =========================================================
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const INVITER_POINTS = Number(process.env.INVITE_INVITER_POINTS) || 50;
const PAGE = 100;

function toNumber(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return new Date(ts).getTime() || 0;
  if (ts.$date) return ts.$date;
  if (typeof ts.getTime === 'function') return ts.getTime();
  return 0;
}

// 北京时间（UTC+8）本周一 00:00 与本月 1 日 00:00
function periodStart() {
  const bj = new Date(Date.now() + 8 * 3600 * 1000);
  const day = bj.getUTCDay(); // 0 = 周日
  const offsetToMonday = (day + 6) % 7;
  const weekStart = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate() - offsetToMonday) - 8 * 3600 * 1000;
  const monthStart = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), 1) - 8 * 3600 * 1000;
  return { weekStart, monthStart };
}

async function fetchAll(collection, whereObj) {
  const out = [];
  let skip = 0;
  while (true) {
    const res = await db.collection(collection).where(whereObj).skip(skip).limit(PAGE).get();
    out.push(...res.data);
    if (res.data.length < PAGE) break;
    skip += PAGE;
  }
  return out;
}

exports.main = async () => {
  const { OPENID, SOURCE } = cloud.getWXContext();
  const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (SOURCE === 'wx_client' && !ADMIN_OPENIDS.includes(OPENID)) {
    return { ok: false, err: '无权限操作' };
  }

  try {
    const { weekStart, monthStart } = periodStart();
    // openid -> { total, week, month, inviteCount }
    const acc = {};
    const getAcc = id => (acc[id] || (acc[id] = { total: 0, week: 0, month: 0, inviteCount: 0 }));

    // 1) 市场表态净收益：won 的 payout - amount；lost/refunded 不计
    const settledBets = await fetchAll('bets', { status: _.in(['won', 'lost', 'refunded']) });
    for (const bet of settledBets) {
      if (bet.status !== 'won') continue;
      const profit = Math.max((bet.payout || 0) - (bet.amount || 0), 0);
      if (profit <= 0) continue;
      const ts = toNumber(bet.settledAt);
      const a = getAcc(bet.openid);
      a.total += profit;
      if (ts >= weekStart) a.week += profit;
      if (ts >= monthStart) a.month += profit;
    }

    // 2) 仲裁瓜分净收益：胜方按投入比例分到的 share 计入榜单分
    const settledArbs = await fetchAll('arbitrations', { status: 'settled', winner: _.in(['support', 'oppose']) });
    for (const arb of settledArbs) {
      const winnerSide = arb.winner;
      const loserSide = winnerSide === 'support' ? 'oppose' : 'support';
      const loserPool = winnerSide === 'support' ? (arb.opposePool || 0) : (arb.supportPool || 0);
      const votes = await fetchAll('arbitration_votes', { arbitrationId: arb._id });
      const winners = votes.filter(v => v.side === winnerSide);
      const winnerBondTotal = winners.reduce((s, v) => s + (v.bond || 0), 0);
      const ts = toNumber(arb.settledAt);
      for (const v of winners) {
        const share = winnerBondTotal > 0 ? Math.floor(((v.bond || 0) / winnerBondTotal) * loserPool) : 0;
        if (share <= 0) continue;
        const a = getAcc(v.openid);
        a.total += share;
        if (ts >= weekStart) a.week += share;
        if (ts >= monthStart) a.month += share;
      }
    }

    // 3) 邀请奖励：每次有效邀请 +50（计入周/月/总），inviteCount 回填
    const rewardedInvites = await fetchAll('invites', { inviterRewarded: true });
    for (const inv of rewardedInvites) {
      const ts = toNumber(inv.rewardedAt);
      const a = getAcc(inv.inviterId);
      a.inviteCount += 1;
      a.total += INVITER_POINTS;
      if (ts >= weekStart) a.week += INVITER_POINTS;
      if (ts >= monthStart) a.month += INVITER_POINTS;
    }

    // 4) 写回（只更新有数据的用户）
    let updated = 0;
    for (const [openid, v] of Object.entries(acc)) {
      await db.collection('users').doc(openid).update({
        data: {
          weekPoints: v.week,
          monthPoints: v.month,
          totalPoints: v.total,
          inviteCount: v.inviteCount,
          updatedAt: db.serverDate()
        }
      });
      updated += 1;
    }

    return {
      ok: true,
      stats: {
        users: Object.keys(acc).length,
        updated,
        bets: settledBets.length,
        arbitrations: settledArbs.length,
        invites: rewardedInvites.length,
        weekStart,
        monthStart
      }
    };
  } catch (e) {
    return { ok: false, err: e.message || '迁移失败' };
  }
};
