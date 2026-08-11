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

function todayKey() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const field = FIELD_MAP[event.type] || 'streak';
  const type = FIELD_MAP[event.type] ? event.type : 'streak';
  const limit = Math.min(Math.max(Number(event.limit) || 50, 10), 200);

  let me = null;
  try {
    me = (await db.collection('users').doc(OPENID).get()).data;
  } catch (e) {
    return { ok: false, err: '请先登录' };
  }

  const myValue = me[field] || 0;
  const rankRes = await db.collection('users').where({ [field]: _.gt(myValue) }).count();
  const myRank = rankRes.total + 1;

  const top = await db.collection('users').orderBy(field, 'desc').limit(limit).get();
  const list = top.data.map((u, i) => ({
    openid: u._id,
    rank: i + 1,
    nickname: u.nickname,
    avatarUrl: u.avatarUrl || '',
    value: u[field] || 0,
    isMe: u._id === OPENID
  }));

  // 追赶提示：直接取紧邻我上一名的值（即使我不在前 N 名内也准确）
  let gapToNext = 0;
  try {
    const prevRes = await db.collection('users')
      .where({ [field]: _.gt(myValue) })
      .orderBy(field, 'asc')
      .limit(1)
      .get();
    if (prevRes.data.length) {
      gapToNext = (prevRes.data[0][field] || 0) - myValue;
    }
  } catch (e) { /* 查询失败按 0 处理 */ }
  const withGap = list.map(item => item.isMe ? Object.assign({}, item, { gapToNext }) : item);

  if (!withGap.some(x => x.isMe)) {
    withGap.push({
      rank: myRank,
      nickname: me.nickname,
      avatarUrl: me.avatarUrl || '',
      value: myValue,
      isMe: true,
      gapToNext
    });
  }

  // 排名变化：与最近一份历史快照对比（排除今天）
  const prevSnap = await db.collection('rank_snapshots')
    .where({ type, date: _.lt(todayKey()) })
    .orderBy('date', 'desc')
    .limit(1)
    .get();
  const prevRankMap = {};
  if (prevSnap.data.length) {
    prevSnap.data[0].rankings.forEach(r => { prevRankMap[r.openid] = r.rank; });
  }
  const withTrend = withGap.map(item => {
    const prev = prevRankMap[item.openid];
    let trend = '';
    if (prev !== undefined) {
      trend = item.rank < prev ? 'up' : (item.rank > prev ? 'down' : 'same');
    } else if (Object.keys(prevRankMap).length) {
      trend = 'new';
    }
    return Object.assign({}, item, { trend });
  });

  const totalCount = await db.collection('users').count();
  return { ok: true, list: withTrend, myRank, limit, totalCount: totalCount.total };
};
