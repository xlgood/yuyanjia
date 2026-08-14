#!/usr/bin/env bash
# =========================================================
# 预测卦局 · 云函数一键上传脚本（@cloudbase/cli）
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

# 部署函数清单：从 cloudfunctions/ 目录动态生成（排除 _shared 公共目录），
# 避免手工维护白名单导致新增/既有函数漏传（曾漏掉 lockMarkets/updateProfile 等 15 个函数）
FUNCS=()
for d in cloudfunctions/*/; do
  f="$(basename "$d")"
  [ "$f" = "_shared" ] && continue
  FUNCS+=("$f")
done

echo "==> 同步公共配置（sync:common）..."
node scripts/sync-common.js

deploy_one() {
  local f="$1"
  echo "==> 上传 $f ..."
  if "$CLI" functions:deploy "$f" -e "$ENV_ID"; then
    echo "   ✓ $f 上传成功"
    return 0
  else
    echo "   ✗ $f 上传失败"
    return 1
  fi
}

case "${1:-deploy}" in
  login)
    echo "==> 打开浏览器登录腾讯云（一次即可，凭证存 ~/.cloudbase）"
    exec "$CLI" login
    ;;
  deploy)
    failed=0
    for f in "${FUNCS[@]}"; do
      deploy_one "$f" || failed=$((failed + 1))
    done
    if [ "$failed" -gt 0 ]; then
      echo "==> 有 $failed 个函数上传失败，请检查后重试。"
      exit 1
    fi
    echo "==> 全部 ${#FUNCS[@]} 个函数上传完成。注意：触发器需在控制台手工配置（见 docs/部署检查清单.md）。"
    ;;
  all)
    echo "==> 全量上传 cloudfunctions/ 下所有函数（跳过 _shared 公共目录）..."
    failed=0
    for f in "${FUNCS[@]}"; do
      deploy_one "$f" || failed=$((failed + 1))
    done
    if [ "$failed" -gt 0 ]; then
      echo "==> 有 $failed 个函数上传失败，请检查后重试。"
      exit 1
    fi
    echo "==> 全部 ${#FUNCS[@]} 个函数上传完成。注意：触发器需在控制台手工配置（见 docs/部署检查清单.md）。"
    ;;
  *)
    echo "用法: $0 [login|deploy|all]" >&2
    exit 1
    ;;
esac
