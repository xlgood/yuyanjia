const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 订阅消息模板（部署时在云函数环境变量配置；留空 = 不推送）
const SUBSCRIBE_ARBITRATION_TMPL = process.env.SUBSCRIBE_ARBITRATION_TMPL || '';

// 结卦锁超过该时长视为上次运行崩溃残留，允许下个定时周期接管重试
const SETTLING_STALE_MS = 10 * 60 * 1000;

// 运营告警：复用 lockMarkets 的 LOCK_WEBHOOK_URL / LOCK_WEBHOOK_TYPE，零新增配置
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

async function sendArbitrationNotify(openid, marketTitle, resultText) {
  if (!SUBSCRIBE_ARBITRATION_TMPL || !openid) return;
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: SUBSCRIBE_ARBITRATION_TMPL,
      page: 'pages/index/index',
      data: {
        thing1: { value: String(marketTitle || '').slice(0, 20) },
        thing2: { value: String(resultText || '').slice(0, 20) }
      }
    });
  } catch (e) {
    console.error('发送公断订阅消息失败', openid, e.message);
  }
}

// 断卦公断是否成立：
// 1) 附议票 > 反对票
// 2) 总票数 ≥ max(ceil(参与人数 × 10%), 2)
// 3) 附议票 ≥ 2 且 反对票 ≥ 1（防单人操纵）
function arbitrationWins(arb) {
  const support = arb.supportVotes || 0;
  const oppose = arb.opposeVotes || 0;
  const total = support + oppose;
  if (support <= oppose) return false;
  if (total < (arb.minVotes || 2)) return false;
  if (support < 2 || oppose < 1) return false;
  return true;
}

// 公断结卦锁：定时器（每 5 分钟）与手动结卦并发时只有一个能真正结卦，
// 防止重复退款 / 重复分卦；崩溃残留超过阈值后可接管
async function claimArbitrationLock(arbId) {
  const nowTs = Date.now();
  const arbs = db.collection('arbitrations');

  let res = await arbs
    .where({ _id: arbId, status: 'pending', settling: _.neq(true) })
    .update({ data: { settling: true, settlingAt: nowTs, updatedAt: db.serverDate() } });
  if (res.stats && res.stats.updated) return true;

  let arb = null;
  try {
    arb = (await arbs.doc(arbId).get()).data;
  } catch (e) { /* 公断可能已删除 */ }
  if (!arb || arb.status !== 'pending' || !arb.settling) return false;
  if (nowTs - (arb.settlingAt || 0) <= SETTLING_STALE_MS) return false;

  res = await arbs
    .where({
      _id: arbId,
      status: 'pending',
      settling: true,
      settlingAt: _.lte(nowTs - SETTLING_STALE_MS)
    })
    .update({ data: { settlingAt: nowTs, updatedAt: db.serverDate() } });
  return !!(res.stats && res.stats.updated);
}

