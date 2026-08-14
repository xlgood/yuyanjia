// =========================================================
// 微信广告「激励视频服务端奖励回调」（SSV）
// 接入步骤（见 docs/部署检查清单.md）：
//   1. 云开发控制台开通「HTTP 访问服务」，把本函数暴露为 HTTP 触发器，得到回调 URL
//   2. 流量主后台 → 广告管理 → 激励广告 → 服务端奖励回调入口 → 开启并填写
//      URL / Token / EncodingAESKey
//   3. 本函数配置环境变量：AD_SSV_TOKEN、AD_SSV_ENCODING_AES_KEY、
//      AD_SSV_REWARD_ITEM（默认 energy）
//   4. 小程序端播放前调用 setServerSideVerificationData（基础库 >= 3.10.3）
// 协议：URL 校验 GET（验签后原样返回 echostr）；真实回调 POST
//      （token+timestamp+nonce+encrypt 字典序拼接 sha256 验签；
//       encrypt URL 解码后取前 16 字节为 IV，AES-256-CBC/对弈CS7 解密）。
// 奖励发放与每日限额原子处理，transaction_id 去重，回调幂等。
// 说明：本函数同时兼容云开发 HTTP 触发器与 callFunction 两种调用形态（联调用）。
// =========================================================
const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 业务常量单一来源：cloudfunctions/_shared/config.js
const { AD_TASK_POINTS, AD_TASK_LIMIT } = require('./common-config');
const TOKEN = process.env.AD_SSV_TOKEN || '';
const ENCODING_AES_KEY = process.env.AD_SSV_ENCODING_AES_KEY || '';
const REWARD_ITEM = process.env.AD_SSV_REWARD_ITEM || 'energy';

