// =========================================================
// AI 选题助手（附议 DeepSeek / 通义千问 / Kimi 三选一，均带联网搜索）
// 输入：用户需求（如“本周热点”）+ 可选分类偏好 + 数据源注册表
// 输出：候选预测卦题清单（严格 YES/NO 二值化、可验证性标注）
// 说明：AI 只做选题建议，最终由运营勾选确认后发题。
// =========================================================
const cloud = require('wx-server-sdk');
const https = require('https');

// =========================================================
// 模型选择（环境变量 AI_PROVIDER：deepseek | qwen | kimi）
// deepseek：Responses API + 服务端 web_search（部分账号/模型不支持时会自动回退离线）
// qwen    ：DashScope OpenAI 兼容接口 + enable_search（阿里官方联网）
// kimi    ：Moonshot chat/completions + Formula 官方工具通道（web-search，kimi-k3 推荐）
// =========================================================
const AI_PROVIDER = String(process.env.AI_PROVIDER || 'deepseek').toLowerCase();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_WEB_SEARCH = String(process.env.DEEPSEEK_WEB_SEARCH || 'true') === 'true';
const DEEPSEEK_RESPONSES_MODEL = process.env.DEEPSEEK_RESPONSES_MODEL || 'deepseek-v4-flash';
const DEEPSEEK_TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS || 110000);

const QWEN_API_KEY = process.env.QWEN_API_KEY || '';
const QWEN_BASE_URL = process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen-plus';

const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
const KIMI_BASE_URL = process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1';
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k2-0711-preview';
const KIMI_FORMULA_URI = process.env.KIMI_FORMULA_URI || 'moonshot/web-search:latest';

// 通用 OpenAI 兼容接口（如 OpenCode Zen / 各类中转网关）
const CUSTOM_API_KEY = process.env.CUSTOM_API_KEY || '';
const CUSTOM_BASE_URL = process.env.CUSTOM_BASE_URL || '';
const CUSTOM_MODEL = process.env.CUSTOM_MODEL || '';
const CUSTOM_SEARCH = String(process.env.CUSTOM_SEARCH || 'false') === 'true';

// 管理员 openid（部署时在云函数环境变量配置 ADMIN_OPENIDS，逗号分隔；空 = 仅 Mock 可进后台）
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

const CATEGORIES = ['影视娱乐', '科技数码', '游戏电竞', '体育竞技', '趣味民生', '财经宏观'];
// 分类别名归一化：AI 可能返回“影视/电影/体育”等简称，统一映射到六类
const CATEGORY_ALIASES = {
  '影视': '影视娱乐', '电影': '影视娱乐', '电视剧': '影视娱乐', '综艺': '影视娱乐', '影娱': '影视娱乐', '文娱': '影视娱乐',
  '科技': '科技数码', '数码': '科技数码', '互联网': '科技数码', '手机': '科技数码', '3c': '科技数码',
  '游戏': '游戏电竞', '电竞': '游戏电竞',
  '体育': '体育竞技', '竞技': '体育竞技', '足球': '体育竞技', '篮球': '体育竞技',
  '民生': '趣味民生', '社会': '趣味民生', '生活': '趣味民生', '趣闻': '趣味民生',
  '财经': '财经宏观', '金融': '财经宏观', '经济': '财经宏观', '宏观': '财经宏观'
};

function normalizeCategory(cat) {
  const s = String(cat || '').trim();
  if (!s) return '';
  if (CATEGORIES.includes(s)) return s;
  return CATEGORY_ALIASES[s] || '';
}

