// =========================================================
// 锁定市场（定时触发，每分钟）
// 截止时间一到，把 status=open 的市场切为 locked：
//   - 用户端立即显示「已停止应卦，等待官方断卦」
//   - resolver 只扫描 locked 市场做断卦
// 附带能力：
//   - 锁定/超时转人工时向企业微信或飞书机器人推送（LOCK_WEBHOOK_URL）
//   - 断卦超时兜底：锁定超过 LOCK_STALE_HOURS（默认 24h）仍未断卦 → needsManualReview
// 环境变量：
//   LOCK_WEBHOOK_URL   企业微信/飞书机器人 webhook（留空不推送）
//   LOCK_WEBHOOK_TYPE  wecom（默认）| feishu
//   LOCK_STALE_HOURS   锁定超时阈值（默认 24）
// =========================================================
const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const LOCK_STALE_MS = (Number(process.env.LOCK_STALE_HOURS) || 24) * 3600 * 1000;
const WEBHOOK_URL = process.env.LOCK_WEBHOOK_URL || '';
const WEBHOOK_TYPE = String(process.env.LOCK_WEBHOOK_TYPE || 'wecom').toLowerCase();
const PAGE = 100;

function postWebhook(content) {
  if (!WEBHOOK_URL) return Promise.resolve(false);
  let payload;
  if (WEBHOOK_TYPE === 'feishu') {
    payload = { msg_type: 'text', content: { text: content } };
  } else {
    payload = { msgtype: 'text', text: { content } };
  }
  return new Promise(resolve => {
    try {
      const body = JSON.stringify(payload);
      const url = new URL(WEBHOOK_URL);
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 5000
      }, res => {
        res.resume();
        res.on('end', () => resolve(true));
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.write(body);
      req.end();
    } catch (e) {
      resolve(false);
    }
  });
}

// 截止时间已到：open → locked
async function lockDueMarkets() {
  const nowTs = Date.now();
  const res = await db.collection('markets')
    .where({ status: 'open', deadline: _.lte(nowTs) })
    .limit(PAGE)
    .get();
  const locked = [];
  for (const m of res.data) {
    await db.collection('markets').doc(m._id).update({
      data: { status: 'locked', lockedAt: nowTs, updatedAt: db.serverDate() }
    });
    locked.push(m);
  }
  return locked;
}

// 断卦超时兜底：锁定超过阈值仍未断卦 → 转人工复核队列并提示
async function flagStaleLocked() {
  const nowTs = Date.now();
  const res = await db.collection('markets')
    .where({
      status: 'locked',
      needsManualReview: _.neq(true),
      lockedAt: _.lte(nowTs - LOCK_STALE_MS)
    })
    .limit(PAGE)
    .get();
  const flagged = [];
  for (const m of res.data) {
    await db.collection('markets').doc(m._id).update({
      data: { needsManualReview: true, updatedAt: db.serverDate() }
    });
    flagged.push(m);
  }
  return flagged;
}

exports.main = async () => {
  try {
    const locked = await lockDueMarkets();
    const flagged = await flagStaleLocked();
    if (WEBHOOK_URL && (locked.length || flagged.length)) {
      const parts = [];
      if (locked.length) {
        parts.push(`【预测卦局】${locked.length} 个卦题已锁定，需断卦：\n${locked.map(m => `- ${m.title}`).join('\n')}`);
      }
      if (flagged.length) {
        parts.push(`【断卦超时已转人工】${flagged.length} 个卦题锁定超过阈值：\n${flagged.map(m => `- ${m.title}`).join('\n')}`);
      }
      await postWebhook(parts.join('\n\n'));
    }
    // 时效优化：锁定后立即触发一次自动断卦扫描（云间调用），
    // 把「结果出现 → 判定」从最长 ~15 分钟（10 分钟周期 + 5 分钟 grace）压缩到 ~1 分钟；
    // resolver 每 10 分钟的定时触发器保留作兜底（失败重试/补充扫描）
    let triggered = 0;
    if (locked.length) {
      try {
        const hr = await cloud.callFunction({ name: 'resolver', data: {} });
        triggered = (hr.result && hr.result.summary && hr.result.summary.scanned) || 0;
      } catch (e) {
        console.error('锁定后立即触发断卦失败', e && e.message || e);
      }
    }
    return { ok: true, locked: locked.length, flagged: flagged.length, resolverTriggered: triggered };
  } catch (e) {
    return { ok: false, err: e.message || '锁定失败' };
  }
};
