#!/usr/bin/env bash
# 一次发布到两处市场：
#   Open VSX          = CodeBuddy 插件商城
#   VS Code Marketplace
#
# 用法（令牌只走环境变量，别写进文件/聊天）：
#   VSCE_PAT='<Azure DevOps PAT>' OVSX_PAT='ovsxat_xxx' ./publish.sh
#
# 前置：已执行 tsc 编译并 vsce package 出 vsix（脚本会检查）。
set -euo pipefail
cd "$(dirname "$0")"

[ -n "${ALL_PROXY:-}" ] && echo "提示：检测到 ALL_PROXY=$ALL_PROXY；若发布卡住，改用 env -u ALL_PROXY ./publish.sh"

VERSION=$(node -p "require('./package.json').version")
VSIX="git-xlx-${VERSION}.vsix"

if [ ! -f "$VSIX" ]; then
  echo "[x] 找不到 $VSIX，先执行：node_modules/.bin/tsc -p ./ && node_modules/.bin/vsce package"
  exit 1
fi

echo "== 版本 $VERSION · 包 $VSIX"

if [ -n "${OVSX_PAT:-}" ]; then
  echo "-- 发布 Open VSX（CodeBuddy 市场）"
  npx --yes ovsx publish "$VSIX" -p "$OVSX_PAT"
else
  echo "-- 跳过 Open VSX（未设置 OVSX_PAT）"
fi

if [ -n "${VSCE_PAT:-}" ]; then
  echo "-- 发布 VS Code 官方市场"
  node_modules/.bin/vsce publish -i "$VSIX" -p "$VSCE_PAT"
else
  echo "-- 跳过 VS Code 市场（未设置 VSCE_PAT）"
fi

echo "== 完成。核对："
echo "   curl -s https://open-vsx.org/api/xiaolinxin/git-xlx | python3 -m json.tool | head -5"
echo "   node_modules/.bin/vsce show xiaolinxin.git-xlx"