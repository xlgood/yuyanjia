const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const page = Math.max(Number((event && event.page) || 1), 1);
  const pageSize = Math.min(Math.max(Number((event && event.pageSize) || 20), 1), 50);

  // 「热门」：全部进行中事件按总池（YES+NO）筛选并降序排列
  if (event.hot) {
    const min = Number(event.minTotal) || 0;
    // 云数据库无法按“两字段之和”排序，全部拉取后再筛选排序，
    // 避免先截断 100 条导致高总池合约被漏掉（上限 2000 防止异常数据拖垮）
    const all = [];
    let skip = 0;
    const PAGE = 100;
    const MAX_FETCH = 2000;
    while (all.length < MAX_FETCH) {
      const res = await db.collection('markets')
        .where({ status: _.in(['open', 'locked']) })
        .skip(skip)
        .limit(PAGE)
        .get();
      all.push(...res.data);
      if (res.data.length < PAGE) break;
      skip += PAGE;
    }
    const filtered = all
      .filter(m => !m.needsManualReview && (m.yesPool || 0) + (m.noPool || 0) >= min)
      .sort((a, b) => ((b.yesPool || 0) + (b.noPool || 0)) - ((a.yesPool || 0) + (a.noPool || 0)));
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
