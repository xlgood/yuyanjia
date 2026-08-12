const cloud = require('wx-server-sdk');

// 昭示期时长（小时，默认 2；可通过 DISPUTE_WINDOW_HOURS 调整）
const DISPUTE_WINDOW_MS = (Number(process.env.DISPUTE_WINDOW_HOURS) || 2) * 3600 * 1000;
// 管理员 openid（部署时在云函数环境变量配置 ADMIN_OPENIDS，逗号分隔；空 = 仅 Mock 可进后台）
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 昭示结束时间：窗口时长 + 跨夜顺延（若结束落在北京时间 00:00~10:00，顺延到当天 10:00）
function computeDisputeEndsAt(nowTs) {
  let end = nowTs + DISPUTE_WINDOW_MS;
  const bj = new Date(end + 8 * 3600 * 1000);
  if (bj.getUTCHours() < 10) {
    end = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate(), 10) - 8 * 3600 * 1000;
  }
  return end;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!ADMIN_OPENIDS.includes(OPENID)) return { ok: false, err: '无权限操作' };

  const marketId = String(event.marketId || '');
  const result = event.result;
  if (!marketId || (result !== 'YES' && result !== 'NO')) return { ok: false, err: '参数不合法' };

  let market;
  try {
    market = (await db.collection('markets').doc(marketId).get()).data;
  } catch (e) {
    return { ok: false, err: '卦题不存在' };
  }
  // 允许在 open/locked（等待断卦）时录入首次断卦，也允许在昭示期内由管理员复核覆盖断卦
  if (market.status !== 'open' && market.status !== 'locked' && market.status !== 'dispute_window') {
    return { ok: false, err: '该卦题已结卦' };
  }

  const nowTs = Date.now();
  // 证据为选填；若提供则必须是合法 http/https 链接（仅收官方证据 URL，不传图）
  let evidenceUrl = event.evidenceUrl !== undefined ? String(event.evidenceUrl || '') : (market.evidenceUrl || '');
  if (evidenceUrl && !/^https?:\/\/\S+$/i.test(evidenceUrl)) {
    return { ok: false, err: '证据请填官方链接（http/https）' };
  }
  evidenceUrl = evidenceUrl.slice(0, 500);
  await db.collection('markets').doc(marketId).update({
    data: {
      status: 'dispute_window',
      result,
      // 未传 evidenceUrl 时保留原有证据链接（覆盖断卦时避免清空存证）
      evidenceUrl,
      hasDispute: false,
      // 人工录入后清除「待人工复核」标记，否则会重复出现在复核队列
      needsManualReview: false,
      resolutionMethod: market.resolutionMethod || 'manual',
      resolvedAt: nowTs,
      disputeEndsAt: computeDisputeEndsAt(nowTs),
      updatedAt: db.serverDate()
    }
  });
  return { ok: true };
};
