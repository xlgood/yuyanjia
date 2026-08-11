const api = require('../../utils/api');
const config = require('../../utils/config');
const share = require('../../utils/share');
const fmt = require('../../utils/format');

Page({
  data: {
    loading: true,
    stats: {
      totalInvites: 0,
      rewardedCount: 0,
      pendingCount: 0,
      weekRewarded: 0,
      dailyCap: 10,
      todayRewards: 0
    },
    list: [],
    inviterPoints: config.INVITE_INVITER_POINTS,
    inviteePoints: config.INVITE_INVITEE_POINTS,
    dailyCap: config.INVITE_DAILY_CAP,
    isMock: config.USE_MOCK,
    compliance: config.APP_MODE === 'compliance',
    simulating: false
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    api.inviteStats()
      .then(res => {
        this.setData({ stats: res.stats, list: res.list, loading: false });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  // Mock 模式专用：模拟一位好友注册并首次表态，验证奖励链路
  onSimulateInvite() {
    if (this.data.simulating) return;
    this.setData({ simulating: true });
    api.simulateInvite()
      .then(res => {
        this.setData({ stats: res.stats, list: res.list });
        if (res.granted) {
          wx.showToast({ title: `模拟成功，邀请人 +${res.granted} 能量`, icon: 'success' });
        } else {
          wx.showToast({ title: '已达每日上限，未发放奖励', icon: 'none' });
        }
        this.refresh();
      })
      .catch(err => wx.showToast({ title: err.message || '模拟失败', icon: 'none' }))
      .finally(() => this.setData({ simulating: false }));
  },

  onShowRules() {
    wx.showModal({
      title: '邀请规则',
      content: `① 分享邀请链接给好友，好友首次打开并完成一次表态，您可获得 ${this.data.inviterPoints} 能量；\n② 好友通过您的链接首次注册，额外获得 ${this.data.inviteePoints} 新手能量；\n③ 您每日最多 ${this.data.dailyCap} 次有效邀请；\n④ 能量为平台虚拟积分，仅用于参与预言与兑换虚拟荣誉。`,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  onShareAppMessage() {
    return share.appShare(
      `🔮 我在这玩「预言大师」，一起来预测热点，双方各得能量！`,
      '/pages/index/index'
    );
  },

  onShareTimeline() {
    return share.timelineShare('🔮 预言大师：热点预测，测测你的洞察力');
  }
});
