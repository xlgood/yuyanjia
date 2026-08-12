const api = require('../../utils/api');
const config = require('../../utils/config');
const share = require('../../utils/share');
const fmt = require('../../utils/format');

const STATUS_TEXT = {
  pending: '待应战',
  accepted: '已应战，待判定',
  declined: '已拒绝',
  expired: '已过期',
  settled: '已结算'
};

Page({
  data: {
    tab: 'inbox',
    inbox: [],
    list: [],
    loading: true,
    processingId: '',
    isMock: config.USE_MOCK,
    highlightPk: '',
    page: 1,
    pageSize: 20,
    total: 0,
    hasMore: false,
    loadingMore: false
  },

  onLoad(options) {
    if (options.challenge) {
      this.setData({ tab: 'inbox', highlightPk: String(options.challenge) });
    }
  },

  onShow() {
    this.refresh();
  },

  onReachBottom() {
    if (this.data.tab === 'mine' && this.data.hasMore && !this.data.loadingMore) {
      this.loadMore();
    }
  },

  loadMore() {
    this.setData({ loadingMore: true, page: this.data.page + 1 });
    this.refresh(true);
  },

  refresh(append) {
    if (!append) this.setData({ page: 1 });
    api.myPks({ page: this.data.page, pageSize: this.data.pageSize })
      .then(res => {
        this.setData({
          inbox: (res.inbox || []).map(pk => this.decorate(pk)),
          list: append
            ? this.data.list.concat((res.list || []).map(pk => this.decorate(pk)))
            : (res.list || []).map(pk => this.decorate(pk)),
          total: res.total || 0,
          hasMore: !!res.hasMore,
          loading: false,
          loadingMore: false
        });
      })
      .catch(err => {
        this.setData({ loading: false, loadingMore: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  decorate(pk) {
    const opp = pk.opponent || (pk.opponentId ? {
      openid: pk.opponentId,
      nickname: '预言新人',
      avatar: '🔮',
      choice: '',
      amount: 0
    } : null);
    const my = getApp().globalData.user || {};
    const mySide = pk.challengerId === my._id ? pk.challenger : (opp && opp.openid === my._id ? opp : null);
    const theirSide = pk.challengerId === my._id ? opp : pk.challenger;
    return Object.assign({}, pk, {
      statusText: STATUS_TEXT[pk.status] || pk.status,
      myAvatar: mySide ? mySide.avatar : '🔮',
      myChoiceText: mySide ? (mySide.choice === 'YES' ? '看好' : '不看好') : '',
      myAmount: mySide ? mySide.amount : 0,
      theirName: theirSide ? theirSide.nickname : '等待应战',
      theirAvatar: theirSide ? theirSide.avatar : '❓',
      theirChoiceText: theirSide && theirSide.choice ? (theirSide.choice === 'YES' ? '看好' : '不看好') : '',
      theirChoice: theirSide && theirSide.choice ? theirSide.choice : '',
      theirAmount: theirSide && theirSide.amount ? theirSide.amount : 0,
      expiresInText: pk.status === 'pending' && pk.expiresIn ? this.timeLeft(pk.expiresIn) : '',
      createdAtText: fmt.formatDate(pk.createdAt),
      resultText: this.resultText(pk)
    });
  },

  timeLeft(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}小时${m}分` : `${m}分钟`;
  },

  resultText(pk) {
    if (pk.status !== 'settled') return '';
    const my = getApp().globalData.user || {};
    if (!pk.winnerId) return '池数据异常，爻已退回';
    return pk.winnerId === my._id ? '🎉 你赢了这场 PK！' : '本场 PK 惜败，下次再战';
  },

  onSwitchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  onAccept(e) {
    const pkId = e.currentTarget.dataset.id;
    this.respond(pkId, true);
  },

  onDecline(e) {
    const pkId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '拒绝挑战',
      content: '拒绝后挑战方爻将退回，确认拒绝？',
      confirmColor: '#e11d48',
      success: res => {
        if (res.confirm) this.respond(pkId, false);
      }
    });
  },

  respond(pkId, accept) {
    if (this.data.processingId) return;
    this.setData({ processingId: pkId });
    api.respondPk({ pkId, accept })
      .then(res => {
        wx.showToast({
          title: accept ? '已应战，立场已锁定' : '已拒绝，挑战方爻已退回',
          icon: 'success'
        });
        this.refresh();
      })
      .catch(err => wx.showToast({ title: err.message || '操作失败', icon: 'none' }))
      .finally(() => this.setData({ processingId: '' }));
  },

  goMarket(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  // Mock 模式：模拟一位好友发起挑战（演示收到挑战 → 应战/拒绝）
  onSimulateChallenge() {
    wx.showModal({
      title: '模拟好友挑战',
      content: '模拟一位好友对「LPL 首局大龙」发起 PK 挑战（投入 100 爻、立场看好），可在下方接受或拒绝。',
      success: res => {
        if (!res.confirm) return;
        api.call('simulatePkChallenge', {
          marketId: 'M003',
          challenger: { nickname: '测试挑战者', avatar: '🐯', choice: 'YES', amount: 100 }
        })
          .then(() => {
            wx.showToast({ title: '已收到挑战', icon: 'success' });
            this.refresh();
          })
          .catch(err => wx.showToast({ title: err.message || '模拟失败', icon: 'none' }));
      }
    });
  },

  onShareAppMessage() {
    return share.appShare('⚔️ 我在「预言大师」发起了 PK 挑战，敢来应战吗？', '/pages/pk/pk');
  },

  onShareTimeline() {
    return share.timelineShare('⚔️ 预言大师 PK 挑战中心');
  }
});
