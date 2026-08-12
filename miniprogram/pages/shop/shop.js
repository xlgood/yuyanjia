const api = require('../../utils/api');
const { HONORS } = require('../../utils/constants');

const SECTIONS = [
  { key: 'milestone', title: '成就里程碑', sub: '达成目标自动解锁' },
  { key: 'rank', title: '天榜卦勋', sub: '进入天榜 Top 10 自动解锁' }
];

Page({
  data: {
    user: null,
    sections: SECTIONS,
    groups: [],
    unlockedCount: 0,
    totalCount: HONORS.length,
    checking: false
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    getApp().refreshUser()
      .then(user => {
        if (!user) return;
        const honors = user.honors || [];
        const displayed = user.title || '';
        const groups = SECTIONS.map(s => ({
          key: s.key,
          title: s.title,
          sub: s.sub,
          items: HONORS
            .filter(i => i.type === s.key)
            .map(i => Object.assign({}, i, {
              owned: honors.indexOf(i.id) >= 0,
              displayed: i.id === displayed,
              rankLabel: i.type === 'rank'
                ? (i.tier === 1 ? '🏆 前三名' : '🎖️ 前十名')
                : ''
            }))
        }));
        this.setData({
          user,
          groups,
          unlockedCount: honors.length
        });
      })
      .catch(err => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  onCheckHonors() {
    if (this.data.checking) return;
    this.setData({ checking: true });
    wx.showLoading({ title: '检测中...' });
    api.checkHonors()
      .then(res => {
        wx.hideLoading();
        if (res.unlocked && res.unlocked.length) {
          const names = res.unlocked
            .map(id => (HONORS.find(h => h.id === id) || {}).name)
            .filter(Boolean)
            .join('、');
          wx.showToast({ title: `解锁新卦勋：${names}`, icon: 'none', duration: 3000 });
        } else {
          wx.showToast({ title: '暂无新卦勋解锁', icon: 'none' });
        }
        this.refresh();
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '检测失败', icon: 'none' });
      })
      .finally(() => this.setData({ checking: false }));
  },

  onSelectHonor(e) {
    const id = e.currentTarget.dataset.id;
    const user = this.data.user;
    if (!user) return;
    const honor = HONORS.find(h => h.id === id);
    if (!honor || (user.honors || []).indexOf(id) < 0) {
      wx.showToast({ title: '该卦勋尚未解锁', icon: 'none' });
      return;
    }
    // 已展示的卦勋再点一次 = 取消展示
    const next = user.title === id ? '' : id;
    api.updateProfile({ title: next })
      .then(updated => {
        getApp().setUser(updated);
        wx.showToast({
          title: next ? `已展示「${honor.name}」` : '已取消展示',
          icon: 'none'
        });
        this.refresh();
      })
      .catch(err => wx.showToast({ title: err.message || '设置失败', icon: 'none' }));
  }
});
