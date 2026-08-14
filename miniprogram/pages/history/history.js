const api = require('../../utils/api');
const { BET_STATUS, CHOICE_TEXT } = require('../../utils/constants');
const fmt = require('../../utils/format');

Page({
  data: {
    list: [],
    loading: true,
    page: 1,
    pageSize: 20,
    total: 0,
    hasMore: false,
    loadingMore: false
  },

  onShow() {
    this.loadSeq = this.loadSeq || 0;
    this.load();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore && !this.data.loading) {
      this.loadMore();
    }
  },

  loadMore() {
    this.setData({ loadingMore: true, page: this.data.page + 1 });
    this.load(null, true);
  },

  onPullDownRefresh() {
    this.load(() => wx.stopPullDownRefresh());
  },

  load(done, append) {
    // 竞态守卫：onShow 刷新与 loadMore 并发时，过期响应直接丢弃
    this.loadSeq = (this.loadSeq || 0) + 1;
    const seq = this.loadSeq;
    if (!append) this.setData({ loading: true, page: 1 });
    api.getMyRecords({ page: this.data.page, pageSize: this.data.pageSize })
      .then(res => {
        if (seq !== this.loadSeq) return; // 过期响应
        const pageList = (res.list || []).map(b => Object.assign({}, b, {
          createdAtText: fmt.formatDate(b.createdAt),
          statusText: BET_STATUS[b.status] || b.status,
          choiceText: b.choice === 'YES' ? CHOICE_TEXT.YES : CHOICE_TEXT.NO,
          choiceClass: b.choice === 'YES' ? 'green' : 'red'
        }));
        this.setData({
          list: append ? this.data.list.concat(pageList) : pageList,
          total: res.total || 0,
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

  onTapItem(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  }
});
