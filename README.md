# 78code Quota Monitor

Claude Code 状态栏插件 —— 实时显示你的 [78code.cc](https://www.78code.cc) 账号额度。

```
Opus 4.6 (1M context) │ myproject │ ██░░░░░░░░ 12% │ 💰 myuser(42) · 余额$150.16
                                                      ↑ 插件显示区域
```

## 功能

- **状态栏实时显示** — 用户名、ID、剩余额度，一目了然
- **自动刷新** — 每 5 分钟后台静默更新额度数据
- **Cookie 自动续期** — Session 过期后自动用保存的凭据重新登录
- **多账号切换** — 一条命令切换到其他账号
- **一键安装/卸载** — 不污染其他配置，卸载后完全恢复原样
- **零依赖** — 纯 Node.js 内置模块，无需 npm install

## 前置要求

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 已安装
- [GSD statusline](https://github.com/glittercowboy/get-shit-done) 已启用（`gsd-statusline.js` 存在于 `~/.claude/hooks/`）
- Node.js >= 16

## 安装

**一键安装：**

```bash
curl -fsSL https://raw.githubusercontent.com/zxyyang/78code-quota-monitor/main/install.sh | bash
```

**然后登录你的 78code 账号：**

```bash
node ~/.claude/hooks/quota-monitor/cli.js login <用户名> <密码>
```

**重启 Claude Code**，状态栏底部即可看到额度信息。

## 命令

所有命令通过 `node ~/.claude/hooks/quota-monitor/cli.js` 执行：

| 命令 | 说明 |
|------|------|
| `install` | 安装插件到 Claude Code 状态栏 |
| `uninstall` | 卸载插件，恢复原始状态栏 |
| `login <用户名> <密码>` | 登录账号 / 切换到其他账号 |
| `logout` | 退出登录，清除本地保存的凭据和缓存 |
| `status` | 查看当前账号信息和额度 |
| `refresh` | 手动刷新额度（不等 5 分钟自动刷新） |

### 快速示例

```bash
# 简写路径
QM=~/.claude/hooks/quota-monitor/cli.js

# 登录
node $QM login myuser mypassword

# 查看状态
node $QM status

# 切换账号
node $QM login another_user another_pass

# 手动刷新
node $QM refresh

# 退出登录
node $QM logout
```

## 卸载

```bash
node ~/.claude/hooks/quota-monitor/cli.js uninstall
```

这会：
1. 恢复 `gsd-statusline.js` 到原始状态
2. 清除本地保存的凭据和缓存

如需彻底删除文件：

```bash
rm -rf ~/.claude/hooks/quota-monitor
```

## 工作原理

```
┌─────────────┐     ┌───────────┐     ┌──────────────┐
│ statusline  │────→│ cache.json│←────│   check.js   │
│ (每次渲染)   │读取  │ (本地缓存) │ 写入 │ (后台API查询) │
└─────────────┘     └───────────┘     └──────┬───────┘
       │                                      │
       │ 缓存>5分钟?                           │ Cookie过期?
       │ 触发 check.js ──────────→             │ 自动重新登录
       │                                      ↓
       │                              ┌──────────────┐
       │                              │ 78code.cc API│
       │                              └──────────────┘
       ↓
  Claude Code 状态栏显示: user(id) 余额:$xxx
```

- **statusline** 每次渲染时读取本地 `cache.json`，零网络开销
- 缓存超过 5 分钟时，自动触发 `check.js` 后台刷新
- `check.js` 调用 78code API 查询额度，失败则自动用保存的密码重新登录
- 所有凭据（用户名、密码、session）仅保存在本地 `~/.claude/hooks/quota-monitor/config.json`

## 数据存储

所有数据存储在本地，不会上传到任何第三方：

| 文件 | 内容 |
|------|------|
| `config.json` | 账号密码、session（已在 .gitignore 中） |
| `cache.json` | 缓存的额度数据（已在 .gitignore 中） |
| `debug.log` | 调试日志（已在 .gitignore 中） |

## License

MIT
