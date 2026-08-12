const cloud = require('wx-server-sdk');

// =========================================================
// 榜单查询（物化缓存版）
// 之前每次请求都做 3 次全集合 count + top N 实时拉取，用户量上来后
// 读放大严重。改为：top 榜读「物化缓存」集合 leaderboards/{type}，
// 缓存 TTL 内直接返回（LEADERBOARD_CACHE_MINUTES 可调，默认 10 分钟）；
// 过期后由本次请求方惰性重建（CAS 写入，并发只让一个生效，输家读新缓存）。
// 仅「我的排名/追赶差值」仍需 2 次轻量 count（按唯一主键字段查询，有索引）。
// 注意：排名是 10 分钟内近似值，榜单场景可接受；要绝对实时可缩短 TTL。
// =========================================================
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const FIELD_MAP = {
  streak: 'streak',
  week: 'weekPoints',
  month: 'monthPoints',
  total: 'totalPoints'
};
const TYPES = Object.keys(FIELD_MAP);
// PK 榜最少场次门槛：与 rankSnapshot / pkLeaderboard 保持一致
const PK_MIN_GAMES = 5;
const TOP_SIZE = 200;                       // 缓存最多存 200 名
const CACHE_TTL_MS = (Number(process.env.LEADERBOARD_CACHE_MINUTES) || 10) * 60 * 1000;

function todayKey() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 计算普通榜 top（users 按字段降序取前 TOP_SIZE）
async function computeRegularTop(field) {
  const res = await db.collection('users')
    .field({ nickname: true, avatarUrl: true, [field]: true })
    .orderBy(field, 'desc')
    .limit(TOP_SIZE)
    .get();
  const list = res.data
    .filter(u => (u[field] || 0) > 0)
    .map(u => ({
      openid: u._id,
      nickname: u.nickname || '预言新人',
      avatarUrl: u.avatarUrl || '',
      value: u[field] || 0
    }));
  return { type: null, list, total: list.length, updatedAt: Date.now() };
}

// 计算 PK 榜 top（聚合已结算 PK 胜率，与 rankSnapshot 口径一致）
async function computePkTop() {
  const pkStats = {};
  let skip = 0;
  while (true) {
    const pkRes = await db.collection('pks')
      .where({ status: 'settled' })
      .field({ challengerId: true, opponentId: true, winnerId: true })
      .skip(skip)
      .limit(100)
      .get();
    pkRes.data.forEach(pk => {
      [pk.challengerId, pk.opponentId].forEach(uid => {
        if (!uid) return;
        const s = pkStats[uid] || (pkStats[uid] = { wins: 0, total: 0 });
        s.total += 1;
        if (pk.winnerId === uid) s.wins += 1;
      });
    });
    if (pkRes.data.length < 100) break;
    skip += 100;
  }
  const entries = Object.keys(pkStats)
    .filter(openid => pkStats[openid].total >= PK_MIN_GAMES)
    .map(openid => {
      const s = pkStats[openid];
      const winRate = s.total > 0 ? s.wins / s.total : 0;
      return { openid, wins: s.wins, losses: s.total - s.wins, total: s.total, winRate };
    })
    .filter(e => e.winRate > 0)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, TOP_SIZE);

  // 补充昵称/头像（一次批量取）
  const ids = entries.map(e => e.openid);
  const nameMap = {};
  if (ids.length) {
    const uRes = await db.collection('users')
      .where({ _id: _.in(ids) })
      .field({ nickname: true, avatarUrl: true })
      .get();
    uRes.data.forEach(u => { nameMap[u._id] = { nickname: u.nickname || '预言新人', avatarUrl: u.avatarUrl || '' }; });
  }
  const list = entries.map(e => Object.assign({}, e, nameMap[e.openid] || { nickname: '预言新人', avatarUrl: '' }));
  return { type: 'pk', list, total: list.length, updatedAt: Date.now() };
}

// 读物化缓存；过期则重建并 CAS 写入（并发只有一人落盘，输家直接读最新）
async function loadCached(type, computeFn) {
  const col = db.collection('leaderboards');
  let doc = null;
  try {
    doc = (await col.doc(type).get()).data;
  } catch (e) { /* 首次访问尚无缓存 */ }

  const fresh = !doc || Date.now() - (doc.updatedAt || 0) > CACHE_TTL_MS;
  if (!fresh) return doc;

  const rebuilt = await computeFn();
  if (doc) {
    // 并发 CAS：只让读到旧 updatedAt 的那一个写成功
    const r = await col
      .where({ _id: type, updatedAt: doc.updatedAt || 0 })
      .update({ data: rebuilt });
    if (r.stats && r.stats.updated) return rebuilt;
    try {
      return (await col.doc(type).get()).data; // 已被并发方刷新，读新缓存
    } catch (e) {
      return rebuilt;
    }
  }
  await col.doc(type).set({ data: rebuilt });
  return rebuilt;
}

