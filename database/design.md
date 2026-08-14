# 数据库设计（微信云开发 · 云数据库）

云开发环境创建后，需在控制台创建 11~12 个集合：`users`、`markets`、`bets`、`data_sources`、`resolution_logs`、`invites`、`pks`、`rank_snapshots`、`leaderboards`、`arbitrations`、`arbitration_votes`；启用激励广告服务端回调时另加 `ad_rewards`。
集合权限统一设为「所有用户不可读写」，所有读写均通过云函数完成，客户端不直连数据库（前端已确认零 `wx.cloud.database()` 调用）。逐集合规则与验证方法见 [security-rules.md](security-rules.md)。

> 原 `disputes`（申诉）集合已被仲裁系统替代，不再创建/使用。

## 1. users（用户档案）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | openid（登录时写入） |
| nickname | string | 昵称，默认「预言新人」 |
| avatarUrl | string | 头像链接，可为空 |
| points | number | 当前爻余额（初始 100；总榜按此排序，见 getLeaderboard） |
| streak | number | 当前连胜 |
| bestStreak | number | 历史最高连胜 |
| weekPoints | number | 本周获得爻（周榜） |
| monthPoints | number | 本月获得爻（月榜） |
| totalPoints | number | 累计净收益（不含本金返还；历史累计统计，非总榜排名依据） |
| lastReliefAt | number | 上次破产补助时间戳 |
| inviteCode | string | 不透明邀友码（8 位随机，分享链接对外使用；存量用户登录时惰性补发） |
| invitedBy | string | 邀请人 openid（被邀请人注册时写入，为空表示无邀请归属） |
| inviteRewarded | boolean | 是否已触发邀请人奖励（首次表态后置 true） |
| inviteCount | number | 累计有效邀请人数 |
| inviteRewardDate | string | 最近发放邀请奖励的日期（YYYY-MM-DD，每日限额用） |
| inviteRewardToday | number | 当日已发放邀请奖励次数 |
| pkOpen | boolean | 是否允许被道友邀请 PK（默认 true） |
| pkWins / pkLosses | number | PK 胜 / 负场次（结算时累加，用于胜率榜） |
| lastArbAt | number | 最近一次发起公断的时间戳（事务内 CAS 冷却，防并发双创建） |
| honors | string[] | 已解锁荣誉 ID 列表（自动解锁，不消耗爻） |
| betCount / pkCount | number | 累计表态数 / 累计 PK 场数（荣誉里程碑判定用） |
| createdAt / updatedAt | Date | 创建 / 更新时间 |

建议索引（降序）：`streak`、`weekPoints`、`monthPoints`、`totalPoints`、`points`（榜单排序；`inviteCode` 单字段由平台自动建索引）。

## 7. invites（邀请记录）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | `${inviterId}_${inviteeId}`（天然防重复） |
| inviterId | string | 邀请人 openid |
| inviteeId | string | 被邀请人 openid |
| inviteeNickname | string | 被邀请人昵称快照 |
| rewardToInviter | number | 邀请人可获奖励（5，与 _shared/config.js INVITE_INVITER_POINTS 一致） |
| inviterRewarded | boolean | 邀请人奖励是否已发放（被邀请人首次表态后） |
| rewardedAt | Date | 奖励发放时间 |
| source | string | `friend` / `group`（预留：分享渠道标记） |
| createdAt / updatedAt | Date | 创建 / 更新时间 |

建议索引：`inviterId + createdAt`（邀请记录列表）、`inviterId + inviterRewarded`（统计）。

## 8. pks（道友 PK 对战）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | PK 记录 ID（如 PKxxxx） |
| marketId | string | 绑定的预言事件 |
| marketTitle | string | 事件标题快照 |
| challengerId / opponentId | string | 挑战方 / 应战方 openid（应战前 opponent 为空） |
| challenger / opponent | object | `{ openid, nickname, avatar, choice, amount }` |
| participantIds | string[] | 参与者 openid 列表（防重复参与查询用） |
| status | string | `pending` 待应战 / `accepted` 已应战 / `declined` 已拒绝 / `expired` 已过期 / `settled` 已结算 |
| winnerId | string | 胜方 openid（池异常为空） |
| challengerBetId / opponentBetId | string | 双方 bets 记录 ID |
| createdAt / expiresAt | number | 创建时间 / 应战截止（24 小时） |
| acceptedAt / settledAt | Date | 应战 / 结算时间 |

建议索引：`marketId + participantIds + status`（重复参与校验）、`status + expiresAt`（过期清理）、`status`（结算统计）。

## 9. rank_snapshots（榜单排名快照）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | `${type}_${date}`（如 `streak_2026-08-07`） |
| type | string | 榜单类型：streak / week / month / total / pk |
| date | string | 快照日期（北京时间 YYYY-MM-DD） |
| rankings | object[] | `[{ openid, rank, value, nickname }]` 当日全量排名 |
| total | number | 上榜人数 |
| createdAt | Date | 生成时间 |

