// =========================================================
// AI 起草断卦条件（DeepSeek，默认走 Responses API + 服务端 web_search 联网核实）
// 输入：卦题标题 + 分类 + 截止时间 + 数据源注册表
// 输出：resolutionSpec 草稿（AI 只起草规则，最终由运营确认后发布，
//       断卦执行仍由 resolver 规则引擎 + 昭示期兜底，AI 不参与裁决）
// =========================================================
const cloud = require('wx-server-sdk');
const https = require('https');

// TODO: 部署前配置（二选一）
// 1) 直接在此处填写：const DEEPSEEK_API_KEY = 'sk-xxxx';
// 2) 在云函数「配置 → 环境变量」中添加 DEEPSEEK_API_KEY
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_RESPONSES_MODEL = process.env.DEEPSEEK_RESPONSES_MODEL || 'deepseek-v4-flash';
const DEEPSEEK_WEB_SEARCH = String(process.env.DEEPSEEK_WEB_SEARCH || 'true') === 'true';
const DEEPSEEK_TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS || 110000);
// 联网检索单次预算：超时即回退离线 chat/completions，剩余时间留给离线生成，保证总耗时压在 55s 上限内
const SEARCH_TIMEOUT_MS = Math.min(DEEPSEEK_TIMEOUT_MS, 20000);
// 小程序端 callFunction 无超时参数，连接约 60s 会被平台掐断；
// 这里在 55s 主动收口，返回明确提示而不是 ESOCKETTIMEDOUT
const AI_SAFE_TIMEOUT_MS = 55000;

// 管理员 openid（部署时在云函数环境变量配置 ADMIN_OPENIDS，逗号分隔；空 = 仅 Mock 可进后台）
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

