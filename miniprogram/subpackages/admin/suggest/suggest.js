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
    selectedCount: 0,
    selectAll: false,
    // 定时候选（dailyHotTopics 自动生成）
    autoDays: [],
    autoSelected: {},
    autoSelectAll: false,
    autoBatchCount: 0,
    autoLoading: true
  },

  onLoad() {
    api.getDataSources()
      .then(res => this.setData({ sources: res.list || [], loading: false }))
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载数据源失败', icon: 'none' });
      });
    // 加载每日定时生成的候选（dailyHotTopics 写入 topic_candidates）
    this.loadAutoCandidates();
  },

  loadAutoCandidates() {
    api.getTopicCandidates({ limit: 5 })
      .then(res => {
        const days = (res.list || []).map(d => ({
          date: d.date,
          status: d.status,
          aiError: d.aiError || '',
          items: (d.items || []).map((it, i) => Object.assign({}, it, {
            autoKey: d.date + '_' + i
          }))
        }));
        this.setData({ autoDays: days, autoLoading: false });
      })
      .catch(() => this.setData({ autoLoading: false }));
  },

  onAutoToggle(e) {
    const key = e.currentTarget.dataset.key;
    const autoSelected = Object.assign({}, this.data.autoSelected);
    autoSelected[key] = !autoSelected[key];
    const autoBatchCount = Object.keys(autoSelected).filter(k => autoSelected[k]).length;
    this.setData({ autoSelected, autoBatchCount });
  },

  onAutoSelectAll() {
    const all = [];
    this.data.autoDays.forEach(d => d.items.forEach(it => all.push(it.autoKey)));
    const allPicked = all.length > 0 && all.every(k => this.data.autoSelected[k]);
    const autoSelected = {};
    if (!allPicked) all.forEach(k => { autoSelected[k] = true; });
    this.setData({
      autoSelected,
      autoSelectAll: allPicked,
      autoBatchCount: Object.keys(autoSelected).filter(k => autoSelected[k]).length
    });
  },

  // 定时候选 → 批量发题（复用 batch 页）
  onAutoBatch() {
    const picked = [];
    this.data.autoDays.forEach(d => d.items.forEach(it => {
      if (this.data.autoSelected[it.autoKey]) picked.push({ title: it.title, category: it.category });
    }));
    if (!picked.length) {
      wx.showToast({ title: '请先勾选候选事件', icon: 'none' });
      return;
    }
    const existing = wx.getStorageSync('batch_candidates') || [];
    wx.setStorageSync('batch_candidates', existing.concat(picked));
    wx.navigateTo({ url: '/subpackages/admin/batch/batch' });
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
          selectAll: false,
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
    this.setData({
      selected,
      selectedCount,
      selectAll: this.data.candidates.length > 0 && selectedCount === this.data.candidates.length
    });
  },

  onSelectAll() {
    const selectAll = !this.data.selectAll;
    const selected = {};
    if (selectAll) {
      this.data.candidates.forEach(c => { selected[c._id] = true; });
    }
    this.setData({
      selectAll,
      selected,
      selectedCount: Object.keys(selected).length
    });
  },

  goPublish() {
    const picked = this.data.candidates.filter(c => this.data.selected[c._id]);
    if (!picked.length) {
      wx.showToast({ title: '请先勾选候选事件', icon: 'none' });
      return;
    }
    if (picked.length > 1) {
      wx.showToast({ title: '单个发题仅支持勾选 1 项，多项请使用批量发题', icon: 'none' });
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
