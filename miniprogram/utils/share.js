// 分享工具：统一生成带邀友码的分享路径
// 邀友码为不透明随机码（user.inviteCode），不再直接把 openid 暴露到分享链接，
// 避免 openid 进入聊天记录/服务器日志（服务端 login 支持 inviteCode 反查 + 旧 openid 兼容回退）
const config = require('./config');

function myInviteCode() {
  const app = getApp();
  const user = app.globalData && app.globalData.user;
  if (user && user.inviteCode) return user.inviteCode;
  if (user && user._id) return user._id; // 存量用户 inviteCode 未生成时的兼容回退（服务端可解析）
  if (config.USE_MOCK) return 'MOCK_USER';
  return '';
}

// 路径后追加邀友参数（路径本身可能已带 query）
function withInvite(path) {
  const id = myInviteCode();
  if (!id) return path;
  const sep = path.indexOf('?') >= 0 ? '&' : '?';
  return `${path}${sep}invite=${encodeURIComponent(id)}`;
}

// 转发给道友/群
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

module.exports = { myInviteCode, myOpenId: myInviteCode, withInvite, appShare, timelineShare };
