# 国潮卦爻 · 图标资源包（方案A）

> 生成器：`scripts/gen-assets.js`（SVG 源）+ `scripts/gen-tabbar-png.py`（tabBar PNG）
> 设计令牌：朱砂 `#A32D2D` / 鎏金 `#BA7517` / 玄墨 `#2C2C2A` / 米白 `#F7F3EC` / 银灰 `#8C8C8C`

## 目录

| 目录 | 内容 | 数量 | 状态 |
|---|---|---|---|
| `app-icon.svg` | 小程序图标概念稿（1024，朱砂底卦爻纹+鎏金印章） | 1 | 概念稿，上线前导出 PNG 传平台 |
| `tabbar/` | 问卦/天榜/我的 × 常态/选中 | 6 SVG + 6 PNG(81×81) | ✅ 已接入 app.json |
| `honor/` | 20 枚荣誉徽章（印章风：里程碑=朱砂 / top3=鎏金绶带 / top10=银章） | 20 SVG | 待接入（当前用 emoji 占位） |
| `avatar/` | 12 枚卦爻头像（五行色 × 三线爻纹，含卦名） | 12 SVG | 待接入（当前用卦象字符占位） |

## 接入状态与后续

- **tabBar**：已接入 `app.json`（iconPath/selectedIconPath），重新编译即显示。
- **荣誉/头像**：小程序 `<image>` 不支持 SVG，接入需两选一：
  1. 把 SVG 用设计工具导出 128px PNG（白底透明），放 `honor/`、`avatar/` 下同名 .png；
  2. 然后改代码：`profile.wxml`/`shop.wxml` 荣誉展示由 emoji 文本改为 `<image src="/images/honor/{{id}}.png">`；头像选择器与展示改为图片。

## 重新生成

```bash
node scripts/gen-assets.js          # 重新生成全部 SVG
python3 scripts/gen-tabbar-png.py   # 重新生成 tabBar PNG（需 pillow）
```
