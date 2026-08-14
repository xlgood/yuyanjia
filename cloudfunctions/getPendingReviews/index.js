const cloud = require('wx-server-sdk');

// 管理员 openid（部署时在云函数环境变量配置 ADMIN_OPENIDS，逗号分隔；空 = 仅 Mock 可进后台）
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 到期提醒窗口：截止前 2 小时即进入“即将到期”提醒
const SOON_MS = 2 * 3600 * 1000;

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!ADMIN_OPENIDS.includes(OPENID)) return { ok: false, err: '无权限操作' };

  const nowTs = Date.now();
  // 1) 人工断卦到期：manual 类型且已过截止（或即将截止），等待运营验证
  const manualRes = await db.collection('markets')
    .where({
      status: _.in(['open', 'locked']),
      needsManualReview: _.neq(true),
      deadline: _.lte(nowTs + SOON_MS)
    })
    .limit(50)
    .get();
  const manualList = manualRes.data.filter(m =>
    m.resolutionSpec && m.resolutionSpec.dataSource && m.resolutionSpec.dataSource.type === 'manual'
  );

  // 2) 自动断卦失败转人工
  const failRes = await db.collection('markets')
    .where({ needsManualReview: true })
    .limit(50)
    .get();
  const failList = failRes.data;

  // 3) 昭示期（已断卦待结卦/可复核）
  const disputeRes = await db.collection('markets')
    .where(_.or([
      { status: 'dispute_window' }
    ]))
    .limit(50)
    .get();
  const disputeList = disputeRes.data;

  const list = [
    ...manualList.map(m => Object.assign({}, m, { reviewType: 'manual_deadline' })),
    ...failList.map(m => Object.assign({}, m, { reviewType: 'manual_fail' })),
    ...disputeList.map(m => Object.assign({}, m, { reviewType: 'dispute' }))
  ].map(m => {
    // 待判定项按「预期结果时刻（有则优先，否则原始截止）」算剩余；
    // 昭示期项按 disputeEndsAt 算剩余，
    // 且不参与「紧急」提醒（昭示期到期由 settleMarket 定时自动结卦，无需人工抢处理）
    const anchorTs = m.reviewType === 'dispute'
      ? (m.disputeEndsAt || m.deadline || 0)
      : (m.expectedResultAt || m.deadline || 0);
    const remainingMs = anchorTs - nowTs;
    const urgency = m.reviewType === 'dispute'
      ? 'normal'
      : (remainingMs < 0 ? 'urgent' : (remainingMs <= SOON_MS ? 'soon' : 'normal'));
    return Object.assign({}, m, { remainingMs, urgency, anchorTs, expectedResultAt: m.expectedResultAt || 0 });
  });
  // 紧急度优先：urgent > soon > normal，同级按实际锚点时间（截止/昭示结束）升序
  const order = { urgent: 0, soon: 1, normal: 2 };
  list.sort((a, b) => (order[a.urgency] - order[b.urgency]) || ((a.anchorTs || 0) - (b.anchorTs || 0)));
  return { ok: true, list };
};
