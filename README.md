# 预言大师（Oracle Master）· 微信小程序 MVP

依据《预言大师：本土化轻量级预测市场项目规划书》开发的微信小程序 MVP：用**虚拟爻**支撑的 YES/NO 热点预测，采用**瓜分池（Pari-mutuel）模型**，配套五维荣誉榜单、5 小时异议公示（跨夜顺延）、社区仲裁（仲裁结果即终局）、破产补助等机制，并通过**审核双视图**满足微信提审合规要求。

> ⚠️ 合规声明：本产品不包含任何法币充值、提现或可变现奖励。爻为平台虚拟积分，仅用于参与活动与兑换虚拟荣誉。

## 当前状态

**已实现（代码完成并已部署云端）**

- 核心玩法：6 大分类（影视娱乐 / 科技数码 / 游戏电竞 / 体育竞技 / 趣味民生 / 财经宏观）YES/NO 表态、瓜分池结算、连胜/周/月/总榜与 PK 胜率榜；
- 事件状态机：`open → locked（截止锁定，等待判定）→ dispute_window（5 小时公示，跨夜顺延）→ resolved`；仲裁结束后直接结算，不再重复公示；
- 自动判定：`resolver` 按 `resolutionSpec` 定时判定（weather/api 适配器），证据写入 `resolution_logs`，连续失败转人工复核；人工判定走运营后台复核队列；
- 并发与资金安全：发钱口原子防双领、市场/仲裁结算锁、逐注事务结算、过期 PK 定时清理（事务化）、未应战 PK 不再污染榜单；
- 社区仲裁：保证金对赌、24 小时投票、成立翻转/不成立维持、无对赌全额退回、仲裁终局；
- 邀请裂变：邀请码归属、首开加成、首次表态触发奖励（每日上限、事务化）、邀请荣誉可解锁；
- 荣誉体系：20 项成就/榜单荣誉，周/月/PK 按历史快照判定，连胜/总榜实时判定；
- 任务与广告：签到（原子防重复）、看激励视频领爻（每日限次，支持服务端回调模式）、破产补助；
- 运营后台：数据源注册表、发题（AI 起草判定条件）、批量发题、待判定/复核队列、看板；
- AI 选题助手（`aiSuggestTopics`，支持 DeepSeek/千问/Kimi 联网搜索；入口当前按策略隐藏，配置好联网后恢复）；
- 内容安全：微信 `msgSecCheck` + 本地敏感词表兜底（不再 fail-open）；
- 工程：`wx-server-sdk` 锁定 4.0.2、首页分页/加载更多/骨架屏/竞态守卫、SDK 版本统一；
- 性能：登录态 TTL 缓存（5 分钟）、荣誉检测节流（默认 10 分钟）、**榜单物化缓存**（`leaderboards` 集合，TTL 10 分钟，榜单查询不再全集合 count）、运营后台 7 页子包化（不进主包）、**热门榜 totalPool 冗余字段索引查询**；
- 监控：结算/仲裁/自动判定异常自动推送企业微信/飞书（复用 `LOCK_WEBHOOK_URL`）；
- 工程：git 基线（main 分支）、`scripts/deploy.sh` 一键上传云函数、**业务常量单一来源**（`cloudfunctions/_shared/config.js`，`npm run sync:common` 同步）、**CI 质量门禁**（`.github/workflows/ci.yml`：语法 + 冒烟 + 合规 + 常量漂移校验）。

**已测试**

- `npm run check`（CI 同款门禁）：公共配置漂移校验 + 79 个 JS 语法检查 + `smoke-test.js` 全链路 + `check-compliance.js` 前端 0 命中；

**待配置（代码已就绪，需要控制台操作）**

- **数据库安全规则（上线安全底线）**：全部集合设「所有用户不可读写」，见 `database/security-rules.md`（含逐集合清单与验证方法）；另需新建 `leaderboards` 集合（榜单物化缓存）；
- 跑一次 `migratePoints`（榜单净收益口径重算 + `inviteCount` 回填）；
- 广告服务端回调：开通 HTTP 访问服务、流量主后台配置回调、创建 `ad_rewards` 集合、设置 `AD_SSV_*` 环境变量、`claimAdTask` 开 `AD_SSV_ENABLED=true`；
- `lockMarkets` 运营通知：配置 `LOCK_WEBHOOK_URL`（企业微信/飞书）；
- 可选环境变量：`DISPUTE_WINDOW_HOURS`（默认 5）、`LOCK_STALE_HOURS`（默认 24）、`HONORS_CHECK_INTERVAL_MINUTES`（默认 10）、`LEADERBOARD_CACHE_MINUTES`（默认 10）、`ALERT_WEBHOOK_URL`（默认回退 `LOCK_WEBHOOK_URL`）。

