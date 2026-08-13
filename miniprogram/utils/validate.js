// 雅号等用户输入的前后端共用校验
const {
  NICKNAME_MAX_LEN, SENSITIVE_WORDS,
  ARBITRATION_REASON_MIN_LEN, ARBITRATION_REASON_MAX_LEN,
  ARBITRATION_SENSITIVE_WORDS
} = require('./constants');

const CONTROL_RE = /[\u0000-\u001f\u007f]/;
// 拦截 HTML/JS 注入与脚本特征
const INJECTION_RE = /[<>`\\]|javascript\s*:|on\w+\s*=|alert\s*\(|<script|%3c|%3e|\{\{|\}\}|\[\[|\]\]/i;

function validateNickname(name) {
  const value = String(name == null ? '' : name).trim();
  if (!value) return { ok: false, err: '雅号不能为空' };
  if (value.length > NICKNAME_MAX_LEN) {
    return { ok: false, err: `雅号不能超过 ${NICKNAME_MAX_LEN} 个字` };
  }
  if (CONTROL_RE.test(value)) return { ok: false, err: '雅号包含非法控制字符' };
  if (INJECTION_RE.test(value)) {
    return { ok: false, err: '雅号包含不允许的字符（< > 引号 脚本等）' };
  }
  const lower = value.toLowerCase();
  for (let i = 0; i < SENSITIVE_WORDS.length; i++) {
    if (lower.indexOf(SENSITIVE_WORDS[i]) >= 0) {
      return { ok: false, err: '雅号包含敏感词汇，请更换' };
    }
  }
  return { ok: true, value };
}

function validateArbitrationReason(reason) {
  const value = String(reason == null ? '' : reason).trim();
  if (!value) return { ok: false, err: '请填写公断理由' };
  if (value.length < ARBITRATION_REASON_MIN_LEN) {
    return { ok: false, err: `公断理由至少 ${ARBITRATION_REASON_MIN_LEN} 个字` };
  }
  if (value.length > ARBITRATION_REASON_MAX_LEN) {
    return { ok: false, err: `公断理由不能超过 ${ARBITRATION_REASON_MAX_LEN} 个字` };
  }
  if (CONTROL_RE.test(value)) return { ok: false, err: '理由包含非法控制字符' };
  if (INJECTION_RE.test(value)) {
    return { ok: false, err: '理由包含不允许的字符（< > 引号 脚本等）' };
  }
  const lower = value.toLowerCase();
  for (let i = 0; i < ARBITRATION_SENSITIVE_WORDS.length; i++) {
    if (lower.indexOf(ARBITRATION_SENSITIVE_WORDS[i]) >= 0) {
      return { ok: false, err: '理由包含敏感词汇，请修改' };
    }
  }
  return { ok: true, value };
}

module.exports = { validateNickname, validateArbitrationReason, CONTROL_RE, INJECTION_RE };
