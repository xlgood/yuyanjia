const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function todayKey() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// PK 榜最少场次门槛：胜率榜至少 5 场才计入，避免 1 胜 0 负刷榜首
const MIN_GAMES = 5;

// 分页拉取全部已结算 PK，避免 500 条截断导致榜单失真
async function fetchAllSettledPks() {
  const out = [];
  let skip = 0;
  const PAGE = 100;
  while (true) {
    const res = await db.collection('pks')
      .where({ status: 'settled' })
      .skip(skip)
      .limit(PAGE)
      .get();
    out.push(...res.data);
    if (res.data.length < PAGE) break;
    skip += PAGE;
  }
  return out;
}

exports.main = async () => {
  try {
    const allPks = await fetchAllSettledPks();
    const stats = {};
    allPks.forEach(pk => {
      [pk.challengerId, pk.opponentId].forEach(uid => {
        if (!uid) return;
        if (!stats[uid]) stats[uid] = { wins: 0, losses: 0, total: 0 };
        stats[uid].total += 1;
        if (pk.winnerId === uid) stats[uid].wins += 1;
        else stats[uid].losses += 1;
      });
    });

    const users = db.collection('users');
    const ids = Object.keys(stats).filter(id => stats[id].total >= MIN_GAMES);
    const nameMap = {};
    if (ids.length) {
      const userRes = await users.where({ _id: _.in(ids) }).field({ nickname: true, avatar: true }).get();
      userRes.data.forEach(u => { nameMap[u._id] = { nickname: u.nickname, avatar: u.avatar }; });
    }

    const limit = 50;
    let list = ids
      .map(id => ({
        openid: id,
        nickname: (nameMap[id] || {}).nickname || '预言新人',
        avatar: (nameMap[id] || {}).avatar || '🔮',
        wins: stats[id].wins,
        losses: stats[id].losses,
        total: stats[id].total,
        rate: stats[id].wins / stats[id].total,
        winRate: Math.round((stats[id].wins / stats[id].total) * 100)
      }))
      .sort((a, b) => b.rate - a.rate || b.wins - a.wins || a.total - b.total)
      .slice(0, limit);

    // 追赶提示：我的上一名
    const { OPENID } = cloud.getWXContext();
    const meIdx = list.findIndex(x => x.openid === OPENID);
    if (meIdx > 0) {
      const prev = list[meIdx - 1];
      list[meIdx] = Object.assign({}, list[meIdx], {
        gapToNext: Math.round((prev.rate - list[meIdx].rate) * 100)
      });
    } else if (meIdx === -1) {
      // 我不在榜内：找所有已结算 PK 用户中排在我前面最近的一位
      const myStats = stats[OPENID];
      if (myStats && myStats.total >= MIN_GAMES) {
        const myRate = myStats.wins / myStats.total;
        const prev = ids
          .filter(id => (stats[id].wins / stats[id].total) > myRate)
          .map(id => stats[id].wins / stats[id].total)
          .sort((a, b) => a - b)[0];
        if (prev !== undefined) {
          list.push({
            openid: OPENID,
            nickname: (nameMap[OPENID] || {}).nickname || '预言新人',
            avatar: (nameMap[OPENID] || {}).avatar || '🔮',
            wins: myStats.wins,
            losses: myStats.losses,
            total: myStats.total,
            rate: myRate,
            winRate: Math.round(myRate * 100),
            isMe: true,
            gapToNext: Math.round((prev - myRate) * 100)
          });
        }
      }
    }
    if (meIdx >= 0) list[meIdx] = Object.assign({}, list[meIdx], { isMe: true });

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
    list = list.map((item, i) => {
      const rank = i + 1;
      const prev = prevRankMap[item.openid];
      let trend = '';
      if (prev !== undefined) {
        trend = rank < prev ? 'up' : (rank > prev ? 'down' : 'same');
      } else if (Object.keys(prevRankMap).length) {
        trend = 'new';
      }
      return Object.assign({}, item, { rank, trend });
    });

    return { ok: true, list };
  } catch (e) {
    return { ok: false, err: e.message || '加载失败' };
  }
};