**待实现 / 待决策**

- 合规评估（审核双视图、广告+预测组合、仲裁对赌）——产品决策项；
- 二期路线：网页抓取判定（第 2 层）、陪审团仲裁、二级市场交易、Web 运营后台；
- 工程：初始化 git/CI。

## 功能清单

- 首页：6 大分类热点预言流，实时展示双池爻与返还倍数；分页加载更多 + 骨架屏 + 快速切换分类的竞态守卫；锁定中的事件显示「⏸ 等待判定中」；
- 详情：判定标准展示、YES/NO 表态、多档额度、已表态状态、判定结果、社区仲裁；截止后显示「已停止表态，等待官方判定」；
- 榜单：连胜榜 / 周榜 / 月榜 / 总积分榜（净收益口径，不含本金）/ PK 胜率榜（最少 5 场门槛），Top 3 奖牌 + 我的排名 + 排名变化箭头 + 追赶提示 + 加载更多；
- 我的：爻与连胜资产、预言记录、破产补助、邀请好友、规则说明；
- 邀请裂变：分享链接带邀请码自动归属，被邀请人首开 +10 爻，其首次表态后邀请人 +5 爻（每日上限防刷，事务化），邀请战绩页实时展示；
- 好友 PK：详情页发起挑战（强制反向立场、爻入池），接受/拒绝，24 小时未应战自动退回（定时清理兜底）；PK 记录中心 + 按胜率排序的 PK 榜；可在「我的」开关是否接受被邀请；
- 荣誉墙：20 项成就/榜单荣誉自动解锁（不消耗爻），实时刷新并提示新解锁；
- 社区仲裁：判定公示期内（事件表态 ≥ 10 人、资格门槛）发起仲裁，锁定全部爻作保证金；支持/否决投票，公示 24 小时；成立则判定翻转、不成立维持原判定；**仲裁结束即终局**，直接进入结算；无对赌时保证金全额退回；同时只能参与 1 个仲裁；
- 任务中心：每日签到（连续签到奖励递增、原子防双领）、看激励视频领爻（每日限次，可选服务端回调校验）；
- 荣誉商城：爻兑换虚拟头像框/专属头衔/勋章（无 resale 价值，符合合规）；
- 用户资料：预设头像（禁止上传）与昵称校验（长度、敏感词、注入拦截，云端叠加微信内容安全检测）；
- 运营后台（仅管理员可见）：数据源注册表维护（先注册后发题，服务端校验）、发布新预言（AI 起草判定条件）、批量发题、待判定/复核队列、运营看板；
- AI 选题助手：输入需求，AI 返回候选预测事件清单（可验证性标注），勾选后直接进发题页（入口当前已隐藏，联网搜索配置好后恢复）；
- 审核双视图：`APP_MODE = 'compliance'` 一键切换为纯民意问卷；
- 开发者模拟结算面板（本地 Mock 模式）：一键模拟判定并验证瓜分池算法。

## 目录结构

```
├── miniprogram/            # 小程序前端
│   ├── app.js / app.json / app.wxss
│   ├── utils/
│   │   ├── config.js       # 运行模式 / 审核模式 / 参数配置
│   │   ├── api.js          # Mock 与云开发统一 API 封装
│   │   ├── mock-data.js    # 本地模拟数据（含结算逻辑）
│   │   ├── constants.js    # 分类、文案、词汇脱敏表
│   │   ├── format.js       # 时间/数字/倍数格式化
│   │   ├── validate.js     # 昵称/仲裁理由校验
│   │   ├── spec.js         # 判定规范构建
│   │   ├── share.js / subscribe.js / ad.js
│   ├── pages/              # 用户端 10 页
│   └── subpackages/admin/  # 运营后台 7 页（子包，不计入主包体积）
├── cloudfunctions/         # 云开发后端（37 个云函数 + _shared 公共配置，wx-server-sdk 锁定 4.0.2）
│   └── _shared/config.js   # 业务常量单一来源（sync:common 拷入各函数）
├── database/               # 集合设计文档 + security-rules（安全规则）+ markets 种子数据 + 判定规范示例
├── docs/开发方案.md         # 完整开发方案（架构/状态机/测试/合规/路线）
├── docs/事件选题与自动判定方案.md  # 事件来源 / 判定条件规范 / 自动结算三层架构
├── docs/广告与变现说明.md    # 广告接入与合规
├── docs/部署检查清单.md      # 云开发部署步骤与上线前检查
├── docs/项目审查报告.md      # 全项目审查报告（含修复记录）
├── docs/prototype/         # 早期 HTML 原型存档（仅参考，与现 UI 已脱节）
├── scripts/
│   ├── deploy.sh           # 云函数一键上传（@cloudbase/cli，npm run deploy）
│   ├── sync-common.js      # 公共配置同步/漂移校验（npm run sync:common）
│   ├── check-syntax.js     # 全仓库 JS 语法检查（npm run check:syntax）
│   ├── smoke-test.js       # 全链路冒烟测试
│   └── check-compliance.js # 合规词表扫描
├── .github/workflows/ci.yml # CI 质量门禁（push/PR 自动跑 npm run check）
├── package.json            # 部署/测试/门禁脚本入口
└── project.config.json
```

