const cloud = require('wx-server-sdk');

const INIT_POINTS = 1000;
// 邀请奖励配置：三个函数（login/placeBet/inviteStats）共用同一组环境变量，缺省值保持一致
const INVITEE_POINTS = Number(process.env.INVITE_INVITEE_POINTS) || 100; // 被邀请人新手加成
const INVITER_POINTS = Number(process.env.INVITE_INVITER_POINTS) || 50;  // 邀请人奖励（首次表态后发放，见 placeBet）
// 每日计次上限 INVITE_DAILY_CAP 由 placeBet 在实际发奖时校验，本函数不再占用名额

// 荣誉检测节流：login 被高频调用（app 启动 + 页面 onShow 刷新），而 checkHonors 内部
// 含多次 count + 排名快照扫描，每次都跑成本过高。间隔内直接跳过；
// 荣誉墙页保留手动「检测」入口（checkHonors 直调）作为即时解锁兜底。
const HONORS_CHECK_INTERVAL_MS = (Number(process.env.HONORS_CHECK_INTERVAL_MINUTES) || 10) * 60 * 1000;

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
    if (Date.now() - ((res.data && res.data.honorsCheckedAt) || 0) >= HONORS_CHECK_INTERVAL_MS) {
      try {
        const hr = await cloud.callFunction({ name: 'checkHonors', data: {} });
        if (hr.result && hr.result.ok) unlockedHonors = hr.result.unlocked || [];
        await users.doc(OPENID).update({ data: { honorsCheckedAt: Date.now() } });
      } catch (e) { /* 荣誉检查失败不影响登录 */ }
    }
    return { ok: true, user: res.data, unlockedHonors };
  } catch (e) {
    // 用户不存在：创建档案（事务内完成，用户 _id 即 openid，方便事务与查询）
    const user = {
      nickname: '预言新人',
      avatarUrl: '',
      avatar: '🔮',
      points: INIT_POINTS,
      streak: 0,
      bestStreak: 0,
      weekPoints: 0,
      monthPoints: 0,
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
      // 邀请裂变字段
      invitedBy: '',
      inviteRewarded: false,
      inviteCount: 0,
      inviteRewardDate: '',
      inviteRewardToday: 0,
      // PK 对战字段
      pkOpen: true,
      pkWins: 0,
      pkLosses: 0,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    };

    let inviteBonus = 0;
    let inviteFrom = '';

    try {
      await db.runTransaction(async t => {
        // 事务冲突重试时先复查，避免重复创建
        let existing = null;
        try {
          existing = (await t.collection('users').doc(OPENID).get()).data;
        } catch (e2) { /* 不存在 */ }
        if (existing) return;

        // 邀请归属：仅当邀请码合法、且不是自己邀请自己时生效。
        // 注意：注册时只记录归属，不占用邀请人当日奖励名额——
        // 名额在被邀请人完成首次表态、实际发奖时才占用（见 placeBet）。
        if (inviteCode && inviteCode !== OPENID) {
          let inviter = null;
          try {
            inviter = (await t.collection('users').doc(inviteCode).get()).data;
          } catch (e2) { /* 邀请码不存在：静默忽略 */ }
          if (inviter && inviter._id !== OPENID) {
            inviteFrom = inviter._id;
          }
        }

        // 被邀请人新手加成随档案一并落库（不再只在返回对象里加，避免重登丢失）
        await t.collection('users').doc(OPENID).set({
          data: Object.assign({}, user, {
            invitedBy: inviteFrom,
            points: INIT_POINTS + (inviteFrom ? INVITEE_POINTS : 0)
          })
        });

        // 记录邀请关系（invites._id = inviter_openid 天然去重）
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

    // 事务已把新手加成落库，这里同步返回对象的展示口径
    if (inviteFrom) {
      user.invitedBy = inviteFrom;
      user.points += INVITEE_POINTS;
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
