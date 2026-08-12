const cloud = require('wx-server-sdk');

// 业务常量单一来源（cloudfunctions/_shared/config.js，npm run sync:common 同步）
const { AVATARS } = require('./common-config');
const NICKNAME_MAX_LEN = 12;
const SENSITIVE_WORDS = [
  '傻逼', '煞笔', '妈逼', '操你', '草你', '你妈', '贱人', '狗逼', '脑残',
  '垃圾', '滚蛋', '去死', '死全家', '嫖娼', '卖淫', '赌博', '博彩', '下注',
  'fuck', 'shit', 'bitch', 'porn', 'nigger', 'cunt'
];
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const INJECTION_RE = /[<>`\\]|javascript\s*:|on\w+\s*=|alert\s*\(|<script|%3c|%3e|\{\{|\}\}|\[\[|\]\]/i;

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function validateNickname(name) {
  const value = String(name == null ? '' : name).trim();
  if (!value) return { ok: false, err: '道号不能为空' };
  if (value.length > NICKNAME_MAX_LEN) return { ok: false, err: `道号不能超过 ${NICKNAME_MAX_LEN} 个字` };
  if (CONTROL_RE.test(value)) return { ok: false, err: '道号包含非法控制字符' };
  if (INJECTION_RE.test(value)) return { ok: false, err: '道号包含不允许的字符（< > 引号 脚本等）' };
  const lower = value.toLowerCase();
  for (let i = 0; i < SENSITIVE_WORDS.length; i++) {
    if (lower.indexOf(SENSITIVE_WORDS[i]) >= 0) return { ok: false, err: '道号包含敏感词汇，请更换' };
  }
  return { ok: true, value };
}

// 叠加微信官方内容安全检测；未开通云调用时自动回退到本地黑名单
async function securityCheck(content) {
  try {
    const r = await cloud.openapi.security.msgSecCheck({ content });
    const suggest = r && r.result && r.result.suggest;
    return suggest === 'pass' || !suggest;
  } catch (e) {
    // 云调用不可用时回退本地词表（validateNickname 已先拦截一次，这里双保险）
    const lower = String(content).toLowerCase();
    return !SENSITIVE_WORDS.some(w => lower.indexOf(w) >= 0);
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const data = { updatedAt: db.serverDate() };

  if (event.nickname !== undefined) {
    const check = validateNickname(event.nickname);
    if (!check.ok) return { ok: false, err: check.err };
    const pass = await securityCheck(check.value);
    if (!pass) return { ok: false, err: '道号包含敏感内容，请更换' };
    data.nickname = check.value;
  }
  if (event.avatarUrl !== undefined) {
    data.avatarUrl = String(event.avatarUrl || '').slice(0, 500);
  }
  if (event.avatar !== undefined) {
    const avatar = String(event.avatar || '');
    if (!AVATARS.includes(avatar)) return { ok: false, err: '头像不合法，只能选择系统预设头像' };
    data.avatar = avatar;
  }
  if (event.title !== undefined) {
    // 佩戴的称号必须来自已解锁卦勋（user.honors），防止任意伪造头衔
    const title = String(event.title || '').slice(0, 64);
    if (title) {
      const u = (await db.collection('users').doc(OPENID).get()).data;
      const honors = (u && u.honors) || [];
      if (honors.indexOf(title) < 0) {
        return { ok: false, err: '尚未解锁该卦勋，无法佩戴' };
      }
    }
    data.title = title;
  }

  await db.collection('users').doc(OPENID).update({
    data
  });
  const res = await db.collection('users').doc(OPENID).get();
  return { ok: true, user: res.data };
};
