const api = require('../../../utils/api');
const { CATEGORIES } = require('../../../utils/constants');

const TRANSFORMS = ['int', 'float', 'string'];
const OPERATORS = ['>=', '>', '<=', '<', '==', '!=', 'contains', 'in'];

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function defaultDate() {
  const d = new Date(Date.now() + 86400000);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

Page({
  data: {
    categories: CATEGORIES,
    categoryIndex: 0,
    title: '',
    deadlineDate: defaultDate(),
    deadlineTime: '20:00',
    modes: ['数值型（API 自动判定）', '事实型（人工录入 + 铁证）'],
    modeIndex: 0,
    sources: [],
    sourceIndex: 0,
    transforms: TRANSFORMS,
    transformIndex: 0,
    operators: OPERATORS,
    operatorIndex: 0,
    field: '',
    value: '',
    unit: '',
    provider: '',
    humanReadable: '',
    specText: '',
    humanText: '',
    publishing: false,
    aiDrafting: false
  },

  onLoad(options) {
    const patch = {};
    if (options && options.title) {
      patch.title = decodeURIComponent(options.title);
    }
    if (options && options.category) {
      const idx = CATEGORIES.indexOf(decodeURIComponent(options.category));
      if (idx >= 0) patch.categoryIndex = idx;
    }
    if (Object.keys(patch).length) this.setData(patch);

    api.getDataSources()
      .then(res => {
        const sources = (res.list || []).filter(s => s.type === 'api');
        this.setData({ sources });
      })
      .catch(err => wx.showToast({ title: err.message || '加载数据源失败', icon: 'none' }));
  },

  onTitle(e) { this.setData({ title: e.detail.value }); },
  onCategory(e) { this.setData({ categoryIndex: Number(e.detail.value) }); },
  onMode(e) { this.setData({ modeIndex: Number(e.detail.value) }); },
  onDate(e) { this.setData({ deadlineDate: e.detail.value }); },
  onTime(e) { this.setData({ deadlineTime: e.detail.value }); },
  onSource(e) { this.setData({ sourceIndex: Number(e.detail.value) }); },
  onField(e) { this.setData({ field: e.detail.value }); },
  onTransform(e) { this.setData({ transformIndex: Number(e.detail.value) }); },
  onOperator(e) { this.setData({ operatorIndex: Number(e.detail.value) }); },
  onValue(e) { this.setData({ value: e.detail.value }); },
  onUnit(e) { this.setData({ unit: e.detail.value }); },
  onProvider(e) { this.setData({ provider: e.detail.value }); },
  onHuman(e) { this.setData({ humanReadable: e.detail.value }); },

  onAiDraft() {
    const title = this.data.title.trim();
    if (title.length < 10) {
      wx.showToast({ title: '请先填写卦题标题（至少 10 字）', icon: 'none' });
      return;
    }
    this.setData({ aiDrafting: true });
    wx.showLoading({ title: 'AI 起草中...' });
    api.aiDraftSpec({
      title,
      category: this.data.categories[this.data.categoryIndex],
      deadlineText: `${this.data.deadlineDate} ${this.data.deadlineTime}`,
      sources: this.data.sources.map(s => ({
        name: s.name,
        type: s.type,
        url: s.url,
        category: s.category,
        notes: s.notes
      }))
    })
      .then(res => {
        const s = res.spec || {};
        if (s.mode === 'manual') {
          this.setData({
            modeIndex: 1,
            provider: s.provider || '',
            humanReadable: s.humanReadable || ''
          });
        } else {
          const idx = this.data.sources.findIndex(x => x.name === s.provider);
          if (idx >= 0) {
            const opIdx = OPERATORS.indexOf(s.operator);
            const tfIdx = TRANSFORMS.indexOf(s.transform);
            this.setData({
              modeIndex: 0,
              sourceIndex: idx,
              field: s.field || '',
              transformIndex: tfIdx >= 0 ? tfIdx : 0,
              operatorIndex: opIdx >= 0 ? opIdx : 0,
              value: String(s.value === undefined ? '' : s.value),
              unit: s.unit || '',
              humanReadable: s.humanReadable || ''
            });
          } else {
            // AI 引用了未注册数据源：回退为人工判定，保留 AI 文案
            this.setData({
              modeIndex: 1,
              provider: s.provider || '',
              humanReadable: s.humanReadable || ''
            });
            wx.showToast({ title: 'AI 引用了未注册数据源，已按人工判定填充', icon: 'none' });
          }
        }
        wx.hideLoading();
        wx.showToast({ title: 'AI 草稿已填充，请核对后发布', icon: 'success' });
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: err.message || 'AI 起草失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ aiDrafting: false });
      });
  },

  buildSpec() {
    if (this.data.modeIndex === 0) {
      const src = this.data.sources[this.data.sourceIndex];
      if (!src) return null;
      const operator = OPERATORS[this.data.operatorIndex];
      const transform = TRANSFORMS[this.data.transformIndex];
      const value = transform === 'string' ? this.data.value : Number(this.data.value);
      if (!this.data.field.trim() || this.data.value === '' || isNaN(value)) return null;
      const humanReadable =
        `根据「${src.name}」官方数据，判定时点 ${this.data.deadlineDate} ${this.data.deadlineTime}，` +
        `指标 ${this.data.field} 满足 ${operator} ${value}${this.data.unit} 则“应验”，否则“未应验”；` +
        `数据缺失时爻原路退回。`;
      return {
        version: 1,
        dataSource: { type: 'api', provider: src.name, url: src.url, field: this.data.field.trim(), transform },
        condition: { operator, value, unit: this.data.unit },
        binaryRule: { missingData: 'refund', tie: 'NO' },
        evidence: { saveRawResponse: true, saveScreenshot: false },
        humanReadable
      };
    }
    const humanReadable = this.data.humanReadable.trim();
    if (humanReadable.length < 10) return null;
    return {
      version: 1,
      dataSource: { type: 'manual', provider: this.data.provider.trim() || '官方公告' },
      evidence: { saveRawResponse: false, saveScreenshot: true },
      humanReadable
    };
  },

  onPreview() {
    const spec = this.buildSpec();
    if (!spec) {
      wx.showToast({ title: '请先填写完整的判定条件', icon: 'none' });
      return;
    }
    this.setData({
      specText: JSON.stringify(spec, null, 2),
      humanText: spec.humanReadable
    });
  },

  onPublish() {
    const title = this.data.title.trim();
    if (title.length < 10) {
      wx.showToast({ title: '标题至少 10 个字', icon: 'none' });
      return;
    }
    // iOS WKWebView 不支持 'YYYY-MM-DD HH:mm:ss' 格式，需将 '-' 替换为 '/'
    const deadline = new Date(`${this.data.deadlineDate} ${this.data.deadlineTime}:00`.replace(/-/g, '/')).getTime();
    if (!deadline || deadline <= Date.now()) {
      wx.showToast({ title: '截止时间必须晚于当前时间', icon: 'none' });
      return;
    }
    const spec = this.buildSpec();
    if (!spec) {
      wx.showToast({ title: '判定条件不完整，请先预览', icon: 'none' });
      return;
    }

    this.setData({ publishing: true });
    api.createMarket({
      category: this.data.categories[this.data.categoryIndex],
      title,
      sourceOfTruth: spec.humanReadable,
      deadline,
      resolutionSpec: spec
    })
      .then(res => {
        wx.showToast({ title: '发布成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
      })
      .catch(err => {
        this.setData({ publishing: false });
        wx.showToast({ title: err.message || '发布失败', icon: 'none' });
      });
  }
});
