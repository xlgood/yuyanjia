const api = require('../../utils/api');
const config = require('../../utils/config');
const fmt = require('../../utils/format');
const { VOTE_BOND_MIN } = require('../../utils/constants');

Page({
  data: {
    id: '',
    arbitration: null,
    myVote: null,
    eligible: false,
    loading: true,
    bond: VOTE_BOND_MIN,
    minBond: VOTE_BOND_MIN,
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
      // 无 ID（从「我的-公断阁」进入）：加载我最近参与的公断
      this.setData({ loading: true });
      api.getArbitration({})
        .then(res => {
          const arb = res.arbitration;
          if (!arb) {
            this.setData({ arbitration: null, myVote: null, eligible: false, loading: false });
            return;
          }
          this.setData({ id: arb.marketId || '' });
          this.setData({
            arbitration: this.decorate(arb),
            myVote: res.myVote || null,
            eligible: !!res.eligible,
            loading: false
          });
        })
        .catch(err => {
          this.setData({ loading: false });
          wx.showToast({ title: err.message || '加载失败', icon: 'none' });
        });
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
      minVotesText: `结卦条件：附议票 > 反对票，总票数 ≥ ${arb.minVotes}（参与 ${arb.participantCount} 人 × 10%），且附议 ≥ 2 票、反对 ≥ 1 票`,
      statusText: arb.status === 'pending' ? '昭示中' : (arb.status === 'settled' ? '已结束' : arb.status)
    });
  },

  timeLeft(ms) {
    if (!ms || ms <= 0) return '已结束';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}小时${m}分` : `${m}分钟`;
  },

  onBondInput(e) {
    // 只接受整数爻数（输入框 type="digit" 不含小数点；这里再兜一层）
    const num = Number(e.detail.value);
    this.setData({ bond: (Number.isInteger(num) && num > 0) ? num : 0 });
  },

  onVote(e) {
    const side = e.currentTarget.dataset.side;
    const { arbitration, bond, myVote, submitting } = this.data;
    if (!arbitration || submitting || myVote) return;
    if (arbitration.status !== 'pending') {
      wx.showToast({ title: '公断已结束', icon: 'none' });
      return;
    }
    if (!Number.isInteger(bond) || bond < VOTE_BOND_MIN) {
      wx.showToast({ title: `保证金必须为整数，且至少 ${VOTE_BOND_MIN} 爻`, icon: 'none' });
      return;
    }
    wx.showModal({
      title: side === 'support' ? '附议公断' : '反对公断',
      content: `缴纳 ${bond} 爻保证金。${side === 'support' ? '若公断成立，您将分卦反对方保证金；若不成立，保证金归反对方。' : '若公断未成立，您将分卦附议方保证金；若成立，保证金归附议方。'}`,
      confirmText: '确认附议',
      success: res => {
        if (!res.confirm) return;
        this.setData({ submitting: true });
        api.voteArbitration({ arbitrationId: arbitration._id, side, bond })
          .then(() => {
            wx.showToast({ title: '附议成功，保证金已锁定', icon: 'success' });
            this.refresh();
          })
          .catch(err => wx.showToast({ title: err.message || '附议失败', icon: 'none' }))
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
