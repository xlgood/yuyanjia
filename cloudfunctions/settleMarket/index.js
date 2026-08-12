const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');

// 管理员 openid（部署时在云函数环境变量配置 ADMIN_OPENIDS，逗号分隔；空 = 仅 Mock 可进后台）
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 订阅消息模板（部署时在云函数环境变量配置；留空 = 不推送）
const SUBSCRIBE_JUDGE_TMPL = process.env.SUBSCRIBE_JUDGE_TMPL || '';

// 结卦锁超过该时长视为上次运行崩溃残留，允许下个定时周期接管重试
const SETTLING_STALE_MS = 10 * 60 * 1000;

// 运营告警：复用 lockMarkets 的 LOCK_WEBHOOK_URL / LOCK_WEBHOOK_TYPE，
// 零新增配置；未配置时静默跳过
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || process.env.LOCK_WEBHOOK_URL || '';
const ALERT_WEBHOOK_TYPE = String(process.env.LOCK_WEBHOOK_TYPE || 'wecom').toLowerCase();

function postWebhook(content) {
  if (!ALERT_WEBHOOK_URL) return Promise.resolve(false);
  let payload;
  if (ALERT_WEBHOOK_TYPE === 'feishu') {
    payload = { msg_type: 'text', content: { text: content } };
  } else {
    payload = { msgtype: 'text', text: { content } };
  }
  return new Promise(resolve => {
    try {
      const body = JSON.stringify(payload);
      const url = new URL(ALERT_WEBHOOK_URL);
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

async function sendJudgeNotify(openid, marketTitle, resultText, payoutText) {
  if (!SUBSCRIBE_JUDGE_TMPL || !openid) return;
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: SUBSCRIBE_JUDGE_TMPL,
      page: 'pages/index/index',
      data: {
        thing1: { value: String(marketTitle || '').slice(0, 20) },
        thing2: { value: String(resultText || '').slice(0, 20) },
        thing3: { value: String(payoutText || '').slice(0, 20) }
      }
    });
  } catch (e) {
    console.error('发送断卦订阅消息失败', openid, e.message);
  }
}

// 市场级结卦锁：cron 与手动结卦并发时只有一个能拿到锁，
// 防止同一市场被两边同时结卦造成重复派奖；崩溃残留超过阈值后可接管
async function claimSettlingLock(marketId) {
  const nowTs = Date.now();
  const markets = db.collection('markets');

  let res = await markets
    .where({ _id: marketId, status: 'dispute_window', settling: _.neq(true) })
    .update({ data: { settling: true, settlingAt: nowTs, updatedAt: db.serverDate() } });
  if (res.stats && res.stats.updated) return true;

  // 已被占用：若超过 STALE 阈值（上次运行崩溃残留）则接管
  let market = null;
  try {
    market = (await markets.doc(marketId).get()).data;
  } catch (e) { /* 市场可能已删除 */ }
  if (!market || market.status !== 'dispute_window' || !market.settling) return false;
  if (nowTs - (market.settlingAt || 0) <= SETTLING_STALE_MS) return false;

  res = await markets
    .where({
      _id: marketId,
      status: 'dispute_window',
      settling: true,
      settlingAt: _.lte(nowTs - SETTLING_STALE_MS)
    })
    .update({ data: { settlingAt: nowTs, updatedAt: db.serverDate() } });
  return !!(res.stats && res.stats.updated);
}

// 单注结卦：标记注单与发放爻放在同一事务内，任一失败整体回滚；
// 并发结卦时后到的事务读不到 active 状态而跳过，保证每注恰好结卦一次。
// 注：事务冲突时 wx-server-sdk 会自动重试（默认 3 次）。
async function settleOneBet(market, bet, refundAll, totalPool, winningPool) {
  const won = bet.choice === market.result;
  const status = refundAll ? 'refunded' : (won ? 'won' : 'lost');
  let payout = 0;
  if (status === 'won') {
    // 卦池公式：R = 投入 / 胜方池 × 卦池，向下取整
    payout = Math.floor((bet.amount / winningPool) * totalPool);
  } else if (status === 'refunded') {
    payout = bet.amount;
  }
  // 天榜口径：只累计净收益（不含本金返还），避免“总流水刷榜”
  const profit = won && !refundAll ? Math.max(payout - bet.amount, 0) : 0;

  return db.runTransaction(async t => {
    const betRef = t.collection('bets').doc(bet._id);
    let cur = null;
    try {
      cur = (await betRef.get()).data;
    } catch (e) { /* 注单不存在 */ }
    if (!cur || cur.status !== 'active') return { skipped: true };

    const userRef = t.collection('users').doc(bet.openid);
    let user = null;
    try {
      user = (await userRef.get()).data;
    } catch (e) { /* 用户可能已注销 */ }
    if (user) {
      const newStreak = won && !refundAll ? (user.streak || 0) + 1 : 0;
      const bestStreak = Math.max(user.bestStreak || 0, newStreak);
      await userRef.update({
        data: {
          points: _.inc(payout),
          streak: newStreak,
          bestStreak,
          weekPoints: _.inc(profit),
          monthPoints: _.inc(profit),
          totalPoints: _.inc(profit),
          updatedAt: db.serverDate()
        }
      });
    }
    await betRef.update({ data: { status, payout, settledAt: Date.now() } });
    return { skipped: false, status, payout, won: won && !refundAll, openid: bet.openid };
  });
}

async function settleOne(marketId) {
  const market = (await db.collection('markets').doc(marketId).get()).data;
  if (!market || market.status !== 'dispute_window') {
    return { settled: false, reason: 'not_in_window' };
  }

  const totalPool = (market.yesPool || 0) + (market.noPool || 0);
  const winningPool = market.result === 'YES' ? market.yesPool || 0 : market.noPool || 0;
  // 池异常（如无人胜出）：全部原路退回，保证爻守恒
  const refundAll = totalPool <= 0 || winningPool <= 0;

  // 有进行中的公断：不允许结卦（等公断昭示期结束）
  const activeArb = await db.collection('arbitrations')
    .where({ marketId, status: 'pending' })
    .limit(1)
    .get();
  if (activeArb.data.length) {
    return { settled: false, reason: 'arbitration_pending' };
  }

  // 市场级锁：抢不到说明另一个结卦修行正在处理（或尚未到接管阈值）
  const locked = await claimSettlingLock(marketId);
  if (!locked) return { settled: false, reason: 'settling_in_progress' };

  const PAGE = 100;
  let processed = 0;
  const settledPks = {};
  const notifies = [];

  // 注意：循环体内会把 bet.status 从 active 改为 won/lost/refunded，
  // 结果集实时缩小，因此每轮必须从头取（skip 固定为 0），
  // 否则翻页漂移会导致部分注单永远漏结卦。
  // rounds 兜底防止单条更新失败时死循环。
  let rounds = 0;
  const MAX_ROUNDS = 500;
  while (rounds++ < MAX_ROUNDS) {
    const res = await db.collection('bets')
      .where({ marketId, status: 'active' })
      .skip(0)
      .limit(PAGE)
      .get();
    const bets = res.data;
    if (!bets.length) break;

    for (const bet of bets) {
      // 单注结卦失败（如事务重试耗尽）直接中断整个市场结卦，
      // 市场保持 dispute_window + settling 标记，10 分钟后由下个周期接管重试
      let r;
      try {
        r = await settleOneBet(market, bet, refundAll, totalPool, winningPool);
      } catch (e) {
        console.error('单注结卦失败，等待下轮重试', marketId, bet._id, e.message || e);
        await postWebhook(`【问卦局·结卦异常】市场 ${marketId}（${market.title}）单注结卦失败：${String(e.message || e).slice(0, 200)}，10 分钟后自动重试`);
        return { settled: false, reason: 'bet_settle_failed', marketId };
      }
      if (r.skipped) continue;
      processed += 1;

      // 对弈 胜负记录：同一 对弈 的两条 bet 都结卦后更新一次
      if (bet.pkId) {
        const entry = settledPks[bet.pkId] || (settledPks[bet.pkId] = { wonOpenids: [], allOpenids: [] });
        entry.allOpenids.push(bet.openid);
        if (r.won) entry.wonOpenids.push(bet.openid);
      }
      notifies.push({
        openid: bet.openid,
        title: market.title,
        won: r.won,
        refundAll,
        status: r.status,
        payout: r.payout
      });
    }

    if (bets.length < PAGE) break;
  }

  // 订阅消息在事务提交后再发送，避免外部调用混入事务
  for (const n of notifies) {
    await sendJudgeNotify(
      n.openid,
      n.title,
      n.won ? '应验' : (n.refundAll ? '数据异常，已退回' : '未应验'),
      n.status === 'won' ? `获得 ${n.payout} 爻` : ''
    );
  }

  // 结卦 对弈：断卦胜负、更新双方 对弈 统计
  for (const pkId of Object.keys(settledPks)) {
    const entry = settledPks[pkId];
    let pk;
    try {
      pk = (await db.collection('pks').doc(pkId).get()).data;
    } catch (e) { continue; }
    if (!pk || pk.status === 'settled') continue;

    // 未应弈（pending）的 对弈：邀弈方注单已按普通应卦结卦完毕，
    // 直接作废，避免“邀弈了不存在的人”污染 对弈 胜率榜，也防止后续清理双倍退款
    if (pk.status !== 'accepted') {
      await db.collection('pks').doc(pkId).update({
        data: { status: 'expired', expiredAt: Date.now(), updatedAt: db.serverDate() }
      });
      continue;
    }

    const winnerId = entry.wonOpenids.length === 1 ? entry.wonOpenids[0] : '';
    await db.collection('pks').doc(pkId).update({
      data: {
        status: 'settled',
        winnerId,
        settledAt: Date.now(),
        updatedAt: db.serverDate()
      }
    });
    for (const uid of entry.allOpenids) {
      const win = !!winnerId && winnerId === uid;
      await db.collection('users').doc(uid).update({
        data: {
          [win ? 'pkWins' : 'pkLosses']: _.inc(1),
          updatedAt: db.serverDate()
        }
      });
    }
  }

  await db.collection('markets').doc(marketId).update({
    data: { status: 'resolved', settledAt: Date.now(), settling: false, updatedAt: db.serverDate() }
  });
  return { settled: true, processed };
}

exports.main = async (event) => {
  const { OPENID, SOURCE } = cloud.getWXContext();
  const marketId = String(event.marketId || '');
  const force = !!event.force;

  // 指定市场：管理员手动结卦（force 用于复核后强制结卦）
  if (marketId) {
    if (!ADMIN_OPENIDS.includes(OPENID)) return { ok: false, err: '无权限操作' };
    let market;
    try {
      market = (await db.collection('markets').doc(marketId).get()).data;
    } catch (e) {
      return { ok: false, err: '卦题不存在' };
    }
    if (market.status !== 'dispute_window') return { ok: false, err: '该卦题不在昭示期' };
    // 异议通道 = 社区公断（settleOne 内已检查 arbitration_pending）；
    // hasDispute/disputeCount 为预留字段，当前无写入方，「申诉转人工」待产品化后启用
    const r = await settleOne(marketId);
    return { ok: true, ...r };
  }

  // 无参批量：仅限定时触发器 / 云间调用 / 管理员，防止客户端刷调用消耗配额
  if (SOURCE === 'wx_client' && !ADMIN_OPENIDS.includes(OPENID)) {
    return { ok: false, err: '无权限操作' };
  }
  const nowTs = Date.now();
  const res = await db.collection('markets')
    .where({ status: 'dispute_window', disputeEndsAt: _.lte(nowTs) })
    .limit(100)
    .get();
  const results = [];
  for (const m of res.data) {
    results.push(await settleOne(m._id));
  }
  return { ok: true, results };
};