function categoryMatch(cat, selected) {
  if (!cat) return true; // 缺分类时允许，展示阶段归入所选分类
  return cat === selected || cat.indexOf(selected) >= 0 || selected.indexOf(cat) >= 0;
}
const MAX_ITEMS = 10;
// 本地兜底词表：msgSecCheck 不可用（云调用未开通/异常）时降级使用，避免 fail-open
const LOCAL_SENSITIVE_WORDS = [
  '选举', '大选', '总统', '议会', '国会', '审判', '开庭', '判决', '起诉', '立案', '庭审',
  '游行', '抗议', '罢工', '骚乱', '示威', '聚集', '疫情', '封控', '确诊', '公共卫生卦题',
  '赌博', '博彩', '下注', '投注', '赔率', '毒品', '冰毒', '海洛因', '枪支', '恐怖袭击',
  '台独', '港独', '藏独', '疆独', '法轮功', '颠覆', '暴动', '政变', '裸聊', '援交', '色情'
];
// 小程序端 callFunction 无超时参数，连接约 60s 会被平台掐断；
// 这里在 55s 主动收口，返回明确提示而不是 ESOCKETTIMEDOUT
const AI_SAFE_TIMEOUT_MS = 55000;

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 微信官方内容安全（AI 输出在展示给运营前先过检）；未开通云调用时回退本地词表
async function securityCheck(content) {
  if (!content) return true;
  try {
    const r = await cloud.openapi.security.msgSecCheck({ content });
    const suggest = r && r.result && r.result.suggest;
    return suggest === 'pass' || !suggest;
  } catch (e) {
    const lower = String(content).toLowerCase();
    const hit = LOCAL_SENSITIVE_WORDS.find(w => lower.indexOf(w.toLowerCase()) >= 0);
    if (hit) {
      console.warn('[aiSuggestTopics] 本地词表命中：', hit, '| 内容：', String(content).slice(0, 60));
    } else {
      console.warn('[aiSuggestTopics] msgSecCheck 不可用且本地词表未命中，判定为通过：', String(content).slice(0, 60));
    }
    return !hit;
  }
}

function postJson(url, payload, apiKey, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const t = timeoutMs || 30000;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: t
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            const errDetail = (parsed.error && (parsed.error.message || JSON.stringify(parsed.error))) || data;
            reject(new Error(`AI 接口返回 ${res.statusCode}: ${String(errDetail).slice(0, 200)}`));
            return;
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error('AI 响应解析失败: ' + String(data).slice(0, 200)));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('AI 请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getJson(url, apiKey, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const t = timeoutMs || 20000;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      timeout: t
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            const errDetail = (parsed.error && (parsed.error.message || JSON.stringify(parsed.error))) || data;
            reject(new Error(`Kimi 接口返回 ${res.statusCode}: ${String(errDetail).slice(0, 200)}`));
            return;
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error('Kimi 响应解析失败: ' + String(data).slice(0, 200)));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Kimi 请求超时')));
    req.on('error', reject);
    req.end();
  });
}

function extractJsonArray(text) {
  let t = String(text || '').trim();
  t = t.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const arr = JSON.parse(t.slice(start, end + 1));
    return Array.isArray(arr) ? arr : null;
  } catch (e) {
    return null;
  }
}

// 兼容两种返回格式：Responses API（output/output_text）与 chat/completions（choices）
function extractContent(resp) {
  if (!resp) return '';
  if (typeof resp.output_text === 'string' && resp.output_text) return resp.output_text;
  if (Array.isArray(resp.output)) {
    const parts = [];
    for (const item of resp.output) {
      if (item && item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c && typeof c.text === 'string') parts.push(c.text);
        }
      }
    }
    if (parts.length) return parts.join('\n');
  }
  const msg = resp && resp.choices && resp.choices[0] && resp.choices[0].message;
  if (msg) {
    if (typeof msg.content === 'string') return msg.content;
    // 部分网关把 content 返回为数组（如 [{type:'text', text:'...'}]）
    if (Array.isArray(msg.content)) {
      const parts = [];
      for (const c of msg.content) {
        if (typeof c === 'string') parts.push(c);
        else if (c && typeof c.text === 'string') parts.push(c.text);
      }
      if (parts.length) return parts.join('\n');
    }
  }
  return '';
}

// 各模型通用 chat/completions 调用
function chatCompletions(baseUrl, model, messages, apiKey, extra = {}, timeoutMs) {
  return postJson(
    baseUrl.replace(/\/$/, '') + '/chat/completions',
    Object.assign({ model, messages, temperature: 0.7 }, extra),
    apiKey,
    timeoutMs || DEEPSEEK_TIMEOUT_MS
  );
}

