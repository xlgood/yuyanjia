const cloud = require('wx-server-sdk');

// 管理员 openid（部署时在云函数环境变量配置 ADMIN_OPENIDS，逗号分隔；空 = 仅 Mock 可进后台）
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function toTs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return new Date(v).getTime() || 0;
  if (v.$date) return v.$date;
  if (typeof v.getTime === 'function') return v.getTime();
  return 0;
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function last7Days() {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    out.push({
      key: dayKey(d.getTime()),
      label: (d.getMonth() + 1) + '月' + d.getDate() + '日',
      count: 0
    });
  }
  return out;
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!ADMIN_OPENIDS.includes(OPENID)) return { ok: false, err: '无权限操作' };

  // 集合缺失时降级为空数组，避免看板白屏
  const safeGet = async name => {
    try {
      return (await db.collection(name).limit(1000).get()).data;
    } catch (e) {
      return [];
    }
  };

  const [markets, arbitrations] = await Promise.all([
    safeGet('markets'),
    safeGet('arbitrations')
  ]);

  const stats = {
    total: markets.length,
    open: 0,
    dispute_window: 0,
    resolved: 0,
    manual: 0,
    dailyCreated: last7Days(),
    methodDist: { auto_api: 0, manual: 0, none: 0 },
    autoStats: {},
    pending: { manual: 0, dispute: 0, disputes: arbitrations.length }
  };

  const dayIndex = {};
  stats.dailyCreated.forEach(d => { dayIndex[d.key] = d; });

  for (const m of markets) {
    if (m.status === 'open') stats.open++;
    else if (m.status === 'dispute_window') stats.dispute_window++;
    else if (m.status === 'resolved') stats.resolved++;

    if (m.needsManualReview) stats.manual++;

    const dk = dayKey(toTs(m.createdAt));
    if (dayIndex[dk]) dayIndex[dk].count++;

    const spec = m.resolutionSpec || {};
    const provider = (spec.dataSource && spec.dataSource.provider) || '未配置数据源';
    if (!stats.autoStats[provider]) stats.autoStats[provider] = { ok: 0, fail: 0 };

    if (m.status === 'resolved' && m.resolutionMethod) {
      stats.methodDist[m.resolutionMethod] = (stats.methodDist[m.resolutionMethod] || 0) + 1;
      stats.autoStats[provider].ok++;
    } else if (m.needsManualReview) {
      stats.methodDist.manual = (stats.methodDist.manual || 0) + 1;
      stats.autoStats[provider].fail++;
    } else if (m.status === 'resolved') {
      // 已结卦但没有自动断卦记录 → 视为人工录入断卦
      stats.methodDist.manual = (stats.methodDist.manual || 0) + 1;
    } else {
      stats.methodDist.none = (stats.methodDist.none || 0) + 1;
    }
  }

  stats.pending.manual = stats.manual;
  stats.pending.dispute = stats.dispute_window;
  stats.maxDaily = Math.max(1, ...stats.dailyCreated.map(d => d.count));
  stats.autoStats = Object.keys(stats.autoStats)
    .map(provider => {
      const s = stats.autoStats[provider];
      const total = s.ok + s.fail;
      return {
        label: provider,
        ok: s.ok,
        fail: s.fail,
        rate: total > 0 ? Math.round((s.ok / total) * 100) : 0
      };
    })
    .sort((a, b) => b.ok - a.ok);
  stats.methodDist = [
    { method: 'auto_api', label: 'API 自动断卦', count: stats.methodDist.auto_api || 0 },
    { method: 'manual', label: '人工录入断卦', count: stats.methodDist.manual || 0 },
    { method: 'none', label: '未断卦', count: stats.methodDist.none || 0 }
  ];

  return { ok: true, stats };
};
