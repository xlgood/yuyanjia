const api = require('../../utils/api');
const { AMOUNT_PRESETS, MARKET_STATUS, MIN_BET_AMOUNT } = require('../../utils/constants');
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
    minBet: MIN_BET_AMOUNT,
    selectedChoice: '',
    selectedAmount: MIN_BET_AMOUNT,
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
    this.startCountdown();
  },

  onUnload() {
    this.stopCountdown();
  },

  onHide() {
    this.stopCountdown();
  },

  // 实时倒计时：open=距截止；dispute_window=昭示剩余；到期自动刷新进入下一状态
  startCountdown() {
    this.stopCountdown();
    this.tickCountdown();
    this._cdTimer = setInterval(() => this.tickCountdown(), 1000);
  },

  stopCountdown() {
    if (this._cdTimer) {
      clearInterval(this._cdTimer);
      this._cdTimer = null;
    }
  },

  tickCountdown() {
    const m = this.data.market;
    if (!m) return;
    const now = Date.now();
    let target = 0;
    // 倒计时只输出纯时间，标签（距截止/昭示剩余）由模板统一提供，避免重复拼接
    if (m.status === 'open' && m.deadline) {
      target = m.deadline;
    } else if (m.status === 'dispute_window' && m.disputeEndsAt) {
      target = m.disputeEndsAt;
    } else {
      // 非倒计时状态：清掉显示（避免残留旧文案）
      if (m.countdownText) this.setData({ 'market.countdownText': '' });
      return;
    }
    const remain = target - now;
    if (remain <= 0) {
      // 到点：刷新详情，让状态推进（locked → 断卦 / 昭示 → 结卦由云函数定时器处理）
      if (m.countdownText) this.setData({ 'market.countdownText': '' });
      this.loadDetail();
      return;
    }
    const text = this.hms(remain);
    if (m.countdownText !== text) this.setData({ 'market.countdownText': text });
  },

  hms(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const mi = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = n => (n < 10 ? '0' + n : '' + n);
    if (h > 0) return h + ':' + pad(mi) + ':' + pad(ss);
    return pad(mi) + ':' + pad(ss);
  },

  onShow() {
    if (this._skipNextShow) {
      this._skipNextShow = false;
      return;
    }
    if (this.data.id) {
      this.refreshUser();
      this.loadDetail();
      // 从后台/其它页返回时重启倒计时（onHide 已停）
      this.startCountdown();
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
    // 先弹确认面板：明确告知保证金 = 当前 100% 爻
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
        wx.showToast({ title: '公断已发起，进入昭示期', icon: 'success' });
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
    // 兼容存量数据：断卦依据里若有旧词（预言成功/未成功/不成功），展示时统一为国潮口径。
    // 旧词用 Unicode 转义拼装，避免被全局文案迁移脚本二次改写
    const P = '\u9884\u8a00';   // 预言
    const S = '\u6210\u529f';   // 成功
    const sourceOfTruth = String(m.sourceOfTruth || '')
      .split(P + '\u4e0d' + S).join('未应验')   // 预言不成功
      .split(P + '\u672a' + S).join('未应验')   // 预言未成功
      .split(P + S).join('应验');               // 预言成功
    return Object.assign({}, m, {
      sourceOfTruth,
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
      selectedAmount: MIN_BET_AMOUNT,
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
      wx.showToast({ title: '该卦题已截止', icon: 'none' });
      return;
    }
    if (myBet) {
      wx.showToast({ title: '您已定下卦意', icon: 'none' });
      return;
    }
    if (!selectedChoice) {
      wx.showToast({ title: '请先定下您的卦意', icon: 'none' });
      return;
    }
    const amount = Number(selectedAmount);
    if (!amount || amount < MIN_BET_AMOUNT) {
      wx.showToast({ title: `每卦至少注爻 ${MIN_BET_AMOUNT} 爻`, icon: 'none' });
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
        wx.showToast({ title: '应卦成功，等待断卦', icon: 'success' });
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

  // 以下为本地 mock 模式的开发调试功能（对应文档原型中的模拟结卦面板）
  onDevResolve(e) {
    const result = e.currentTarget.dataset.result;
    const marketId = this.data.market._id;
    wx.showLoading({ title: '录入断卦中' });
    api.resolveMarket({ marketId, result })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '断卦已录入，进入昭示期', icon: 'success' });
        this.loadDetail();
        this.loadArbitration();
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '结卦失败', icon: 'none' });
      });
  },

  onDevForceSettle() {
    const marketId = this.data.market._id;
    wx.showLoading({ title: '强制结卦中' });
    api.settleMarket({ marketId, force: true })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '结卦完成', icon: 'success' });
        this.loadDetail();
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '结卦失败', icon: 'none' });
      });
  },

  onDevSettle() {
    const marketId = this.data.market._id;
    wx.showLoading({ title: '模拟结卦中' });
    api.settleMarket({ marketId })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '结卦完成', icon: 'success' });
        this.loadDetail();
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '结卦失败', icon: 'none' });
      });
  },

  noop() {},

  onCreatePk() {
    const { market, selectedChoice, selectedAmount, customAmount } = this.data;
    if (!market || market.status !== 'open') {
      wx.showToast({ title: '该卦题已截止，无法发起 对弈', icon: 'none' });
      return;
    }
    if (!selectedChoice) {
      wx.showToast({ title: '请先定下您的卦意（应 / 否）', icon: 'none' });
      return;
    }
    const amount = customAmount ? Number(customAmount) : selectedAmount;
    if (!amount || amount < MIN_BET_AMOUNT) {
      wx.showToast({ title: `邀弈至少注爻 ${MIN_BET_AMOUNT} 爻`, icon: 'none' });
      return;
    }
    wx.showModal({
      title: '发起 对弈 邀弈',
      content: `以「${selectedChoice === 'YES' ? '正' : '反'}」立场邀弈，投入 ${amount} 爻？对方应弈后将锁定反向立场，爻先入卦题池，断卦后按分卦规则结卦。`,
      confirmText: '发起',
      success: res => {
        if (!res.confirm) return;
        this.setData({ submitting: true });
        api.createPk({ marketId: market._id, choice: selectedChoice, amount })
          .then(result => {
            getApp().setUser(result.user);
            wx.showModal({
              title: '邀弈已发出',
              content: '把 对弈 中心分享给道友，对方接受后双方立场锁定，等待卦题断卦自动结卦。',
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
    if (!market) return share.appShare('🔮 问卦局', '/pages/index/index');
    return share.appShare(`${market.title} —— 来测测你的判断！`, `/pages/detail/detail?id=${market._id}`);
  },

  onShareTimeline() {
    const { market } = this.data;
    if (!market) return share.timelineShare('🔮 问卦局：热点问卦，测测你的洞察力');
    return share.timelineShare(`🔮 ${market.title}`);
  }
});
