const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const FIELD_MAP = {
  streak: 'streak',
  week: 'weekPoints',
  month: 'monthPoints',
  total: 'totalPoints'
};
const TYPES = ['streak', 'week', 'month', 'total', 'pk'];
// PK 榜最少场次门槛：与 pkLeaderboard 保持一致
const MIN_GAMES = 5;

function todayKey() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

async function fetchAll(collection, fields) {
  const out = [];
  let skip = 0;
  const PAGE = 100;
  while (true) {
    const res = await collection.where({ _id: _.exists(true) }).field(fields).skip(skip).limit(PAGE).get();
    out.push(...res.data);
    if (res.data.length < PAGE) break;
    skip += PAGE;
  }
  return out;
}

exports.main = async (event) => {
  // 榜单快照属高危操作：仅允许定时触发器 / 云间调用 / 管理员
  const { OPENID, SOURCE } = cloud.getWXContext();
  const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (SOURCE === 'wx_client' && !ADMIN_OPENIDS.includes(OPENID)) {
    return { ok: false, err: '无权限操作' };
  }

  const date = todayKey();
  const type = String((event && event.type) || 'all');
  const targets = type === 'all' ? TYPES : (TYPES.includes(type) ? [type] : []);
  if (!targets.length) return { ok: false, err: '参数不合法' };

  try {
    const users = await fetchAll(db.collection('users'), { nickname: true, avatarUrl: true, avatar: true, streak: true, weekPoints: true, monthPoints: true, totalPoints: true });
    const snapshots = db.collection('rank_snapshots');
    const done = [];

    for (const t of targets) {
      let entries;
      if (t === 'pk') {
        // PK 榜：先聚合已结算 PK 的胜负，再按胜率排名
        const pkStats = {};
        let pkSkip = 0;
        while (true) {
          const pkRes = await db.collection('pks').where({ status: 'settled' }).skip(pkSkip).limit(100).get();
          pkRes.data.forEach(pk => {
            [pk.challengerId, pk.opponentId].forEach(uid => {
              if (!uid) return;
              if (!pkStats[uid]) pkStats[uid] = { wins: 0, total: 0 };
              pkStats[uid].total += 1;
              if (pk.winnerId === uid) pkStats[uid].wins += 1;
            });
          });
          if (pkRes.data.length < 100) break;
          pkSkip += 100;
        }
        entries = Object.keys(pkStats).filter(openid => pkStats[openid].total >= MIN_GAMES)
          .map(openid => {
            const u = users.find(x => x._id === openid) || {};
            const s = pkStats[openid];
            return {
              openid,
              value: s.total > 0 ? s.wins / s.total : 0,
              nickname: u.nickname || '预言新人'
            };
          })
          .filter(x => x.value > 0);
      } else {
        const field = FIELD_MAP[t];
        entries = users
          .map(u => ({ openid: u._id, value: u[field] || 0, nickname: u.nickname || '' }))
          .filter(x => x.value > 0);
      }

      entries.sort((a, b) => b.value - a.value);
      const rankings = entries.map((e, i) => ({ openid: e.openid, rank: i + 1, value: e.value, nickname: e.nickname }));
      await snapshots.doc(`${t}_${date}`).set({
        data: {
          type: t,
          date,
          rankings,
          total: rankings.length,
          createdAt: db.serverDate()
        }
      });
      done.push(t);
    }
    return { ok: true, date, types: done };
  } catch (e) {
    return { ok: false, err: e.message || '快照生成失败' };
  }
};