async function settleArbitrationId(arbId) {
  const arbRef = db.collection('arbitrations').doc(arbId);
  let arb;
  try {
    arb = (await arbRef.get()).data;
  } catch (e) {
    return { settled: false, reason: 'not_found' };
  }
  if (!arb || arb.status !== 'pending') return { settled: false, reason: 'not_pending' };

  // 先抢结卦锁：抢不到说明另一个结卦修行正在处理（或尚未到接管阈值）
  const locked = await claimArbitrationLock(arbId);
  if (!locked) return { settled: false, reason: 'settling_in_progress' };

  const wins = arbitrationWins(arb);
  const winnerSide = wins ? 'support' : 'oppose';
  const loserSide = wins ? 'oppose' : 'support';
  const loserPool = winnerSide === 'support' ? (arb.opposePool || 0) : (arb.supportPool || 0);

  // 拉取双方附议记录
  const votes = [];
  let skip = 0;
  const PAGE = 100;
  while (true) {
    const res = await db.collection('arbitration_votes')
      .where({ arbitrationId: arbId })
      .skip(skip)
      .limit(PAGE)
      .get();
    votes.push(...res.data);
    if (res.data.length < PAGE) break;
    skip += PAGE;
  }

  const winners = votes.filter(v => v.side === winnerSide);
  const losers = votes.filter(v => v.side === loserSide);
  const winnerBondTotal = winners.reduce((s, v) => s + (v.bond || 0), 0);

  // 市场信息提前取出（无对赌分支也要用，且依赖其状态决定回流状态）
  const marketRef = db.collection('markets').doc(arb.marketId);
  let market = null;
  try {
    market = (await marketRef.get()).data;
  } catch (e) { /* 市场可能已被删除 */ }
  // 无对赌兜底：若某一方 0 票（如无人投反对），没有形成有效对赌，
  // 所有附议人保证金原路全额退回，平台不产生也不吞没爻
  const noBet = winners.length === 0 || losers.length === 0;
  if (noBet) {
    for (const v of votes) {
      await db.collection('users').doc(v.openid).update({
        data: { points: _.inc(v.bond || 0), updatedAt: db.serverDate() }
      });
      await sendArbitrationNotify(v.openid, arb.marketTitle, '公断无有效对赌，保证金已退回');
    }
    await arbRef.update({
      data: {
        status: 'settled',
        winner: 'no_bet',
        settledAt: Date.now(),
        settling: false,
        updatedAt: db.serverDate()
      }
    });
    if (market) {
      await marketRef.update({
        data: {
          // 公断结束即终局：直接回到可结卦状态，不再重复公示
          status: 'dispute_window',
          disputeEndsAt: Date.now(),
          arbitrationResult: 'no_bet',
          updatedAt: db.serverDate()
        }
      });
    }
    return { settled: true, wins: false, noBet: true, refunded: true };
  }

  // 赢家：退回本金 + 按投入比例分卦输家池
  for (const v of winners) {
    const share = winnerBondTotal > 0
      ? Math.floor(((v.bond || 0) / winnerBondTotal) * loserPool)
      : 0;
    await db.collection('users').doc(v.openid).update({
      data: {
        points: _.inc((v.bond || 0) + share),
        weekPoints: _.inc(share),
        monthPoints: _.inc(share),
        totalPoints: _.inc(share),
        updatedAt: db.serverDate()
      }
    });
    await sendArbitrationNotify(v.openid, arb.marketTitle, wins ? '公断成立，断卦已翻转' : '公断未成立，维持原断卦');
  }
  // 输家：本金进入卦池，不再退回
  for (const v of losers) {
    await db.collection('users').doc(v.openid).update({
      data: { updatedAt: db.serverDate() }
    });
    await sendArbitrationNotify(v.openid, arb.marketTitle, wins ? '公断成立，你的保证金已归附议方' : '公断未成立，你的保证金已归反对方');
  }

  const flip = wins && market && market.result;
  const newResult = flip ? (market.result === 'YES' ? 'NO' : 'YES') : (market ? market.result : '');

  await arbRef.update({
    data: {
      status: 'settled',
      winner: wins ? 'support' : 'oppose',
      settledAt: Date.now(),
      settling: false,
      updatedAt: db.serverDate()
    }
  });
  if (market) {
    await marketRef.update({
      data: {
        // 公断结束即终局：直接回到可结卦状态，不再重复公示
        status: 'dispute_window',
        disputeEndsAt: Date.now(),
        result: newResult,
        arbitrationResult: wins ? 'overturned' : 'upheld',
        updatedAt: db.serverDate()
      }
    });
  }

  return {
    settled: true,
    wins,
    supportVotes: arb.supportVotes || 0,
    opposeVotes: arb.opposeVotes || 0,
    winnerSide,
    flipped: !!flip
  };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const arbId = String((event && event.arbitrationId) || '');

  // 指定公断单结卦：仅管理员可操作，且必须已过公示期
  // （防止任意用户提前触发结卦 / 绕过附议周期）
  if (arbId) {
    const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ADMIN_OPENIDS.includes(OPENID)) return { ok: false, err: '无权限操作' };
    let target = null;
    try {
      target = (await db.collection('arbitrations').doc(arbId).get()).data;
    } catch (e) {
      return { ok: false, err: '公断不存在' };
    }
    if (target && target.status === 'pending' && target.endsAt && target.endsAt > Date.now()) {
      return { ok: false, err: '公断公示期未结束，暂不能结卦' };
    }
    try {
      return { ok: true, ...(await settleArbitrationId(arbId)) };
    } catch (e) {
      await postWebhook(`【卦题大师·公断结卦异常】公断 ${arbId} 结卦抛错：${String(e.message || e).slice(0, 200)}`);
      return { ok: false, err: e.message || '结卦失败' };
    }
  }

  // 批量：结卦所有已过公示期的公断（定时触发器）
  const res = await db.collection('arbitrations')
    .where({ status: 'pending', endsAt: _.lte(Date.now()) })
    .limit(20)
    .get();
  const results = [];
  for (const arb of res.data) {
    try {
      results.push(await settleArbitrationId(arb._id));
    } catch (e) {
      await postWebhook(`【卦题大师·公断结卦异常】公断 ${arb._id} 结卦抛错：${String(e.message || e).slice(0, 200)}，下个周期自动重试`);
      results.push({ settled: false, reason: 'exception', arbitrationId: arb._id });
    }
  }
  return { ok: true, results };
};