## 快速开始（本地预览，无需后端）

1. 打开微信开发者工具 → 导入项目 → 选择本目录；
2. `project.config.json` 中 `appid` 可先使用测试号（云开发功能需真实 AppID）；
3. 当前 `miniprogram/utils/config.js` 的 `USE_MOCK = false`（已接云开发）；本地纯演示请临时改为 `true`，直接编译即可体验全流程；
4. 在详情页底部「开发者模拟结算面板」点击模拟判定，可验证瓜分池结算与连胜/积分变化。

## 接入云开发（正式环境）

1. 注册小程序获取 AppID，替换 `project.config.json` 中 `appid`；
2. 开通云开发并创建环境，将环境 ID 填入 `miniprogram/utils/config.js` 的 `CLOUD_ENV`；
3. 在云开发控制台创建集合（见 `database/design.md`），导入 `database/markets.seed.json`；
4. 上传部署全部云函数（详见 `docs/部署检查清单.md`，含 `ADMIN_OPENIDS`、定时触发器、环境变量）；
5. 核对定时触发器：`lockMarkets`（每分钟）、`resolver` / `settleMarket`（每 10 分钟）、`settleArbitration`（每 5 分钟）、`rankSnapshot`（每天）、`resetPeriods`（每周/每月）、`myPks`（每 10 分钟）；
6. 按 `docs/部署检查清单.md` 的「E. 上线前最终检查」逐项完成。

### 启用 AI 功能（DeepSeek）

1. 到 [DeepSeek 开放平台](https://platform.deepseek.com) 创建 API Key；
2. 云开发控制台 → 云函数 → `aiDraftSpec` / `aiSuggestTopics` → 配置 → 环境变量：添加 `DEEPSEEK_API_KEY`、`ADMIN_OPENIDS`；
3. 上传并部署这两个函数；
4. AI 选题联网搜索：DeepSeek 需账号开通联网搜索配额；也可切换 `AI_PROVIDER=qwen`（配 `QWEN_API_KEY`）或 `kimi`（配 `KIMI_API_KEY`），详见部署清单；
5. AI 选题助手入口当前按运营策略隐藏（`miniprogram/pages/admin/index/index.wxml` 注释），配置好联网搜索后取消注释即可恢复；
6. 本地 Mock 模式下 AI 功能返回固定演示样例（标注“Mock 示例”）。

### AI 选题与发布约束（五项硬性标准）

AI 提示词与 `createMarket` 服务端校验共同执行：

1. **绝对二元性**：结果必须非此即彼，标题须含“是否/能否/是否达到/是否超过”等二值化表述；
2. **单一权威结算源**：只允许一个公开可访问、无争议的第三方结算源；`createMarket` 校验数据源必须在注册表中，判定说明不得出现多个数据源名称；
3. **物理截止时间**：必须有明确截止日期与时刻，截止后信息不作为判定证据（发布限制 90 天内）；
4. **无政治/社会敏感红线**：政治选举、社会争议、司法案件、公共卫生事件一律禁止；
5. **悬念区间 20%-80%**：明显无悬念的事件排除。

## 事件状态机

```
open ──截止时间到（lockMarkets 每分钟）──▶ locked（停止收注，等待判定）
locked ──resolver 自动判定 / 运营人工判定──▶ dispute_window（5h 公示，跨夜顺延）
dispute_window ──公示到期（无仲裁）──▶ resolved
dispute_window ──发起仲裁──▶ arbitration_window（24h）──▶ 仲裁终局 ──▶ resolved
```

详细步骤、验收标准、测试用例与发布流程见 [docs/开发方案.md](docs/开发方案.md)，部署见 [docs/部署检查清单.md](docs/部署检查清单.md)。
