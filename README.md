# 9527code Quota Monitor

Claude Code 状态栏插件 —— 实时显示你的 [9527code.com](https://www.9527code.com) 账号额度、订阅套餐、分组倍率。

```
Opus 4.6 │ myproject │ 💰 zxyang | new-cc 1.5x | $321.51 | vip-1-codex ¥0/50 31d
                       ↑ 用户名    ↑ 分组+倍率    ↑ 钱包余额  ↑ 订阅套餐 额度 剩余天数
```

## 功能

- **状态栏实时显示** — 用户名、分组倍率、钱包余额、订阅套餐，一目了然
- **多色区分** — 用户名(浅蓝)、分组(浅紫)、余额(金黄)、订阅(浅绿)，清晰易读
- **分组识别** — 自动匹配当前 API Key 对应的分组，并显示倍率
- **订阅套餐** — 展示有效套餐名称、已用/总额度、剩余天数，过期自动隐藏
- **全局生效** — 安装一次，所有目录/项目均可显示，无需重复安装
- **可调刷新间隔** — 支持 1 / 2 / 5 / 10 / 30 分钟
- **Cookie 自动续期** — Session 过期后自动用保存的凭据重新登录
- **交互式设置** — 菜单式操作，登录/切换/退出/设置一站搞定
- **一键安装/卸载** — 不污染其他配置，卸载后完全恢复原样
- **零依赖** — 纯 Node.js 内置模块，无需额外安装
- **GSD 兼容** — 与 GSD statusline 完美共存，互不影响

## 前置要求

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 已安装
- Node.js >= 16
- （可选）[GSD statusline](https://github.com/glittercowboy/get-shit-done) — 如已安装会自动兼容，未安装也可独立使用

## 安装

### 方式一：npm 安装（推荐）

```bash
npm install -g 9527code-quota-monitor
```

安装后运行交互式设置：

```bash
9527code-quota
```

会出现交互式菜单，按提示操作即可：

```
  ╔══════════════════════════════════════╗
  ║    💰 9527code Quota Monitor v2.1.1   ║
  ║    Claude Code 状态栏额度监控插件     ║
  ╚══════════════════════════════════════╝

  1.  🔧  安装到状态栏
  2.  🔑  登录 / 切换账号
  3.  ⏱   设置刷新间隔
  4.  📊  查看详细状态
  5.  🔄  立即刷新额度
  6.  🚪  退出登录
  7.  🗑   卸载插件
  0.  退出
```

### 方式二：一键脚本安装

```bash
curl -fsSL https://raw.githubusercontent.com/zxyyang/9527code-quota-monitor/main/install.sh | bash
```

## 快速开始

```bash
# 1. 安装 npm 包
npm install -g 9527code-quota-monitor

# 2. 打开交互式菜单
9527code-quota

# 3. 选 1 安装到状态栏 → 选 2 登录账号 → 重启 Claude Code
```

或者用命令行直接操作（跳过菜单）：

```bash
9527code-quota install                    # 安装到状态栏
9527code-quota login <用户名> <密码>       # 登录
9527code-quota status                     # 查看状态
9527code-quota refresh                    # 刷新额度
9527code-quota interval                   # 设置刷新间隔
9527code-quota logout                     # 退出登录
9527code-quota uninstall                  # 卸载
```

## 状态栏展示说明

```
💰 用户名 | 分组 倍率x | $钱包余额 | 套餐名 ¥已用/总额 剩余天数d
```

| 信息 | 颜色 | 说明 |
|------|------|------|
| 用户名 | 浅蓝 | 9527code 显示名 |
| 分组+倍率 | 浅紫 | 当前 API Key 的分组及计费倍率 |
| 钱包余额 | 金黄 | 账户钱包余额（美元） |
| 订阅套餐 | 浅绿 | 套餐名、已用/总额度（人民币）、剩余天数 |

- 无有效订阅时，订阅部分不显示
- 多个有效订阅会依次追加展示

## 刷新间隔

支持以下间隔，通过交互菜单或 `9527code-quota interval` 设置：

| 选项 | 间隔 |
|------|------|
| 1 | 1 分钟 |
| 2 | 2 分钟 |
| 3 | 5 分钟 (默认) |
| 4 | 10 分钟 |
| 5 | 30 分钟 |

## 卸载

**交互式卸载：**

```bash
9527code-quota
# 选择 7 → 卸载插件
```

**命令行卸载：**

```bash
9527code-quota uninstall
npm uninstall -g 9527code-quota-monitor
```

## 工作原理

```
┌──────────────────┐     ┌───────────┐     ┌──────────────┐
│ wrapper 包装脚本  │────→│ cache.json│←────│   check.js   │
│ (每次渲染调用)    │读取  │ (本地缓存) │ 写入 │ (后台API查询) │
└──────┬───────────┘     └───────────┘     └──────┬───────┘
       │                                          │
       │ 先执行 gsd-statusline.js                  │ 并行请求:
       │ 再追加额度信息                             │ · /api/user/self (余额)
       │                                          │ · /api/subscription/self (订阅)
       │                                          │ · /api/token/ (分组匹配)
       │                                          │ · /api/user/self/groups (倍率)
       │                                          ↓
       │                                  ┌──────────────┐
       │                                  │ 9527code.com API│
       │                                  └──────────────┘
       ↓
  Claude Code 状态栏: model │ dir │ 💰 user | group 1.5x | $xxx | plan ¥x/x xxd
```

**v2.1 新增：**
- 订阅套餐展示（名称、额度、剩余天数），过期自动隐藏
- 自动识别当前 API Key 对应的分组及倍率
- 多色区分不同信息，紧凑布局减少占用空间

**v2.0 架构改进（独立包装模式）：**
- 不再修改 `gsd-statusline.js`，通过独立的 wrapper 脚本包装
- 自动修改 `~/.claude/settings.json` 的 `statusLine` 配置，全局生效
- GSD 更新不会影响额度显示
- 即使未安装 GSD，也能独立显示基本状态 + 额度

## 数据存储

所有数据存储在本地，不会上传到任何第三方：

| 文件 | 内容 | 安全 |
|------|------|------|
| `config.json` | 账号密码、session | 仅本地，已在 .gitignore |
| `cache.json` | 缓存的额度数据 | 仅本地，已在 .gitignore |
| `debug.log` | 调试日志 | 仅本地，已在 .gitignore |

## 从旧版本升级

```bash
npm install -g 9527code-quota-monitor
9527code-quota install
```

v2.1 会自动同步所有运行时脚本，v2.0 会自动清除旧版注入代码，无需手动操作。

## License

MIT
