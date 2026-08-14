const api = require('../../utils/api');

const TABS = [
  { key: 'streak', label: '🔥 连胜榜', unit: '连胜' },
  { key: 'week', label: '📅 周榜', unit: '爻' },
  { key: 'month', label: '🌙 月榜', unit: '爻' },
  { key: 'total', label: '🪙 总榜', unit: '爻' },
  { key: 'pk', label: '⚔️ 弈绩', unit: '胜率' }
];

// 各榜统计口径说明（页面顶部展示）
const TAB_DESC = {
  streak: '按当前连胜数排名',
  week: '按本周新增爻排名（每周一清零）',
  month: '按本月新增爻排名（每月 1 日清零）',
  total: '按当前爻余额排名',
  pk: '按胜率排名（满 5 场入榜）'
};

Page({
  data: {
    tabs: TABS,
    activeTab: 'streak',
    tabDesc: TAB_DESC.streak,
    list: [],
    loading: true,
    isPk: false,
    limit: 50,
    total: 0
  },

  onLoad() {
    this.loadSeq = 0;
    if (!this.maybeSwitchToPk()) {
      this.load();
    }
  },

  onShow() {
    this.maybeSwitchToPk();
  },

  maybeSwitchToPk() {
    const app = getApp();
    const flag = app && app.globalData && app.globalData.pkLbRequest;
    if (flag) {
      app.globalData.pkLbRequest = false;
      if (this.data.activeTab !== 'pk') {
        this.setData({ activeTab: 'pk' });
        this.load();
        return true;
      }
      // 已是 对弈 tab：确保数据刷新
      this.load();
      return true;
    }
    return false;
  },

  onPullDownRefresh() {
    this.load(() => wx.stopPullDownRefresh());
  },

  onLoadMore() {
    // 去抖：加载中不重复触发
    if (this.data.loading || this.data.loadingMore) return;
    this.setData({ limit: this.data.limit + 50 });
    this.load();
  },

  onSwitchTab(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.activeTab) return;
    this.setData({ activeTab: key, tabDesc: TAB_DESC[key] || '' });
    this.load();
  },

  load(done) {
    // 竞态守卫：快速切榜时过期响应直接丢弃，且 isPk 与响应映射取同一口径
    const seq = ++this.loadSeq;
    const reqTab = this.data.activeTab;
    const isPk = reqTab === 'pk';
    this.setData({ loading: true, isPk });
    const req = isPk ? api.pkLeaderboard() : api.getLeaderboard({ type: reqTab, limit: this.data.limit });
    req
      .then(res => {
        if (seq !== this.loadSeq) return; // 过期响应
        const tab = TABS.find(t => t.key === reqTab) || TABS[0];
        const list = (res.list || []).map((item, i) => isPk
          ? {
              rank: i + 1,
              nickname: item.nickname,
              avatarUrl: item.avatarUrl || '',
              value: item.winRate + '%',
              unit: '',
              sub: `${item.wins} 胜 ${item.losses} 负 · ${item.total} 场`,
              isMe: !!item.isMe,
              trend: item.trend || '',
              gapToNext: item.gapToNext || 0,
              medal: i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1)
            }
          : {
              rank: item.rank,
              nickname: item.nickname,
              avatarUrl: item.avatarUrl || '',
              value: item.value,
              unit: tab.unit,
              isMe: !!item.isMe,
              trend: item.trend || '',
              gapToNext: item.gapToNext || 0,
              medal: item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : String(item.rank)
            });
        this.setData({ list, total: res.totalCount || res.list.length || 0, loading: false });
      })
      .catch(err => {
        if (seq !== this.loadSeq) return;
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      })
      .finally(() => {
        if (done) done();
      });
  }
});
