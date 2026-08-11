#!/usr/bin/env bash
# =========================================================
# 预言大师 · 云函数一键上传脚本（@cloudbase/cli）
#
# 用法：
#   1) 首次：npm run deploy:login   （浏览器登录腾讯云）
#   2) 上传本次改动的函数：npm run deploy
#   3) 全量上传（首次部署所有函数）：npm run deploy:all
#
# 说明：
#   - 依赖 @cloudbase/cli，自动安装到本仓库 node_modules（不污染全局）
#   - 上传前自动运行 sync:common，把公共配置拷进各消费函数（勿手改拷贝）
#   - 触发器不能由本脚本管理：CLI 上传不会同步 config.json，需在控制台
#     「触发管理」手工配置（清单见 docs/部署检查清单.md）
# =========================================================
set -euo pipefail
cd "$(dirname "$0")/.."

CLI=node_modules/.bin/cloudbase
CLI_PKG="@cloudbase/cli@2.8.0"

if [ ! -x "$CLI" ]; then
  echo "==> 未检测到 @cloudbase/cli，正在安装（仅本仓库）..."
  npm install --no-save "$CLI_PKG"
fi

ENV_ID="${CLOUDBASE_ENV_ID:-cloud1-d0gyxil2hba0873d3}"

# 已改动过、需要（重新）上传的云函数（随迭代追加）
FUNCS=(
  login
  checkHonors
  adRewardCallback
  settleMarket
  settleArbitration
  resolver
  getLeaderboard
  pkLeaderboard
  rankSnapshot
  getMarkets
  createMarket
  placeBet
  createPk
  respondPk
  myPks
  migratePoints
  checkIn
  claimAdTask
  claimRelief
  createArbitration
  voteArbitration
)

echo "==> 同步公共配置（sync:common）..."
node scripts/sync-common.js

case "${1:-deploy}" in
  login)
    echo "==> 打开浏览器登录腾讯云（一次即可，凭证存 ~/.cloudbase）"
    exec "$CLI" login
    ;;
  deploy)
    for f in "${FUNCS[@]}"; do
      echo "==> 上传 $f ..."
      "$CLI" functions:deploy "$f" -e "$ENV_ID" || echo "!! $f 上传失败，继续"
    done
    echo "==> 完成。注意：触发器需在控制台手工配置（见 docs/部署检查清单.md）。"
    ;;
  all)
    echo "==> 全量上传 cloudfunctions/ 下所有函数（跳过 _shared 公共目录）..."
    for d in cloudfunctions/*/; do
      f="$(basename "$d")"
      [ "$f" = "_shared" ] && continue
      echo "==> 上传 $f ..."
      "$CLI" functions:deploy "$f" -e "$ENV_ID" || echo "!! $f 上传失败，继续"
    done
    echo "==> 完成。注意：触发器需在控制台手工配置（见 docs/部署检查清单.md）。"
    ;;
  *)
    echo "用法: $0 [login|deploy|all]" >&2
    exit 1
    ;;
esac
