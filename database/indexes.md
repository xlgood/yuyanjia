# 数据库索引清单（对照控制台逐个建立）

> 依据：`database/design.md` 建议索引 + 云函数真实查询逐条核对（2026-08-12）。
> **索引属性一律选「非唯一」**（本项目的防重全部靠文档 `_id` 天然唯一，无需业务唯一索引）。
> 优先级：🔴 核心（不建会导致查询报错/页面不可用）｜🟢 建议（数据量上来后性能）｜⚪ 可选（查询量小，可容忍扫描）。
> 建索引路径：云开发控制台 → 数据库 → 对应集合 → 「索引管理」→ 新建索引。

## markets（预言合约）—— 3 个

| 索引名称 | 字段（方向） | 服务查询 | 优先级 |
|----------|--------------|----------|--------|
| `idx_status_deadline` | status 升序 + deadline 升序 | 首页列表 `where status in(...) orderBy deadline asc` | 🔴 |
| `idx_category_status_deadline` | category 升序 + status 升序 + deadline 升序 | 首页分类筛选（带 category 条件） | 🟢 |
| `idx_status_totalPool` | status 升序 + totalPool **降序** | 热门榜 `where status in(...) and totalPool>=min orderBy totalPool desc` | 🔴 |

## users（用户档案）—— 4 个（单字段）

| 索引名称 | 字段（方向） | 服务查询 | 优先级 |
|----------|--------------|----------|--------|
| `idx_streak` | streak 降序 | 连胜榜 orderBy/count | 🔴 |
| `idx_weekPoints` | weekPoints 降序 | 周榜 | 🔴 |
| `idx_monthPoints` | monthPoints 降序 | 月榜 | 🔴 |
| `idx_totalPoints` | totalPoints 降序 | 总榜 | 🔴 |

> 单字段索引方向建「降序」即可；追赶差值的 `orderBy asc` 会反向扫描同一索引。

## bets（表态记录）—— 2 个

| 索引名称 | 字段（方向） | 服务查询 | 优先级 |
|----------|--------------|----------|--------|
| `idx_openid_createdAt` | openid 升序 + createdAt **降序** | 我的预言记录（分页）+ 荣誉 betCount | 🔴 |
| `idx_marketId_status` | marketId 升序 + status 升序 | 结算扫描 `where marketId+status=active`、仲裁参与人数 count | 🟢 |

## pks（PK 对战）—— 6 个

| 索引名称 | 字段（方向） | 服务查询 | 优先级 |
|----------|--------------|----------|--------|
| `idx_status_expiresAt` | status 升序 + expiresAt 升序 | 过期 PK 定时清理 | 🟢 |
| `idx_opponentId_status_createdAt` | opponentId 升序 + status 升序 + createdAt 降序 | PK 收件箱（待应战列表） | 🟢 |
| `idx_challengerId_createdAt` | challengerId 升序 + createdAt 降序 | 我的 PK 列表（or 分支一） | 🟢 |
| `idx_opponentId_createdAt` | opponentId 升序 + createdAt 降序 | 我的 PK 列表（or 分支二） | 🟢 |
| `idx_status_participantIds` | status 升序 + participantIds 升序 | 结算统计、仲裁/PK 资格 `where status=settled and participantIds` | 🟢 |
| `idx_marketId_participantIds_status` | marketId 升序 + participantIds 升序 + status 升序 | 防重复参与校验（placeBet/createPk） | 🟢 |

## invites（邀请记录）—— 2 个

| 索引名称 | 字段（方向） | 服务查询 | 优先级 |
|----------|--------------|----------|--------|
| `idx_inviterId_createdAt` | inviterId 升序 + createdAt 降序 | 邀请记录列表 | 🟢 |
| `idx_inviterId_inviterRewarded` | inviterId 升序 + inviterRewarded 升序 | 邀请统计/migratePoints | 🟢 |

## rank_snapshots（榜单快照）—— 1 个

| 索引名称 | 字段（方向） | 服务查询 | 优先级 |
|----------|--------------|----------|--------|
| `idx_type_date` | type 升序 + date **降序** | 排名变化对比、周/月荣誉判定 `where type orderBy date desc` | 🔴 |

## arbitrations（仲裁）—— 4 个

| 索引名称 | 字段（方向） | 服务查询 | 优先级 |
|----------|--------------|----------|--------|
| `idx_marketId_status` | marketId 升序 + status 升序 | 详情页「进行中的仲裁」 | 🟢 |
| `idx_marketId_createdAt` | marketId 升序 + createdAt 降序 | 详情页最近一次仲裁 | 🟢 |
| `idx_status_endsAt` | status 升序 + endsAt 升序 | 仲裁定时结算 | 🟢 |
| `idx_challengerOpenid_createdAt` | `challenger.openid` 升序 + createdAt 降序 | 发起冷却/同时参与上限（嵌套字段） | ⚪ |

## arbitration_votes（仲裁投票）—— 2 个

| 索引名称 | 字段（方向） | 服务查询 | 优先级 |
|----------|--------------|----------|--------|
| `idx_arbitrationId` | arbitrationId 升序 | 结算拉票/migratePoints | 🟢 |
| `idx_openid` | openid 升序 | 我的投票/同时参与判定 | 🟢 |

## 无需建索引的集合

| 集合 | 原因 |
|------|------|
| `leaderboards` | 按 `_id` 单文档读写（系统自动索引） |
| `ad_rewards` | 按 `_id`（transaction_id）读写 |
| `data_sources` | 全量扫描（≤200 条） |
| `resolution_logs` | 仅写入 + 偶发按 marketId 查（数据量小时扫描可接受，量大再加 `idx_marketId`） |

## 快速核对清单（建议顺序）

1. 🔴 markets：`idx_status_deadline`、`idx_status_totalPool`
2. 🔴 users：4 个单字段榜索引
3. 🔴 bets：`idx_openid_createdAt`
4. 🔴 rank_snapshots：`idx_type_date`
5. 🟢 其余（pks×6、invites×2、arbitrations×3~4、arbitration_votes×2、markets 第 3 个、bets 第 2 个）

> 建完 markets 索引后记得**重跑一次 `migratePoints`** 回填 `totalPool`，热门榜即可正常使用。
