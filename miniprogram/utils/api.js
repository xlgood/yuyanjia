// =========================================================
// API 统一封装：本地 Mock 与云开发两种模式共用同一套方法，
// 页面层无需关心数据来源。
// =========================================================
const config = require('./config');

// mock-data（76KB）改为懒加载：云开发模式下不加载、不执行该模块，
// 降低启动时的模块解析开销；发布时如需彻底剔除可在 project.config.json
// 的 packOptions.ignore 中登记 utils/mock-data.js
let mock = null;
function getMock() {
  if (!mock) mock = require('./mock-data');
  return mock;
}

function normalize(promise) {
  return promise.then(res => {
    if (res && res.ok === false) {
      const err = new Error(res.err || '操作失败');
      err.raw = res;
      throw err;
    }
    return res;
  });
}

function call(name, data = {}) {
  if (config.USE_MOCK) {
    return normalize(Promise.resolve(getMock().call(name, data)));
  }
  if (!wx.cloud) {
    return Promise.reject(new Error('云开发能力不可用，请升级基础库或检查配置'));
  }
  return normalize(wx.cloud.callFunction({ name, data }).then(res => res.result));
}

module.exports = {
  call,
  // 这两个接口直接返回用户对象，页面层无需再取 .user
  login: data => call('login', data).then(res => res.user),
  updateProfile: data => call('updateProfile', data).then(res => res.user),
  getMarkets: data => call('getMarkets', data),
  getMarketDetail: data => call('getMarketDetail', data),
  placeBet: data => call('placeBet', data),
  getMyRecords: data => call('getMyRecords', data),
  getLeaderboard: data => call('getLeaderboard', data),
  claimRelief: () => call('claimRelief'),
  resolveMarket: data => call('resolveMarket', data),
  settleMarket: data => call('settleMarket', data),
  createMarket: data => call('createMarket', data),
  getDataSources: () => call('getDataSources'),
  upsertDataSource: data => call('upsertDataSource', data),
  getPendingReviews: () => call('getPendingReviews'),
  getDashboardStats: () => call('getDashboardStats'),
  aiDraftSpec: data => call('aiDraftSpec', data),
  aiSuggestTopics: data => call('aiSuggestTopics', data),
  getTopicCandidates: data => call('getTopicCandidates', data),
  checkIn: () => call('checkIn'),
  claimAdTask: () => call('claimAdTask'),
  checkHonors: () => call('checkHonors'),
  inviteStats: () => call('inviteStats'),
  // 仅本地 Mock 模式可用的演示接口（云端没有对应云函数）
  simulateInvite: () => config.USE_MOCK
    ? call('simulateInvite')
    : Promise.reject(new Error('模拟邀友仅本地演示模式可用')),
  createPk: data => call('createPk', data),
  respondPk: data => call('respondPk', data),
  myPks: data => call('myPks', data),
  pkLeaderboard: () => call('pkLeaderboard'),
  // 与 login/updateProfile 一样解包 .user，调用方直接拿用户对象，
  // 避免把整个响应体写进 globalData.user（曾导致全局用户对象被污染、分享丢邀友码）
  togglePkOpen: data => call('togglePkOpen', data).then(res => res.user),
  createArbitration: data => call('createArbitration', data),
  getArbitration: data => call('getArbitration', data),
  voteArbitration: data => call('voteArbitration', data),
  settleArbitration: data => call('settleArbitration', data)
};
