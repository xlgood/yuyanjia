// =========================================================
// 自动断卦执行器（resolver）
// 每 10 分钟扫描「已过截止时间 + 带 resolutionSpec」的合约，
// 按数据源类型调用适配器拉取官方数据并自动断卦：
//   - 成功：写入 result / 证据，状态 → dispute_window（2h 昭示）
//   - 失败：记录日志并重试，连续 3 次失败转人工复核
// 之后由 settleMarket 定时器自动结卦，全链路无人值守。
// =========================================================
const cloud = require('wx-server-sdk');

// 昭示期时长（小时，默认 2；可通过 DISPUTE_WINDOW_HOURS 调整）
const DISPUTE_WINDOW_MS = (Number(process.env.DISPUTE_WINDOW_HOURS) || 2) * 3600 * 1000;
const MAX_ATTEMPTS = 3;
const GRACE_MS = 5 * 60 * 1000; // 截止后等待 5 分钟再断卦（等官方数据刷新）

// 昭示结束时间：窗口时长 + 跨夜顺延（若结束落在北京时间 00:00~10:00，顺延到当天 10:00）
function computeDisputeEndsAt(nowTs) {
  let end = nowTs + DISPUTE_WINDOW_MS;
  const bj = new Date(end + 8 * 3600 * 1000);
  if (bj.getUTCHours() < 10) {
    end = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate(), 10) - 8 * 3600 * 1000;
  }
  return end;
}

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 运营告警：复用 lockMarkets 的 LOCK_WEBHOOK_URL / LOCK_WEBHOOK_TYPE，零新增配置
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || process.env.LOCK_WEBHOOK_URL || '';
const ALERT_WEBHOOK_TYPE = String(process.env.LOCK_WEBHOOK_TYPE || 'wecom').toLowerCase();
// 管理员 openid：允许运营在控制台/后台手动触发断卦扫描
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

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

// =========================================================
// 适配器（原 adapters/ 目录，因 CLI 打包反对子目录已内联，
// 功能与拆分版本完全一致；GUI 部署两种写法均可）
// =========================================================
const http = require('http');
const https = require('https');