用途：榜单页对比「今日实时排名」与「最近一份历史快照」计算 ↑/↓/= / NEW 箭头；由 `rankSnapshot` 云函数每日 00:00 定时生成。

建议索引：`type + date`（取最近快照）。

## 2. markets（预言合约）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 合约 ID（如 M001） |
| category | string | 分类：影视娱乐 / 科技数码 / 游戏电竞 / 体育竞技 / 趣味民生 / 财经宏观 |
| title | string | 预言标题（严格 YES/NO 二项化表述） |
| sourceOfTruth | string | 胜负判定标准与唯一数据源（铁证规范） |
| deadline | number | 截止时间戳 |
| yesPool / noPool | number | 双方爻池 |
| totalPool | number | 冗余字段 = yesPool + noPool（表态/PK 收退注时原子维护；热门榜按此索引排序，存量数据用 `migratePoints` 回填） |
| status | string | `open` 进行中 / `locked` 已锁定待判定 / `dispute_window` 判定昭示 / `arbitration_window` 仲裁昭示（临时）/ `resolved` 已结算 |
| lockedAt | number | 锁定时间（截止时间到达时由 lockMarkets 写入） |
| result | string/null | 官方判定：`YES` / `NO` |
| evidenceUrl | string | 官方公告截图或链接（铁证） |
| hasDispute | boolean | 历史字段：是否存在旧版申诉（仲裁替代后基本恒为 false） |
| disputeCount | number | 历史字段：旧版申诉数量（仲裁替代后不再使用） |
| resolvedAt | number | 判定录入时间 |
| disputeEndsAt | number | 昭示期结束时间（结算最早时间） |
| settledAt | number | 实际结算时间 |
| resolutionSpec | object | 机读判定规范（数据源/字段/运算符/阈值/边界规则，见 `resolution-spec.example.json`） |
| resolutionMethod | string | 判定方式：`auto_api`（接口自动）/ `auto_web`（抓取自动，二期）/ `manual`（人工） |
| resolutionAttempts | number | 自动判定尝试次数（连续 3 次失败转人工） |
| needsManualReview | boolean | 是否已转入人工复核队列 |

建议索引：
- `status + deadline`（首页列表）
- `category + status + deadline`（分类筛选）
- `status + totalPool`（降序，热门榜排序——必须先建此索引，`getMarkets` 热门模式才可运行）

## 3. bets（表态记录）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | `${openid}_${marketId}`，天然唯一，保证一人一场仅一注 |
| marketId | string | 合约 ID |
| openid | string | 用户 openid |
| choice | string | `YES` / `NO` |
| amount | number | 投入爻 |
| marketTitle / marketCategory / marketDeadline | 冗余快照 | 便于历史记录查询，无需联表 |
| status | string | `active` / `won` / `lost` / `refunded` |
| payout | number | 结算返还（0 表示无） |
| createdAt | Date | 表态时间 |

建议索引：`openid + createdAt`（我的记录）、`marketId + status`（结算扫描）。

## 4. disputes（异议申诉，已废弃）

> 已被社区仲裁（`arbitrations` / `arbitration_votes`）替代，不再创建/使用。`markets.hasDispute` / `disputeCount` 为历史字段，仅兼容旧数据。

## 5. resolution_logs（自动判定日志 / 存证）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 自动生成 |
| marketId | string | 合约 ID |
| method | string | 判定方式（`auto_api` / `weather` / `unknown`） |
| status | string | `ok` 成功 / `error` 失败 |
| value | any | 抓取到的实际值 |
| result | string | 判定结果（成功时） |
| raw | string | 原始响应快照（截断 5000 字） |
| error | string | 失败原因（失败时） |
| fetchedAt | number | 数据抓取时间 |
| createdAt | Date | 日志写入时间 |

建议索引：`marketId`、`status`。该集合不可删除，是自动判定的审计证据。

## 6. 种子数据导入

`markets.seed.json` 为 8 条演示合约。导入方式：

1. 云开发控制台 → 数据库 → 选择 `markets` 集合；
2. 「导入」→ 选择 `database/markets.seed.json`；
3. 冲突处理选「insert」。

> 注意：种子中的 `deadline` 为演示时间，正式运营前请在管理后台重新录入真实截止时间，并同步更新 `sourceOfTruth` 对应的官方数据源。

## 7. 自动判定相关云函数

- `createMarket`：管理员发布合约（校验分类/标题/截止时间/机读判定规范），自动写入 `resolutionSpec`；
- `resolver`：每 10 分钟扫描「已截止 + 带 spec」的合约，按适配器自动判定并写入 `resolution_logs`，失败重试 3 次后标记 `needsManualReview`；
- 判定产出后走现有 `dispute_window` → `settleMarket`（定时器）自动结算链路。

完整流程见 [docs/事件选题与自动判定方案.md](../docs/事件选题与自动判定方案.md)。