exports.main = async (event) => {
  event = event || {};
  try {
    return await handle(event);
  } catch (e) {
    // 兜底：任何异常转为可见错误返回，避免云函数崩溃（-504002 / 145 code exit unexpected）
    console.error('[getLeaderboard] 异常', e && e.message || e);
    return { ok: false, err: String((e && e.message) || e).slice(0, 200) };
  }
};

async function handle(event) {
  const { OPENID } = cloud.getWXContext();
  const type = TYPES.includes(event.type) ? event.type : 'streak';
  const field = FIELD_MAP[type];
  const limit = Math.min(Math.max(Number(event.limit) || 50, 10), TOP_SIZE);

  let me = null;
  try {
    me = (await db.collection('users').doc(OPENID).get()).data;
  } catch (e) {
    return { ok: false, err: '请先登录' };
  }

  const isPk = type === 'pk';
  const cached = await loadCached(type, isPk ? computePkTop : () => computeRegularTop(field));

  // 我的排名 / 追赶差值：轻量 count（有索引）
  const myValue = isPk ? 0 : (me[field] || 0);
  let myRank = 1;
  let gapToNext = 0;
  if (!isPk) {
    const rankRes = await db.collection('users').where({ [field]: _.gt(myValue) }).count();
    myRank = rankRes.total + 1;
    try {
      const prevRes = await db.collection('users')
        .where({ [field]: _.gt(myValue) })
        .orderBy(field, 'asc')
        .limit(1)
        .get();
      if (prevRes.data.length) {
        gapToNext = (prevRes.data[0][field] || 0) - myValue;
      }
    } catch (e) { /* 按 0 处理 */ }
  } else {
    // PK 榜：我的排名 = 胜率高于我的用户数 + 1（复用同一份物化数据即可）
    const myPk = (cached.list || []).find(i => i.openid === OPENID);
    if (myPk) myRank = cached.list.indexOf(myPk) + 1;
    else {
      const idx = (cached.list || []).findIndex(i => i.winRate > ((me.pkWins / Math.max(me.pkWins + me.pkLosses, 1)) || 0));
      myRank = idx < 0 ? (cached.list || []).length + 1 : idx + 1;
    }
  }

  const list = (cached.list || []).slice(0, limit).map((item, i) => {
    const base = {
      openid: item.openid,
      rank: i + 1,
      nickname: item.nickname,
      avatarUrl: item.avatarUrl || '',
      isMe: item.openid === OPENID
    };
    return isPk
      ? Object.assign({}, base, {
          winRate: Math.round(item.winRate * 100) / 100,
          wins: item.wins,
          losses: item.losses,
          total: item.total,
          value: item.winRate,
          gapToNext: 0
        })
      : Object.assign({}, base, { value: item.value, gapToNext: item.openid === OPENID ? gapToNext : 0 });
  });

  // 我不在榜内时，把「我」追加到末尾（保证前端能看到自己的名次/追赶提示）
  if (!list.some(x => x.isMe)) {
    list.push(isPk
      ? {
          openid: OPENID,
          rank: myRank,
          nickname: me.nickname,
          avatarUrl: me.avatarUrl || '',
          winRate: (me.pkWins / Math.max(me.pkWins + me.pkLosses, 1)) || 0,
          wins: me.pkWins || 0,
          losses: me.pkLosses || 0,
          total: (me.pkWins || 0) + (me.pkLosses || 0),
          value: (me.pkWins / Math.max(me.pkWins + me.pkLosses, 1)) || 0,
          gapToNext: 0,
          isMe: true
        }
      : {
          openid: OPENID,
          rank: myRank,
          nickname: me.nickname,
          avatarUrl: me.avatarUrl || '',
          value: myValue,
          gapToNext,
          isMe: true
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
  const withTrend = list.map(item => {
    const prev = prevRankMap[item.openid];
    let trend = '';
    if (prev !== undefined) {
      trend = item.rank < prev ? 'up' : (item.rank > prev ? 'down' : 'same');
    } else if (Object.keys(prevRankMap).length) {
      trend = 'new';
    }
    return Object.assign({}, item, { trend });
  });

  return { ok: true, list: withTrend, myRank, limit, totalCount: cached.total || withTrend.length };
};
