const api = require('../../utils/api');
const { AMOUNT_PRESETS, MARKET_STATUS } = require('../../utils/constants');
const fmt = require('../../utils/format');
const config = require('../../utils/config');
const share = require('../../utils/share');
const { validateArbitrationReason } = require('../../utils/validate');
const subscribe = require('../../utils/subscribe');

Page({
  data: {
    id: '',
    market: null,
    myBet: null,
    participantCount: 0,
    activeArbitration: null,
    arbitration: null,
    arbEligible: false,
    myArbVote: null,
    pollChoice: '',
    compliance: config.APP_MODE === 'compliance',
    isMock: config.USE_MOCK,
    presets: AMOUNT_PRESETS,
    selectedChoice: '',
    selectedAmount: 100,
    customAmount: '',
    userPoints: 0,
    submitting: false,
    arbConfirmVisible: false,
    arbBond: 0,
    arbReason: '',
    insufficientVisible: false,
    needAmount: 0,
    loading: true
  },

  onLoad(options) {
    const id = options.id || '';
    this.setData({ id });
    // onLoad 后紧跟的首次 onShow 不再重复加载（修复双请求）
    this._skipNextShow = true;
    this.refreshUser();
    this.loadDetail();
  },

  onShow() {
    if (this._skipNextShow) {
      this._skipNextShow = false;
      return;
    }
    if (this.data.id) {
      this.refreshUser();
      this.loadDetail();
    }
  },

  refreshUser() {
    getApp().refreshUser().then(user => {
      this.setData({ userPoints: user ? user.points : 0 });
    });
  },

  loadDetail() {
    if (!this.data.id) {
      this.setData({ loading: false });
      return;
    }
    api.getMarketDetail({ marketId: this.data.id })
      .then(res => {
        const pollChoice = wx.getStorageSync('poll_' + this.data.id) || '';
        this.setData({
          market: res.market ? this.decorate(res.market) : null,
          myBet: res.myBet || null,
          participantCount: res.participantCount || 0,
          activeArbitration: res.activeArbitration || null,
          pollChoice,
          loading: false
        });
        if (res.myBet) this.resetSelection();
        this.loadArbitration();
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  loadArbitration() {
    api.getArbitration({ marketId: this.data.id })
      .then(res => {
        this.setData({
          arbitration: res.arbitration || null,
          arbEligible: !!res.eligible,
          myArbVote: res.myVote || null
        });
      })
      .catch(() => {});
  },

  onCreateArbitration() {
    // 先弹确认面板：明确告知保证金 = 当前 100% 能量
    this.setData({
      arbConfirmVisible: true,
      arbBond: this.data.userPoints || 0
    });
  },

  onArbCancel() {
    this.setData({ arbConfirmVisible: false, arbReason: '' });
  },

  onArbConfirm() {
    const check = validateArbitrationReason(this.data.arbReason);
    if (!check.ok) {
      wx.showToast({ title: check.err, icon: 'none' });
      return;
    }
    const reason = check.value;
    this.setData({ arbConfirmVisible: false, submitting: true });
    const doCreate = () => api.createArbitration({ marketId: this.data.id, reason })
      .then(res => {
        wx.hideLoading();
        wx.showToast({ title: '仲裁已发起，进入公示期', icon: 'success' });
        this.loadDetail();
        this.loadArbitration();
        subscribe.requestArbitration();
        wx.navigateTo({ url: `/pages/arbitration/arbitration?marketId=${this.data.id}` });
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '发起失败', icon: 'none' });
      })
      .finally(() => this.setData({ submitting: false }));

    if (config.USE_MOCK && this.data.participantCount < 10) {
      // Mock 演示：参与人数不足 10 人时，自动模拟 12 位用户参与后直接发起
      wx.showLoading({ title: '模拟参与中...' });
      api.call('mockSeedArbitration', { marketId: this.data.id })
        .then(() => {
          this.loadDetail();
          return doCreate();
        })
        .catch(err => {
          wx.hideLoading();
          wx.showToast({ title: err.message || '模拟失败', icon: 'none' });
          this.setData({ submitting: false });
        });
      return;
    }
    doCreate();
  },

  onArbReasonInput(e) {
    this.setData({ arbReason: e.detail.value });
  },

  onArbitrationAction() {
    if (this.data.activeArbitration) {
      this.goArbitration();
      return;
    }
    this.onCreateArbitration();
  },

  goArbitration() {
    wx.navigateTo({ url: `/pages/arbitration/arbitration?marketId=${this.data.id}` });
  },

  decorate(m) {
    const total = (m.yesPool || 0) + (m.noPool || 0);
    return Object.assign({}, m, {
      deadlineText: fmt.formatDeadline(m.deadline),
      resolvedAtText: m.resolvedAt ? fmt.formatDate(m.resolvedAt) : '',
      totalPool: total,
      totalText: fmt.formatNumber(total),
      yesRateNum: total ? Math.round(((m.yesPool || 0) / total) * 100) : 0,
      noRateNum: total ? Math.round(((m.noPool || 0) / total) * 100) : 0,
      yesRate: fmt.rate(m.yesPool, total),
      noRate: fmt.rate(m.noPool, total),
      statusText: MARKET_STATUS[m.status] || m.status
    });
  },

  resetSelection() {
    this.setData({
      selectedChoice: '',
      selectedAmount: 100,
      customAmount: ''
    });
  },

  onSelectChoice(e) {
    this.setData({ selectedChoice: e.currentTarget.dataset.choice });
  },

  onSelectAmount(e) {
    this.setData({
      selectedAmount: Number(e.currentTarget.dataset.amount),
      customAmount: ''
    });
  },

  onCustomAmount(e) {
    const val = e.detail.value;
    const num = parseInt(val, 10);
    this.setData({
      customAmount: val,
      selectedAmount: !isNaN(num) && num > 0 ? num : 0
    });
  },

  onConfirmBet() {
    const { market, myBet, selectedChoice, selectedAmount, submitting } = this.data;
    if (submitting) return;
    if (!market || market.status !== 'open') {
      wx.showToast({ title: '该预言已截止', icon: 'none' });
      return;
    }
    if (myBet) {
      wx.showToast({ title: '您已表态过啦', icon: 'none' });
      return;
    }
    if (!selectedChoice) {
      wx.showToast({ title: '请先选择看好或不看好', icon: 'none' });
      return;
    }
    const amount = Number(selectedAmount);
    if (!amount || amount <= 0) {
      wx.showToast({ title: '请输入有效的能量值', icon: 'none' });
      return;
    }
    const app = getApp();
    const user = app.globalData.user;
    if (!user || user.points < amount) {
      this.setData({
        insufficientVisible: true,
        needAmount: amount
      });
      return;
    }

    this.setData({ submitting: true });
    api.placeBet({ marketId: market._id, choice: selectedChoice, amount })
      .then(res => {
        wx.showToast({ title: '表态成功，等待判定', icon: 'success' });
        app.setUser(res.user);
        this.setData({ submitting: false, userPoints: res.user.points });
        this.loadDetail();
        subscribe.requestJudge();
      })
      .catch(err => {
        this.setData({ submitting: false });
        wx.showToast({ title: err.message || '操作失败', icon: 'none' });
      });
  },

  onCloseInsufficient() {
    this.setData({ insufficientVisible: false });
  },

  goTaskCenter() {
    this.setData({ insufficientVisible: false });
    wx.navigateTo({ url: '/pages/task/task' });
  },

  onPollVote(e) {
    const choice = e.currentTarget.dataset.choice;
    this.setData({ pollChoice: choice });
    wx.setStorageSync('poll_' + this.data.id, choice);
    wx.showToast({ title: '感谢参与民意调查', icon: 'success' });
  },

  // 以下为本地 mock 模式的开发调试功能（对应文档原型中的模拟结算面板）
  onDevResolve(e) {
    const result = e.currentTarget.dataset.result;
    const marketId = this.data.market._id;
    wx.showLoading({ title: '录入判定中' });
    api.resolveMarket({ marketId, result })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '判定已录入，进入公示期', icon: 'success' });
        this.loadDetail();
        this.loadArbitration();
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '结算失败', icon: 'none' });
      });
  },

  onDevForceSettle() {
    const marketId = this.data.market._id;
    wx.showLoading({ title: '强制结算中' });
    api.settleMarket({ marketId, force: true })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '结算完成', icon: 'success' });
        this.loadDetail();
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '结算失败', icon: 'none' });
      });
  },

  onDevSettle() {
    const marketId = this.data.market._id;
    wx.showLoading({ title: '模拟结算中' });
    api.settleMarket({ marketId })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '结算完成', icon: 'success' });
        this.loadDetail();
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '结算失败', icon: 'none' });
      });
  },

  noop() {},

  onCreatePk() {
    const { market, selectedChoice, selectedAmount, customAmount } = this.data;
    if (!market || market.status !== 'open') {
      wx.showToast({ title: '该预言已截止，无法发起 PK', icon: 'none' });
      return;
    }
    if (!selectedChoice) {
      wx.showToast({ title: '请先选择您的立场（看好/不看好）', icon: 'none' });
      return;
    }
    const amount = customAmount ? Number(customAmount) : selectedAmount;
    if (!amount || amount <= 0) {
      wx.showToast({ title: '请先选择投入的能量值', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '发起 PK 挑战',
      content: `以「${selectedChoice === 'YES' ? '看好' : '不看好'}」立场发起挑战，投入 ${amount} 能量？对方应战后将锁定反向立场，能量先入预言池，判定后按瓜分规则结算。`,
      confirmText: '发起',
      success: res => {
        if (!res.confirm) return;
        this.setData({ submitting: true });
        api.createPk({ marketId: market._id, choice: selectedChoice, amount })
          .then(result => {
            getApp().setUser(result.user);
            wx.showModal({
              title: '挑战已发出',
              content: '把 PK 中心分享给好友，对方接受后双方立场锁定，等待预言判定自动结算。',
              showCancel: false,
              confirmText: '去分享',
              success: () => {
                wx.navigateTo({ url: '/pages/pk/pk' });
              }
            });
            this.refreshUser();
            this.loadDetail();
          })
          .catch(err => wx.showToast({ title: err.message || '发起失败', icon: 'none' }))
          .finally(() => this.setData({ submitting: false }));
      }
    });
  },

  onShareAppMessage() {
    const { market } = this.data;
    if (!market) return share.appShare('🔮 预言大师', '/pages/index/index');
    return share.appShare(`${market.title} —— 来测测你的判断！`, `/pages/detail/detail?id=${market._id}`);
  },

  onShareTimeline() {
    const { market } = this.data;
    if (!market) return share.timelineShare('🔮 预言大师：热点预测，测测你的洞察力');
    return share.timelineShare(`🔮 ${market.title}`);
  }
});
