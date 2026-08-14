const cloud = require('wx-server-sdk');

// 管理员 openid（部署时在云函数环境变量配置 ADMIN_OPENIDS，逗号分隔；空 = 仅 Mock 可进后台）
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const TYPES = ['api', 'web', 'manual', 'scraper', 'webpage'];
const STATUS = ['verified', 'trial', 'pending', 'frozen'];
// 本地兜底词表：msgSecCheck 不可用（云调用未开通/异常）时降级使用，避免 fail-open
const LOCAL_SENSITIVE_WORDS = [
  '选举', '大选', '总统', '议会', '国会', '审判', '开庭', '判决', '起诉', '立案', '庭审',
  '游行', '抗议', '罢工', '骚乱', '示威', '聚集', '疫情', '封控', '确诊', '公共卫生卦题',
  '赌博', '博彩', '下注', '投注', '赔率', '毒品', '冰毒', '海洛因', '枪支', '恐怖袭击',
  '台独', '港独', '藏独', '疆独', '法轮功', '颠覆', '暴动', '政变', '裸聊', '援交', '色情'
];

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 微信官方内容安全检测（数据源名称/备注展示给运营与用户，需过检）；未开通云调用时回退本地词表
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
    console.error('[upsertDataSource] 异常', e && e.message || e);
    return { ok: false, err: String((e && e.message) || e).slice(0, 200) };
  }
};

async function handle(event) {
  const { OPENID } = cloud.getWXContext();
  if (!ADMIN_OPENIDS.includes(OPENID)) return { ok: false, err: '无权限操作' };

  const id = String(event.id || '').trim();
  const name = String(event.name || '').trim();
  if (!name) return { ok: false, err: '名称不能为空' };
  if (name.length > 50) return { ok: false, err: '数据源名称过长（最多 50 字）' };
  const notes = String(event.notes || '').slice(0, 500);

  // 内容安全：名称与备注统一过检
  const nameOk = await securityCheck(name);
  if (!nameOk) return { ok: false, err: '数据源名称包含敏感内容，请修改' };
  if (notes) {
    const notesOk = await securityCheck(notes);
    if (!notesOk) return { ok: false, err: '数据源备注包含敏感内容，请修改' };
  }

  const doc = {
    name,
    category: String(event.category || '全品类'),
    type: TYPES.includes(event.type) ? event.type : 'api',
    access: String(event.access || 'free'),
    url: String(event.url || '').slice(0, 500),
    notes,
    status: STATUS.includes(event.status) ? event.status : 'trial',
    updatedAt: db.serverDate()
  };

  if (id) {
    let exist = null;
    try {
      exist = (await db.collection('data_sources').doc(id).get()).data;
    } catch (e) { /* 不存在则新建 */ }
    if (exist) {
      await db.collection('data_sources').doc(id).update({ data: doc });
    } else {
      await db.collection('data_sources').doc(id).set({ data: Object.assign({ createdAt: db.serverDate() }, doc) });
    }
  } else {
    await db.collection('data_sources').add({ data: Object.assign({ createdAt: db.serverDate() }, doc) });
  }

  const res = await db.collection('data_sources').limit(200).get();
  return { ok: true, list: res.data };
};