function fetchJson(url, timeoutMs) {
  const t = timeoutMs || 10000;
  return new Promise((resolve, reject) => {
    const lib = url.indexOf('https') === 0 ? https : http;
    const req = lib.get(url, { timeout: t }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ raw: body, json: JSON.parse(body) });
        } catch (e) {
          reject(new Error('响应不是合法 JSON'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

function getPath(obj, path) {
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function toNumber(v) {
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function evaluate(actual, cond) {
  const target = cond.value;
  switch (cond.operator) {
    case '>=': return actual >= target;
    case '>': return actual > target;
    case '<=': return actual <= target;
    case '<': return actual < target;
    case '==': return actual === target;
    case '!=': return actual !== target;
    case 'contains': return String(actual).indexOf(String(target)) >= 0;
    case 'in': return Array.isArray(target) && target.indexOf(actual) >= 0;
    default: throw new Error('反对的运算符: ' + cond.operator);
  }
}

async function resolveGenericJson(spec) {
  const ds = spec.dataSource;
  if (ds.type !== 'api') throw new Error('generic-json 适配器仅附议 dataSource.type=api');

  const { raw, json } = await fetchJson(ds.url, ds.timeoutMs);
  let actual = getPath(json, ds.field);
  if (actual == null) throw new Error('数据源字段不存在: ' + ds.field);

  // 注意顺序：先做数值合法性判断，再做 int 取整（Math.round(null) 会得到 0 导致脏数据被误判）
  if (ds.transform === 'int' || ds.transform === 'float') {
    actual = toNumber(actual);
    if (actual == null) throw new Error('字段值无法解析为数字: ' + getPath(json, ds.field));
    if (ds.transform === 'int') actual = Math.round(actual);
  } else if (ds.transform === 'string') {
    actual = String(actual);
  }

  if (actual == null || (typeof actual === 'number' && isNaN(actual))) throw new Error('字段值无法解析: ' + actual);

  const yes = evaluate(actual, spec.condition);
  return {
    result: yes ? 'YES' : 'NO',
    value: actual,
    raw: raw.length > 5000 ? raw.slice(0, 5000) : raw,
    fetchedAt: Date.now()
  };
}

async function resolveWeather(spec) {
  const ds = spec.dataSource;
  const normalized = Object.assign({}, spec, {
    dataSource: {
      type: 'api',
      url: ds.url || 'http://www.weather.com.cn/data/sk/101010100.html',
      field: ds.field || 'weatherinfo.temp',
      transform: ds.transform || 'int'
    }
  });
  return resolveGenericJson(normalized);
}

const ADAPTERS = {
  api: resolveGenericJson,
  weather: resolveWeather
};

exports.main = async () => {
  // 门禁：仅定时触发器 / 云间调用 / 管理员可触发，防止客户端刷调用
  // （扫描会真实改写市场状态、写判定日志、发 webhook）
  const { OPENID, SOURCE } = cloud.getWXContext();
  if (SOURCE === 'wx_client' && !ADMIN_OPENIDS.includes(OPENID)) {
    return { ok: false, err: '无权限操作' };
  }
  const now = Date.now();
  const res = await db.collection('markets')
    .where({
      status: 'locked',
      deadline: _.lte(now - GRACE_MS),
      resolutionSpec: _.exists(true)
    })
    .limit(20)
    .get();

  const summary = { scanned: res.data.length, resolved: [], retrying: [], manual: [] };

  for (const m of res.data) {
    // 已转人工或已超过重试上限的跳过（查询条件无法表达 exists，这里显式过滤）
    if (m.needsManualReview) continue;
    const attempts = (m.resolutionAttempts || 0) + 1;
    const spec = m.resolutionSpec;
    // manual 类型由运营人工录入断卦（见 resolveMarket），不参与自动断卦
    if (spec && spec.dataSource && spec.dataSource.type === 'manual') continue;
    const adapter = ADAPTERS[spec && spec.dataSource && spec.dataSource.type];

    if (!adapter) {
      await flagManual(m._id, attempts, '无对应数据源适配器: ' + (spec && spec.dataSource && spec.dataSource.type));
      await postWebhook(`【预测卦局·断卦告警】卦题「${String(m.title || m._id).slice(0, 30)}」无对应数据源适配器，已转人工`);
      summary.manual.push(m._id);
      continue;
    }

    try {
      const r = await adapter(spec);
      await db.collection('markets').doc(m._id).update({
        data: {
          status: 'dispute_window',
          result: r.result,
          evidenceUrl: r.archiveUrl || '',
          resolvedAt: Date.now(),
          disputeEndsAt: computeDisputeEndsAt(Date.now()),
          hasDispute: false,
          resolutionMethod: 'auto_api',
          resolutionAttempts: attempts,
          needsManualReview: false,
          updatedAt: db.serverDate()
        }
      });
      await log(m._id, 'auto_api', {
        status: 'ok',
        value: r.value,
        result: r.result,
        raw: r.raw,
        fetchedAt: r.fetchedAt
      });
      summary.resolved.push(m._id);
    } catch (e) {
      await log(m._id, (spec && spec.dataSource && spec.dataSource.type) || 'unknown', {
        status: 'error',
        error: String(e.message || e).slice(0, 500)
      });
      if (attempts >= MAX_ATTEMPTS) {
        await db.collection('markets').doc(m._id).update({
          data: { needsManualReview: true, resolutionAttempts: attempts, updatedAt: db.serverDate() }
        });
        await postWebhook(`【预测卦局·断卦告警】卦题「${String(m.title || m._id).slice(0, 30)}」自动断卦连续 ${attempts} 次失败，已转人工复核`);
        summary.manual.push(m._id);
      } else {
        await db.collection('markets').doc(m._id).update({
          data: { resolutionAttempts: attempts, updatedAt: db.serverDate() }
        });
        summary.retrying.push(m._id);
      }
    }
  }

  return { ok: true, summary };
};

async function log(marketId, method, data) {
  try {
    await db.collection('resolution_logs').add({
      data: Object.assign({ marketId, method, createdAt: db.serverDate() }, data)
    });
  } catch (e) {
    console.error('写入断卦日志失败', marketId, e);
  }
}

async function flagManual(marketId, attempts, reason) {
  try {
    await db.collection('markets').doc(marketId).update({
      data: { needsManualReview: true, resolutionAttempts: attempts, updatedAt: db.serverDate() }
    });
    await log(marketId, 'unknown', { status: 'error', error: reason });
  } catch (e) {
    console.error('标记人工复核失败', marketId, e);
  }
}