// DeepSeek Responses API：服务端 web_search 分两段返回（先 web_search_call，
// 需把输出项原样回传，服务端恢复搜索结果后再生成最终答案），这里做多轮续接
async function callDeepSeekResponses(instructions, userPrompt, apiKey, temperature) {
  let input = [{ role: 'user', content: userPrompt }];
  const t0 = Date.now();
  for (let round = 0; round < 4; round++) {
    // 首轮搜索给 30s；后续轮尽量用满剩余预算，总耗时由外层 55s 上限兜底
    const budget = round === 0 ? 30000 : Math.max(15000, 54000 - (Date.now() - t0));
    let resp;
    try {
      resp = await postJson(
        DEEPSEEK_BASE_URL.replace(/\/$/, '') + '/responses',
        {
          model: DEEPSEEK_RESPONSES_MODEL,
          instructions,
          input,
          tools: [{ type: 'web_search' }],
          // 首轮强制发起联网检索，避免模型只写计划不执行
          tool_choice: round === 0 ? { type: 'web_search' } : 'auto',
          temperature,
          reasoning: { effort: 'low' },
          max_output_tokens: 8000
        },
        apiKey,
        budget
      );
    } catch (e) {
      throw new Error(`联网请求失败（第 ${round + 1} 轮，预算 ${Math.round(budget / 1000)}s）：${e.message}`);
    }
    const output = Array.isArray(resp.output) ? resp.output : [];
    // 输出被 token 上限截断 → 立即报错（走离线回退），不拿半截内容当结果
    if (resp.status === 'incomplete' && resp.incomplete_details && resp.incomplete_details.reason === 'max_output_tokens') {
      throw new Error('AI 输出被截断（max_output_tokens），请重试');
    }
    const last = output[output.length - 1];
    const hasFinal = last && last.type === 'message' && Array.isArray(last.content) &&
      last.content.some(c => c && typeof c.text === 'string' && c.text.trim());
    if (hasFinal) return resp;
    const hasPending = output.some(item => item && (item.type === 'web_search_call' || item.type === 'function_call'));
    if (!hasPending) {
      // 没有待执行调用也没有最终答案：再给一轮，要求直接输出 JSON，不带任何解释
      if (round === 0) {
        input = input.concat(output);
        input.push({ role: 'user', content: '请直接输出最终 JSON，不要输出任何解释或计划文字。' });
        continue;
      }
      return resp;
    }
    // 续接：把上一轮输出（含 web_search_call）原样追加到 input
    input = input.concat(output);
  }
  throw new Error('联网检索轮次过多，请重试');
}

// Kimi k3 联网搜索：官方 Formula 工具通道（OpenAI 协议标准 function tool）
// 流程：GET /formulas/{uri}/tools 拉取工具声明 → chat 让模型调用 →
//       POST /formulas/{uri}/fibers 执行搜索 → 结果以 tool 消息回传后继续
async function callKimiWithSearch(systemPrompt, userPrompt, apiKey) {
  // 1) 拉取官方工具声明
  const toolsRes = await getJson(
    KIMI_BASE_URL.replace(/\/$/, '') + '/formulas/' + KIMI_FORMULA_URI + '/tools',
    apiKey,
    20000
  );
  const tools = (toolsRes && Array.isArray(toolsRes.tools) ? toolsRes.tools : [])
    .filter(t => t && t.type === 'function' && t.function && t.function.name);
  if (!tools.length) throw new Error('Kimi Formula 未返回可用工具，请检查 KIMI_FORMULA_URI');

  // 2) 聊天循环：模型调用工具时执行 formula，结果回传后继续
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
  for (let round = 0; round < 6; round++) {
    const resp = await chatCompletions(KIMI_BASE_URL, KIMI_MODEL, messages, apiKey, {
      tools,
      // 首轮强制调用 web-search，避免模型只写计划不执行
      tool_choice: round === 0 ? { type: 'function', function: { name: tools[0].function.name } } : 'auto'
    });
    const choice = resp && resp.choices && resp.choices[0];
    const msg = choice && choice.message;
    if (choice && choice.finish_reason === 'tool_calls' && msg && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      // 完整回传 assistant 消息（保留 content / tool_calls / reasoning_content）
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        const fnName = tc.function && tc.function.name;
        let output;
        if (fnName) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { args = { query: String(tc.function.arguments || '') }; }
          output = await execKimiFormula(fnName, args, apiKey);
        } else {
          output = JSON.stringify({ error: '工具缺少名称' });
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: String(output).slice(0, 3000) });
      }
      continue;
    }
    // 没有工具调用但内容为空：再给一轮，要求直接输出 JSON
    const contentOk = msg && (typeof msg.content === 'string'
      ? msg.content.trim()
      : Array.isArray(msg.content) ? msg.content.length > 0 : !!msg.content);
    if (!contentOk && round < 2) {
      messages.push({ role: 'user', content: '请直接输出最终 JSON，不要输出任何解释或计划文字。' });
      continue;
    }
    return resp;
  }
  throw new Error('Kimi 联网检索轮次过多，请重试');
}

