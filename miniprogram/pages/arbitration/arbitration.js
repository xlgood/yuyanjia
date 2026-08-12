const api = require('../../utils/api');
const config = require('../../utils/config');
const fmt = require('../../utils/format');

const VOTE_BOND_MIN = 100;

Page({
  data: {
    id: '',
    arbitration: null,
    myVote: null,
    eligible: false,
    loading: true,
    bond: VOTE_BOND_MIN,
    submitting: false,
    isMock: config.USE_MOCK
  },

  onLoad(options) {
    this.setData({ id: options.marketId || options.id || '' });
    this.refresh();
  },

  onShow() {
    if (this.data.id) this.refresh();
  },

  refresh() {
    if (!this.data.id) {
      // 无 ID：加载最近一个仲裁（从详情页/我的页进入）
      this.setData({ loading: false });
      return;
    }
    api.getArbitration({ marketId: this.data.id })
      .then(res => {
        const arb = res.arbitration;
        this.setData({
          arbitration: arb ? this.decorate(arb) : null,
          myVote: res.myVote || null,
          eligible: !!res.eligible,
          loading: false
        });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  decorate(arb) {
    return Object.assign({}, arb, {
      timeLeft: this.timeLeft(arb.remainingMs),
      supportRate: (arb.supportVotes + arb.opposeVotes) > 0
        ? Math.round((arb.supportVotes / (arb.supportVotes + arb.opposeVotes)) * 100) + '%'
        : '--',
      supportRateNum: (arb.supportVotes + arb.opposeVotes) > 0
        ? Math.round((arb.supportVotes / (arb.supportVotes + arb.opposeVotes)) * 100)
        : 0,
      opposeRate: (arb.supportVotes + arb.opposeVotes) > 0
        ? Math.round((arb.opposeVotes / (arb.supportVotes + arb.opposeVotes)) * 100) + '%'
        : '--',
      minVotesText: `需总票数 ≥ ${arb.minVotes}（参与 ${arb.participantCount} 人 × 10%），且支持票 > 否决票`,
      statusText: arb.status === 'pending' ? '公示中' : (arb.status === 'settled' ? '已结束' : arb.status)
    });
  },

  timeLeft(ms) {
    if (!ms || ms <= 0) return '已结束';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}小时${m}分` : `${m}分钟`;
  },

  onBondInput(e) {
    this.setData({ bond: Number(e.detail.value) || 0 });
  },

  onVote(e) {
    const side = e.currentTarget.dataset.side;
    const { arbitration, bond, myVote, submitting } = this.data;
    if (!arbitration || submitting || myVote) return;
    if (arbitration.status !== 'pending') {
      wx.showToast({ title: '仲裁已结束', icon: 'none' });
      return;
    }
    if (bond < VOTE_BOND_MIN) {
      wx.showToast({ title: `保证金至少 ${VOTE_BOND_MIN} 爻`, icon: 'none' });
      return;
    }
    wx.showModal({
      title: side === 'support' ? '支持仲裁' : '否决仲裁',
      content: `缴纳 ${bond} 爻保证金。${side === 'support' ? '若仲裁成立，您将瓜分否决方保证金；若不成立，保证金归否决方。' : '若仲裁未成立，您将瓜分支持方保证金；若成立，保证金归支持方。'}`,
      confirmText: '确认投票',
      success: res => {
        if (!res.confirm) return;
        this.setData({ submitting: true });
        api.voteArbitration({ arbitrationId: arbitration._id, side, bond })
          .then(() => {
            wx.showToast({ title: '投票成功，保证金已锁定', icon: 'success' });
            this.refresh();
          })
          .catch(err => wx.showToast({ title: err.message || '投票失败', icon: 'none' }))
          .finally(() => this.setData({ submitting: false }));
      }
    });
  },

  goMarket() {
    if (this.data.arbitration) {
      wx.navigateTo({ url: `/pages/detail/detail?id=${this.data.arbitration.marketId}` });
    }
  }
});
