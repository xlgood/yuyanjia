const api = require('../../../utils/api');

Page({
  data: {
    sourceCount: 0,
    pendingCount: 0,
    urgentCount: 0,
    loading: true
  },

  onShow() {
    this.load();
  },

  load() {
    Promise.all([api.getDataSources(), api.getPendingReviews()])
      .then(([s, p]) => {
        this.setData({
          sourceCount: (s.list || []).length,
          pendingCount: (p.list || []).length,
          urgentCount: (p.list || []).filter(x => x.urgency === 'urgent' || x.urgency === 'soon').length,
          loading: false
        });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  goSources() {
    wx.navigateTo({ url: '/subpackages/admin/sources/sources' });
  },

  goPublish() {
    wx.navigateTo({ url: '/subpackages/admin/publish/publish' });
  },

  goReview() {
    wx.navigateTo({ url: '/subpackages/admin/review/review' });
  },

  goDashboard() {
    wx.navigateTo({ url: '/subpackages/admin/dashboard/dashboard' });
  },

  goSuggest() {
    wx.navigateTo({ url: '/subpackages/admin/suggest/suggest' });
  }
});
