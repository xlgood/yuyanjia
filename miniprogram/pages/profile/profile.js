const api = require('../../utils/api');
const config = require('../../utils/config');
const { AVATARS, NICKNAME_MAX_LEN, HONORS } = require('../../utils/constants');
const { validateNickname } = require('../../utils/validate');
const { playRewardedVideo } = require('../../utils/ad');
const share = require('../../utils/share');

const FRAME_CLASS = {
  frame_gold: 'frame-gold',
  frame_flame: 'frame-flame',
  frame_star: 'frame-star'
};

Page({
  data: {
    user: null,
    compliance: config.APP_MODE === 'compliance',
    isAdmin: false,
    editVisible: false,
    nicknameInput: '',
    avatarVisible: false,
    avatarOptions: AVATARS,
    selectedAvatar: '',
    nicknameMax: NICKNAME_MAX_LEN,
    claiming: false,
    reliefLeft: '',
    frameClass: '',
    titleText: '',
    displayBadges: [],
    invitePoints: config.INVITE_INVITER_POINTS,
    inviteTotal: 0,
    pkOpen: true,
    pkInboxCount: 0
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    // 走 app 级 TTL 缓存：tab 频繁切换不再每次触发完整 login 云调用
    getApp().refreshUser()
      .then(user => {
        if (!user) return;
        this.setData({
          user,
          // 客户端隐藏入口（真正的权限校验在云函数内）
          isAdmin: config.USE_MOCK || (config.ADMIN_OPENIDS.indexOf(user._id) >= 0),
          reliefLeft: this.reliefLeftText(user),
          frameClass: FRAME_CLASS[user.avatarFrame] || '',
          titleText: (HONORS.find(i => i.id === user.title) || {}).name || '',
          inviteTotal: user.inviteCount || 0,
          displayBadges: (user.honors || [])
            .map(id => (HONORS.find(i => i.id === id) || {}).emoji || '')
            .filter(Boolean)
            .slice(0, 12),
          pkOpen: user.pkOpen !== false
        });
        api.myPks()
          .then(res => this.setData({ pkInboxCount: (res.inbox || []).length }))
          .catch(() => {});
      })
      .catch(err => {
        console.error('[问卦局] 刷新用户失败', err);
      });
  },

  reliefLeftText(user) {
    if (!user) return '';
    const left = (user.lastReliefAt || 0) + config.RELIEF_COOLDOWN_MS - Date.now();
    if (left <= 0) return '';
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    return h > 0 ? `${h}小时${m}分后可领` : `${m}分钟后可领`;
  },

  onEditNickname() {
    this.setData({
      editVisible: true,
      nicknameInput: (this.data.user && this.data.user.nickname) || ''
    });
  },

  onNicknameInput(e) {
    this.setData({ nicknameInput: e.detail.value });
  },

  onSaveNickname() {
    const check = validateNickname(this.data.nicknameInput);
    if (!check.ok) {
      wx.showToast({ title: check.err, icon: 'none' });
      return;
    }
    api.updateProfile({ nickname: check.value })
      .then(user => {
        getApp().setUser(user);
        this.setData({ user, editVisible: false });
        wx.showToast({ title: '已保存', icon: 'success' });
        this.refresh();
      })
      .catch(err => {
        wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      });
  },

  onCloseEdit() {
    this.setData({ editVisible: false });
  },

  onEditAvatar() {
    this.setData({
      avatarVisible: true,
      selectedAvatar: (this.data.user && this.data.user.avatar) || '🔮'
    });
  },

  onPickAvatar(e) {
    this.setData({ selectedAvatar: e.currentTarget.dataset.avatar });
  },

  onSaveAvatar() {
    const avatar = this.data.selectedAvatar;
    if (!avatar) return;
    api.updateProfile({ avatar })
      .then(user => {
        getApp().setUser(user);
        this.setData({ user, avatarVisible: false });
        wx.showToast({ title: '头像已更新', icon: 'success' });
        this.refresh();
      })
      .catch(err => wx.showToast({ title: err.message || '保存失败', icon: 'none' }));
  },

  onCloseAvatar() {
    this.setData({ avatarVisible: false });
  },

  onClaimRelief() {
    const { user, claiming, reliefLeft } = this.data;
    if (claiming) return;
    if (!user) {
      wx.showToast({ title: '请稍候，正在登录', icon: 'none' });
      return;
    }
    if (user.points > 0) {
      wx.showToast({ title: '爻充足，无需补助', icon: 'none' });
      return;
    }
    if (reliefLeft) {
      wx.showToast({ title: '补助冷却中：' + reliefLeft, icon: 'none' });
      return;
    }

    this.setData({ claiming: true });
    playRewardedVideo()
      .then(result => {
        if (!result || !result.ended) {
          const err = new Error('需完整观演广告才能领取补助');
          err.noToast = false;
          throw err;
        }
        return api.claimRelief();
      })
      .then(res => {
        getApp().setUser(res.user);
        this.setData({ user: res.user, reliefLeft: '' });
        wx.showToast({ title: `已领取 ${config.RELIEF_POINTS} 爻`, icon: 'success' });
      })
      .catch(err => {
        wx.showToast({ title: err.message || '领取失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ claiming: false });
      });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goAdmin() {
    wx.navigateTo({ url: '/subpackages/admin/index/index' });
  },

  goTask() {
    wx.navigateTo({ url: '/pages/task/task' });
  },

  goShop() {
    wx.navigateTo({ url: '/pages/shop/shop' });
  },

  goInvite() {
    wx.navigateTo({ url: '/pages/invite/invite' });
  },

  goPk() {
    wx.navigateTo({ url: '/pages/pk/pk' });
  },

  goPkLeaderboard() {
    // 天榜是 tabBar 页面，必须用 switchTab；用全局标记传递“进入即切弈榜”信号
    getApp().globalData.pkLbRequest = true;
    wx.switchTab({ url: '/pages/leaderboard/leaderboard' });
  },

  goArbitrationCenter() {
    wx.navigateTo({ url: '/pages/arbitration/arbitration' });
  },

  onTogglePkOpen(e) {
    const open = !!e.detail.value;
    api.togglePkOpen({ open })
      .then(user => {
        getApp().setUser(user);
        this.setData({ user, pkOpen: open });
        wx.showToast({
          title: open ? '已开启：可被邀友 对弈' : '已关闭：不会被邀友 对弈',
          icon: 'none'
        });
      })
      .catch(err => wx.showToast({ title: err.message || '设置失败', icon: 'none' }));
  },

  onShowRules() {
    wx.showModal({
      title: '玩法与断卦规则',
      content: '① 每个卦题上线前绑定唯一断卦标准与官方数据源；\n② 断卦录入后进入 5 小时异议公示期（跨夜顺延），无异议后按卦池公式结卦；\n③ 正确方按投入占比分卦卦池，系统向下取整；\n④ 爻为平台虚拟积分，仅用于参与活动与兑换虚拟卦勋，不可兑换现金或可变现实物。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  noop() {},

  onShareAppMessage() {
    return share.appShare('🔮 问卦局：来邀弈 7 连胜，测测你的卦题力', '/pages/index/index');
  },

  onShareTimeline() {
    return share.timelineShare('🔮 问卦局：来邀弈 7 连胜，测测你的卦题力');
  }
});
