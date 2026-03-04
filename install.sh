#!/bin/bash
# 78code Quota Monitor - 一键安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/zxyyang/78code-quota-monitor/main/install.sh | bash

set -e

REPO="https://raw.githubusercontent.com/zxyyang/78code-quota-monitor/main"
DIR="$HOME/.claude/hooks/quota-monitor"

echo ""
echo "  78code Quota Monitor 安装程序"
echo "  ================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "  ✗ 未找到 Node.js，请先安装: https://nodejs.org"
  exit 1
fi

# 检查 Claude Code hooks 目录
if [ ! -d "$HOME/.claude/hooks" ]; then
  echo "  ✗ 未找到 Claude Code hooks 目录 (~/.claude/hooks)"
  echo "    请确认已安装 Claude Code"
  exit 1
fi

# 创建目录
mkdir -p "$DIR"

# 下载核心文件
echo "  → 下载核心文件..."
curl -fsSL "$REPO/cli.js" -o "$DIR/cli.js"
curl -fsSL "$REPO/check.js" -o "$DIR/check.js"

# 注入到状态栏
echo "  → 安装到状态栏..."
node "$DIR/cli.js" install

echo ""
echo "  ✓ 安装完成!"
echo ""
echo "  下一步 - 登录你的 78code 账号:"
echo ""
echo "    node ~/.claude/hooks/quota-monitor/cli.js login <用户名> <密码>"
echo ""
echo "  登录后重启 Claude Code 即可在状态栏看到额度信息。"
echo ""
echo "  更多命令:"
echo "    node ~/.claude/hooks/quota-monitor/cli.js status    # 查看状态"
echo "    node ~/.claude/hooks/quota-monitor/cli.js refresh   # 刷新额度"
echo "    node ~/.claude/hooks/quota-monitor/cli.js logout    # 退出登录"
echo ""
