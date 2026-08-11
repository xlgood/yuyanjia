const config = require('./utils/config');

// 登录态缓存 TTL：页面 onShow 刷新用户时在此窗口内直接复用缓存，
// 避免每次切换页面都触发完整 login 云调用（login 内还串联 checkHonors，成本更高）
const USER_CACHE_TTL_MS = 5 * 60 * 1000;

App({
  globalData: {
    user: null,
    userAt: 0
  },

  onLaunch() {
    if (!config.USE_MOCK) {
      if (!wx.cloud) {
        console.error('当前微信基础库版本过低，无法使用云开发能力，请在开发者工具中升级基础库版本。');
      } else {
        wx.cloud.init({
          env: config.CLOUD_ENV,
          traceUser: true
        });
      }
    }
    const options = arguments[0] || {};
    const invite = options.query && options.query.invite;
    if (invite) {
      this.globalData.inviteCode = String(invite).slice(0, 64);
    }
    // 静默登录：获取 / 创建用户档案（带上邀请码，用于裂变归属）
    this.login(this.globalData.inviteCode || '');
  },

  login(inviteCode) {
    const api = require('./utils/api');
    return api.login(inviteCode ? { invite: inviteCode } : {}).then(user => {
      this.setUser(user);
      return user;
    }).catch(err => {
      console.error('[预言大师] 登录失败', err);
      return null;
    });
  },

  // 各页面操作（表态/签到/兑换等）拿到最新用户后统一走这里更新缓存
  setUser(user) {
    this.globalData.user = user;
    this.globalData.userAt = Date.now();
  },

  ensureLogin() {
    if (this.globalData.user) {
      return Promise.resolve(this.globalData.user);
    }
    return this.login();
  },

  // TTL 内复用缓存；force=true 强制重新登录（如完成任务后需立即刷新能量）
  refreshUser(force) {
    if (!force && this.globalData.user && Date.now() - (this.globalData.userAt || 0) < USER_CACHE_TTL_MS) {
      return Promise.resolve(this.globalData.user);
    }
    return this.login();
  },

  getCurrentUser() {
    return this.globalData.user;
  }
});
