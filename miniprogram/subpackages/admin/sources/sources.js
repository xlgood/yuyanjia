const api = require('../../../utils/api');

const CATEGORIES = ['全品类', '影视娱乐', '科技数码', '游戏电竞', '体育竞技', '趣味民生', '财经宏观'];
const TYPES = [
  { key: 'api', label: 'API 接口' },
  { key: 'web', label: '网页抓取' },
  { key: 'manual', label: '人工录入' },
  { key: 'scraper', label: '托管抓取' }
];
const ACCESS = [
  { key: 'free', label: '免费' },
  { key: 'paid', label: '付费授权' },
  { key: 'authorized', label: '商务授权' }
];
const STATUS_TEXT = {
  verified: '可用',
  trial: '试运行',
  pending: '待接入',
  frozen: '已冻结'
};
const STATUS_CLASS = {
  verified: 'ok',
  trial: 'trial',
  pending: 'pending',
  frozen: 'bad'
};

Page({
  data: {
    list: [],
    loading: true,
    formVisible: false,
    categories: CATEGORIES,
    types: TYPES,
    typeIndex: 0,
    accesses: ACCESS,
    accessIndex: 0,
    categoryIndex: 0,
    statusText: STATUS_TEXT,
    statusClass: STATUS_CLASS,
    form: {}
  },

  onShow() {
    this.load();
  },

  load() {
    api.getDataSources()
      .then(res => this.setData({ list: res.list || [], loading: false }))
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  onAdd() {
    this.setData({
      formVisible: true,
      form: { id: '', name: '', category: '全品类', type: 'api', access: 'free', url: '', notes: '', status: 'trial' },
      categoryIndex: 0,
      typeIndex: 0,
      accessIndex: 0
    });
  },

  onEdit(e) {
    const item = this.data.list.find(s => s._id === e.currentTarget.dataset.id);
    if (!item) return;
    this.setData({
      formVisible: true,
      form: {
        id: item._id,
        name: item.name || '',
        category: item.category || '全品类',
        type: item.type || 'api',
        access: item.access || 'free',
        url: item.url || '',
        notes: item.notes || '',
        status: item.status || 'trial'
      },
      categoryIndex: Math.max(0, CATEGORIES.indexOf(item.category)),
      typeIndex: Math.max(0, TYPES.findIndex(t => t.key === item.type)),
      accessIndex: Math.max(0, ACCESS.findIndex(a => a.key === item.access))
    });
  },

  onClose() {
    this.setData({ formVisible: false });
  },

  onFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  onCategoryChange(e) {
    const i = Number(e.detail.value);
    this.setData({ categoryIndex: i, 'form.category': CATEGORIES[i] });
  },

  onTypeChange(e) {
    const i = Number(e.detail.value);
    this.setData({ typeIndex: i, 'form.type': TYPES[i].key });
  },

  onAccessChange(e) {
    const i = Number(e.detail.value);
    this.setData({ accessIndex: i, 'form.access': ACCESS[i].key });
  },

  onToggleStatus(e) {
    const item = this.data.list.find(s => s._id === e.currentTarget.dataset.id);
    if (!item) return;
    const status = item.status === 'frozen' ? 'trial' : 'frozen';
    api.upsertDataSource({
      id: item._id,
      name: item.name,
      category: item.category,
      type: item.type,
      access: item.access,
      url: item.url,
      notes: item.notes,
      status
    })
      .then(() => {
        wx.showToast({ title: status === 'frozen' ? '已冻结该数据源' : '已解冻', icon: 'success' });
        this.load();
      })
      .catch(err => wx.showToast({ title: err.message || '操作失败', icon: 'none' }));
  },

  onSave() {
    const form = this.data.form;
    if (!form.name || !form.name.trim()) {
      wx.showToast({ title: '名称不能为空', icon: 'none' });
      return;
    }
    api.upsertDataSource(form)
      .then(() => {
        this.setData({ formVisible: false });
        wx.showToast({ title: '已保存', icon: 'success' });
        this.load();
      })
      .catch(err => wx.showToast({ title: err.message || '保存失败', icon: 'none' }));
  },

  noop() {}
});