## 8. data_sources（数据源注册表）

先注册、后发题：只有注册过的数据源才允许被新合约引用。注册时确定其判定数据形态与自动化级别。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 数据源 ID（如 SRC-WEATHER-CMA） |
| name | string | 数据源名称 |
| category | string | 适用分类 |
| type | string | `api`（接口直连）/ `web`（页面抓取）/ `manual`（人工录入+铁证）/ `scraper`（托管抓取服务） |
| access | string | `free` / `paid` / `authorized` |
| url | string | 官方地址或接口地址 |
| notes | string | 使用说明与限制 |
| status | string | `verified` 已验证可用 / `trial` 试运行 / `pending` 待接入 / `frozen` 已熔断 |

示例：`data-sources.example.json`。数据源熔断（连续判定失败）时运营将其 `status` 改为 `frozen`，并禁止用该来源发新题。

## 9. arbitrations（社区仲裁）

判定录入后进入 `dispute_window`（判定昭示期），事件表态人数 ≥ 10 的用户可发起社区仲裁；仲裁进入 `arbitration_window` 后全社区投票，昭示 24 小时。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 仲裁 ID（如 ARBxxxx） |
| marketId / marketTitle | string | 绑定事件 |
| reason | string | 仲裁理由（必填，10-200 字，敏感词/注入字符校验） |
| challenger | object | 发起人 `{ openid, nickname, avatar, bond }` |
| challengerBond | number | 发起人保证金（当前爻 100%） |
| supportPool / opposePool | number | 支持 / 否决保证金池 |
| supportVotes / opposeVotes | number | 支持 / 否决票数（发起人默认 1 支持票） |
| participantCount | number | 事件表态人数（门槛基数） |
| minVotes | number | 成立所需最低总票数 `max(ceil(参与人数×10%), 2)` |
| status | string | `pending` 昭示中 / `settled` 已结算 |
| winner | string | `support` 成立 / `oppose` 未成立 |
| createdAt / endsAt | number | 发起时间 / 昭示截止（24 小时） |
| settledAt | number | 结算时间 |

成立条件（三件套）：
1. 支持票 > 否决票；
2. 总票数 ≥ max(ceil(参与人数 × 10%), 2)；
3. 支持票 ≥ 2 且 否决票 ≥ 1（防单人操纵）。

保证金分配：投对票者按投入比例瓜分投错票者的保证金池（爻守恒，平台不收取费用）。成立则判定结果翻转，按新结果结算；不成立维持原判定。

> 仲裁终局：`settleArbitration` 结算后市场直接进入可结算状态（`disputeEndsAt = 当前时间`），不再重新昭示，防止「判定 → 昭示 → 仲裁 → 昭示」循环。

建议索引：`marketId + status`、`status + endsAt`（定时结算）、`challenger.openid`（发起冷却 / 同时参与上限）。

## 10. arbitration_votes（仲裁投票）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | `${arbitrationId}_${openid}`（一人一票） |
| arbitrationId / marketId | string | 关联仲裁与事件 |
| openid | string | 投票人 |
| side | string | `support` 支持仲裁 / `oppose` 否决仲裁 |
| bond | number | 投票保证金（≥ 10，自定义投入整数爻，与 _shared/config.js VOTE_BOND_MIN 一致） |
| isChallenger | boolean | 是否为发起人 |
| createdAt | Date | 投票时间 |

建议索引：`arbitrationId`、`openid`。

## 11. leaderboards（榜单物化缓存）

`getLeaderboard` / `pkLeaderboard` 惰性写入的 top 榜缓存（TTL 默认 10 分钟，`LEADERBOARD_CACHE_MINUTES` 可调），把「每次请求全集合 count + top N 拉取」降为「读缓存文档 + 2 次轻量 count」。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 榜单类型：streak / week / month / total / pk |
| list | object[] | `[{ openid, nickname, avatarUrl, value }]`；pk 榜为 `[{ openid, nickname, avatarUrl, wins, losses, total, winRate }]` |
| total | number | 上榜人数 |
| updatedAt | number | 最近重建时间（CAS 并发写依据） |

建议索引：无需额外索引（按 `_id` 单文档读写）。

## 12. ad_rewards（激励广告服务端回调交易去重）

启用「激励视频广告服务端奖励回调」后由 `adRewardCallback` 写入，按 `transaction_id` 去重，保证同一笔广告奖励只发放一次。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 微信广告回调的 `transaction_id`（天然去重） |
| userId | string | 用户 openid（广告回调 `user_id`） |
| amount | number | 本次发放爻 |
| granted | boolean | 是否实际发放（超每日限额时为 false） |
| createdAt | Date | 回调登记时间 |

另注：`markets` 集合在结算期间会临时出现 `settling: true` / `settlingAt`（市场级结算锁，防 cron 与手动结算并发重复派奖）；`pks` 的未应战挑战被市场结算作废时写入 `expiredAt`。
