const cloud = require('wx-server-sdk');

// 昭示期时长（小时，默认 2；可通过 DISPUTE_WINDOW_HOURS 调整）
const DISPUTE_WINDOW_MS = (Number(process.env.DISPUTE_WINDOW_HOURS) || 2) * 3600 * 1000;
// 订阅消息模板（部署时在云函数环境变量配置；留空 = 不推送）
const SUBSCRIBE_JUDGE_TMPL = process.env.SUBSCRIBE_JUDGE_TMPL || '';
// 管理员 openid（部署时在云函数环境变量配置 ADMIN_OPENIDS，逗号分隔；空 = 仅 Mock 可进后台）
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 昭示结束时间：窗口时长 + 跨夜顺延（若结束落在北京时间 00:00~10:00，顺延到当天 10:00）
function computeDisputeEndsAt(nowTs) {
  let end = nowTs + DISPUTE_WINDOW_MS;
  const bj = new Date(end + 8 * 3600 * 1000);
  if (bj.getUTCHours() < 10) {
    end = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate(), 10) - 8 * 3600 * 1000;
  }
  return end;
}

// 结果更正通知（带 Outbox：写 notification_outbox + 发送，失败由 settleMarket 定时器重试）
async function sendCorrectionNotify(openid, marketTitle) {
  if (!SUBSCRIBE_JUDGE_TMPL || !openid) return;
  const data = {
    thing1: { value: String(marketTitle || '').slice(0, 20) },
    thing2: { value: '判定结果已更正，请查看最新结果'.slice(0, 20) },
    thing3: { value: '请进入小程序查看详情'.slice(0, 20) }
  };
  let outboxId = '';
  try {
    const r = await db.collection('notification_outbox').add({
      data: {
        openid,
        channel: 'wechat',
        template: 'judge',
        payload: { templateId: SUBSCRIBE_JUDGE_TMPL, page: 'pages/index/index', data },
        status: 'pending',
        retryCount: 0,
        nextRetryAt: 0,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });
    outboxId = r._id;
  } catch (e) {
    console.error('写入通知 Outbox 失败', openid, e.message || e);
  }
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: SUBSCRIBE_JUDGE_TMPL,
      page: 'pages/index/index',
      data
    });
    if (outboxId) {
      await db.collection('notification_outbox').doc(outboxId).update({
        data: { status: 'sent', sentAt: Date.now(), updatedAt: db.serverDate() }
      });
    }
  } catch (e) {
    console.error('发送更正订阅消息失败', openid, e.message || e);
    if (outboxId) {
      await db.collection('notification_outbox').doc(outboxId).update({
        data: {
          status: 'failed',
          lastError: String(e.message || e).slice(0, 200),
          retryCount: _.inc(1),
          nextRetryAt: Date.now() + 5 * 60 * 1000,
          updatedAt: db.serverDate()
        }
      });
    }
  }
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
  // 判定结果变更 = 已有判定后被覆盖 → 结果更正（需版本 +1 并通知已表态用户）
  const isCorrection = market.status === 'dispute_window' && !!market.result;
  const oldResult = market.result;

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
      // 人工录入/复核改判统一记为 manual，避免看板把人工复核算作 auto_api 成功
      resolutionMethod: 'manual',
      // 结果版本 +1（更正审计与通知依据）
      resultVersion: (market.resultVersion || 0) + 1,
      resolvedAt: nowTs,
      disputeEndsAt: computeDisputeEndsAt(nowTs),
      updatedAt: db.serverDate()
    }
  });

  // 结果更正：通知该市场所有已表态用户（带 Outbox 重试）
  if (isCorrection && result !== oldResult) {
    try {
      const notified = [];
      let skip = 0;
      const PAGE = 100;
      while (true) {
        const res = await db.collection('bets')
          .where({ marketId })
          .skip(skip)
          .limit(PAGE)
          .get();
        for (const b of res.data) {
          if (b.openid) {
            notified.push(b.openid);
            await sendCorrectionNotify(b.openid, market.title);
          }
        }
        if (res.data.length < PAGE) break;
        skip += PAGE;
      }
      console.log('[resolveMarket] 结果更正通知完成', marketId, notified.length, '人');
    } catch (e) {
      console.error('[resolveMarket] 更正通知失败', marketId, e.message || e);
    }
  }

  return { ok: true, isCorrection, oldResult, result, resultVersion: (market.resultVersion || 0) + 1 };
};
