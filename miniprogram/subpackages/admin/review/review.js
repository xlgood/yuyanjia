const api = require('../../../utils/api');
const { MARKET_STATUS } = require('../../../utils/constants');
const fmt = require('../../../utils/format');

Page({
  data: {
    list: [],
    evidenceMap: {},
    loading: true
  },

  onShow() {
    this.load();
  },

  load() {
    api.getPendingReviews()
      .then(res => {
        const list = (res.list || []).map(m => this.decorate(m));
        this.setData({ list, loading: false });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  decorate(m) {
    const typeMap = {
      manual_deadline: { text: '人工判定（到期待验证）', cls: 'deadline' },
      manual_fail: { text: '自动判定失败（待人工录入）', cls: 'fail' },
      dispute: { text: '昭示期（待结算/可复核）', cls: 'dispute' }
    };
    const t = typeMap[m.reviewType] || { text: '待处理', cls: '' };
    const urgencyMap = {
      urgent: { text: '⚠️ 已超时', cls: 'urgent' },
      soon: { text: '⏰ 即将到期', cls: 'soon' },
      normal: { text: '待处理', cls: 'normal' }
    };
    const u = urgencyMap[m.urgency] || { text: '', cls: '' };
    const remainingMs = m.remainingMs || 0;
    // 昭示期项：到期由 settleMarket 定时器自动结卦（≤10min 窗口），不显示「已超时」制造恐慌
    let timeText;
    if (m.reviewType === 'dispute') {
      timeText = remainingMs < 0
        ? '昭示期已结束'
        : `昭示剩余 ${this.durText(remainingMs)}`;
    } else {
      timeText = remainingMs < 0
        ? `已超时 ${this.durText(-remainingMs)}`
        : `剩余 ${this.durText(remainingMs)}`;
    }
    const urgencyText = (m.reviewType === 'dispute' && remainingMs < 0) ? '' : u.text;
    return Object.assign({}, m, {
      deadlineText: fmt.formatDeadline(m.deadline),
      statusText: MARKET_STATUS[m.status] || m.status,
      reviewTypeText: t.text,
      reviewTypeCls: t.cls,
      urgencyText,
      urgencyCls: (m.reviewType === 'dispute' && remainingMs < 0) ? 'normal' : u.cls,
      timeText
    });
  },

  durText(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return `${h}小时${m}分`;
    return `${m}分钟`;
  },

  onEvidenceInput(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ ['evidenceMap.' + id]: e.detail.value });
  },

  onResolve(e) {
    const { id, result } = e.currentTarget.dataset;
    const evidenceUrl = (this.data.evidenceMap[id] || '').trim();
    // 选填；若填写则必须是合法 http/https 链接（不传图，仅收官方证据 URL）
    if (evidenceUrl && !/^https?:\/\/\S+$/i.test(evidenceUrl)) {
      wx.showToast({ title: '证据请填官方链接（http/https）', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '录入官方断卦',
      content: `确认断卦为「${result === 'YES' ? '正' : '反'}」？录入后将进入 2 小时昭示期（跨夜顺延）。`,
      success: res => {
        if (!res.confirm) return;
        api.resolveMarket({ marketId: id, result, evidenceUrl })
          .then(() => {
            wx.showToast({ title: '已录入，进入昭示期', icon: 'success' });
            this.load();
          })
          .catch(err => wx.showToast({ title: err.message || '录入失败', icon: 'none' }));
      }
    });
  },

  onForceSettle(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '强制结算',
      content: '将按当前判定直接结算（跳过昭示等待）。确认继续？',
      success: res => {
        if (!res.confirm) return;
        api.settleMarket({ marketId: id, force: true })
          .then(() => {
            wx.showToast({ title: '结算完成', icon: 'success' });
            this.load();
          })
          .catch(err => wx.showToast({ title: err.message || '结算失败', icon: 'none' }));
      }
    });
  },

  onOverride(e) {
    const { id, result } = e.currentTarget.dataset;
    wx.showModal({
      title: '覆盖断卦并结卦',
      content: `将断卦覆盖为「${result === 'YES' ? '正' : '反'}」并立即结卦。确认继续？`,
      success: res => {
        if (!res.confirm) return;
        api.resolveMarket({ marketId: id, result })
          .then(() => api.settleMarket({ marketId: id, force: true }))
          .then(() => {
            wx.showToast({ title: '已覆盖并结算', icon: 'success' });
            this.load();
          })
          .catch(err => wx.showToast({ title: err.message || '操作失败', icon: 'none' }));
      }
    });
  }
});
