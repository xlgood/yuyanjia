// 分享工具：统一生成带邀请码的分享路径
const config = require('./config');

function myOpenId() {
  const app = getApp();
  const user = app.globalData && app.globalData.user;
  if (user && user._id) return user._id;
  if (config.USE_MOCK) return 'MOCK_USER';
  return '';
}

// 路径后追加邀请参数（路径本身可能已带 query）
function withInvite(path) {
  const id = myOpenId();
  if (!id) return path;
  const sep = path.indexOf('?') >= 0 ? '&' : '?';
  return `${path}${sep}invite=${encodeURIComponent(id)}`;
}

// 转发给好友/群
function appShare(title, path, imageUrl) {
  const obj = {
    title,
    path: withInvite(path),
    imageUrl
  };
  if (!imageUrl) delete obj.imageUrl;
  return obj;
}

// 分享到朋友圈（仅右上角菜单触发）
function timelineShare(title, imageUrl) {
  const obj = { title };
  if (imageUrl) obj.imageUrl = imageUrl;
  return obj;
}

module.exports = { myOpenId, withInvite, appShare, timelineShare };
