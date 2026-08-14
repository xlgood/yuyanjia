const cloud = require('wx-server-sdk');

// 管理员 openid（部署时在云函数环境变量配置 ADMIN_OPENIDS，逗号分隔；空 = 仅 Mock 可进后台）
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);
// 业务常量单一来源：cloudfunctions/_shared/config.js（与前端 utils/constants.js 分类一致）
const { CATEGORIES, OPERATORS, TRANSFORMS } = require('./common-config');

// 二值化词：标题必须包含其一，保证结果非此即彼
const BINARY_WORDS = ['是否', '能否', '会不会', '能不能', '有没有', '是否达到', '是否突破', '是否超过', '是否低于', '会不会突破', '是否赢得', '是否获胜'];
// 敏感红线：政治选举 / 社会争议 / 司法案件 / 公共卫生突发卦题
const SENSITIVE_WORDS = [
  '选举', '大选', '总统', '特朗普', '拜登', '附议结果', '议会', '国会',
  '审判', '开庭', '判决', '起诉', '立案', '在审', '庭审',
  '游行', '抗议', '罢工', '骚乱', '示威', '聚集',
  '疫情', '封控', '确诊', '疑似病例', '公共卫生卦题'
];
// 本地兜底词表：msgSecCheck 不可用（云调用未开通/异常）时降级使用，避免 fail-open
const LOCAL_SENSITIVE_WORDS = SENSITIVE_WORDS.concat([
  '赌博', '博彩', '下注', '投注', '赔率', '毒品', '冰毒', '海洛因', '枪支', '恐怖袭击',
  '台独', '港独', '藏独', '疆独', '法轮功', '颠覆', '暴动', '政变', '裸聊', '援交', '色情'
]);

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 微信官方内容安全检测（标题/断卦说明全链路）；未开通云调用时回退本地词表
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

exports.main = async (event) => {
  try {
    return await handle(event);
  } catch (e) {
    // 任何异常转为可见错误返回，避免云函数崩溃（-504002 / 145 code exit unexpected）
    console.error('[createMarket] 异常', e && e.message || e);
    return { ok: false, err: String((e && e.message) || e).slice(0, 200) };
  }
};

