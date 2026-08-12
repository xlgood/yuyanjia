#!/usr/bin/env node
// =========================================================
// 国潮卦爻 · SVG 资源包生成器（方案A）
// 生成：app-icon / tabBar×6 / 荣誉徽章×20 / 卦爻头像×12
// 设计令牌：朱砂#A32D2D 鎏金#BA7517 玄墨#2C2C2A 米白#F7F3EC 银灰#8C8C8C
// 用法：node scripts/gen-assets.js
// =========================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IMG = path.join(ROOT, 'miniprogram', 'images');
const C = { red: '#A32D2D', gold: '#BA7517', ink: '#2C2C2A', paper: '#F7F3EC', silver: '#8C8C8C', redSoft: '#FCEBEB', goldSoft: '#FAEEDA', graySoft: '#F1EFE8' };

function svg(w, h, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>\n`;
}
const write = (rel, content) => {
  const p = path.join(IMG, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

// ---------- App 图标（1024 概念稿） ----------
write('app-icon.svg', svg(1024, 1024, `
<rect x="64" y="64" width="896" height="896" rx="200" fill="${C.red}"/>
<g fill="#FFFFFF">
  <rect x="352" y="330" width="320" height="56" rx="28"/>
  <rect x="352" y="440" width="128" height="56" rx="28"/>
  <rect x="544" y="440" width="128" height="56" rx="28"/>
  <rect x="352" y="550" width="320" height="56" rx="28"/>
</g>
<circle cx="820" cy="820" r="76" fill="${C.gold}"/>
<rect x="786" y="812" width="68" height="10" rx="5" fill="#FFFFFF"/>
<rect x="786" y="830" width="30" height="10" rx="5" fill="#FFFFFF"/>
<rect x="824" y="830" width="24" height="10" rx="5" fill="#FFFFFF"/>`));

// ---------- tabBar（81×81 线稿，常态灰/选中朱砂） ----------
function tabIcon(active, inner) {
  const col = active ? C.red : C.silver;
  return svg(81, 81, inner.split('#STROKE').join(col));
}
// 问卦：卦钱
const guawen = `<circle cx="40.5" cy="38" r="22" fill="none" stroke="#STROKE" stroke-width="6"/>
<rect x="29" y="30" width="23" height="4.5" rx="2.25" fill="#STROKE"/>
<rect x="29" y="38" width="10" height="4.5" rx="2.25" fill="#STROKE"/>
<rect x="42" y="38" width="10" height="4.5" rx="2.25" fill="#STROKE"/>
<rect x="29" y="46" width="23" height="4.5" rx="2.25" fill="#STROKE"/>`;
// 天榜：榜文卷轴
const tianbang = `<rect x="18" y="14" width="45" height="46" rx="5" fill="none" stroke="#STROKE" stroke-width="5.5"/>
<rect x="26" y="24" width="29" height="5" fill="#STROKE"/>
<rect x="26" y="34" width="29" height="5" fill="#STROKE"/>
<rect x="26" y="44" width="18" height="5" fill="#STROKE"/>
<rect x="26" y="56" width="29" height="5" fill="#STROKE"/>
<path d="M40.5 62 L36 68 L45 68 Z" fill="#STROKE"/>`;
// 我的：人形
const mine = `<circle cx="40.5" cy="26" r="11" fill="none" stroke="#STROKE" stroke-width="5.5"/>
<path d="M18 66 a22.5 22.5 0 0 1 45 0 Z" fill="none" stroke="#STROKE" stroke-width="5.5"/>`;
write('tabbar/guawen.svg', tabIcon(false, guawen));
write('tabbar/guawen-active.svg', tabIcon(true, guawen));
write('tabbar/tianbang.svg', tabIcon(false, tianbang));
write('tabbar/tianbang-active.svg', tabIcon(true, tianbang));
write('tabbar/mine.svg', tabIcon(false, mine));
write('tabbar/mine-active.svg', tabIcon(true, mine));

// ---------- 荣誉徽章（128×128 印章风） ----------
function badge(kind, sym) {
  const t = kind === 'gold' ? { bg: C.goldSoft, ring: C.gold, sym: C.gold } : kind === 'silver' ? { bg: C.graySoft, ring: C.silver, sym: C.silver } : { bg: C.redSoft, ring: C.red, sym: C.red };
  const ribbon = kind !== 'milestone' ? `<path d="M46 92 L64 100 L82 92 L82 112 L64 104 L46 112 Z" fill="${t.ring}" opacity="0.9"/><rect x="58" y="100" width="12" height="5" rx="2.5" fill="${C.paper}"/>` : '';
  return svg(128, 128, `
<circle cx="64" cy="64" r="52" fill="${t.bg}" stroke="${t.ring}" stroke-width="6"/>
${sym(t.sym)}
${ribbon}`);
}
const S = {
  star: c => `<polygon points="64,26 70,48 92,48 74,61 81,84 64,70 47,84 54,61 36,48 58,48" fill="${c}"/>`,
  flames: c => `<g fill="${c}"><path d="M42 66 Q34 52 44 40 Q46 50 50 52 Q48 40 54 32 Q56 44 62 48 Q58 34 66 30 Q62 44 68 48 Q78 38 82 56 Q88 74 72 82 Q52 90 42 76 Z"/><circle cx="64" cy="64" r="26" fill="${C.redSoft}" opacity="0"/></g>`,
  sevendots: c => `<g fill="${c}"><circle cx="36" cy="70" r="7"/><circle cx="64" cy="70" r="7"/><circle cx="92" cy="70" r="7"/><circle cx="44" cy="50" r="7"/><circle cx="84" cy="50" r="7"/><circle cx="52" cy="36" r="7"/><circle cx="76" cy="36" r="7"/></g>`,
  sun: c => `<g stroke="${c}" stroke-width="6" stroke-linecap="round"><circle cx="64" cy="60" r="18" fill="${c}"/><path d="M64 24 V34 M64 86 V96 M30 60 H40 M88 60 H98 M42 38 L49 45 M79 75 L86 82 M86 38 L79 45 M49 75 L42 82"/></g>`,
  eye: c => `<g fill="none" stroke="${c}" stroke-width="6"><path d="M24 64 Q44 40 64 64 Q84 40 104 64 Q84 88 64 64 Q44 88 24 64 Z"/><circle cx="64" cy="64" r="9" fill="${c}"/></g>`,
  crown: c => `<g fill="${c}"><path d="M34 82 L30 48 L50 60 L64 42 L78 60 L98 48 L94 82 Z"/><rect x="34" y="86" width="60" height="10" rx="4"/></g>`,
  shield: c => `<path d="M64 28 L94 38 V60 Q94 82 64 96 Q34 82 34 60 V38 Z" fill="none" stroke="${c}" stroke-width="6"/><path d="M52 62 L60 70 L78 52" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`,
  swords: c => `<g stroke="${c}" stroke-width="6" stroke-linecap="round"><path d="M40 40 L88 88"/><path d="M88 40 L40 88"/><rect x="30" y="36" width="12" height="12" rx="3" fill="${c}"/><rect x="86" y="80" width="12" height="12" rx="3" fill="${c}"/></g>`,
  horn: c => `<g fill="${c}"><path d="M34 56 L40 34 L92 44 L88 58 Z"/><path d="M34 56 Q26 60 28 68 Q30 76 40 74 L44 70 Z"/></g>`,
  crowd: c => `<g fill="${c}"><circle cx="64" cy="44" r="20"/><path d="M30 88 Q30 60 52 58 L76 58 Q98 60 98 88 Z"/></g>`,
  cup: c => `<path d="M46 32 H82 V52 Q82 72 64 72 Q46 72 46 52 Z" fill="none" stroke="${c}" stroke-width="6"/><path d="M46 40 H38 Q34 48 38 56 H46" fill="none" stroke="${c}" stroke-width="6"/><path d="M82 40 H90 Q94 48 90 56 H82" fill="none" stroke="${c}" stroke-width="6"/><rect x="52" y="76" width="24" height="8" rx="4" fill="${c}"/><path d="M64 84 V94" stroke="${c}" stroke-width="6"/>`,
  medal: c => `<circle cx="64" cy="52" r="20" fill="none" stroke="${c}" stroke-width="6"/><rect x="52" y="74" width="24" height="8" rx="4" fill="${c}"/><path d="M56 82 L64 96 L72 82" fill="none" stroke="${c}" stroke-width="6"/>`,
  ring: c => `<circle cx="64" cy="64" r="24" fill="none" stroke="${c}" stroke-width="7"/>`,
  moon: c => `<path d="M84 64 A26 26 0 1 1 52 34 A20 20 0 0 0 84 64 Z" fill="${c}"/>`,
  gem: c => `<polygon points="64,26 92,56 64,96 36,56" fill="none" stroke="${c}" stroke-width="6"/><path d="M36 56 H92 M64 26 L64 96 M50 40 L58 68 M78 40 L70 68" stroke="${c}" stroke-width="4"/>`,
  sword: c => `<path d="M60 30 L92 30 L92 62" fill="none" stroke="${c}" stroke-width="6"/><path d="M92 30 L104 18 M60 30 L48 20" stroke="${c}" stroke-width="6"/><rect x="58" y="58" width="14" height="18" rx="4" fill="${c}"/><rect x="58" y="82" width="14" height="8" rx="3" fill="${c}"/>`
};
const HONORS = [
  ['honor_first_bet', 'milestone', S.star], ['honor_streak_3', 'milestone', S.flames],
  ['honor_streak_7', 'milestone', S.sevendots], ['honor_streak_10', 'milestone', S.sun],
  ['honor_bet_50', 'milestone', S.eye], ['honor_bet_200', 'milestone', S.crown],
  ['honor_pk_first', 'milestone', S.shield], ['honor_pk_10', 'milestone', S.swords],
  ['honor_invite_first', 'milestone', S.horn], ['honor_invite_10', 'milestone', S.crowd],
  ['rank_streak_top3', 'gold', S.cup], ['rank_streak_top10', 'silver', S.medal],
  ['rank_week_top3', 'gold', S.sun], ['rank_week_top10', 'silver', S.ring],
  ['rank_month_top3', 'gold', S.moon], ['rank_month_top10', 'silver', S.moon],
  ['rank_total_top3', 'gold', S.gem], ['rank_total_top10', 'silver', S.shield],
  ['rank_pk_top3', 'gold', S.sword], ['rank_pk_top10', 'silver', S.sword]
];
HONORS.forEach(([id, kind, sym]) => write(`honor/${id}.svg`, badge(kind, sym)));

// ---------- 卦爻头像（128×128，五行色 × 爻线） ----------
// 爻线：S=实 B=断（8 卦象 + 4 延伸色）
const HEX = [
  { n: '乾', pat: 'SSS', c: '#A32D2D', bg: '#FCEBEB' }, { n: '兑', pat: 'SSB', c: '#BA7517', bg: '#FAEEDA' },
  { n: '离', pat: 'SBS', c: '#0F6E56', bg: '#E1F5EE' }, { n: '震', pat: 'BSS', c: '#185FA5', bg: '#E6F1FB' },
  { n: '巽', pat: 'SBB', c: '#534AB7', bg: '#EEEDFE' }, { n: '坎', pat: 'BSB', c: '#993556', bg: '#FBEAF0' },
  { n: '艮', pat: 'BBS', c: '#5F5E5A', bg: '#F1EFE8' }, { n: '坤', pat: 'BBB', c: '#3B6D11', bg: '#EAF3DE' },
  { n: '乾', pat: 'SSS', c: '#993C1D', bg: '#FAECE7' }, { n: '离', pat: 'SBS', c: '#185FA5', bg: '#B5D4F4' },
  { n: '坎', pat: 'BSB', c: '#0F6E56', bg: '#9FE1CB' }, { n: '坤', pat: 'BBB', c: '#534AB7', bg: '#CECBF6' }
];
function line(y, mode, c) {
  const w = 46, h = 8, x0 = 41, gap = 12;
  if (mode === 'S') return `<rect x="${x0}" y="${y}" width="${w}" height="${h}" rx="4" fill="${c}"/>`;
  return `<rect x="${x0}" y="${y}" width="${(w - gap) / 2}" height="${h}" rx="4" fill="${c}"/><rect x="${x0 + (w + gap) / 2}" y="${y}" width="${(w - gap) / 2}" height="${h}" rx="4" fill="${c}"/>`;
}
HEX.forEach((h, i) => {
  const ys = [44, 60, 76];
  write(`avatar/avatar-${i + 1}.svg`, svg(128, 128, `
<circle cx="64" cy="64" r="60" fill="${h.bg}" stroke="${h.c}" stroke-width="5"/>
${h.pat.split('').map((m, k) => line(ys[k], m, h.c)).join('')}
<text x="64" y="116" text-anchor="middle" font-size="16" fill="${h.c}" font-family="serif">${h.n}</text>`));
});

console.log('SVG 资源包生成完毕：', fs.readdirSync(path.join(IMG, 'tabbar')).length + ' tabBar +', fs.readdirSync(path.join(IMG, 'honor')).length, '荣誉 +', fs.readdirSync(path.join(IMG, 'avatar')).length, '头像 + app-icon');
