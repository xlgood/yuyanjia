// =========================================================
// 定时选题（dailyHotTopics）
// 每天 08:00 / 20:00 由定时触发器调用：
//   1. 拉取稳定免费源（GitHub Trending 官方 API + Hacker News 官方 API）
//   2. 聚合为「今日热点素材」文本
//   3. 调用 aiSuggestTopics（注入素材作为 searchSummary）生成候选事件
//   4. 候选写入 topic_candidates 集合（管理端「定时候选」确认发题）
// 设计约束：发现与确认分离——本函数只产出候选，最终发题仍需运营确认；
// 幂等：同一天只生成一次（date+source 去重）。
// =========================================================
const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 管理员 openid（与其它管理函数一致；空 = 仅定时器/云间调用可用）
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

// 运营告警：复用 LOCK_WEBHOOK_URL（企业微信/飞书），零新增配置
const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || process.env.LOCK_WEBHOOK_URL || '';
const WEBHOOK_TYPE = String(process.env.LOCK_WEBHOOK_TYPE || 'wecom').toLowerCase();

const MAX_ITEMS = 10;
const SUMMARY_MAX = 6000;

function todayKey() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function fetchJson(url, timeoutMs) {
  const t = timeoutMs || 15000;
  return new Promise((resolve, reject) => {
    const lib = url.indexOf('https') === 0 ? https : http;
    const req = lib.get(url, { timeout: t, headers: { 'User-Agent': 'Mozilla/5.0 dailyHotTopics' } }, res => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
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

// GitHub Trending（官方 search API，未认证限 10 次/分钟，单次调用足够）
async function fetchGithubTrending() {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const url = 'https://api.github.com/search/repositories?q=created:%3E' + since + '&sort=stars&order=desc&per_page=' + MAX_ITEMS;
  const { json } = await fetchJson(url, 20000);
  return (json.items || []).map(r =>
    `【GitHub】${r.full_name}：${(r.description || '（无描述）').slice(0, 120)} 语言:${r.language || '未知'} star:${r.stargazers_count} 链接:${r.html_url}`
  );
}

// Hacker News（官方 Firebase API）
async function fetchHackerNews() {
  const { json: ids } = await fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json', 15000);
  const top = (Array.isArray(ids) ? ids : []).slice(0, MAX_ITEMS);
  const out = [];
  for (const id of top) {
    try {
      const { json: item } = await fetchJson('https://hacker-news.firebaseio.com/v0/item/' + id + '.json', 10000);
      if (item && item.title) {
        out.push(`【HackerNews】${item.title} 得分:${item.score || 0} 链接:${item.url || 'https://news.ycombinator.com/item?id=' + id}`);
      }
    } catch (e) { /* 单条失败跳过 */ }
  }
  return out;
}

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

exports.main = async () => {
  // 门禁：仅定时触发器 / 云间调用 / 管理员可触发
  const { OPENID, SOURCE } = cloud.getWXContext();
  if (SOURCE === 'wx_client' && !ADMIN_OPENIDS.includes(OPENID)) {
    return { ok: false, err: '无权限操作' };
  }

  const date = todayKey();
  const col = db.collection('topic_candidates');

  // 幂等：当天已自动生成则跳过
  try {
    const dup = await col.where({ date, source: 'auto' }).count();
    if (dup.total > 0) return { ok: true, skipped: true, date };
  } catch (e) { /* 集合不存在等异常：继续生成 */ }

  // 1) 拉取稳定免费源（逐源 try/catch，单源失败不影响整体）
  const materials = [];
  try {
    materials.push(...await fetchGithubTrending());
  } catch (e) {
    console.error('GitHub Trending 拉取失败', e && e.message || e);
  }
  try {
    materials.push(...await fetchHackerNews());
  } catch (e) {
    console.error('Hacker News 拉取失败', e && e.message || e);
  }
  if (!materials.length) {
    await postWebhook('【预测卦局·选题告警】定时选题：全部数据源拉取失败，本轮跳过');
    return { ok: false, err: '数据源拉取全部失败' };
  }
  const summary = materials.join('\n').slice(0, SUMMARY_MAX);

  // 2) 调用 AI 选题（注入素材作为 searchSummary，跳过独立联网检索）
  let candidates = [];
  let aiMode = '';
  let aiError = '';
  try {
    const hr = await cloud.callFunction({
      name: 'aiSuggestTopics',
      data: { topic: '科技数码、财经宏观热点事件', category: '', timeRange: '一周内', searchSummary: summary }
    });
    const r = hr.result || {};
    if (r.ok) {
      candidates = Array.isArray(r.list) ? r.list.slice(0, 20) : [];
      aiMode = r.mode || 'auto';
    } else {
      aiError = String(r.err || 'AI 选题失败');
    }
  } catch (e) {
    aiError = String((e && e.message) || e);
  }

  // 3) 落库（即使 AI 失败也保留素材，供管理端人工参考）
  const doc = {
    date,
    source: 'auto',
    status: 'pending', // pending / accepted / rejected（管理端处理后更新）
    summary: summary.slice(0, SUMMARY_MAX),
    items: candidates,
    aiMode,
    aiError: candidates.length ? '' : (aiError || 'AI 未返回候选'),
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };
  try {
    await col.add({ data: doc });
  } catch (e) {
    return { ok: false, err: '写入 topic_candidates 失败: ' + String((e && e.message) || e) };
  }

  if (WEBHOOK_URL) {
    await postWebhook(`【预测卦局·选题】今日自动生成 ${candidates.length} 条候选事件，请到运营后台「定时候选」确认发题`);
  }

  return { ok: true, date, materials: materials.length, candidates: candidates.length, aiError: aiError || undefined };
};