async function handle(event) {
  const { OPENID } = cloud.getWXContext();
  if (!ADMIN_OPENIDS.includes(OPENID)) return { ok: false, err: '无权限操作' };

  const category = String(event.category || '');
  const title = String(event.title || '').trim();
  const sourceOfTruth = String(event.sourceOfTruth || '').trim();
  const deadline = Number(event.deadline);
  const spec = event.resolutionSpec;

  if (!CATEGORIES.includes(category)) return { ok: false, err: '分类不合法' };
  if (!title || title.length < 10) return { ok: false, err: '标题过短' };
  // 硬性约束 1：绝对二元性（标题必须二值化）
  if (!BINARY_WORDS.some(w => title.indexOf(w) >= 0)) {
    return { ok: false, err: '标题必须二值化（请使用“是否/能否/是否达到/是否超过”等表述），保证结果非此即彼' };
  }
  // 硬性约束 4：敏感红线
  const hit = SENSITIVE_WORDS.find(w => title.indexOf(w) >= 0);
  if (hit) return { ok: false, err: `标题涉及敏感红线（${hit}），禁止发布` };
  // 内容安全全链路：标题 / 断卦说明 / 用户可见文案统一过微信官方检测
  const titlePass = await securityCheck(title);
  if (!titlePass) return { ok: false, err: '标题包含敏感内容，禁止发布' };
  if (!sourceOfTruth) return { ok: false, err: '缺少断卦标准说明' };
  if (!deadline || deadline <= Date.now()) return { ok: false, err: '截止时间必须晚于当前时间' };
  if (deadline - Date.now() > 90 * 24 * 3600 * 1000) {
    return { ok: false, err: '截止时间过远（超过 90 天），预测周期过长，请调整' };
  }

  // 机读断卦规范校验
  //   - type=manual：事实型卦题，无需数值条件，运营在截止后人工录入官方断卦 + 铁证链接
  //   - type=api/weather：数值型卦题，必须带可执行的 condition
  //   - type=webpage：官方网页型卦题，按 regex/selector 提取结果字段后走 condition 判定
  // type 白名单：仅接受 resolver 适配器支持的 manual/api/weather/webpage，杜绝 web/scraper 等死类型
  const SOURCE_TYPES = ['manual', 'api', 'weather', 'webpage'];
  if (!spec || !spec.dataSource || !SOURCE_TYPES.includes(spec.dataSource.type)) {
    return { ok: false, err: '缺少 resolutionSpec（dataSource.type 仅支持 manual/api/weather/webpage）' };
  }
  if (spec.dataSource.type === 'manual') {
    if (!spec.humanReadable) return { ok: false, err: 'manual 类型必须提供 humanReadable 断卦说明' };
  } else {
    if (!spec.condition) return { ok: false, err: '缺少断卦条件 condition' };
    if (!OPERATORS.includes(spec.condition.operator)) return { ok: false, err: '断卦运算符反对' };
    if (spec.condition.value === undefined || spec.condition.value === null) return { ok: false, err: '断卦阈值缺失' };
    // 阈值类型白名单：数字或字符串；拒绝数组/对象/布尔（避免 evaluate 语义错乱导致恒 YES/NO）
    const cv = spec.condition.value;
    if (typeof cv !== 'number' && typeof cv !== 'string') {
      return { ok: false, err: '断卦阈值必须为数字或字符串' };
    }
    if (typeof cv === 'number' && !isFinite(cv)) return { ok: false, err: '断卦阈值必须是有限数字' };
    if (spec.dataSource.type === 'webpage') {
      // webpage 类型：url 必填；regex / selector 至少提供一个（都不配则按全文匹配）
      if (!String(spec.dataSource.url || '').trim()) return { ok: false, err: 'webpage 类型必须提供数据源 url' };
      if (spec.dataSource.regex && typeof spec.dataSource.regex !== 'string') return { ok: false, err: 'regex 必须为字符串' };
      if (spec.dataSource.selector && typeof spec.dataSource.selector !== 'string') return { ok: false, err: 'selector 必须为字符串' };
      if (!spec.dataSource.regex && !spec.dataSource.selector && !spec.dataSource.transform) {
        return { ok: false, err: 'webpage 类型至少配置 regex 或 selector（否则按全文匹配，请明确判定方式）' };
      }
    } else {
      const field = String(spec.dataSource.field || '').trim();
      if (!field || field.length > 100 || !/^[A-Za-z0-9_.\[\]']+$/.test(field)) {
        return { ok: false, err: '取值字段不合法（仅允许字母数字点号下划线方括号单引号，长度 ≤ 100）' };
      }
    }
  }

  // 可选：防信息套利的时间戳字段（数据源返回结果时间的点分路径）
  const timestampField = String(spec.dataSource.timestampField || '').trim();
  if (timestampField && !/^[A-Za-z0-9_.\[\]']{1,100}$/.test(timestampField)) {
    return { ok: false, err: 'timestampField 不合法（仅允许字母数字点号下划线方括号单引号）' };
  }

  // 可选：多源交叉验证 backupSources（类型白名单、url 必填、不得与主源同 url）
  const backupSources = Array.isArray(spec.backupSources) ? spec.backupSources.slice(0, 2) : [];
  for (const bs of backupSources) {
    if (!bs || !SOURCE_TYPES.slice(1).includes(bs.type)) {
      return { ok: false, err: 'backupSources 类型仅支持 api/weather/webpage' };
    }
    if (!String(bs.url || '').trim()) return { ok: false, err: 'backupSources 必须提供 url' };
    if (String(bs.url || '') === String(spec.dataSource.url || '')) {
      return { ok: false, err: 'backupSources 不得与主源使用同一 url' };
    }
    if (bs.type === 'api' && !String(bs.field || '').trim()) return { ok: false, err: 'backupSources(api) 必须提供 field' };
    if (bs.type === 'webpage' && !bs.regex && !bs.selector) return { ok: false, err: 'backupSources(webpage) 必须提供 regex 或 selector' };
  }

  // 可选：预期结果揭晓时刻（管理端复核队列排序/展示用；不影响判定逻辑）
  let expectedResultAt = 0;
  if (event.expectedResultAt !== undefined && event.expectedResultAt !== null && event.expectedResultAt !== '') {
    expectedResultAt = Number(event.expectedResultAt);
    if (!expectedResultAt || isNaN(expectedResultAt) || expectedResultAt <= deadline) {
      return { ok: false, err: 'expectedResultAt 必须晚于截止时间' };
    }
  }

  // 硬性约束 2：先注册、后发题——api/weather 类型必须引用注册表中的数据源，
  // 并提供可执行的 url / field / transform；断卦说明中不得同时出现多个数据源名称
  let knownSources = [];
  try {
    const dsRes = await db.collection('data_sources').limit(200).get();
    knownSources = dsRes.data || [];
  } catch (e) {
    return { ok: false, err: '数据源注册表不可用，请先初始化 data_sources 集合' };
  }
  const sourceType = spec.dataSource.type;
  const sourceName = String(spec.dataSource.name || spec.dataSource.provider || '').trim();
  const sourceUrl = String(spec.dataSource.url || '').trim();
  if (sourceType !== 'manual') {
    const matched = knownSources.some(s =>
      (sourceName && (s.name === sourceName || (s._id || s.id) === sourceName)) ||
      (sourceUrl && s.url === sourceUrl)
    );
    if (!matched) {
      return { ok: false, err: `数据源未注册：请先在数据源注册表登记「${sourceName || sourceUrl || sourceType}」` };
    }
    if (!sourceUrl) return { ok: false, err: 'api/weather/webpage 类型必须提供数据源 url' };
    if (sourceType === 'api' || sourceType === 'weather') {
      if (!String(spec.dataSource.field || '').trim()) return { ok: false, err: 'api/weather 类型必须提供取值字段 field' };
      if (!TRANSFORMS.includes(spec.dataSource.transform)) return { ok: false, err: 'transform 仅附议 int / float / string' };
    } else if (!TRANSFORMS.includes(spec.dataSource.transform) && spec.dataSource.transform) {
      return { ok: false, err: 'transform 仅附议 int / float / string' };
    }
  }
  if (spec.humanReadable) {
    const hr = String(spec.humanReadable);
    const hitNames = knownSources.filter(s => s.name && hr.indexOf(s.name) >= 0).map(s => s.name);
    if (hitNames.length > 1) {
      return { ok: false, err: `断卦说明出现多个数据源（${hitNames.join('、')}），只能指定一个结卦源` };
    }
  }

  if (spec.humanReadable) {
    const hrPass = await securityCheck(String(spec.humanReadable).slice(0, 500));
    if (!hrPass) return { ok: false, err: '断卦说明包含敏感内容，请修改后发布' };
  }
  if (sourceOfTruth) {
    const stPass = await securityCheck(sourceOfTruth.slice(0, 500));
    if (!stPass) return { ok: false, err: '断卦标准说明包含敏感内容，请修改后发布' };
  }
  const doc = {
    category,
    title,
    sourceOfTruth: spec.humanReadable || sourceOfTruth,
    deadline,
    expectedResultAt: expectedResultAt || 0, // 预期结果揭晓时刻（可选，复核队列排序用）
    yesPool: 0,
    noPool: 0,
    totalPool: 0, // 冗余字段：热门榜按此索引排序（应卦/对弈 时原子维护）
    status: 'open',
    result: null,
    evidenceUrl: '',
    hasDispute: false,
    disputeCount: 0,
    resolutionSpec: spec,
    resolutionMethod: '',
    resolutionAttempts: 0,
    needsManualReview: false,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };

  const r = await db.collection('markets').add({ data: doc });
  return { ok: true, marketId: r._id };
};