function todayKey() {
  const t = Date.now() + 8 * 3600 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// 微信广告服务端验证签名：token/timestamp/nonce（真实回调含 encrypt）
// 字典序排序后拼接，sha256 十六进制
function verifySignature(params) {
  const { signature, timestamp, nonce, encrypt } = params;
  if (!signature || !timestamp || !nonce || !TOKEN) return false;
  const parts = [TOKEN, String(timestamp), String(nonce)];
  if (encrypt) parts.push(String(encrypt));
  parts.sort();
  return sha256Hex(parts.join('')) === String(signature);
}

// 解密 encrypt：EncodingAESKey 尾部补一个 "=" 后 Base64 解码为 32 字节 AESKey；
// encrypt URL 解码后前 16 字节为 IV，其余为密文，AES-256-CBC + 对弈CS7
function decryptEncrypt(encrypt) {
  if (!encrypt || !ENCODING_AES_KEY) return null;
  // 微信 EncodingAESKey 为 43 位 base64，尾部补一个 "=" 解码为 32 字节；
  // 兼容用户直接粘贴了带 "=" 的 44 位形式
  const key = Buffer.from(ENCODING_AES_KEY.replace(/=+$/, '') + '=', 'base64');
  if (key.length !== 32) return null;
  let decoded;
  try {
    decoded = Buffer.from(decodeURIComponent(encrypt), 'base64');
  } catch (e) {
    decoded = Buffer.from(encrypt, 'base64');
  }
  if (!decoded || decoded.length <= 16) return null;
  const iv = decoded.slice(0, 16);
  const data = decoded.slice(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  try {
    const out = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(out.toString('utf8'));
  } catch (e) {
    return null;
  }
}

// 解密 payload 内层防篡改校验（纵深防御）：
// 解密后的 JSON 含 sign 字段，是对 token 与业务字段
// （user_id/transaction_id/reward_amount/reward_item/custom_data）的签名——
// 与外层 URL 校验同款「字典序排序拼接 + sha256」风格，依据微信官方
// 《激励广告服务端验证接入指引》。由 AD_SSV_VERIFY_SIGN 控制（默认 true）；
// 若与官方最新文档有出入，可置 false 关闭并按官方文档校准。
function verifyInnerSign(info) {
  if (String(process.env.AD_SSV_VERIFY_SIGN || 'true') !== 'true') return true;
  if (!info || !info.sign) return false;
  const parts = [TOKEN, info.user_id, info.transaction_id, info.reward_amount, info.reward_item, info.custom_data]
    .map(v => (v === undefined || v === null ? '' : String(v)));
  parts.sort();
  return sha256Hex(parts.join('')) === String(info.sign);
}

// 原子发放观演修行奖励：transaction_id 去重 + 每日限次 + 发放爻在同一事务内完成，
// 并发或重试时只有一次生效；事务冲突时 wx-server-sdk 自动重试（默认 3 次）
async function grantAdReward(userId, transactionId, amount) {
  try {
    await db.runTransaction(async t => {
      const dedupRef = t.collection('ad_rewards').doc(String(transactionId));
      let existing = null;
      try {
        existing = (await dedupRef.get()).data;
      } catch (e) { /* 首次处理 */ }
      if (existing) return; // 同一交易已处理过，幂等返回

      const userRef = t.collection('users').doc(userId);
      let user = null;
      try {
        user = (await userRef.get()).data;
      } catch (e) { throw new Error('用户不存在'); }
      if (!user) throw new Error('用户不存在');

      const today = todayKey();
      const count = user.adTaskDate === today ? (user.adTaskCount || 0) : 0;
      if (count >= AD_TASK_LIMIT) {
        await dedupRef.set({ data: { userId, amount, granted: false, createdAt: db.serverDate() } });
        return;
      }

      await userRef.update({
        data: {
          points: _.inc(amount),
          weekPoints: _.inc(amount),
          monthPoints: _.inc(amount),
          adTaskDate: today,
          adTaskCount: count + 1,
          updatedAt: db.serverDate()
        }
      });
      await dedupRef.set({ data: { userId, amount, granted: true, createdAt: db.serverDate() } });
    });
    return true;
  } catch (e) {
    console.error('广告回调发放失败', userId, transactionId, e.message || e);
    return false;
  }
}

exports.main = async (event) => {
  // 兼容云开发 HTTP 触发器与 callFunction 两种卦题形态
  const httpMethod = String(event.httpMethod || event.method || '').toUpperCase();
  const query = event.queryStringParameters || event.query || {};

  // URL 校验（GET）：验签通过后原样返回 echostr
  const echostr = event.echostr || query.echostr || '';
  if (echostr && (httpMethod === 'GET' || !httpMethod)) {
    const sig = event.signature || query.signature || '';
    const ts = event.timestamp || query.timestamp || '';
    const nonce = event.nonce || query.nonce || '';
    return { echostr: verifySignature({ signature: sig, timestamp: ts, nonce, encrypt: '' }) ? String(echostr) : '' };
  }

  // 真实回调（POST）
  let params = event;
  if (!event.signature && event.body) {
    try {
      params = JSON.parse(event.body);
    } catch (e) {
      return { is_valid: false };
    }
  }
  if (!verifySignature(params)) return { is_valid: false };

  const info = decryptEncrypt(params.encrypt);
  if (!info) return { is_valid: false };

  // 内层签名校验（外层验签保证回调来自微信，内层防解密后字段被篡改）
  if (!verifyInnerSign(info)) {
    console.warn('[adRewardCallback] 内层签名校验失败', String(info.user_id || '').slice(0, 40), String(info.transaction_id || '').slice(0, 40));
    return { is_valid: false };
  }

  const userId = String(info.user_id || '');
  const transactionId = String(info.transaction_id || '');
  // 发放金额只信服务端常量：reward_amount 来自客户端 setServerSideVerificationData 透传，
  // 改包可伪造，仅作存在性校验，不作为发放依据
  const clientAmount = Number(info.reward_amount) || 0;
  if (!userId || clientAmount <= 0 || transactionId.length < 8) return { is_valid: false };
  if (info.reward_item && String(info.reward_item) !== REWARD_ITEM) return { is_valid: false };

  await grantAdReward(userId, transactionId, AD_TASK_POINTS);
  return { is_valid: true };
};
