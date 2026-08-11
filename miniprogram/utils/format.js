function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

// 兼容云数据库返回的 Date / ISO 字符串 / {$date: ...} / 时间戳
function toNumber(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return new Date(ts).getTime() || 0;
  if (ts.$date) return ts.$date;
  if (typeof ts.getTime === 'function') return ts.getTime();
  return 0;
}

function formatDeadline(ts) {
  const t = toNumber(ts);
  if (!t) return '--';
  const diff = t - Date.now();
  if (diff > 0 && diff < 24 * 3600 * 1000) {
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `${h}小时${m}分后` : `${m}分钟后`;
  }
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(ts) {
  const t = toNumber(ts);
  if (!t) return '--';
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatNumber(n) {
  const num = Number(n) || 0;
  if (num >= 100000000) return (num / 100000000).toFixed(2) + '亿';
  if (num >= 10000) return (num / 10000).toFixed(1) + '万';
  return String(Math.round(num)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function odds(pool, total) {
  if (!pool || pool <= 0 || !total) return '--';
  return (total / pool).toFixed(2);
}

function rate(pool, total) {
  if (!total) return '--';
  return Math.round(((pool || 0) / total) * 100) + '%';
}

// 北京时间（UTC+8）的日期键，用于签到/任务等“按天”逻辑
function todayKey(offsetDays) {
  const t = Date.now() + 8 * 3600 * 1000 + (offsetDays || 0) * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

module.exports = {
  pad,
  toNumber,
  formatDeadline,
  formatDate,
  formatNumber,
  odds,
  rate,
  todayKey
};
