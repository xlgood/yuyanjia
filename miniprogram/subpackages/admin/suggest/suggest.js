const api = require('../../../utils/api');
const { CATEGORIES } = require('../../../utils/constants');

Page({
  data: {
    timeRanges: ['一周内', '一个月内', '三个月内'],
    timeRangeIndex: 0,
    categories: ['全部'].concat(CATEGORIES),
    categoryIndex: 0,
    sources: [],
    loading: true,
    generating: false,
    generated: false,
    mode: '',
    fallbackReason: '',
    errorMsg: '',
    candidates: [],
    selected: {},
    selectedCount: 0
  },

  onLoad() {
    api.getDataSources()
      .then(res => this.setData({ sources: res.list || [], loading: false }))
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载数据源失败', icon: 'none' });
      });
  },

  onTimeRange(e) {
    this.setData({ timeRangeIndex: Number(e.detail.value) });
  },

  onCategory(e) {
    this.setData({ categoryIndex: Number(e.detail.value) });
  },

  onGenerate() {
    const timeRange = this.data.timeRanges[this.data.timeRangeIndex];
    const category = this.data.categories[this.data.categoryIndex];
    const sourcePayload = this.data.sources.map(s => ({
      name: s.name,
      type: s.type,
      url: s.url,
      category: s.category,
      notes: s.notes
    }));
    this.setData({ generating: true });
    wx.showLoading({ title: 'AI 联网检索中...' });
    api.aiSuggestTopics({
      searchOnly: true,
      topic: '热点事件',
      timeRange,
      category: category === '全部' ? '' : category
    })
      .then(res => {
        const summary = res.searchSummary || '';
        if (!summary) throw new Error('联网检索未返回摘要');
        wx.showLoading({ title: 'AI 生成候选清单...' });
        return api.aiSuggestTopics({
          topic: '热点事件',
          timeRange,
          category: category === '全部' ? '' : category,
          searchSummary: summary,
          sources: sourcePayload
        });
      })
      .then(res => {
        this.setData({
          candidates: res.list || [],
          selected: {},
          selectedCount: 0,
          generated: true,
          mode: res.mode || '',
          fallbackReason: res.fallbackReason || '',
          errorMsg: ''
        });
        wx.hideLoading();
        if (!this.data.candidates.length) {
          wx.showToast({ title: 'AI 未返回候选事件', icon: 'none' });
        }
      })
      .catch(err => {
        wx.hideLoading();
        this.setData({ errorMsg: err.message || 'AI 生成失败' });
        wx.showToast({ title: err.message || 'AI 生成失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ generating: false });
      });
  },

  onToggle(e) {
    const id = e.currentTarget.dataset.id;
    const selected = Object.assign({}, this.data.selected);
    selected[id] = !selected[id];
    const selectedCount = Object.keys(selected).filter(k => selected[k]).length;
    this.setData({ selected, selectedCount });
  },

  goPublish() {
    const picked = this.data.candidates.filter(c => this.data.selected[c._id]);
    if (!picked.length) {
      wx.showToast({ title: '请先勾选候选事件', icon: 'none' });
      return;
    }
    const first = picked[0];
    wx.navigateTo({
      url: `/subpackages/admin/publish/publish?title=${encodeURIComponent(first.title)}&category=${encodeURIComponent(first.category)}`
    });
  },

  goBatch() {
    const picked = this.data.candidates.filter(c => this.data.selected[c._id]);
    if (!picked.length) {
      wx.showToast({ title: '请先勾选候选事件', icon: 'none' });
      return;
    }
    wx.setStorageSync('batch_candidates', picked);
    wx.navigateTo({ url: '/subpackages/admin/batch/batch' });
  }
});
