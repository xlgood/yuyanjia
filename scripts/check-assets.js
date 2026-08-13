#!/usr/bin/env node
// =========================================================
// 资源一致性校验
// 1) utils/avatar.wxs 的字符列表 必须与 utils/constants.js AVATARS 完全一致
//    （WXS 无法 require JS，双维护，靠本校验防漂移）
// =========================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const constantsPath = path.join(ROOT, 'miniprogram', 'utils', 'constants.js');
const wxsPath = path.join(ROOT, 'miniprogram', 'utils', 'avatar.wxs');

let failed = false;

try {
  const constants = require(constantsPath);
  const jsAvatars = constants.AVATARS || [];
  const wxsSrc = fs.readFileSync(wxsPath, 'utf8');
  const m = wxsSrc.match(/var list = (\[[\s\S]*?\]);/);
  if (!m) throw new Error('avatar.wxs 中未找到 list 数组');
  // eslint-disable-next-line no-eval
  const wxsAvatars = eval(m[1]);

  const eq = jsAvatars.length === wxsAvatars.length && jsAvatars.every((a, i) => a === wxsAvatars[i]);
  if (!eq) {
    failed = true;
    console.error('[check-assets] AVATARS 漂移：constants.js 与 avatar.wxs 不一致');
    console.error('  constants.js:', JSON.stringify(jsAvatars));
    console.error('  avatar.wxs  :', JSON.stringify(wxsAvatars));
  } else {
    console.log(`[check-assets] 通过：头像列表 ${jsAvatars.length} 项一致`);
  }
} catch (e) {
  failed = true;
  console.error('[check-assets] 校验失败：', e.message);
}

process.exit(failed ? 1 : 0);
