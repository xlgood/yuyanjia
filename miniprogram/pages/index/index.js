const api = require('../../utils/api');
const { CATEGORIES } = require('../../utils/constants');
const { MARKET_STATUS } = require('../../utils/constants');
const fmt = require('../../utils/format');
const config = require('../../utils/config');
const share = require('../../utils/share');

Page({
  data: {
    categories: ['全部', '热门'].concat(CATEGORIES),
    activeCategory: '全部',
    markets: [],
    user: null,
    hotThreshold: config.HOT_POOL_THRESHOLD,
    inviterPoints: config.INVITE_INVITER_POINTS,
    inviteePoints: config.INVITE_INVITEE_POINTS,
    loading: true,
    compliance: config.APP_MODE === 'compliance',
    page: 1,
    pageSize: 10,
    hasMore: true,
    loadingMore: false
  },

  onLoad() {
    // 竞态序号挂实例属性（非 data，避免绕过 setData 的隐式写）
    this.loadSeq = 0;
    // onLoad 后紧跟的首次 onShow 不再重复加载（修复双请求）
    this._skipNextShow = true;
    this.refreshUser();
    this.loadMarkets();
  },

  onShow() {
    if (this._skipNextShow) {
      this._skipNextShow = false;
      return;
    }
    this.refreshUser();
    // 池数据在其他页面操作后可能变化，返回首页时刷新
    this.loadMarkets();
  },

  onPullDownRefresh() {
    this.loadMarkets(() => wx.stopPullDownRefresh());
  },

  refreshUser() {
    getApp().refreshUser().then(user => {
      this.setData({ user });
    });
  },

  loadMarkets(done, append) {
    // 竞态守卫：快速切换分类/下拉刷新时，过期响应直接丢弃
    const seq = ++this.loadSeq;
    const cat = this.data.activeCategory;
    const page = append ? this.data.page : 1;
    const params = cat === '热门'
      ? { hot: true, minTotal: config.HOT_POOL_THRESHOLD, page, pageSize: this.data.pageSize }
      : { category: cat === '全部' ? '' : cat, page, pageSize: this.data.pageSize };
    if (append) {
      this.setData({ loadingMore: true });
    } else {
      this.setData({ loading: true, loadingMore: false });
    }
    api.getMarkets(params)
      .then(res => {
        if (seq !== this.loadSeq) return; // 过期响应
        const list = (res.list || []).map(m => this.decorate(m));
        this.setData({
          markets: append ? this.data.markets.concat(list) : list,
          page,
          hasMore: !!res.hasMore,
          loading: false,
          loadingMore: false
        });
      })
      .catch(err => {
        if (seq !== this.loadSeq) return;
        this.setData({ loading: false, loadingMore: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      })
      .finally(() => {
        if (done) done();
      });
  },

  onReachBottom() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    this.loadMarkets(null, true);
  },

  decorate(m) {
    const total = (m.yesPool || 0) + (m.noPool || 0);
    return Object.assign({}, m, {
      deadlineText: fmt.formatDeadline(m.deadline),
      totalPool: total,
      totalText: fmt.formatNumber(total),
      yesRate: fmt.rate(m.yesPool, total),
      noRate: fmt.rate(m.noPool, total),
      statusText: MARKET_STATUS[m.status] || m.status
    });
  },

  onSwitchCategory(e) {
    const cat = e.currentTarget.dataset.cat;
    if (cat === this.data.activeCategory) return;
    this.setData({ activeCategory: cat });
    this.loadMarkets();
  },

  onTapMarket(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  goInvite() {
    wx.navigateTo({ url: '/pages/invite/invite' });
  },

  onShareAppMessage() {
    return share.appShare('🔮 卦题大师：来测测你的热点洞察力', '/pages/index/index');
  },

  onShareTimeline() {
    return share.timelineShare('🔮 卦题大师：热点问卦，测测你的洞察力');
  }
});
