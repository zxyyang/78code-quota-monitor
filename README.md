# 78code Quota Monitor

Claude Code 状态栏插件 —— 实时显示你的 [78code.cc](https://www.78code.cc) 账号额度。

```
Opus 4.6 (1M context) │ myproject │ ██░░░░░░░░ 12% │ 💰 myuser(42) · 余额$150.16
                                                      ↑ 插件显示区域
```

## 功能

- **状态栏实时显示** — 用户名、ID、剩余额度，一目了然
- **可调刷新间隔** — 支持 1 / 2 / 5 / 10 / 30 分钟
- **Cookie 自动续期** — Session 过期后自动用保存的凭据重新登录
- **交互式设置** — 菜单式操作，登录/切换/退出/设置一站搞定
- **一键安装/卸载** — 不污染其他配置，卸载后完全恢复原样
- **零依赖** — 纯 Node.js 内置模块，无需额外安装

## 前置要求

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 已安装
- [GSD statusline](https://github.com/glittercowboy/get-shit-done) 已启用（`gsd-statusline.js` 存在于 `~/.claude/hooks/`）
- Node.js >= 16

## 安装

### 方式一：npm 安装（推荐）

```bash
npm install -g 78code-quota-monitor
```

安装后运行交互式设置：

```bash
78code-quota
```

会出现交互式菜单，按提示操作即可：

```
  ╔══════════════════════════════════════╗
  ║    💰 78code Quota Monitor v1.0.0    ║
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
curl -fsSL https://raw.githubusercontent.com/zxyyang/78code-quota-monitor/main/install.sh | bash
```

## 快速开始

```bash
# 1. 安装 npm 包
npm install -g 78code-quota-monitor

# 2. 打开交互式菜单
78code-quota

# 3. 选 1 安装到状态栏 → 选 2 登录账号 → 重启 Claude Code
```

或者用命令行直接操作（跳过菜单）：

```bash
78code-quota install                    # 安装到状态栏
78code-quota login <用户名> <密码>       # 登录
78code-quota status                     # 查看状态
78code-quota refresh                    # 刷新额度
78code-quota interval                   # 设置刷新间隔
78code-quota logout                     # 退出登录
78code-quota uninstall                  # 卸载
```

## 刷新间隔

支持以下间隔，通过交互菜单或 `78code-quota interval` 设置：

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
78code-quota
# 选择 7 → 卸载插件
```

**命令行卸载：**

```bash
78code-quota uninstall
npm uninstall -g 78code-quota-monitor
```

## 工作原理

```
┌─────────────┐     ┌───────────┐     ┌──────────────┐
│ statusline  │────→│ cache.json│←────│   check.js   │
│ (每次渲染)   │读取  │ (本地缓存) │ 写入 │ (后台API查询) │
└─────────────┘     └───────────┘     └──────┬───────┘
       │                                      │
       │ 缓存过期?                             │ Cookie过期?
       │ 触发 check.js ──────────→             │ 自动重新登录
       │                                      ↓
       │                              ┌──────────────┐
       │                              │ 78code.cc API│
       │                              └──────────────┘
       ↓
  Claude Code 状态栏: 💰 user(id) · 余额$xxx
```

- **statusline** 每次渲染读取本地 `cache.json`，零网络开销
- 缓存过期时自动触发 `check.js` 后台刷新
- `check.js` 调用 78code API，失败则自动重新登录
- 所有凭据仅保存在本地 `~/.claude/hooks/quota-monitor/config.json`

## 数据存储

所有数据存储在本地，不会上传到任何第三方：

| 文件 | 内容 | 安全 |
|------|------|------|
| `config.json` | 账号密码、session | 仅本地，已在 .gitignore |
| `cache.json` | 缓存的额度数据 | 仅本地，已在 .gitignore |
| `debug.log` | 调试日志 | 仅本地，已在 .gitignore |

## License

MIT
