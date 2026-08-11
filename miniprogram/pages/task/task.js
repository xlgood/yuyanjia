const api = require('../../utils/api');
const { playRewardedVideo } = require('../../utils/ad');
const config = require('../../utils/config');
const {
  CHECKIN_BASE_POINTS, CHECKIN_STREAK_BONUS, CHECKIN_STREAK_CAP,
  AD_TASK_POINTS, AD_TASK_LIMIT
} = require('../../utils/constants');
const fmt = require('../../utils/format');

Page({
  data: {
    user: null,
    checkIn: { checked: false, streak: 0, total: 0, todayReward: CHECKIN_BASE_POINTS },
    adTask: { count: 0, limit: AD_TASK_LIMIT, points: AD_TASK_POINTS, done: false },
    adConfigured: false,
    claiming: false
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    getApp().refreshUser()
      .then(user => {
        if (!user) return;
        const today = fmt.todayKey();
        const yesterday = fmt.todayKey(-1);
        const streak = user.checkInStreak || 0;
        const nextStreak = user.lastCheckInDate === yesterday ? streak + 1 : 1;
        const bonus = Math.min(Math.max(nextStreak - 1, 0), CHECKIN_STREAK_CAP - 1) * CHECKIN_STREAK_BONUS;
        const adCount = user.adTaskDate === today ? (user.adTaskCount || 0) : 0;
        this.setData({
          user,
          checkIn: {
            checked: user.lastCheckInDate === today,
            streak,
            total: user.checkInTotal || 0,
            todayReward: CHECKIN_BASE_POINTS + bonus
          },
          adTask: {
            count: adCount,
            limit: AD_TASK_LIMIT,
            points: AD_TASK_POINTS,
            done: adCount >= AD_TASK_LIMIT
          },
          adConfigured: !!config.REWARDED_VIDEO_AD_UNIT_ID
        });
      })
      .catch(err => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  onCheckIn() {
    if (this.data.checkIn.checked || this.data.claiming) return;
    this.setData({ claiming: true });
    api.checkIn()
      .then(res => {
        getApp().setUser(res.user);
        wx.showToast({ title: `签到成功 +${res.checkIn.granted} 能量`, icon: 'success' });
        this.refresh();
      })
      .catch(err => wx.showToast({ title: err.message || '签到失败', icon: 'none' }))
      .finally(() => this.setData({ claiming: false }));
  },

  onAdTask() {
    if (this.data.adTask.done || this.data.claiming) return;
    this.setData({ claiming: true });
    wx.showLoading({ title: '广告播放中...' });
    const user = getApp().globalData.user || {};
    playRewardedVideo({
      userId: user._id || '',
      rewardItem: 'energy',
      rewardAmount: AD_TASK_POINTS
    })
      .then(result => {
        if (!result.ended) {
          wx.hideLoading();
          wx.showToast({
            title: result.reason === 'ad_error' ? '广告加载失败，请稍后再试' : '完整观看广告后才能领取',
            icon: 'none'
          });
          return null;
        }
        return api.claimAdTask();
      })
      .then(res => {
        if (!res) return;
        wx.hideLoading();
        // 已接入服务端奖励回调：能量由回调原子发放，这里只提示到账中
        if (res.pending) {
          wx.showToast({ title: '广告已确认，能量稍后到账', icon: 'none' });
          this.refresh();
          return;
        }
        getApp().setUser(res.user);
        wx.showToast({ title: `+${res.adTask.granted} 能量`, icon: 'success' });
        this.refresh();
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '领取失败', icon: 'none' });
      })
      .finally(() => this.setData({ claiming: false }));
  }
});
