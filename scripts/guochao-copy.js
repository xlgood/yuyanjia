#!/usr/bin/env node
// =========================================================
// 国潮卦爻文案改造（一次性迁移工具，可重复执行，幂等）
// 用法：node scripts/guochao-copy.js
// 范围：miniprogram/pages（wxml/js/json 标题）、utils/validate.js、utils/mock-data.js、
//       cloudfunctions/*/index.js（用户可见错误文案）
// 跳过：subpackages/admin（运营后台保留现代口径）、constants.js/app.json（手工维护）
// 原则：长短语优先替换，避免二次污染；保留「民意调查」等合规口径
// =========================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 长短语在前
const MAP = [
  ['您已表态过啦', '您已定下卦意'],
  ['请先选择您的立场（看好/不看好）', '请先定下您的卦意（应 / 否）'],
  ['请先选择看好或不看好', '请先定下您的卦意'],
  ['请先选择您的立场', '请先定下您的卦意'],
  ['发起 PK 至少投入', '邀弈至少注爻'],
  ['每次表态至少投入', '每卦至少注爻'],
  ['该预言已停止接收表态', '该卦题已停止接收应卦'],
  ['不能应战自己发起的挑战', '不可应弈自己发起的邀弈'],
  ['能量不足，无法应战', '爻不足，无法应弈'],
  ['广告任务', '观演修行'],
  ['任务中心', '修行台'],
  ['每日签到', '每日问签'],
  ['连续签到', '连续问签'],
  ['签到成功', '问签已定'],
  ['今日已签到', '今日问签已定'],
  ['破产补助', '卦资救济'],
  ['PK 挑战中心', '对弈弈台'],
  ['PK 对局', '弈局'],
  ['PK胜率', '弈绩'],
  ['PK 挑战者', '对弈邀弈者'],
  ['挑战者', '邀弈者'],
  ['仲裁社区', '公断阁'],
  ['发起仲裁', '发起公断'],
  ['仲裁', '公断'],
  ['瓜分池', '卦池'],
  ['总池', '卦池'],
  ['瓜分', '分卦'],
  ['表态', '应卦'],
  ['参与投票', '参与附议'],
  ['投票', '附议'],
  ['支持率', '卦意占比'],
  ['不支持', '反对'],
  ['支持', '附议'],
  ['否决', '反对'],
  ['结算', '结卦'],
  ['判定', '断卦'],
  ['预测', '问卦'],
  ['签到', '问签'],
  ['任务', '修行'],
  ['PK', '对弈'],
  ['对局', '弈局'],
  ['发起挑战', '邀弈'],
  ['挑战', '邀弈'],
  ['应战', '应弈'],
  ['邀请好友', '邀友论卦'],
  ['邀请', '邀友'],
  ['好友', '道友'],
  ['荣誉榜单', '天榜'],
  ['荣誉墙', '卦勋墙'],
  ['荣誉', '卦勋'],
  ['榜单', '天榜'],
  ['昵称', '道号'],
  ['观看', '观演'],
  ['预言新人', '卦中新客'],
  ['预言成功', '应验'],
  ['预言未成功', '未应验'],
  ['预言详情', '卦题详情'],
  ['热点预言', '热点卦题'],
  ['我的预言记录', '我的卦录'],
  ['发布新预言', '发布新卦题'],
  ['预言', '卦题'],
  ['卦题大师', '预测卦局'],
  ['事件', '卦题'],
  ['新手', '初入道']
];

function apply(file) {
  let s = fs.readFileSync(file, 'utf8');
  const before = s;
  for (const [from, to] of MAP) {
    s = s.split(from).join(to);
  }
  if (s !== before) {
    fs.writeFileSync(file, s);
    return true;
  }
  return false;
}

const targets = [];
const walk = d => {
  for (const name of fs.readdirSync(d)) {
    if (name === 'node_modules') continue;
    const p = path.join(d, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(wxml|js|json)$/.test(name)) targets.push(p);
  }
};
walk(path.join(ROOT, 'miniprogram', 'pages'));
targets.push(path.join(ROOT, 'miniprogram', 'utils', 'validate.js'));
targets.push(path.join(ROOT, 'miniprogram', 'utils', 'mock-data.js'));
targets.push(path.join(ROOT, 'miniprogram', 'utils', 'share.js'));
targets.push(path.join(ROOT, 'miniprogram', 'utils', 'subscribe.js'));
targets.push(path.join(ROOT, 'miniprogram', 'utils', 'api.js'));
targets.push(path.join(ROOT, 'miniprogram', 'app.js'));
for (const f of fs.readdirSync(path.join(ROOT, 'cloudfunctions'))) {
  const idx = path.join(ROOT, 'cloudfunctions', f, 'index.js');
  if (fs.existsSync(idx)) targets.push(idx);
}

let changed = 0;
for (const t of targets) {
  if (apply(t)) { changed += 1; console.log('  ✓', path.relative(ROOT, t)); }
}
console.log(`\n共修改 ${changed} 个文件`);
