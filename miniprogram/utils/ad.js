// 激励视频广告播放封装
// 返回 { ended, reason }：
//   not_configured / finished / not_finished / ad_error
// opts：可选的服务端奖励验证（SSV）透传数据
//   { userId, rewardItem, rewardAmount, customData }，基础库 >= 3.10.3 生效
const config = require('./config');

function playRewardedVideo(opts) {
  if (!config.REWARDED_VIDEO_AD_UNIT_ID) {
    return Promise.resolve({ ended: true, reason: 'not_configured' });
  }
  return new Promise(resolve => {
    const ad = wx.createRewardedVideoAd({ adUnitId: config.REWARDED_VIDEO_AD_UNIT_ID });
    // 服务端奖励验证：流量主后台开启「服务端奖励回调」后，
    // 微信广告服务器会依据这里透传的数据回调云函数 adRewardCallback
    if (ad.setServerSideVerificationData && opts) {
      const ssv = {};
      if (opts.userId) ssv.userId = String(opts.userId);
      if (opts.rewardItem) ssv.rewardItem = String(opts.rewardItem);
      if (opts.rewardAmount !== undefined) ssv.rewardAmount = Number(opts.rewardAmount);
      if (opts.customData) ssv.customData = String(opts.customData);
      if (Object.keys(ssv).length) {
        try {
          ad.setServerSideVerificationData(ssv);
        } catch (e) { /* 低版本基础库忽略 */ }
      }
    }
    ad.onClose(res => resolve({
      ended: !!(res && res.isEnded),
      reason: res && res.isEnded ? 'finished' : 'not_finished'
    }));
    ad.onError(() => resolve({ ended: false, reason: 'ad_error' }));
    ad.show().catch(() => {
      ad.load().then(() => ad.show()).catch(() => resolve({ ended: false, reason: 'ad_error' }));
    });
  });
}

module.exports = { playRewardedVideo };
