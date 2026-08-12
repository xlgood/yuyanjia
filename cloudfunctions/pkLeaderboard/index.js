const cloud = require('wx-server-sdk');

// =========================================================
// 对弈 胜率榜（物化缓存版）
// 与 getLeaderboard 共享 leaderboards/pk 物化文档：胜率聚合成本高
// （每次要全量扫已结卦 对弈），由 getLeaderboard 在缓存过期时惰性重建，
// 本函数只读缓存并补充“我的排名/追赶/趋势”，单次调用零聚合开销。
// 响应契约与旧版一致（winRate 为整数百分比、含 rate/avatarUrl）。
// =========================================================
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const CACHE_TTL_MS = (Number(process.env.LEADERBOARD_CACHE_MINUTES) || 10) * 60 * 1000;
const LIMIT = 50;

function todayKey() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 读 leaderboards/pk 缓存；过期则由 getLeaderboard 侧重建（本函数只读，
// 若读到过期数据也先返回，保证一次请求不触发两次全量聚合）
async function loadPkCache() {
  try {
    const doc = (await db.collection('leaderboards').doc('pk').get()).data;
    if (doc && doc.list) return doc;
  } catch (e) { /* 尚无缓存 */ }
  // 缓存缺失：退化为全量聚合一次（首访冷启动）
  const stats = {};
  let skip = 0;
  while (true) {
    const res = await db.collection('pks')
      .where({ status: 'settled' })
      .field({ challengerId: true, opponentId: true, winnerId: true })
      .skip(skip)
      .limit(100)
      .get();
    res.data.forEach(pk => {
      [pk.challengerId, pk.opponentId].forEach(uid => {
        if (!uid) return;
        const s = stats[uid] || (stats[uid] = { wins: 0, total: 0 });
        s.total += 1;
        if (pk.winnerId === uid) s.wins += 1;
      });
    });
    if (res.data.length < 100) break;
    skip += 100;
  }
  const ids = Object.keys(stats).filter(id => stats[id].total >= 5 && stats[id].wins > 0);
  const nameMap = {};
  if (ids.length) {
    const uRes = await db.collection('users').where({ _id: _.in(ids) }).field({ nickname: true, avatarUrl: true }).get();
    uRes.data.forEach(u => { nameMap[u._id] = { nickname: u.nickname || '卦中新客', avatarUrl: u.avatarUrl || '' }; });
  }
  const list = ids
    .map(id => ({
      openid: id,
      nickname: (nameMap[id] || {}).nickname || '卦中新客',
      avatarUrl: (nameMap[id] || {}).avatarUrl || '',
      wins: stats[id].wins,
      losses: stats[id].total - stats[id].wins,
      total: stats[id].total,
      winRate: stats[id].wins / stats[id].total
    }))
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 200);
  return { list, total: list.length, updatedAt: Date.now() };
}

exports.main = async () => {
  try {
    const { OPENID } = cloud.getWXContext();
    const cached = await loadPkCache();
    const cachedList = cached.list || [];

    let list = cachedList.slice(0, LIMIT).map((item, i) => ({
      openid: item.openid,
      nickname: item.nickname,
      avatarUrl: item.avatarUrl || '',
      wins: item.wins,
      losses: item.losses,
      total: item.total,
      rate: item.winRate,
      winRate: Math.round(item.winRate * 100),
      rank: i + 1,
      isMe: item.openid === OPENID
    }));

    // 我的追赶/入榜（基于物化数据，10 分钟内近似；比旧版省两次全量查询）
    const meIdx = list.findIndex(x => x.openid === OPENID);
    if (meIdx > 0) {
      const prev = list[meIdx - 1];
      list[meIdx] = Object.assign({}, list[meIdx], { gapToNext: Math.round((prev.rate - list[meIdx].rate) * 100) });
    } else if (meIdx === -1) {
      const myEntry = cachedList.find(i => i.openid === OPENID);
      if (myEntry) {
        const myRate = myEntry.winRate;
        const prevRate = cachedList
          .filter(i => i.winRate > myRate)
          .sort((a, b) => b.winRate - a.winRate)
          .slice(-1)[0];
        list.push({
          openid: OPENID,
          nickname: myEntry.nickname,
          avatarUrl: myEntry.avatarUrl || '',
          wins: myEntry.wins,
          losses: myEntry.losses,
          total: myEntry.total,
          rate: myRate,
          winRate: Math.round(myRate * 100),
          rank: cachedList.findIndex(i => i.openid === OPENID) + 1,
          isMe: true,
          gapToNext: prevRate ? Math.round((prevRate.winRate - myRate) * 100) : 0
        });
      }
    }

    // 排名变化：与最近一份历史快照对比
    const prevSnap = await db.collection('rank_snapshots')
      .where({ type: 'pk', date: _.lt(todayKey()) })
      .orderBy('date', 'desc')
      .limit(1)
      .get();
    const prevRankMap = {};
    if (prevSnap.data.length) {
      prevSnap.data[0].rankings.forEach(r => { prevRankMap[r.openid] = r.rank; });
    }
    list = list.map(item => {
      const prev = prevRankMap[item.openid];
      let trend = '';
      if (prev !== undefined) {
        trend = item.rank < prev ? 'up' : (item.rank > prev ? 'down' : 'same');
      } else if (Object.keys(prevRankMap).length) {
        trend = 'new';
      }
      return Object.assign({}, item, { trend });
    });

    return { ok: true, list };
  } catch (e) {
    return { ok: false, err: e.message || '加载失败' };
  }
};