const OPERATORS = ['>=', '>', '<=', '<', '==', '!=', 'contains', 'in'];
const TRANSFORMS = ['int', 'float', 'string'];
// 本地兜底词表：msgSecCheck 不可用（云调用未开通/异常）时降级使用，避免 fail-open
const LOCAL_SENSITIVE_WORDS = [
  '选举', '大选', '总统', '议会', '国会', '审判', '开庭', '判决', '起诉', '立案', '庭审',
  '游行', '抗议', '罢工', '骚乱', '示威', '聚集', '疫情', '封控', '确诊', '公共卫生卦题',
  '赌博', '博彩', '下注', '投注', '赔率', '毒品', '冰毒', '海洛因', '枪支', '恐怖袭击',
  '台独', '港独', '藏独', '疆独', '法轮功', '颠覆', '暴动', '政变', '裸聊', '援交', '色情'
];

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 微信官方内容安全（AI 断卦草稿在展示给运营前先过检）；未开通云调用时回退本地词表
async function securityCheck(content) {
  if (!content) return true;
  try {
    const r = await cloud.openapi.security.msgSecCheck({ content });
    const suggest = r && r.result && r.result.suggest;
    return suggest === 'pass' || !suggest;
  } catch (e) {
    const lower = String(content).toLowerCase();
    return !LOCAL_SENSITIVE_WORDS.some(w => lower.indexOf(w.toLowerCase()) >= 0);
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

function extractJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
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

function chatCompletions(baseUrl, model, messages, apiKey, extra = {}, timeoutMs) {
  return postJson(
    baseUrl.replace(/\/$/, '') + '/chat/completions',
    Object.assign({ model, messages, temperature: 0.2 }, extra),
    apiKey,
    timeoutMs || DEEPSEEK_TIMEOUT_MS
  );
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!ADMIN_OPENIDS.includes(OPENID)) return { ok: false, err: '无权限操作' };

  const title = String(event.title || '').trim();
  const category = String(event.category || '');
  const deadlineText = String(event.deadlineText || '');
  const sources = Array.isArray(event.sources) ? event.sources.slice(0, 30) : [];

  if (title.length < 10) return { ok: false, err: '卦题标题过短，无法起草' };
  if (!DEEPSEEK_API_KEY) {
    return { ok: false, err: '尚未配置 DeepSeek API Key：请在 aiDraftSpec 云函数中配置环境变量 DEEPSEEK_API_KEY' };
  }

  const sourceList = sources.map(s => ({
    name: String(s.name || '').slice(0, 60),
    type: String(s.type || ''),
    url: String(s.url || '').slice(0, 200),
    category: String(s.category || ''),
    notes: String(s.notes || '').slice(0, 100)
  }));

  const systemPrompt = '你是预测市场「预测卦局」的断卦条件起草助手。你的职责是把卦题改写成严格二值化（YES/NO）、机器可执行的断卦条件（resolutionSpec）。你只起草规则，不裁决结果。';
  const userPrompt = `请为以下预测卦题起草断卦条件。

卦题描述：${title}
分类：${category || '未指定'}
断卦时点（截止）：${deadlineText || '未指定'}

可选数据源（只能从其中选择 provider，禁止编造数据源）：
${JSON.stringify(sourceList)}

你有 web_search 联网检索工具：起草前先检索数据源是否可用、官方字段与口径，禁止编造字段/接口；联网失败时基于给定数据源与通用规范起草，但 humanReadable 必须可被运营核实。

输出要求：只输出一个 JSON 对象（不要 markdown 代码块、不要多余文字）：
{
  "mode": "numeric" 或 "manual",
  "provider": "数据源名称（numeric 时必须是上面列表中的 name）",
  "field": "JSON 点分取值路径（numeric 时填写，如 weatherinfo.temp）",
  "transform": "int|float|string",
  "operator": ">=|>|<=|<|==|!=|contains|in",
  "value": 阈值（数值或字符串，contains/in 时可为字符串或数组）,
  "unit": "单位，如 ℃/元/分",
  "humanReadable": "给用户看的断卦说明（中文，必须包含：数据源、断卦时点、比较规则、缺失数据处理），严格使用当前产品口径（应验/未应验、爻、卦池、昭示），建议格式：根据「{provider}」官方数据，判定时点 {截止时间}，指标 {field} 满足 {operator} {value}{unit} 则“应验”，否则“未应验”；数据缺失时爻原路退回。"
}

硬性规则：
1. 优先 numeric（有可机读数据源时）；只有无法机读时才选 manual；
2. 边界规则固定为：数据缺失时爻原路退回；临界值按条件严格比较，平局判 NO；
3. humanReadable 严格使用当前产品口径：应验/未应验、爻、卦池、昭示、公断；禁用能量/预言/问卦/下注/赔率/庄家等旧词或博彩词；
4. 【单一结卦源】provider 只能唯一指定一个官方数据源（必须来自上面列表），humanReadable 中只允许出现这一个结卦源，禁止“以 A 为准、B 做参考”的多源表述；
5. 【物理截止】humanReadable 必须包含明确的断卦时点（截止时间），并注明“截止时点之后产生的任何信息不作为断卦证据”；
6. 【二元性】断卦条件必须保证结果严格二值（成立/不成立），不存在第三种结果；若卦题可能取消/延期，写明“数据缺失或卦题未发生时爻原路退回”；
7. 【敏感红线】若卦题属于政治选举、社会争议、司法案件、公共卫生突发卦题等敏感话题，直接返回 {"mode":"manual","provider":"","humanReadable":"卦题涉及敏感红线，禁止发布"}；
8. 【联网核实】优先基于 web_search 检索到的最新官方口径起草；检索结果与给定数据源注册表冲突时，以注册表为准并保留可核实的说明。`;

  let resp;
  let mode = 'offline';
  let fallbackReason = '';
  const t0 = Date.now();
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
  try {
    const work = (async () => {
      if (DEEPSEEK_WEB_SEARCH) {
        try {
          resp = await postJson(
            DEEPSEEK_BASE_URL.replace(/\/$/, '') + '/responses',
            {
              model: DEEPSEEK_RESPONSES_MODEL,
              instructions: systemPrompt,
              input: [{ role: 'user', content: userPrompt }],
              tools: [{ type: 'web_search' }],
              temperature: 0.2,
              reasoning: { effort: 'low' }
            },
            DEEPSEEK_API_KEY,
            SEARCH_TIMEOUT_MS
          );
          mode = 'deepseek_search';
        } catch (e) {
          fallbackReason = String(e.message || e).slice(0, 300);
          console.error('DeepSeek Responses/web_search 调用失败，回退离线 chat/completions：', e.message || e);
          // 联网环节已耗时，剩余预算留给离线生成（至少 12s）
          const remaining = Math.max(12000, 50000 - (Date.now() - t0));
          resp = await chatCompletions(DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, messages, DEEPSEEK_API_KEY, {
            response_format: { type: 'json_object' }
          }, remaining);
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
        setTimeout(() => reject(new Error(
          `AI 生成超时（联网+离线共超 ${AI_SAFE_TIMEOUT_MS / 1000}s 上限）` +
          (fallbackReason ? `；联网环节失败原因：${fallbackReason}` : '；联网环节耗时过长') +
          '；离线回退也未在预算内完成，请稍后重试或更换更快模型'
        )), AI_SAFE_TIMEOUT_MS)
      )
    ]);
  } catch (e) {
    return { ok: false, err: 'AI 调用失败：' + (e.message || '未知错误') };
  }

  const content = extractContent(resp);
  const parsed = extractJson(content);
  if (!parsed) {
    return { ok: false, err: 'AI 未返回有效 JSON，请重试' };
  }

  if (parsed.mode === 'manual') {
    const humanReadable = String(parsed.humanReadable || '').trim();
    if (humanReadable.length < 10) return { ok: false, err: 'AI 未返回有效的断卦说明，请重试' };
    const hrPass = await securityCheck(humanReadable.slice(0, 500));
    if (!hrPass) return { ok: false, err: 'AI 生成的断卦说明包含敏感内容，请重试或改用手动填写' };
    return {
      ok: true,
      spec: {
        mode: 'manual',
        provider: String(parsed.provider || '官方公告').slice(0, 60),
        humanReadable
      },
      aiMode: mode,
      fallbackReason
    };
  }

  // numeric 模式校验
  const provider = String(parsed.provider || '').trim();
  const field = String(parsed.field || '').trim();
  if (!provider || !field) return { ok: false, err: 'AI 返回的数据源或字段为空，请重试' };
  if (!sources.some(s => String(s.name || '') === provider)) {
    return { ok: false, err: `AI 引用了未注册数据源「${provider}」，请重试或改用手动填写` };
  }
  if (!OPERATORS.includes(parsed.operator)) return { ok: false, err: 'AI 返回了反对的比较符，请重试' };
  const transform = TRANSFORMS.includes(parsed.transform) ? parsed.transform : 'int';
  const value = transform === 'string' ? String(parsed.value) : Number(parsed.value);
  if (value === '' || (transform !== 'string' && isNaN(value))) return { ok: false, err: 'AI 返回的阈值无效，请重试' };

  const hrCheck = await securityCheck(String(parsed.humanReadable || '').slice(0, 500));
  if (!hrCheck) return { ok: false, err: 'AI 生成的断卦说明包含敏感内容，请重试或改用手动填写' };

  return {
    ok: true,
    spec: {
      mode: 'numeric',
      provider,
      field,
      transform,
      operator: parsed.operator,
      value,
      unit: String(parsed.unit || '').slice(0, 20),
      humanReadable: String(parsed.humanReadable || '').slice(0, 300)
    },
    aiMode: mode,
    fallbackReason
  };
};
