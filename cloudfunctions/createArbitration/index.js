const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 业务常量单一来源：cloudfunctions/_shared/config.js
const {
  VOTE_BOND_MIN,
  ACTIVE_ARBITRATION_LIMIT: ACTIVE_LIMIT,
  ARBITRATION_WINDOW_MS,
  ARBITRATION_MIN_PARTICIPANTS: MIN_PARTICIPANTS,
  ARBITRATION_COOLDOWN_MS: COOLDOWN_MS
} = require('./common-config');

// 公断理由校验（与前端 validate.js 保持一致）
const REASON_MIN_LEN = 10;
const REASON_MAX_LEN = 200;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const INJECTION_RE = /[<>`\\]|javascript\s*:|on\w+\s*=|alert\s*\(|<script|%3c|%3e|\{\{|\}\}|\[\[|\]\]/i;
const SENSITIVE_WORDS = [
  '傻逼', '煞笔', '妈逼', '操你', '草你', '你妈', '贱人', '狗逼', '脑残',
  '垃圾', '滚蛋', '去死', '死全家', '嫖娼', '卖淫', '赌博', '博彩', '下注',
  '毒品', '冰毒', '海洛因', '摇头丸', '大麻', '贩毒', '吸毒',
  '枪支', '枪杀', '爆炸物', '恐怖', '恐怖袭击', '杀人', '强奸', '轮奸', '色情', '裸聊', '援交',
  '台独', '港独', '藏独', '疆独', '法轮功', '推翻', '颠覆', '暴动', '政变',
  'fuck', 'shit', 'bitch', 'porn', 'nigger', 'cunt'
];

// 微信官方内容安全检测（政治/色情/赌博/毒品等全量），未开通云调用时回退本地词表
async function securityCheck(content) {
  try {
    const r = await cloud.openapi.security.msgSecCheck({ content });
    const suggest = r && r.result && r.result.suggest;
    return suggest === 'pass' || !suggest;
  } catch (e) {
    // 云调用不可用时回退本地词表（validateReason 已先拦截一次，这里双保险）
    const lower = String(content).toLowerCase();
    return !SENSITIVE_WORDS.some(w => lower.indexOf(w) >= 0);
  }
}

function validateReason(reason) {
  const value = String(reason == null ? '' : reason).trim();
  if (!value) return { ok: false, err: '请填写公断理由' };
  if (value.length < REASON_MIN_LEN) return { ok: false, err: `公断理由至少 ${REASON_MIN_LEN} 个字` };
  if (value.length > REASON_MAX_LEN) return { ok: false, err: `公断理由不能超过 ${REASON_MAX_LEN} 个字` };
  if (CONTROL_RE.test(value)) return { ok: false, err: '理由包含非法控制字符' };
  if (INJECTION_RE.test(value)) return { ok: false, err: '理由包含不允许的字符（< > 引号 脚本等）' };
  const lower = value.toLowerCase();
  for (let i = 0; i < SENSITIVE_WORDS.length; i++) {
    if (lower.indexOf(SENSITIVE_WORDS[i]) >= 0) return { ok: false, err: '理由包含敏感词汇，请修改' };
  }
  return { ok: true, value };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const marketId = String(event.marketId || '');
  const reasonCheck = validateReason(event.reason);
  if (!reasonCheck.ok) return { ok: false, err: reasonCheck.err };
  // 微信官方内容安全（政治/黄赌毒等），本地词表之外的第二道防线
  const secPass = await securityCheck(reasonCheck.value);
  if (!secPass) return { ok: false, err: '理由包含敏感内容，请修改' };
  if (!marketId) return { ok: false, err: '缺少卦题 ID' };

  try {
    // 资格/门槛/唯一性检查放事务外（官方文档：事务仅附议单记录操作），
    // 事务内保留 doc 级校验（market.status / user.points）保证核心一致性
    const participantCount = (await db.collection('bets').where({ marketId }).count()).total;
    const settledBets = (await db.collection('bets').where({ openid: OPENID, status: _.in(['won', 'lost', 'refunded']) }).count()).total;
    const settledPks = (await db.collection('pks').where({ status: 'settled', participantIds: OPENID }).count()).total;
    const activeArbRes = await db.collection('arbitrations')
      .where({ marketId, status: 'pending' })
      .limit(1)
      .get();
    const myActiveRes = await db.collection('arbitrations')
      .where({ status: 'pending', 'challenger.openid': OPENID })
      .count();
    const lastArbRes = await db.collection('arbitrations')
      .where({ 'challenger.openid': OPENID })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    const result = await db.runTransaction(async t => {
      const marketRef = t.collection('markets').doc(marketId);
      let market;
      try {
        market = (await marketRef.get()).data;
      } catch (e) {
        throw new Error('卦题不存在');
      }
      if (market.status !== 'dispute_window') {
        throw new Error('当前不在断卦公示期，无法发起公断');
      }
      if (market.needsManualReview) {
        throw new Error('该卦题已停止接收应卦');
      }

      // 参与人数门槛：该事件应卦人数 ≥ 10
      if (participantCount < MIN_PARTICIPANTS) {
        throw new Error(`该事件应卦人数不足 ${MIN_PARTICIPANTS} 人，暂反对社区公断`);
      }

      const userRef = t.collection('users').doc(OPENID);
      const user = (await userRef.get()).data;
      if (!user) throw new Error('用户不存在');

      // 附议资格：已结卦应卦 ≥ 5 或 已结卦 对弈 ≥ 3（won/lost/refunded 均算已结卦）
      if (settledBets < 5 && settledPks < 3) {
        throw new Error('公断参与资格：需已结卦应卦 ≥ 5 次或已结卦 对弈 ≥ 3 场');
      }

      // 保证金：锁定当前爻 100%
      const bond = user.points;
      if (bond < VOTE_BOND_MIN) throw new Error(`爻不足，发起公断需要至少 ${VOTE_BOND_MIN} 爻`);

      // 同一事件已存在进行中的公断
      if (activeArbRes.data.length) throw new Error('该事件已有进行中的公断');

      // 同时参与上限 + 发起冷却
      if (myActiveRes.total >= ACTIVE_LIMIT) throw new Error('您同时只能参与 1 个公断');
      // 发起冷却：距上次发起（无论是否已结卦）不足 24 小时则拒绝，
      // 不再依赖 pending 状态（原判断与“同时只能参与 1 个公断”重复，实际永不触发）
      if (lastArbRes.data.length && Date.now() - (lastArbRes.data[0].createdAt || 0) < COOLDOWN_MS) {
        throw new Error('24 小时内只能发起 1 次公断');
      }

      const arbId = 'ARB' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
      const nowTs = Date.now();
      const arb = {
        _id: arbId,
        marketId,
        marketTitle: market.title,
        reason: reasonCheck.value,
        challenger: {
          openid: OPENID,
          nickname: user.nickname || '卦中新客',
          avatar: user.avatar || '🔮',
          bond
        },
        challengerBond: bond,
        supportPool: bond,
        opposePool: 0,
        supportVotes: 0,
        opposeVotes: 0,
        participantCount,
        minVotes: Math.max(Math.ceil(participantCount * 0.1), 2),
        status: 'pending',
        winner: '',
        createdAt: nowTs,
        endsAt: nowTs + ARBITRATION_WINDOW_MS,
        updatedAt: db.serverDate()
      };
      await t.collection('arbitrations').doc(arbId).set({ data: arb });
      // 发起人默认投附议票（保证金计入附议池）
      await t.collection('arbitration_votes').doc(`${arbId}_${OPENID}`).set({
        data: {
          arbitrationId: arbId,
          marketId,
          openid: OPENID,
          side: 'support',
          bond,
          isChallenger: true,
          createdAt: db.serverDate()
        }
      });
      await userRef.update({ data: { points: _.inc(-bond), updatedAt: db.serverDate() } });
      await marketRef.update({ data: { status: 'arbitration_window', arbitrationId: arbId, updatedAt: db.serverDate() } });

      return { ok: true, arbitration: Object.assign({}, arb, { _id: arbId, createdAt: nowTs, endsAt: nowTs + ARBITRATION_WINDOW_MS }) };
    });
    return result;
  } catch (e) {
    return { ok: false, err: e.message || '发起公断失败' };
  }
};
