const api = require('../../../utils/api');

Page({
  data: {
    stats: null,
    daily: [],
    loading: true
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load(() => wx.stopPullDownRefresh());
  },

  load(done) {
    this.setData({ loading: true });
    api.getDashboardStats()
      .then(res => {
        const stats = res.stats || {};
        const max = stats.maxDaily || 1;
        const daily = (stats.dailyCreated || []).map(d => ({
          key: d.key,
          label: d.label,
          count: d.count,
          pct: Math.max(4, Math.round((d.count / max) * 100))
        }));
        this.setData({ stats, daily, loading: false });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      })
      .finally(() => {
        if (done) done();
      });
  }
});
