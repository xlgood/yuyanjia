const cloud = require('wx-server-sdk');

// 业务常量单一来源：cloudfunctions/_shared/config.js（npm run sync:common 同步）
const { INIT_POINTS, INVITE_INVITER_POINTS, INVITE_INVITEE_POINTS } = require('./common-config');
// 邀友奖励附议环境变量覆盖（login/placeBet/inviteStats 共用同一组环境变量）
const INVITEE_POINTS = Number(process.env.INVITE_INVITEE_POINTS) || INVITE_INVITEE_POINTS; // 被邀友人新人礼加成
const INVITER_POINTS = Number(process.env.INVITE_INVITER_POINTS) || INVITE_INVITER_POINTS; // 邀友人奖励（首次应卦后发放，见 placeBet）
// 每日计次上限 INVITE_DAILY_CAP 由 placeBet 在实际发奖时校验，本函数不再占用名额

// 卦勋检测节流：login 被高频调用（app 启动 + 页面 onShow 刷新），而 checkHonors 内部
// 含多次 count + 排名快照扫描，每次都跑成本过高。间隔内直接跳过；
// 卦勋墙页保留手动「检测」入口（checkHonors 直调）作为即时解锁兜底。
const HONORS_CHECK_INTERVAL_MS = (Number(process.env.HONORS_CHECK_INTERVAL_MINUTES) || 10) * 60 * 1000;

// 不透明邀友码：8 位随机（排除易混淆字符 0/O/1/I/l），分享时对外使用，
// 避免把 openid 直接暴露在分享链接/聊天记录/服务器日志中
const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const INVITE_CODE_LEN = 8;

function genInviteCode() {
  let s = '';
  for (let i = 0; i < INVITE_CODE_LEN; i++) {
    s += INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)];
  }
  return s;
}

// 生成全局唯一邀友码（查重，碰撞则重试，最多 5 次）
async function ensureUniqueInviteCode(users) {
  for (let i = 0; i < 5; i++) {
    const code = genInviteCode();
    try {
      const dup = await users.where({ inviteCode: code }).count();
      if (!dup.total) return code;
      // 碰撞：继续下一轮重试
    } catch (e) {
      // 集合/索引异常：直接返回，容忍小概率碰撞（登录时还有惰性补齐兜底）
      return code;
    }
  }
  return genInviteCode();
}

