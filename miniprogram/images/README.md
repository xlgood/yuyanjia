# 国潮卦爻 · 图标资源包（方案A）

> 生成器：`scripts/gen-assets.js`（SVG 源）+ `scripts/gen-tabbar-png.py`（tabBar PNG）
> 设计令牌：朱砂 `#A32D2D` / 鎏金 `#BA7517` / 玄墨 `#2C2C2A` / 米白 `#F7F3EC` / 银灰 `#8C8C8C`

## 目录

| 目录 | 内容 | 数量 | 状态 |
|---|---|---|---|
| `app-icon.svg` | 小程序图标概念稿（1024，朱砂底卦爻纹+鎏金印章） | 1 | 概念稿，上线前导出 PNG 传平台 |
| `tabbar/` | 问卦/天榜/我的 × 常态/选中 | 6 SVG + 6 PNG(81×81) | ✅ 已接入 app.json |
| `honor/` | 20 枚荣誉徽章（印章风：里程碑=朱砂 / top3=鎏金绶带 / top10=银章） | 20 SVG + 20 PNG(128) | ✅ 已接入 profile / shop |
| `avatar/` | 12 枚卦爻头像（五行色 × 三线爻纹，含卦名） | 12 SVG + 12 PNG(128) | ✅ 已接入（WXS 映射） |

## 接入状态与后续

- **tabBar**：已接入 `app.json`（iconPath/selectedIconPath），重新编译即显示。
- **荣誉**：已生成 128px PNG 并接入 —— profile「我的卦勋」/ shop「卦勋墙」用 `<image src="/images/honor/{{id}}.png">` 渲染（`displayBadges` 存荣誉 id）。
- **头像**：`utils/avatar.wxs` 提供 `av.img(字符)` → 图片路径映射；profile 头部与选择器、pk / invite / arbitration 展示均已改为图片，未匹配字符回退文本。数据层仍存字符（`user.avatar`），旧数据兼容。

## 重新生成

```bash
node scripts/gen-assets.js            # 重新生成全部 SVG
python3 scripts/gen-tabbar-png.py     # 重新生成 tabBar PNG（需 pillow）
python3 scripts/gen-icon-png.py       # 重新生成荣誉/头像 PNG（需 pillow）
```
