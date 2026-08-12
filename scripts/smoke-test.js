// =========================================================
// Mock 全流程冒烟测试（Node 环境运行，无需微信开发者工具）
// 用法：node scripts/smoke-test.js
// =========================================================
const assert = require('assert');

// 用内存 storage 模拟 wx 环境
const memStore = {};
global.wx = {
  getStorageSync: key => memStore[key],
  setStorageSync: (key, val) => { memStore[key] = val; }
};

const mock = require('../miniprogram/utils/mock-data');

async function main() {
  // 1. 登录
  const login = await mock.call('login');
  assert.strictEqual(login.ok, true);
  assert.strictEqual(login.user.points, 100, '初始爻应为 100');
  console.log('✓ 登录，初始爻 100');

  // 2. 合约列表
  const markets = await mock.call('getMarkets');
  assert.strictEqual(markets.ok, true);
  assert.strictEqual(markets.list.length, 8, '应返回 8 个进行中合约');
  const catFilter = await mock.call('getMarkets', { category: '影视娱乐' });
  assert.ok(catFilter.list.every(m => m.category === '影视娱乐'));
  console.log('✓ 合约列表与分类筛选');

  // 热门标签：总池 ≥ 门槛，按总爻降序
  const hot = await mock.call('getMarkets', { hot: true, minTotal: 200 });
  assert.ok(hot.list.length >= 1, '热门标签应至少返回 1 条');
  assert.ok(hot.list.every(m => m.yesPool + m.noPool >= 200), '热门合约总池应 ≥ 门槛');
  for (let i = 1; i < hot.list.length; i++) {
    assert.ok(
      hot.list[i - 1].yesPool + hot.list[i - 1].noPool >= hot.list[i].yesPool + hot.list[i].noPool,
      '热门列表应按总池降序'
    );
  }
  console.log('✓ 热门标签：门槛过滤 + 总池降序');

  // 3. 表态（下注）
  const bet = await mock.call('placeBet', { marketId: 'M004', choice: 'NO', amount: 20 });
  assert.strictEqual(bet.ok, true);
  assert.strictEqual(bet.user.points, 80, '扣减后应为 80');
  assert.strictEqual(bet.market.noPool, 110, 'NO 池应增加 20');
  assert.strictEqual(bet.market.yesPool + bet.market.noPool, 210);
  console.log('✓ 表态：爻扣减、NO 池增加、总池正确');

  // 4. 重复表态应被拒绝
  const dup = await mock.call('placeBet', { marketId: 'M004', choice: 'YES', amount: 10 });
  assert.strictEqual(dup.ok, false);
  console.log('✓ 重复表态被拒绝');

  // 5. 详情返回我的表态
  const detail = await mock.call('getMarketDetail', { marketId: 'M004' });
  assert.strictEqual(detail.myBet.choice, 'NO');
  assert.strictEqual(detail.myBet.amount, 20);
  console.log('✓ 详情返回我的表态');

  // 6. 判定 + 结算（NO 胜出）
  const resolve = await mock.call('resolveMarket', { marketId: 'M004', result: 'NO' });
  assert.strictEqual(resolve.ok, true);
  const settle = await mock.call('settleMarket', { marketId: 'M004' });
  assert.strictEqual(settle.ok, true);
  // 瓜分：20 / 110 × 210 = 38.18 → floor 38（整数向下取整，不产生小数发放）
  const expectedPayout = Math.floor((20 / 110) * 210);
  assert.strictEqual(expectedPayout, 38);
  const after = await mock.call('login');
  assert.strictEqual(after.user.points, 80 + expectedPayout, '结算后爻应为 118');
  assert.strictEqual(after.user.streak, 1, '胜出方连胜 +1');
  // 榜单只累计净收益（不含本金），投入 20，净收益 = 38 - 20 = 18
  assert.strictEqual(after.user.weekPoints, expectedPayout - 20);
  console.log('✓ 瓜分池结算：返还', expectedPayout, '（榜单记净收益', expectedPayout - 20, '），连胜 +1');

  // 7. 历史记录
  const records = await mock.call('getMyRecords');
  assert.strictEqual(records.list.length, 1);
  assert.strictEqual(records.list[0].status, 'won');
  assert.strictEqual(records.list[0].payout, expectedPayout);
  const recPage = await mock.call('getMyRecords', { page: 1, pageSize: 1 });
  assert.strictEqual(recPage.list.length, 1);
  assert.strictEqual(typeof recPage.hasMore, 'boolean', '分页应返回 hasMore');
  assert.ok(recPage.total >= 1, '分页应返回总数');
  console.log('✓ 历史记录状态为「预言成功」');

  // 8. 申诉流程：先表态再判定，提交申诉后不能直接结算
  await mock.call('placeBet', { marketId: 'M005', choice: 'YES', amount: 10 });
  await mock.call('resolveMarket', { marketId: 'M005', result: 'NO' });
  const dispute = await mock.call('submitDispute', { marketId: 'M005', reason: '气象站显示温度为 34.9℃，证据链接见申诉正文' });
  assert.strictEqual(dispute.ok, true);
  const blocked = await mock.call('settleMarket', { marketId: 'M005' });
  assert.strictEqual(blocked.ok, false, '有申诉时应阻止自动结算');
  const forced = await mock.call('settleMarket', { marketId: 'M005', force: true });
  assert.strictEqual(forced.ok, true, '管理员强制结算应成功');
  console.log('✓ 申诉流程：提交申诉 → 自动结算被阻止 → 强制结算通过');

  // 9. 破产补助：把爻打光再领取
  const left = (await mock.call('login')).user.points; // 118 - 10(已投) + 0 = 108
  await mock.call('placeBet', { marketId: 'M006', choice: 'NO', amount: left });
  await mock.call('resolveMarket', { marketId: 'M006', result: 'YES' });
  await mock.call('settleMarket', { marketId: 'M006' });
  const broke = await mock.call('login');
  assert.strictEqual(broke.user.points, 0, '爻应归零');
  const relief = await mock.call('claimRelief');
  assert.strictEqual(relief.ok, true);
  assert.strictEqual(relief.user.points, 50, '补助应发放 50');
  const reliefAgain = await mock.call('claimRelief');
  assert.strictEqual(reliefAgain.ok, false, '冷却期内不可重复领取');
  console.log('✓ 破产补助：归零可领 50，24 小时冷却生效');

  // 10. 榜单与昵称
  const lb = await mock.call('getLeaderboard', { type: 'total' });
  assert.ok(lb.list.some(x => x.isMe));
  assert.ok(lb.list.every(x => !x.trend || ['up', 'down', 'same', 'new'].includes(x.trend)), '趋势字段应合法');
  assert.ok(typeof lb.list.find(x => x.isMe).gapToNext === 'number', '追赶提示应为数字');
  const profile = await mock.call('updateProfile', { nickname: '测试预言家' });
  assert.strictEqual(profile.user.nickname, '测试预言家');
  console.log('✓ 榜单包含我的排名，昵称可修改');

  // 11. 运营后台：数据源注册、发题、待判定队列
  const srcRes = await mock.call('upsertDataSource', {
    name: '测试数据源', category: '科技数码', type: 'api', access: 'free', url: 'https://example.com/api', notes: '冒烟测试'
  });
  assert.strictEqual(srcRes.ok, true);
  const srcBad = await mock.call('upsertDataSource', {
    name: '赌博数据源', category: '科技数码', type: 'api', access: 'free', url: '', notes: 'bad'
  });
  assert.strictEqual(srcBad.ok, false, '数据源名称含敏感词应拒绝');
  const sources = await mock.call('getDataSources');
  assert.ok(sources.list.length >= 9);
  const frozen = await mock.call('upsertDataSource', {
    id: 'SRC-WEATHER-CMA', name: '中国气象网实时天气', category: '趣味民生', type: 'api', access: 'free', url: 'http://www.weather.com.cn/data/sk/101010100.html', notes: '', status: 'frozen'
  });
  assert.strictEqual(frozen.list.find(s => s._id === 'SRC-WEATHER-CMA').status, 'frozen');
  const created = await mock.call('createMarket', {
    category: '科技数码',
    title: '测试合约：某公司是否于下月官宣新一代芯片的发布日期？',
    sourceOfTruth: '以官方公告为准。',
    deadline: Date.now() + 86400000,
    resolutionSpec: {
      version: 1,
      dataSource: { type: 'manual', provider: '官方公告' },
      humanReadable: '以品牌官方公告为准。出现发布日期声明则“预言成功”，否则“预言未成功”。'
    }
  });
  assert.strictEqual(created.ok, true);
  const markets2 = await mock.call('getMarkets');
  assert.ok(markets2.list.some(m => m._id === created.marketId), '新发布的合约应出现在首页列表');
  const pending = await mock.call('getPendingReviews');
  assert.ok(pending.list.some(m => m.reviewType === 'manual_fail' && m.needsManualReview), 'M009 应进入待人工判定队列');
  assert.ok(pending.list.some(m => m.reviewType === 'manual_fail'), '自动判定失败的合约应进入复核队列');
  console.log('✓ 运营后台：数据源注册/冻结、发题、待判定队列');

  // 12. 运营看板
  const dash = await mock.call('getDashboardStats');
  assert.strictEqual(dash.ok, true);
  assert.ok(dash.stats.total >= 11, '总合约数应包含演示数据');
  assert.ok(dash.stats.resolved >= 2, '已结算应至少 2 个');
  assert.strictEqual(dash.stats.dailyCreated.length, 7, '近 7 天发题数据应为 7 天');
  assert.ok(dash.stats.autoStats.some(s => s.label === '中国气象网' && s.ok >= 1), '中国气象网应有成功判定记录');
  assert.ok(dash.stats.methodDist.some(m => m.method === 'auto_api' && m.count >= 2), '自动判定合约应至少 2 个');
  assert.ok(dash.stats.pending.manual >= 1, '待人工判定应至少 1 个');
  console.log('✓ 运营看板：状态分布/近7天发题/判定成功率');

  // 13. AI 起草判定条件（Mock 模拟）
  const aiDraft = await mock.call('aiDraftSpec', {
    title: '明天 14:00 北京南郊观象台气温是否 ≥ 35.0℃？',
    sources: [{ name: '中国气象网', type: 'api' }]
  });
  assert.strictEqual(aiDraft.ok, true);
  assert.strictEqual(aiDraft.spec.mode, 'numeric');
  assert.strictEqual(aiDraft.spec.operator, '>=');
  assert.ok(aiDraft.spec.humanReadable.length > 10);
  const aiManual = await mock.call('aiDraftSpec', { title: '某品牌是否官宣下一代产品发布日期？' });
  assert.strictEqual(aiManual.spec.mode, 'manual');
  console.log('✓ AI 起草判定条件（Mock）：数值型/事实型');

  // 14. AI 选题助手（Mock 模拟）
  const suggest = await mock.call('aiSuggestTopics', {
    topic: '本周热点',
    sources: [{ name: '中国气象网', type: 'api' }]
  });
  assert.strictEqual(suggest.ok, true);
  assert.ok(Array.isArray(suggest.list) && suggest.list.length >= 3, '应返回至少 3 条候选');
  assert.ok(suggest.list.every(c => c.title.length >= 10 && c.category), '候选事件应包含标题与分类');
  console.log('✓ AI 选题助手（Mock）：候选清单');

  // 15. 批量发题的 spec 规范化工具
  const { buildResolutionSpec } = require('../miniprogram/utils/spec');
  const spec = buildResolutionSpec(
    { mode: 'numeric', provider: '中国气象网', field: 'weatherinfo.temp', transform: 'int', operator: '>=', value: 35, unit: '℃', humanReadable: '测试判定文案' },
    [{ name: '中国气象网', url: 'http://www.weather.com.cn/data/sk/101010100.html' }]
  );
  assert.strictEqual(spec.dataSource.url, 'http://www.weather.com.cn/data/sk/101010100.html');
  assert.strictEqual(spec.condition.operator, '>=');
  assert.strictEqual(spec.binaryRule.missingData, 'refund');
  const manualSpec = buildResolutionSpec({ mode: 'manual', provider: '官方公告', humanReadable: '以官方公告为准' }, []);
  assert.strictEqual(manualSpec.dataSource.type, 'manual');
  console.log('✓ 批量发题 spec 构建工具');

  // 16. 大数字格式化（避免长串 0）
  const fmt2 = require('../miniprogram/utils/format');
  assert.strictEqual(fmt2.formatNumber(12345), '1.2万');
  assert.strictEqual(fmt2.formatNumber(123456789), '1.23亿');
  assert.strictEqual(fmt2.formatNumber(9876), '9,876');
  console.log('✓ 大数字格式化：万/亿/千分位');

  // 17. API 封装回归：login/updateProfile 直接返回用户对象（曾因返回 {ok,user} 导致页面数据空白）
  // 冒烟测试与全局运行模式解耦：强制走 Mock 分支（生产配置 USE_MOCK=false 时脚本也应可运行）
  require('../miniprogram/utils/config').USE_MOCK = true;
  const api = require('../miniprogram/utils/api');
  const apiLogin = await api.login();
  assert.strictEqual(apiLogin._id, 'MOCK_USER', 'login 应直接返回用户对象');
  assert.ok(apiLogin.nickname, '默认昵称应存在');
  assert.strictEqual(typeof apiLogin.points, 'number', '能量值应为数字');
  assert.ok(apiLogin.avatar, '默认头像应存在');
  const apiProfile = await api.updateProfile({ nickname: 'API测试员', avatar: '🦊' });
  assert.strictEqual(apiProfile.nickname, 'API测试员');
  assert.strictEqual(apiProfile.avatar, '🦊');
  // 只换头像不应重置昵称
  const apiAvatarOnly = await api.updateProfile({ avatar: '🐼' });
  assert.strictEqual(apiAvatarOnly.nickname, 'API测试员', '单独换头像不应重置昵称');
  assert.strictEqual(apiAvatarOnly.avatar, '🐼');
  console.log('✓ API 封装回归：login/updateProfile 返回用户对象，昵称/头像可更新');

  // 18. 昵称校验：长度 / 注入 / 敏感词
  const { validateNickname } = require('../miniprogram/utils/validate');
  assert.strictEqual(validateNickname('   ').ok, false, '空昵称应被拒绝');
  assert.strictEqual(validateNickname('一二三四五六七八九十甲乙丙丁').ok, false, '超长昵称应被拒绝');
  assert.strictEqual(validateNickname('<script>alert(1)</script>').ok, false, '脚本注入应被拒绝');
  assert.strictEqual(validateNickname('onclick=alert(1)').ok, false, '事件注入应被拒绝');
  assert.strictEqual(validateNickname('fuck').ok, false, '敏感词应被拒绝');
  assert.strictEqual(validateNickname('小明').ok, true, '正常昵称应通过');
  const badNick = await mock.call('updateProfile', { nickname: '<script>' });
  assert.strictEqual(badNick.ok, false, '更新接口应拒绝非法昵称');
  const goodNick = await mock.call('updateProfile', { nickname: '小明' });
  assert.strictEqual(goodNick.ok, true);
  assert.strictEqual(goodNick.user.nickname, '小明');
  console.log('✓ 昵称校验：长度/注入/敏感词');

  // 19. 每日签到
  const ci1 = await mock.call('checkIn');
  assert.strictEqual(ci1.ok, true, '首次签到应成功');
  assert.ok(ci1.checkIn.granted >= 5, '签到应发放爻');
  const ci2 = await mock.call('checkIn');
  assert.strictEqual(ci2.ok, false, '同日重复签到应被拒绝');
  console.log('✓ 每日签到：发放爻 + 防重复');

  // 20. 广告任务（每日限次）
  let adPoints = 0;
  for (let i = 0; i < 3; i++) {
    const r = await mock.call('claimAdTask');
    assert.strictEqual(r.ok, true);
    adPoints += r.adTask.granted;
  }
  assert.strictEqual(adPoints, 30, '3 次应共发放 30');
  const ad4 = await mock.call('claimAdTask');
  assert.strictEqual(ad4.ok, false, '第 4 次应被拒绝');
  console.log('✓ 广告任务：每日限次发放');

  // 21. 荣誉体系：表态自动解锁「初露锋芒」，checkHonors 幂等
  const hr1 = await mock.call('checkHonors');
  assert.strictEqual(hr1.ok, true);
  assert.ok(hr1.honors.includes('honor_first_bet'), '首次表态后应解锁初露锋芒');
  const hr2 = await mock.call('checkHonors');
  assert.strictEqual(hr2.unlocked.length, 0, '重复检测不应重复解锁');
  assert.strictEqual(hr2.honors.filter(h => h === 'honor_first_bet').length, 1, '荣誉不应重复记录');
  console.log('✓ 荣誉体系：表态自动解锁 + 幂等检测');

  // 22. 邀请裂变：模拟好友注册并首次表态 → 邀请人得奖励
  const before = await mock.call('inviteStats');
  const sim = await mock.call('simulateInvite');
  assert.strictEqual(sim.ok, true);
  assert.strictEqual(sim.granted, 5, '邀请人应获得 5 爻');
  assert.strictEqual(sim.stats.totalInvites, before.stats.totalInvites + 1, '累计邀请应 +1');
  assert.strictEqual(sim.stats.rewardedCount, before.stats.rewardedCount + 1, '已得奖励应 +1');
  assert.strictEqual(sim.list[0].inviterRewarded, true);
  assert.strictEqual(sim.list[0].inviteeNickname, '测试道友1');
  const inviteAfter = await mock.call('inviteStats');
  assert.strictEqual(inviteAfter.stats.totalInvites, 1);
  assert.ok(inviteAfter.list.length === 1);
  console.log('✓ 邀请裂变：模拟好友注册 → 邀请人奖励发放');

  // 23. 邀请归属：被邀请人首开加成 + 首次表态触发邀请人奖励（云端等价逻辑）
  const invitedLogin = await mock.call('login', { invite: 'u2' });
  assert.strictEqual(invitedLogin.ok, true);
  assert.strictEqual(invitedLogin.user.invitedBy, 'u2', '应记录邀请归属');
  assert.strictEqual(invitedLogin.user.points, 110, '被邀请人应获得 100 初始 + 10 首开加成');
  const invitedBet = await mock.call('placeBet', { marketId: 'M007', choice: 'YES', amount: 10 });
  assert.strictEqual(invitedBet.ok, true);
  assert.strictEqual(invitedBet.inviteRewardGranted, 5, '邀请人应获得 5 爻');
  console.log('✓ 邀请归属：首开加成 + 首次表态触发奖励');

  // 24. PK：模拟好友发起挑战 → 接受应战 → 判定结算 → 榜单
  const simPk = await mock.call('simulatePkChallenge', {
    marketId: 'M008',
    challenger: { nickname: 'PK 挑战者', avatar: '🦁', choice: 'YES', amount: 10 }
  });
  assert.strictEqual(simPk.ok, true);
  const inbox = await mock.call('myPks');
  assert.ok(inbox.inbox.length >= 1, '应收到挑战');
  assert.strictEqual(inbox.inbox[0].challenger.nickname, 'PK 挑战者');
  const acceptPk = await mock.call('respondPk', { pkId: simPk.pkId, accept: true });
  assert.strictEqual(acceptPk.ok, true);
  assert.strictEqual(acceptPk.status, 'accepted');
  const pkDetail = await mock.call('getMarketDetail', { marketId: 'M008' });
  assert.strictEqual(pkDetail.myBet.choice, 'NO', '应战方应锁定反向立场');
  await mock.call('resolveMarket', { marketId: 'M008', result: 'NO' });
  const pkSettle = await mock.call('settleMarket', { marketId: 'M008' });
  assert.strictEqual(pkSettle.ok, true);
  const pkList = await mock.call('myPks');
  assert.ok(pkList.list.some(p => p.marketId === 'M008' && p.status === 'settled'), 'PK 应已结算');
  const pkLb = await mock.call('pkLeaderboard');
  assert.ok(pkLb.list.length >= 1, 'PK 榜单应至少 1 人');
  console.log('✓ PK 流程：发起 → 应战 → 判定结算 → 榜单');

  // 25. PK：拒绝挑战 → 挑战者爻退回
  const pointsBefore = (await mock.call('login')).user.points;
  const newPk = await mock.call('createPk', { marketId: 'M001', choice: 'YES', amount: 10 });
  assert.strictEqual(newPk.ok, true);
  const decline = await mock.call('respondPk', { pkId: newPk.pk._id, accept: false });
  assert.strictEqual(decline.ok, true);
  assert.strictEqual(decline.status, 'declined');
  const afterDecline = await mock.call('login');
  assert.strictEqual(afterDecline.user.points, pointsBefore, '拒绝后挑战者爻应退回');
  console.log('✓ PK 拒绝：爻退回');

  // 26. 仲裁：发起（参与人数门槛）→ 投票 → 结算 → 翻案/维持
  await mock.call('resolveMarket', { marketId: 'M001', result: 'YES' });
  await mock.call('mockSeedArbitration', { marketId: 'M001' });
  const createArb = await mock.call('createArbitration', { marketId: 'M001', reason: '官方数据源口径与判定条件不一致，判定存在偏差' });
  assert.strictEqual(createArb.ok, true, '满足门槛应能发起仲裁');
  assert.ok(createArb.arbitration.reason.length >= 10, '仲裁应记录理由');
  const badReason = await mock.call('createArbitration', { marketId: 'M001', reason: '太短' });
  assert.strictEqual(badReason.ok, false, '理由过短应拒绝');
  const badReason2 = await mock.call('createArbitration', { marketId: 'M001', reason: '这个判定很垃圾，<script>注入</script>' });
  assert.strictEqual(badReason2.ok, false, '敏感/注入理由应拒绝');
  const badReason3 = await mock.call('createArbitration', { marketId: 'M001', reason: '这个判定涉及台独分裂言论，不应通过' });
  assert.strictEqual(badReason3.ok, false, '政治敏感理由应拒绝');
  const badReason4 = await mock.call('createArbitration', { marketId: 'M001', reason: '这个判定涉嫌毒品交易和色情内容' });
  assert.strictEqual(badReason4.ok, false, '黄赌毒理由应拒绝');
  assert.strictEqual(createArb.arbitration.supportVotes, 1, '发起人默认支持票');
  const arbId = createArb.arbitration._id;
  // 参与人数不足时拒绝
  await mock.call('resolveMarket', { marketId: 'M002', result: 'NO' });
  const tooFew = await mock.call('createArbitration', { marketId: 'M002', reason: '参与人数不足但理由仍然有效并且足够长' });
  assert.strictEqual(tooFew.ok, false, '参与人数不足应拒绝仲裁');
  // 投票门槛：保证金不足 10 拒绝
  const voteBad = await mock.call('voteArbitration', { arbitrationId: arbId, side: 'oppose', bond: 5 });
  assert.strictEqual(voteBad.ok, false, '保证金不足应拒绝');
  // 注入社区投票：2 支持 + 1 否决（发起人 1 支持 → 总 3 支持 1 否决）
  const seedVotes = await mock.call('mockSeedVotes', { arbitrationId: arbId, support: 2, oppose: 1 });
  assert.strictEqual(seedVotes.supportVotes, 3);
  assert.strictEqual(seedVotes.opposeVotes, 1);
  const settleArb = await mock.call('settleArbitration', { arbitrationId: arbId });
  assert.strictEqual(settleArb.ok, true);
  assert.strictEqual(settleArb.wins, true, '支持票>否决票且票数达标应成立');
  assert.strictEqual(settleArb.flipped, true, '成立应翻转判定');
  const arbMarket = await mock.call('getMarketDetail', { marketId: 'M001' });
  assert.strictEqual(arbMarket.market.result, 'NO', '判定应翻转为 NO');
  assert.strictEqual(arbMarket.market.status, 'dispute_window', '翻转后回到判定昭示期等待结算');
  console.log('✓ 仲裁流程：发起 → 门槛 → 投票 → 成立翻转');

  // 27. 仲裁无对赌兜底：只有发起人支持、无人否决 → 保证金全额退回
  await mock.call('resolveMarket', { marketId: 'M003', result: 'YES' });
  await mock.call('mockSeedArbitration', { marketId: 'M003' });
  const pointsBeforeArb = (await mock.call('login')).user.points;
  const soloArb = await mock.call('createArbitration', { marketId: 'M003', reason: '该事件判定结果与官方数据明显不符，需要社区仲裁确认' });
  assert.strictEqual(soloArb.ok, true);
  assert.strictEqual(soloArb.arbitration.supportVotes, 1, '仅发起人 1 票');
  assert.strictEqual(soloArb.arbitration.opposeVotes, 0, '无人否决');
  const settleNoBet = await mock.call('settleArbitration', { arbitrationId: soloArb.arbitration._id });
  assert.strictEqual(settleNoBet.ok, true);
  assert.strictEqual(settleNoBet.noBet, true, '无对赌应标记 no_bet');
  const afterNoBet = await mock.call('login');
  assert.strictEqual(afterNoBet.user.points, pointsBeforeArb, '无对赌时保证金应全额退回');
  console.log('✓ 仲裁无对赌兜底：保证金全额退回');

  console.log('\n✅ 全部冒烟测试通过');
}

main().catch(err => {
  console.error('❌ 冒烟测试失败：', err.message);
  process.exit(1);
});
