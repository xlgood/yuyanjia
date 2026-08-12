const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const page = Math.max(Number((event && event.page) || 1), 1);
  const pageSize = Math.min(Math.max(Number((event && event.pageSize) || 20), 1), 50);

  // 「热门」：按冗余字段 totalPool（YES+NO 之和，应卦/对弈 时原子维护）索引查询。
  // 前置：markets 需建复合索引 status + totalPool（降序），且已跑过 migratePoints 回填 totalPool；
  // 未建索引时云数据库会报错，需在控制台「索引管理」补充。
  if (event.hot) {
    const min = Number(event.minTotal) || 0;
    const PAGE = 100;
    const MAX_FETCH = 2000;
    const all = [];
    let skip = 0;
    while (all.length < MAX_FETCH) {
      const res = await db.collection('markets')
        .where({ status: _.in(['open', 'locked']), totalPool: _.gte(min) })
        .orderBy('totalPool', 'desc')
        .skip(skip)
        .limit(PAGE)
        .get();
      all.push(...res.data);
      if (res.data.length < PAGE) break;
      skip += PAGE;
    }
    // 待人工复核的合约不下发（不影响排序，只做展示过滤）
    const filtered = all.filter(m => !m.needsManualReview);
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return { ok: true, list, total, hasMore: page * pageSize < total, page, pageSize };
  }

  const category = String(event.category || '');
  const cond = { status: _.in(['open', 'locked']) };
  if (category) cond.category = category;

  const countRes = await db.collection('markets').where(cond).count();
  const total = countRes.total;
  const res = await db.collection('markets')
    .where(cond)
    .orderBy('deadline', 'asc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  // 待人工复核（needsManualReview）的合约不再向用户展示，避免截止后继续收注
  const list = res.data.filter(m => !m.needsManualReview);
  return { ok: true, list, total, hasMore: page * pageSize < total, page, pageSize };
};
