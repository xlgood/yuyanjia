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

// SSRF 防护：禁止抓取内网/回环/链路本地/保留地址，防止恶意 spec 探测云函数内网
function isPrivateUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch (e) {
    return true; // 非法 URL 视为不安全
  }
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // 组播/保留
  }
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  if (host.startsWith('::ffff:')) {
    const v4 = host.slice(7);
    const m4 = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m4 && (Number(m4[1]) === 127 || Number(m4[1]) === 10 || Number(m4[1]) === 192)) return true;
  }
  return false;
}

function assertPublicUrl(url, label) {
  if (isPrivateUrl(url)) {
    throw new Error((label || '数据源') + ' URL 不允许访问内网/回环地址: ' + String(url).slice(0, 80));
  }
}

function fetchJson(url, timeoutMs) {
  assertPublicUrl(url, '数据源');
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

// 抓取 HTML 原文（webpage 适配器用；强制 identity 编码避免 gzip 乱码，
// 带浏览器 UA 提高部分站点可达性）
function fetchText(url, timeoutMs) {
  assertPublicUrl(url, '网页数据源');
  const t = timeoutMs || 15000;
  return new Promise((resolve, reject) => {
    const lib = url.indexOf('https') === 0 ? https : http;
    const req = lib.get(url, {
      timeout: t,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Encoding': 'identity',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8'
      }
    }, res => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error('页面返回 HTTP ' + res.statusCode));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

// 剥离 script/style/标签与常见实体，得到可见文本
function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 简单 CSS 选择器提取（仅支持 #id / .class / 标签名，零依赖正则实现；
// 复杂选择器场景可后续引入 cheerio）
function extractBySelector(html, selector) {
  const s = String(selector || '').trim();
  if (!s) return null;
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let re;
  if (s[0] === '#') {
    const id = esc(s.slice(1));
    re = new RegExp('<[^>]+id\\s*=\\s*["\']' + id + '["\'][^>]*>([\\s\\S]*?)</', 'i');
  } else if (s[0] === '.') {
    const cls = esc(s.slice(1));
    re = new RegExp('<[^>]+class\\s*=\\s*["\'][^"\']*\\b' + cls + '\\b[^"\']*["\'][^>]*>([\\s\\S]*?)</', 'i');
  } else {
    const tag = s.replace(/[^a-zA-Z0-9]/g, '');
    if (!tag) return null;
    re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i');
  }
  const m = String(html).match(re);
  if (!m) return null;
  return stripHtml(m[1]);
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
    json,
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

// webpage 适配器：抓取官方页面，按 regex（正则捕获组）/ selector（简单选择器）/
// 全文三种方式提取结果字段，再走统一 evaluate 规则判定（零依赖）
async function resolveWebpage(spec) {
  const ds = spec.dataSource;
  if (ds.type !== 'webpage') throw new Error('webpage 适配器仅支持 dataSource.type=webpage');
  if (!ds.url) throw new Error('webpage 适配器缺少数据源 url');

  const html = await fetchText(ds.url, ds.timeoutMs);
  let actual;
  if (ds.regex) {
    const m = String(html).match(new RegExp(ds.regex));
    if (!m) throw new Error('未匹配到提取表达式: ' + ds.regex);
    actual = stripHtml(m[1] !== undefined ? m[1] : m[0]);
  } else if (ds.selector) {
    actual = extractBySelector(html, ds.selector);
    if (actual == null) throw new Error('选择器未命中: ' + ds.selector);
  } else {
    actual = stripHtml(html);
  }

  if (ds.transform === 'int' || ds.transform === 'float') {
    const num = toNumber(actual);
    if (num == null) throw new Error('字段值无法解析为数字: ' + String(actual).slice(0, 100));
    actual = ds.transform === 'int' ? Math.round(num) : num;
  } else if (ds.transform === 'string') {
    actual = String(actual);
  }
  if (actual == null) throw new Error('字段值无法解析: ' + actual);

  const yes = evaluate(actual, spec.condition);
  return {
    result: yes ? 'YES' : 'NO',
    value: String(actual).slice(0, 500),
    raw: String(html).slice(0, 5000),
    fetchedAt: Date.now()
  };
}

const ADAPTERS = {
  api: resolveGenericJson,
  weather: resolveWeather,
  webpage: resolveWebpage
};

// 多源交叉验证：主源判定后，逐个拉取 backupSources 备用源；
// 任一备用源成功且结果一致 → 确认；任一不一致 → 冲突转人工；全部失败 → 以主源为准
async function crossCheck(spec, primaryResult) {
  const backups = spec.backupSources || [];
  if (!backups.length) return { status: 'ok', detail: 'no_backup' };
  let allFailed = true;
  let checked = 0;
  for (const bs of backups) {
    const type = bs && bs.type;
    const adapter = ADAPTERS[type];
    if (!adapter || !bs.url) continue;
    const subSpec = Object.assign({}, spec, { dataSource: bs });
    try {
      const r = await adapter(subSpec);
      allFailed = false;
      checked += 1;
      if (r.result !== primaryResult.result) {
        return { status: 'conflict', detail: bs.url + ' -> ' + r.result + ' vs 主源 ' + primaryResult.result };
      }
    } catch (e) {
      /* 备用源失败，尝试下一个 */
    }
  }
  if (checked === 0) return { status: 'ok', detail: 'backup_not_applicable' };
  return { status: 'ok', detail: allFailed ? 'backup_all_failed' : 'backup_consistent' };
}

// 防信息套利：数据源配置了 timestampField 时，校验结果时间 >= 截止时间
// （结果在收注期间已出现 → 疑似提前揭晓，转人工复核）
async function checkResultTimestamp(market, spec, r) {
  const tf = spec && spec.dataSource && spec.dataSource.timestampField;
  if (!tf) return null;
  const json = r.json || {};
  let ts = getPath(json, tf);
  if (ts == null) return '数据源未返回时间戳字段: ' + tf;
  ts = toNumber(ts);
  if (ts == null) return '时间戳无法解析: ' + tf;
  const deadline = toNumber(market.deadline);
  if (deadline && ts < deadline) {
    return '结果时间早于截止时间（疑似提前揭晓）: ' + new Date(ts).toISOString();
  }
  return null;
}

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

      // 防信息套利：结果时间早于截止时间 → 疑似提前揭晓，转人工复核
      const tsIssue = await checkResultTimestamp(m, spec, r);
      if (tsIssue) {
        await log(m._id, methodOf(spec), { status: 'timestamp_conflict', error: tsIssue, value: r.value });
        await flagManual(m._id, attempts, tsIssue);
        await postWebhook(`【预测卦局·断卦告警】卦题「${String(m.title || m._id).slice(0, 30)}」${tsIssue}，已转人工复核`);
        summary.manual.push(m._id);
        continue;
      }

      // 多源交叉验证：冲突 → 转人工复核（不自动结算）
      const cross = await crossCheck(spec, r);
      if (cross.status === 'conflict') {
        await log(m._id, methodOf(spec), { status: 'conflict', error: cross.detail, value: r.value, result: r.result });
        await flagManual(m._id, attempts, '多源结果冲突: ' + cross.detail);
        await postWebhook(`【预测卦局·断卦告警】卦题「${String(m.title || m._id).slice(0, 30)}」多源结果冲突（${String(cross.detail).slice(0, 120)}），已转人工复核`);
        summary.manual.push(m._id);
        continue;
      }

      const method = methodOf(spec);
      await db.collection('markets').doc(m._id).update({
        data: {
          status: 'dispute_window',
          result: r.result,
          evidenceUrl: r.archiveUrl || '',
          resolvedAt: Date.now(),
          disputeEndsAt: computeDisputeEndsAt(Date.now()),
          hasDispute: false,
          resolutionMethod: method,
          resolutionAttempts: attempts,
          needsManualReview: false,
          updatedAt: db.serverDate()
        }
      });
      await log(m._id, method, {
        status: 'ok',
        value: r.value,
        result: r.result,
        raw: r.raw,
        cross: cross.detail,
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

// 判定方法名：webpage → auto_webpage，其余 → auto_api（看板按此统计）
function methodOf(spec) {
  return spec && spec.dataSource && spec.dataSource.type === 'webpage' ? 'auto_webpage' : 'auto_api';
}

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