// 执行 Kimi Formula（web-search）：POST /formulas/{uri}/fibers
async function execKimiFormula(name, args, apiKey) {
  const res = await postJson(
    KIMI_BASE_URL.replace(/\/$/, '') + '/formulas/' + KIMI_FORMULA_URI + '/fibers',
    { name, arguments: JSON.stringify(args) },
    apiKey,
    25000
  );
  const ctx = res.context || {};
  if (res.status === 'succeeded') {
    const out = ctx.output || ctx.encrypted_output || '';
    return typeof out === 'string' ? out : JSON.stringify(out);
  }
  return JSON.stringify({ error: res.error || ctx.error || '搜索执行失败' });
}

// 阶段一：DeepSeek 仅联网检索，返回中文要点摘要（不生成候选）
async function runDeepSeekSearch(category, timeRange, topic) {
  const todayCN = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const searchPrompt = `今天是北京时间 ${todayCN}。请针对以下范围做一次联网检索：分类：${category || '全品类'}；时间范围：${timeRange || '一周内'}；需求：${topic}。
检索最近可验证的热点事件（赛事/发布会/票房/官方统计发布/官宣定档等），然后输出不超过 500 字的中文要点摘要：列出候选方向、关键事实与数据来源名称。不要输出 JSON，不要长篇大论。`;
  const instructions = '你是热点检索助手。整个任务只允许调用一次 web_search 工具；检索完成后直接输出中文要点摘要，不要解释过程。';
  let input = [{ role: 'user', content: searchPrompt }];
  const t0 = Date.now();
  for (let round = 0; round < 4; round++) {
    // 首轮给足检索时间；续接轮用剩余预算
    const budget = round === 0 ? 50000 : Math.max(10000, 55000 - (Date.now() - t0));
    let resp;
    try {
      resp = await postJson(
        DEEPSEEK_BASE_URL.replace(/\/$/, '') + '/responses',
        {
          model: DEEPSEEK_RESPONSES_MODEL,
          instructions,
          input,
          tools: [{ type: 'web_search' }],
          tool_choice: { type: 'web_search' },
          reasoning: { effort: 'low' },
          max_output_tokens: 2000
        },
        DEEPSEEK_API_KEY,
        budget
      );
    } catch (e) {
      throw new Error(`联网检索请求失败（第 ${round + 1} 轮，预算 ${Math.round(budget / 1000)}s）：${e.message}`);
    }
    const output = Array.isArray(resp.output) ? resp.output : [];
    if (resp.status === 'incomplete' && resp.incomplete_details && resp.incomplete_details.reason === 'max_output_tokens') {
      throw new Error('联网检索输出被截断，请重试');
    }
    const last = output[output.length - 1];
    const text = extractContent(resp);
    const hasFinal = last && last.type === 'message' && Array.isArray(last.content) &&
      last.content.some(c => c && typeof c.text === 'string' && c.text.trim());
    const hasPending = output.some(item => item && (item.type === 'web_search_call' || item.type === 'function_call'));
    if (hasFinal || !hasPending) return text;
    input = input.concat(output);
  }
  throw new Error('联网检索轮次过多，请重试');
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!ADMIN_OPENIDS.includes(OPENID)) return { ok: false, err: '无权限操作' };

  const topic = String(event.topic || '').trim() || '热点事件';
  const category = String(event.category || '');
  const timeRange = String(event.timeRange || '').trim() || '一周内';
  const rangeDays = timeRange.indexOf('一个月') >= 0 ? 30 : (timeRange.indexOf('三个月') >= 0 ? 90 : 7);
  const sources = Array.isArray(event.sources) ? event.sources.slice(0, 30) : [];
  // 以北京时间锚定“今天”，防止模型按训练数据的旧日期生成选题
  const todayCN = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  const providerKey = AI_PROVIDER === 'qwen' ? QWEN_API_KEY
    : AI_PROVIDER === 'kimi' ? KIMI_API_KEY
    : AI_PROVIDER === 'custom' ? CUSTOM_API_KEY
    : DEEPSEEK_API_KEY;
  const providerLabel = AI_PROVIDER === 'qwen' ? '通义千问'
    : AI_PROVIDER === 'kimi' ? 'Kimi'
    : AI_PROVIDER === 'custom' ? '自定义接口'
    : 'DeepSeek';
  const providerKeyName = AI_PROVIDER === 'qwen' ? 'QWEN_API_KEY'
    : AI_PROVIDER === 'kimi' ? 'KIMI_API_KEY'
    : AI_PROVIDER === 'custom' ? 'CUSTOM_API_KEY'
    : 'DEEPSEEK_API_KEY';
  if (!providerKey) {
    return { ok: false, err: `尚未配置 ${providerLabel} API Key：请在 aiSuggestTopics 环境变量中配置 ${providerKeyName}（AI_PROVIDER=${AI_PROVIDER}）` };
  }
  if (AI_PROVIDER === 'custom' && (!CUSTOM_BASE_URL || !CUSTOM_MODEL)) {
    return { ok: false, err: 'custom 模式需同时配置 CUSTOM_BASE_URL 与 CUSTOM_MODEL' };
  }

  const searchSummary = String(event.searchSummary || '').trim();
  const searchOnly = !!event.searchOnly;

  // 阶段一：仅联网检索（前端先调用，拿到摘要后再调用生成）
  if (searchOnly) {
    if (AI_PROVIDER !== 'deepseek' || !DEEPSEEK_WEB_SEARCH) {
      return { ok: false, err: '分步联网检索仅支持 DeepSeek（AI_PROVIDER=deepseek）' };
    }
    try {
      const summary = await runDeepSeekSearch(category, timeRange, topic);
      if (!summary || !summary.trim()) return { ok: false, err: '联网检索未返回有效摘要，请重试' };
      return { ok: true, searchSummary: summary.slice(0, 3000), mode: 'deepseek_search' };
    } catch (e) {
      return { ok: false, err: 'AI 联网检索失败：' + (e.message || e) };
    }
  }

  const sourceList = sources.map(s => ({
    name: String(s.name || '').slice(0, 60),
    type: String(s.type || ''),
    url: String(s.url || '').slice(0, 200),
    category: String(s.category || ''),
    notes: String(s.notes || '').slice(0, 100)
  }));

  const systemPrompt = '你是预测市场「预测卦局」的选题助手。你的职责是发现“截止后能用官方数据或官方公告验证”的硬事实型候选卦题，并写成严格 YES/NO 二值化的问题。你只做选题建议，不裁决结果。';
  const userPrompt = `今天是北京时间 ${todayCN}。时间范围：${timeRange}（所有候选的截止时间必须落在今天起 ${rangeDays} 天内）。用户需求：${topic}${category ? `，分类偏好：${category}（本批次只输出该分类的候选卦题）` : ''}

可选数据源（只能从其中选择 dataSource，禁止编造；无合适来源时 dataSource 填空字符串并把 verifiable 设为 false）：
${JSON.stringify(sourceList)}

只输出一个 JSON 数组（不要 markdown 代码块、不要多余文字），每个元素：
{
  "title": "严格 YES/NO 二值化的预测问题（中文，20-60 字）",
  "category": "${CATEGORIES.join('|')}",
  "reason": "为什么热门、为什么可验证（一句话）",
  "dataSource": "建议数据源名称（必须来自上面的列表；没有就填空字符串）",
  "suggestedDeadline": "建议截止时间（如：本周日 24:00）",
  "verifiable": true,
  "probability": "对该卦题发生概率的粗略估计（20-80 之间的整数，表示存在悬念）",
  "constraintCheck": {
    "binary": true,
    "singleSource": true,
    "hardDeadline": true,
    "noSensitive": true,
    "hasSuspense": true
  }
}

硬性规则：
1. 只选「在某个时间点能用官方数据/官方公告验证」的硬事实，避免主观话题和无法验证的传闻；
2. 标题必须二值化（是否/能否/是否达到），禁用“下注/赔率/庄家”等博彩词；
3. 至少输出 10 条、最多 ${MAX_ITEMS} 条，按可验证性和热度排序；
4. 【绝对二元性】结果必须非此即彼，不存在平局、取消、改期之外的第三种可判读结果；若卦题可能“取消/延期导致无法断卦”，仍可接受，但必须在 reason 中说明断卦兜底（数据缺失原路退回）；
5. 【单一权威结卦源】每个候选只允许绑定一个第三方权威公开结卦源（官方数据/官方公告/权威天榜），禁止多个来源混用、禁止平台自设来源；dataSource 只能从给定列表选择；
6. 【物理截止时间】每个候选必须有明确截止日期与时刻；截止后出现的任何信息不得作为断卦证据，suggestedDeadline 必须具体到日或时刻；
7. 【敏感红线】严禁输出任何国内外政治选举（含美国大选）、国内社会争议民生卦题、法院正在审理的司法案件、公共卫生突发卦题等敏感话题；无法判断是否敏感时一律不选；
8. 【悬念区间】只选结果概率大致落在 20%-80% 之间的卦题；99% 确定（如太阳升起）或实力悬殊到无悬念的卦题必须排除；
9. 【时效性】你有 web_search 联网检索工具：整个任务只允许发起一次检索（覆盖所有候选），检索完成后直接基于结果生成候选清单，禁止逐条/反复检索；禁止把记忆里的旧卦题当作“当前热点”，禁止编造检索不到的卦题。所有候选截止时间必须在 ${todayCN} 之后仍可验证。优先输出周期性/持续性可验证的硬事实（未来天气、周票房、汇率/指数、官方天榜、已官宣日程），并把标题与 suggestedDeadline 写成面向 ${todayCN} 之后的可断卦版本；
10. 每个候选的 constraintCheck 五项必须全部为 true，否则不要输出该候选；
11. 【结果时点确定】区分“停止收注截止”与“结果可得时点”：比赛结束、发布会结束、官方统计发布时刻这类结果时点确定的事件可以选用，停止收注截止应设在结果时点之前（如开赛前），suggestedDeadline 需写明截止时间，reason 中注明结果时点（判定在结果时点后自动进行）；禁止“开分、榜单首更、开奖、销量揭晓”等结果时点不确定的数据形态（无法安排判定）；若确需使用，必须给出数据发布的最晚预期时点，并写明缺失兜底（数据缺失时爻原路退回）。`;

  let resp;
  let mode = 'offline';
  const userPromptFinal = searchSummary
    ? userPrompt + '\n\n【联网检索结果（仅作事实参考；数据源名称必须来自上面列表，禁止编造）】\n' + searchSummary
    : userPrompt;
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPromptFinal }
  ];
  try {
    const work = (async () => {
      if (AI_PROVIDER === 'qwen') {
        // 通义千问：OpenAI 兼容接口 + enable_search（服务端自动联网）
        resp = await chatCompletions(QWEN_BASE_URL, QWEN_MODEL, messages, QWEN_API_KEY, {
          enable_search: true,
          response_format: { type: 'json_object' }
        });
        mode = 'qwen_search';
      } else if (AI_PROVIDER === 'kimi') {
        // Kimi：$web_search 内置工具（模型先搜索再回答）
        resp = await callKimiWithSearch(systemPrompt, userPrompt, KIMI_API_KEY);
        mode = 'kimi_search';
      } else if (AI_PROVIDER === 'custom') {
        // 通用 OpenAI 兼容接口：若平台附议 search 参数可开 CUSTOM_SEARCH=true
        // 注意：部分网关对 temperature 有限制（如仅允许 1），这里不传，让模型用默认值
        resp = await postJson(
          CUSTOM_BASE_URL.replace(/\/$/, '') + '/chat/completions',
          Object.assign(
            { model: CUSTOM_MODEL, messages },
            CUSTOM_SEARCH ? { enable_search: true } : {}
          ),
          CUSTOM_API_KEY,
          DEEPSEEK_TIMEOUT_MS
        );
        mode = CUSTOM_SEARCH ? 'custom_search' : 'custom';
      } else if (DEEPSEEK_WEB_SEARCH) {
        if (searchSummary) {
          // 阶段二：基于联网摘要生成候选（不再联网，稳定快速）
          resp = await chatCompletions(DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, messages, DEEPSEEK_API_KEY, {
            response_format: { type: 'json_object' }
          }, 50000);
          mode = 'deepseek_search';
        } else {
          // 兼容单次调用：联网检索 + 续接生成；失败直接报错，不回退离线
          resp = await callDeepSeekResponses(systemPrompt, userPrompt, DEEPSEEK_API_KEY, 0.7);
          mode = 'deepseek_search';
        }
      } else {
        resp = await chatCompletions(DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, messages, DEEPSEEK_API_KEY, {
          response_format: { type: 'json_object' }
        }, 30000);
      }
    })();
    await Promise.race([
      work,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI 生成超时（超过 55s 上限）：联网检索或生成未在预算内完成，请稍后重试')), AI_SAFE_TIMEOUT_MS)
      )
    ]);
  } catch (e) {
    return { ok: false, err: 'AI 调用失败：' + (e.message || '未知错误') };
  }

  const content = extractContent(resp);
  const parsed = extractJsonArray(content);
  if (!parsed) {
    const searchMode = mode !== 'offline' && mode !== 'custom';
    const snippet = String(content || JSON.stringify(resp || {})).slice(0, 200);
    return { ok: false, err: (searchMode ? '联网模式未返回有效候选清单' : 'AI 未返回有效候选清单') + '，返回内容：' + snippet };
  }

  // 先归一化分类，再做过滤（避免 AI 返回“影视/电影”等简称导致 0 条）
  const normalizedParsed = parsed
    .filter(c => c && typeof c === 'object' && !Array.isArray(c))
    .map(c => Object.assign({}, c, { category: normalizeCategory(c.category) }));

  const list = normalizedParsed
    .filter(c => {
      const title = String(c.title || '').trim();
      const catOk = category
        ? categoryMatch(c.category, category)
        : (!c.category || CATEGORIES.includes(c.category));
      return title.length >= 10 && catOk;
    })
    .slice(0, MAX_ITEMS)
    .map((c, i) => ({
      _id: 'c' + i,
      title: String(c.title || '').trim().slice(0, 80),
      category: CATEGORIES.includes(c.category) ? c.category : (category || '趣味民生'),
      reason: String(c.reason || '').slice(0, 100),
      dataSource: String(c.dataSource || ''),
      suggestedDeadline: String(c.suggestedDeadline || '').slice(0, 30),
      verifiable: !!c.verifiable,
      probability: String(c.probability || '').slice(0, 8),
      constraintCheck: c.constraintCheck && typeof c.constraintCheck === 'object' ? c.constraintCheck : null
    }));

  if (!list.length) {
    const rawSnippet = JSON.stringify(parsed).slice(0, 300);
    const droppedSample = normalizedParsed.slice(0, 5).map(c =>
      `《${String(c.title || '').slice(0, 24)}》[分类:${c.category || '无'},标题长度:${String(c.title || '').trim().length}]`
    ).join('；');
    console.error('[aiSuggestTopics] 候选过滤后为 0，原始返回：', rawSnippet);
    return {
      ok: false,
      err: `AI 返回的候选全部未通过过滤（0 条）。被过滤样本：${droppedSample || '无（原始返回为空）'}。原始返回开头：${rawSnippet}...`
    };
  }

  // 逐条过微信内容安全，命中敏感内容的不进入候选清单
  const safeList = [];
  const rejected = [];
  for (const c of list) {
    const titleOk = await securityCheck(c.title);
    const reasonOk = await securityCheck(c.reason);
    if (titleOk && reasonOk) {
      safeList.push(c);
    } else {
      rejected.push({ title: c.title, reason: c.reason, titleOk, reasonOk });
    }
  }

  if (!safeList.length) {
    console.error('[aiSuggestTopics] 候选全部未通过安全检测：', JSON.stringify(rejected).slice(0, 1200));
    const sample = rejected.slice(0, 3).map(r => `「${r.title}」`).join('、');
    return {
      ok: false,
      err: `AI 生成的 ${list.length} 条候选均未通过内容安全检测（示例：${sample}）。请更换时间范围/分类后重试；若反复出现，可能是 AI 生成了政治/赌博等敏感题材，请人工检查选题。`
    };
  }
  return { ok: true, list: safeList, mode };
};
