const api = require('../../../utils/api');
const { buildResolutionSpec } = require('../../../utils/spec');

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function defaultDate() {
  const d = new Date(Date.now() + 2 * 86400000);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

Page({
  data: {
    items: [],
    sources: [],
    deadlineDate: defaultDate(),
    deadlineTime: '20:00',
    publishing: false,
    publishCount: 0,
    readyCount: 0
  },

  onLoad() {
    const candidates = wx.getStorageSync('batch_candidates') || [];
    const items = candidates.map((c, i) => ({
      key: 'k' + i,
      title: c.title,
      category: c.category,
      status: 'drafting',
      publish: true,
      mode: '',
      provider: '',
      conditionText: '',
      humanReadable: '',
      draft: null
    }));
    this.setData({ items, readyCount: 0 });

    api.getDataSources()
      .then(res => {
        this.setData({ sources: res.list || [] });
        this.draftAll();
      })
      .catch(err => {
        wx.showToast({ title: err.message || '加载数据源失败', icon: 'none' });
      });
  },

  sourcesPayload() {
    return this.data.sources.map(s => ({
      name: s.name,
      type: s.type,
      url: s.url,
      category: s.category,
      notes: s.notes
    }));
  },

  // 逐个 AI 起草（串行，避免触发限流）
  draftAll() {
    const items = this.data.items.map(i => Object.assign({}, i, {
      status: 'drafting',
      mode: '',
      provider: '',
      conditionText: '',
      humanReadable: '',
      draft: null
    }));
    this.setData({ items, readyCount: 0 });
    const queue = items.slice();
    const next = () => {
      if (!queue.length) return;
      const item = queue.shift();
      api.aiDraftSpec({
        title: item.title,
        category: item.category,
        sources: this.sourcesPayload()
      })
        .then(res => {
          const s = res.spec || {};
          item.status = 'ready';
          item.mode = s.mode;
          item.provider = s.provider || '';
          item.conditionText = s.mode === 'manual'
            ? '人工录入判定'
            : `${s.field || ''} ${s.operator || ''} ${s.value}${s.unit || ''}`;
          item.humanReadable = s.humanReadable || '';
          item.draft = s;
        })
        .catch(() => {
          item.status = 'failed';
        })
        .finally(() => {
          this.setData({ items });
          this.refreshReadyCount();
          next();
        });
    };
    next();
  },

  onRetry(e) {
    const key = e.currentTarget.dataset.key;
    const item = this.data.items.find(i => i.key === key);
    if (!item) return;
    item.status = 'drafting';
    item.draft = null;
    this.setData({ items: this.data.items.slice() });
    api.aiDraftSpec({
      title: item.title,
      category: item.category,
      sources: this.sourcesPayload()
    })
      .then(res => {
        const s = res.spec || {};
        item.status = 'ready';
        item.mode = s.mode;
        item.provider = s.provider || '';
        item.conditionText = s.mode === 'manual'
          ? '人工录入判定'
          : `${s.field || ''} ${s.operator || ''} ${s.value}${s.unit || ''}`;
        item.humanReadable = s.humanReadable || '';
        item.draft = s;
      })
      .catch(() => {
        item.status = 'failed';
      })
      .finally(() => {
        this.setData({ items: this.data.items.slice() });
        this.refreshReadyCount();
      });
  },

  onToggle(e) {
    const key = e.currentTarget.dataset.key;
    const items = this.data.items.map(i => i.key === key ? Object.assign({}, i, { publish: !i.publish }) : i);
    this.setData({ items });
    this.refreshReadyCount();
  },

  onEdit(e) {
    const key = e.currentTarget.dataset.key;
    const item = this.data.items.find(i => i.key === key);
    if (!item) return;
    wx.navigateTo({
      url: `/subpackages/admin/publish/publish?title=${encodeURIComponent(item.title)}&category=${encodeURIComponent(item.category)}`
    });
  },

  onDate(e) { this.setData({ deadlineDate: e.detail.value }); },
  onTime(e) { this.setData({ deadlineTime: e.detail.value }); },

  onPublishAll() {
    const ready = this.data.items.filter(i => i.publish && i.status === 'ready' && i.draft);
    if (!ready.length) {
      wx.showToast({ title: '没有可发布的草稿（请勾选且 AI 草稿完成）', icon: 'none' });
      return;
    }
    // iOS WKWebView 不支持 'YYYY-MM-DD HH:mm:ss' 格式，需将 '-' 替换为 '/'
    const deadline = new Date(`${this.data.deadlineDate} ${this.data.deadlineTime}:00`.replace(/-/g, '/')).getTime();
    if (!deadline || deadline <= Date.now()) {
      wx.showToast({ title: '截止时间必须晚于当前时间', icon: 'none' });
      return;
    }

    this.setData({ publishing: true });
    wx.showLoading({ title: '批量发布中...' });
    let done = 0;
    let failed = 0;
    const chain = ready.reduce((p, item) => p.then(() => api.createMarket({
      category: item.category,
      title: item.title,
      sourceOfTruth: item.draft.humanReadable,
      deadline,
      resolutionSpec: buildResolutionSpec(item.draft, this.data.sources)
    })).then(() => { done += 1; }, () => { failed += 1; }), Promise.resolve());

    chain.finally(() => {
      wx.hideLoading();
      this.setData({ publishing: false, publishCount: done });
      wx.showModal({
        title: '批量发布完成',
        content: `成功发布 ${done} 份，失败 ${failed} 份。可在首页查看新合约。`,
        showCancel: false,
        confirmText: '好的',
        success: () => wx.navigateBack()
      });
    });
  },

  refreshReadyCount() {
    const readyCount = this.data.items.filter(i => i.publish && i.status === 'ready' && i.draft).length;
    this.setData({ readyCount });
  },

  noop() {}
});
