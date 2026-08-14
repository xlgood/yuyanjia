# 数据库安全规则（上线前必做）

> 适用范围：云开发环境 `cloud1-d0gyxil2hba0873d3`（`miniprogram/utils/config.js` 的 `CLOUD_ENV`）
> 已核对：小程序前端**没有任何 `wx.cloud.database()` 直连代码**，全部读写都通过云函数完成，
> 因此所有集合都可以上最严格的规则——「所有用户不可读写」。

---

## 一、规则总表

| # | 集合 | 建议规则 | 说明 |
|---|------|----------|------|
| 1 | `users` | **所有用户不可读写** | 含爻/连胜/荣誉，必须禁客户端直读直写，防改包刷爻 |
| 2 | `markets` | **所有用户不可读写** | 列表/详情均由 `getMarkets` / `getMarketDetail` 云函数返回 |
| 3 | `bets` | **所有用户不可读写** | 资金账，禁直写 |
| 4 | `pks` | **所有用户不可读写** | PK 资金相关 |
| 5 | `arbitrations` | **所有用户不可读写** | 仲裁保证金相关 |
| 6 | `arbitration_votes` | **所有用户不可读写** | 投票保证金相关 |
| 7 | `invites` | **所有用户不可读写** | 邀请关系与奖励 |
| 8 | `rank_snapshots` | **所有用户不可读写** | 历史快照，仅云函数读写 |
| 9 | `leaderboards` | **所有用户不可读写** | 榜单物化缓存（getLeaderboard 惰性写入） |
| 10 | `data_sources` | **所有用户不可读写** | 数据源注册表，仅管理员经云函数操作 |
| 11 | `resolution_logs` | **所有用户不可读写** | 判定审计证据 |
| 12 | `ad_rewards` | **所有用户不可读写** | 广告回调去重账（未启用广告也先建好） |
| 13 | `topic_candidates` | **所有用户不可读写** | 定时选题候选（dailyHotTopics 写入 / getTopicCandidates 读取，2026-08-14 新增） |

> 全部统一为「所有用户不可读写」后，客户端即使被改包也无法绕过云函数直接篡改任何数据。
> 云函数运行在服务端上下文，不受该规则限制。

---

## 二、控制台操作步骤（每个集合约 30 秒）

1. 打开 [云开发控制台](https://console.cloud.tencent.com/tcb) → 选择环境 `cloud1-d0gyxil2hba0873d3`；
2. 左侧「数据库」→ 若集合不存在则点「+ 新建集合」逐个创建上表 13 个集合（`ad_rewards` 可随广告接入时创建）；
3. 进入集合 → 「权限设置」标签 → 选择 **「所有用户不可读写」**（或「自定义安全规则」粘贴下面的 JSON）→ 保存；
4. 逐个集合重复第 3 步。

## 三、自定义规则 JSON（等效粘贴版）

若控制台支持「自定义规则」，可直接粘贴：

```json
{
  "read": false,
  "write": false
}
```

## 四、验证方法（强烈建议做一次）

在微信开发者工具 Console 里执行（应被拒绝，报权限错误）：

```js
wx.cloud.init({ env: 'cloud1-d0gyxil2hba0873d3' });
wx.cloud.database().collection('users').limit(1).get()
  .then(() => console.log('❌ 危险：客户端能读到 users！规则未生效'))
  .catch(() => console.log('✅ 客户端直读 users 已被拒绝'));
```

同时确认 App 内所有页面功能（首页/详情/表态/榜单/我的）走云函数后一切正常——两者都通过即安全。

## 五、索引核对（与规则同步确认）

云开发控制台「索引管理」为各集合建立建议索引（详见 `database/design.md` 各节）：

| 集合 | 索引 |
|------|------|
| `users` | `streak`↓、`weekPoints`↓、`monthPoints`↓、`totalPoints`↓、**`points`↓**（总榜按当前爻余额，2026-08-14 新增） |
| `markets` | `status+deadline`、`category+status+deadline`、`status+totalPool`、**`needsManualReview`**、**`status+disputeEndsAt`** |
| `bets` | `openid+createdAt`、`marketId+status`、**`openid+status`**（公断资格统计） |
| `pks` | `marketId+participantIds+status`、`status+expiresAt`、`status` |
| `invites` | `inviterId+createdAt`、`inviterId+inviterRewarded` |
| `rank_snapshots` | `type+date` |
| `arbitrations` | `marketId+status`、`status+endsAt`、`challenger.openid` |
| `arbitration_votes` | `arbitrationId`、`openid`、**`arbitrationId+openid`** |
| `topic_candidates` | **`source+date`**（date 降序） |

> `markets` 的 `status+deadline` 与 `bets` 的 `marketId+status` 直接影响首页列表与结算扫描的读成本，缺失会在数据量上来后拖慢云函数。
