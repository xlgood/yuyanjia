#!/usr/bin/env bash
# =========================================================
# 预言大师 · 云函数一键上传脚本（@cloudbase/cli）
#
# 用法：
#   1) 首次：npm run deploy:login   （浏览器登录腾讯云）
#   2) 上传本次改动的函数：npm run deploy
#   3) 全量上传（首次部署所有 37 个函数）：npm run deploy:all
#
# 说明：
#   - 依赖 @cloudbase/cli，自动安装到本仓库 node_modules（不污染全局）
#   - 环境 ID 与项目配置从 project.config.json / project.private.config.json 读取
#   - 登录态保存在 ~/.cloudbase，脚本可重复执行
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

# 本次改动的云函数（登录态/荣誉节流/广告回调/结算/快照定时器）
FUNCS=(
  login
  checkHonors
  adRewardCallback
  settleMarket
  rankSnapshot
  settleArbitration
  resolver
)

case "${1:-deploy}" in
  login)
    echo "==> 打开浏览器登录腾讯云（一次即可，凭证存 ~/.cloudbase）"
    exec "$CLI" login
    ;;
  deploy)
    for f in "${FUNCS[@]}"; do
      echo "==> 上传 $f ..."
      "$CLI" functions:deploy "$f" -e "$ENV_ID"
    done
    echo "==> 完成。请到控制台核对 rankSnapshot 触发器时间（应为每天 23:55）。"
    ;;
  all)
    echo "==> 全量上传 cloudfunctions/ 下所有函数 ..."
    for d in cloudfunctions/*/; do
      f="$(basename "$d")"
      echo "==> 上传 $f ..."
      "$CLI" functions:deploy "$f" -e "$ENV_ID" || echo "!! $f 上传失败，继续"
    done
    echo "==> 完成。"
    ;;
  *)
    echo "用法: $0 [login|deploy|all]" >&2
    exit 1
    ;;
esac
