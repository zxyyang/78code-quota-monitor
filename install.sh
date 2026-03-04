#!/bin/bash
# 78code Quota Monitor - 一键安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/zxyyang/78code-quota-monitor/main/install.sh | bash

set -e

echo ""
echo "  💰 78code Quota Monitor 安装程序"
echo "  ================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "  ✗ 未找到 Node.js，请先安装: https://nodejs.org"
  exit 1
fi

# 检查 npm
if ! command -v npm &> /dev/null; then
  echo "  ✗ 未找到 npm"
  exit 1
fi

# 全局安装 npm 包
echo "  → 安装 npm 包..."
npm install -g 78code-quota-monitor

# 运行安装
echo "  → 安装到状态栏..."
78code-quota install

echo ""
echo "  ✓ 安装完成!"
echo ""
echo "  下一步 - 运行交互式设置:"
echo ""
echo "    78code-quota"
echo ""
echo "  或直接登录:"
echo ""
echo "    78code-quota login <用户名> <密码>"
echo ""
