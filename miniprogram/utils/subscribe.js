// 订阅消息封装：模板 ID 留空时不请求、不打扰用户
const config = require('./config');

// 请求订阅（一次性订阅：用户同意一次，服务端可推送一次）
function request(tmplId) {
  if (!tmplId || typeof wx.requestSubscribeMessage !== 'function') {
    return Promise.resolve(false);
  }
  return new Promise(resolve => {
    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success: res => resolve(res[tmplId] === 'accept'),
      fail: () => resolve(false)
    });
  });
}

function requestJudge() {
  return request(config.SUBSCRIBE_JUDGE_TMPL);
}

function requestArbitration() {
  return request(config.SUBSCRIBE_ARBITRATION_TMPL);
}

module.exports = { request, requestJudge, requestArbitration };