// 解析邀友参数：优先按 inviteCode 反查邀请人；反查不到时兼容旧链接
// （旧版本分享参数直接携带 openid），按 openid 直查。
// 在事务外执行（纯读操作），避免事务内做 where 查询。
async function resolveInviter(users, rawInvite, OPENID) {
  const code = String(rawInvite || '').slice(0, 64);
  if (!code || code === OPENID) return '';
  try {
    const byCode = await users.where({ inviteCode: code }).limit(1).get();
    if (byCode.data.length && byCode.data[0]._id !== OPENID) return byCode.data[0]._id;
  } catch (e) { /* 查询异常走回退 */ }
  // 兼容旧链接：参数即 openid
  try {
    const byOpenid = (await users.doc(code).get()).data;
    if (byOpenid && byOpenid._id !== OPENID) return byOpenid._id;
  } catch (e) { /* 不存在：静默忽略 */ }
  return '';
}

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, err: '获取用户身份失败' };

  const users = db.collection('users');
  const inviteCode = String((event && event.invite) || '').slice(0, 64);
  try {
    const res = await users.doc(OPENID).get();
    let unlockedHonors = [];
    // 存量用户惰性补发邀友码（无迁移脚本，首次登录/分享自动补齐）
    if (res.data && !res.data.inviteCode) {
      const code = await ensureUniqueInviteCode(users);
      await users.doc(OPENID).update({ data: { inviteCode: code, updatedAt: db.serverDate() } });
      res.data.inviteCode = code;
    }
    if (Date.now() - ((res.data && res.data.honorsCheckedAt) || 0) >= HONORS_CHECK_INTERVAL_MS) {
      try {
        const hr = await cloud.callFunction({ name: 'checkHonors', data: {} });
        if (hr.result && hr.result.ok) unlockedHonors = hr.result.unlocked || [];
        await users.doc(OPENID).update({ data: { honorsCheckedAt: Date.now() } });
      } catch (e) { /* 卦勋检查失败不影响登录 */ }
    }
    return { ok: true, user: res.data, unlockedHonors };
  } catch (e) {
    // 用户不存在：创建档案（事务内完成，用户 _id 即 openid，方便事务与查询）
    const user = {
      nickname: '卦中新客',
      avatarUrl: '',
      avatar: '🔮',
      points: INIT_POINTS,
      streak: 0,
      bestStreak: 0,
      weekPoints: INIT_POINTS,
      monthPoints: INIT_POINTS,
      totalPoints: 0,
      lastReliefAt: 0,
      lastCheckInDate: '',
      checkInStreak: 0,
      checkInTotal: 0,
      adTaskDate: '',
      adTaskCount: 0,
      avatarFrame: '',
      title: '',
      badges: [],
      honors: [],
      // 邀友裂变字段
      inviteCode: '',
      invitedBy: '',
      inviteRewarded: false,
      inviteCount: 0,
      inviteRewardDate: '',
      inviteRewardToday: 0,
      // 对弈 对战字段
      pkOpen: true,
      pkWins: 0,
      pkLosses: 0,
      // 公断发起冷却（事务内 CAS，防并发双创建）
      lastArbAt: 0,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    };

    let inviteBonus = 0;
    let inviteFrom = '';

    // 邀友归属解析与邀友码生成放事务外（纯读 + 随机，避免事务内 where 查询）
    inviteFrom = await resolveInviter(users, inviteCode, OPENID);
    const myCode = await ensureUniqueInviteCode(users);

    try {
      await db.runTransaction(async t => {
        // 事务冲突重试时先复查，避免重复创建
        let existing = null;
        try {
          existing = (await t.collection('users').doc(OPENID).get()).data;
        } catch (e2) { /* 不存在 */ }
        if (existing) return;

        // 被邀友人新人礼加成随档案一并落库（points 与周/月榜同步加成，
        // 避免「响应 110 / 落库 100」不一致导致重登后余额跳变、按 110 下注被拒）
        await t.collection('users').doc(OPENID).set({
          data: Object.assign({}, user, {
            inviteCode: myCode,
            invitedBy: inviteFrom,
            points: INIT_POINTS + (inviteFrom ? INVITEE_POINTS : 0),
            weekPoints: INIT_POINTS + (inviteFrom ? INVITEE_POINTS : 0),
            monthPoints: INIT_POINTS + (inviteFrom ? INVITEE_POINTS : 0)
          })
        });

        // 记录邀友关系（invites._id = inviter_openid 天然去重）
        if (inviteFrom) {
          await t.collection('invites').doc(`${inviteFrom}_${OPENID}`).set({
            data: {
              inviterId: inviteFrom,
              inviteeId: OPENID,
              inviteeNickname: user.nickname,
              rewardToInviter: INVITER_POINTS,
              inviterRewarded: false,
              source: 'friend',
              createdAt: db.serverDate(),
              updatedAt: db.serverDate()
            }
          });
        }
      });
    } catch (e4) {
      console.error('注册事务失败', OPENID, e4.message || e4);
      return { ok: false, err: '注册失败，请稍后重试' };
    }

    // 事务已把新人礼加成落库（含 points），这里同步返回对象的展示口径
    if (inviteFrom) {
      user.invitedBy = inviteFrom;
      user.points = INIT_POINTS + INVITEE_POINTS;
      inviteBonus = INVITEE_POINTS;
    }

    return {
      ok: true,
      user: Object.assign({}, user, {
        _id: OPENID,
        inviteBonus,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }),
      unlockedHonors: []
    };
  }
};
