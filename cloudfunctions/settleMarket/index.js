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
          // 天榜口径：只累计净收益（不含本金返还）；退款（refundAll）不计入榜分
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
  const notifies = [];

  // 注意：循环体内会把 bet.status 从 active 改为 won/lost/refunded，
  // 结果集实时缩小，因此每轮必须从头取（skip 固定为 0），
  // 否则翻页漂移会导致部分注单永远漏结卦。
  // rounds 兜底防止单条更新失败时死循环；耗尽后不置 resolved，
  // 保持 dispute_window + settling 由下个周期接管继续（绝不丢注单）。
  let rounds = 0;
  const MAX_ROUNDS = 2000;
  let exhausted = false;
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
        await postWebhook(`【预测卦局·结卦异常】市场 ${marketId}（${market.title}）单注结卦失败：${String(e.message || e).slice(0, 200)}，10 分钟后自动重试`);
        return { settled: false, reason: 'bet_settle_failed', marketId };
      }
      if (r.skipped) continue;
      processed += 1;

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

  // 轮次耗尽仍未结完（注单量级过大）：保持 dispute_window + settling，
  // 交由下个定时周期接管继续结，绝不把剩余注单留在 active
  if (rounds >= MAX_ROUNDS) {
    const remain = await db.collection('bets').where({ marketId, status: 'active' }).count();
    if (remain.total > 0) {
      exhausted = true;
      await postWebhook(`【预测卦局·结卦告警】市场 ${marketId}（${market.title}）注单过多（剩余 ${remain.total} 条），本周期未结完，下周期接管继续`);
    }
  }
  if (exhausted) {
    return { settled: false, reason: 'bet_settle_incomplete', marketId };
  }

  // 结卦 对弈：直接按 DB 状态推导（幂等），
  // 崩溃接管重跑时即使本轮没结过任何注单，也能把对弈正确收尾，
  // 避免「上次运行已结完注单、PK 却永远停在 accepted」导致胜负与 PK 榜缺失。
  await settlePksForMarket(marketId);

  await db.collection('markets').doc(marketId).update({
    data: { status: 'resolved', settledAt: Date.now(), settling: false, updatedAt: db.serverDate() }
  });

  // 订阅消息最后发送（外部网络调用）：失败不影响核心状态；
  // 若在此处超时崩溃，市场已 resolved、对弈已收尾，接管重跑会直接跳过
  for (const n of notifies) {
    try {
      await sendJudgeNotify(
        n.openid,
        n.title,
        n.won ? '应验' : (n.refundAll ? '数据异常，已退回' : '未应验'),
        n.status === 'won' ? `获得 ${n.payout} 爻` : ''
      );
    } catch (e) {
      console.error('发送断卦订阅消息失败', n.openid, e && e.message);
    }
  }

  return { settled: true, processed };
}

// 结卦本市场全部未收尾的对弈（幂等，可重复执行）：
//  - pending（未应战）：挑战者注单已按普通注单结卦完毕，直接作废邀弈，
//    避免污染 对弈胜率榜，也防止后续 myPks 清理时二次退款；
//  - accepted：按双方注单的结卦状态推导胜负，无胜者（退款/数据异常）不计胜负。
async function settlePksForMarket(marketId) {
  const PAGE = 100;
  let skip = 0;
  while (true) {
    const res = await db.collection('pks')
      .where({ marketId, status: _.in(['pending', 'accepted']) })
      .skip(skip)
      .limit(PAGE)
      .get();
    const pks = res.data;
    if (!pks.length) break;

    for (const pk of pks) {
      // 拉取该对弈的注单（含 pkId 标记）
      const betRes = await db.collection('bets').where({ pkId: pk._id }).limit(10).get();
      const pkBets = betRes.data;
      // 注单还没结完（本轮循环未覆盖）：跳过，交给下个周期/接管轮
      if (pkBets.some(b => b.status === 'active')) continue;

      if (pk.status !== 'accepted') {
        await db.collection('pks').doc(pk._id).update({
          data: { status: 'expired', expiredAt: Date.now(), updatedAt: db.serverDate() }
        });
        continue;
      }

      const wonBets = pkBets.filter(b => b.status === 'won');
      // 反向立场对弈，胜者必然唯一；退款/异常（如 refundAll）时无胜者
      const winnerId = wonBets.length === 1 ? wonBets[0].openid : '';
      await db.collection('pks').doc(pk._id).update({
        data: {
          status: 'settled',
          winnerId,
          settledAt: Date.now(),
          updatedAt: db.serverDate()
        }
      });
      // 有明确胜者才计胜负；无胜者（数据异常退款）不计，避免双方都记负
      if (winnerId) {
        for (const b of pkBets) {
          await db.collection('users').doc(b.openid).update({
            data: {
              [winnerId === b.openid ? 'pkWins' : 'pkLosses']: _.inc(1),
              updatedAt: db.serverDate()
            }
          });
        }
      }
    }

    if (pks.length < PAGE) break;
    skip += PAGE;
  }
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
