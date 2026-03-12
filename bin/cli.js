#!/usr/bin/env node
// 78code Quota Monitor - 交互式 CLI
// 安装后运行: 78code-quota

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const core = require('../lib/core');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

// ── 颜色工具 ──
const c = {
  purple: s => `\x1b[38;5;177m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
};

function banner() {
  console.log('');
  console.log(c.purple('  ╔══════════════════════════════════════╗'));
  console.log(c.purple('  ║    💰 78code Quota Monitor v2.0.0    ║'));
  console.log(c.purple('  ║    Claude Code 状态栏额度监控插件     ║'));
  console.log(c.purple('  ╚══════════════════════════════════════╝'));
  console.log('');
}

function statusSummary() {
  const config = core.readConfig();
  const cache = core.readCache();
  const installed = core.isInstalled();

  console.log(c.dim('  ─────────────────────────────────────'));
  console.log(`  插件状态:  ${installed ? c.green('● 已安装') : c.red('○ 未安装')}`);
  if (config) {
    console.log(`  当前账号:  ${c.cyan(config.username)} (ID: ${config.userId || '?'})`);
    const iv = core.INTERVALS.find(i => i.value === config.checkInterval);
    console.log(`  刷新间隔:  ${c.cyan(iv ? iv.label : config.checkInterval + '秒')}`);
    if (cache && cache.status === 'ok') {
      console.log(`  剩余额度:  ${c.yellow('$' + core.formatQuota(cache.quota))}`);
      const ageSec = Math.round((Date.now() - cache.updatedAt) / 1000);
      const ageStr = ageSec < 60 ? `${ageSec}秒前` : `${Math.round(ageSec / 60)}分钟前`;
      console.log(`  更新时间:  ${c.dim(ageStr)}`);
    } else if (cache && cache.status !== 'ok') {
      console.log(`  额度状态:  ${c.red(cache.error || cache.status)}`);
    }
  } else {
    console.log(`  当前账号:  ${c.dim('未登录')}`);
  }
  console.log(c.dim('  ─────────────────────────────────────'));
}

async function mainMenu() {
  banner();
  statusSummary();
  console.log('');
  console.log(`  ${c.bold('1.')}  🔧  安装到状态栏`);
  console.log(`  ${c.bold('2.')}  🔑  登录 / 切换账号`);
  console.log(`  ${c.bold('3.')}  ⏱   设置刷新间隔`);
  console.log(`  ${c.bold('4.')}  📊  查看详细状态`);
  console.log(`  ${c.bold('5.')}  🔄  立即刷新额度`);
  console.log(`  ${c.bold('6.')}  🚪  退出登录`);
  console.log(`  ${c.bold('7.')}  🗑   卸载插件`);
  console.log(`  ${c.bold('0.')}  退出`);
  console.log('');

  const choice = await ask(c.purple('  请选择 [0-7]: '));
  console.log('');

  switch (choice.trim()) {
    case '1': await doInstall(); break;
    case '2': await doLogin(); break;
    case '3': await doInterval(); break;
    case '4': await doStatus(); break;
    case '5': await doRefresh(); break;
    case '6': await doLogout(); break;
    case '7': await doUninstall(); break;
    case '0': case '': rl.close(); return;
    default:
      console.log(c.red('  无效选择'));
  }

  console.log('');
  await mainMenu();
}

// ── 1. 安装 ──
async function doInstall() {
  core.ensureDir();

  // 复制 check.js, core.js, statusline-wrapper.js 到 monitor 目录
  const srcCheck = path.join(__dirname, '..', 'lib', 'check.js');
  const srcCore = path.join(__dirname, '..', 'lib', 'core.js');
  const srcWrapper = path.join(__dirname, '..', 'lib', 'statusline-wrapper.js');
  const dstCheck = path.join(core.MONITOR_DIR, 'check.js');
  const dstCore = path.join(core.MONITOR_DIR, 'core.js');
  const dstWrapper = path.join(core.MONITOR_DIR, 'statusline-wrapper.js');
  fs.copyFileSync(srcCheck, dstCheck);
  fs.copyFileSync(srcCore, dstCore);
  fs.copyFileSync(srcWrapper, dstWrapper);

  const result = core.installStatusline();
  console.log(result.ok ? c.green(`  ✓ ${result.msg}`) : c.red(`  ✗ ${result.msg}`));
  if (result.ok && !core.readConfig()) {
    console.log(c.dim('  提示: 请选择 [2] 登录你的账号'));
  }
}

// ── 2. 登录 / 切换账号 ──
async function doLogin() {
  const username = await ask(c.cyan('  用户名: '));
  if (!username.trim()) { console.log(c.red('  已取消')); return; }

  const password = await ask(c.cyan('  密  码: '));
  if (!password.trim()) { console.log(c.red('  已取消')); return; }

  console.log(c.dim('  正在登录...'));
  try {
    const { data, session } = await core.apiLogin(username.trim(), password.trim());

    if (!session && data.success === false) {
      console.log(c.red(`  ✗ 登录失败: ${data.message || '未知错误'}`));
      return;
    }

    const userId = data.data?.id || data.data?.user_id || '';
    const oldConfig = core.readConfig();
    const config = {
      username: username.trim(),
      password: password.trim(),
      session,
      userId,
      baseUrl: 'https://api.78code.cc',
      checkInterval: (oldConfig && oldConfig.checkInterval) || 300,
      lastLogin: Date.now(),
    };
    core.writeConfig(config);
    console.log(c.green(`  ✓ 登录成功! 用户ID: ${userId}`));

    // 立即查询额度
    console.log(c.dim('  正在查询额度...'));
    const res = await core.apiGetUser(session, userId);
    const d = res.data?.data || res.data;
    const cache = core.buildCacheObj(d, username.trim(), userId);
    core.writeCache(cache);

    console.log(c.green(`  ✓ 剩余额度: $${core.formatQuota(cache.quota)}`));
    console.log(c.dim('  重启 Claude Code 后状态栏将显示额度'));
  } catch (e) {
    console.log(c.red(`  ✗ 错误: ${e.message}`));
  }
}

// ── 3. 设置刷新间隔 ──
async function doInterval() {
  const config = core.readConfig();
  const current = config ? config.checkInterval : 300;

  console.log(c.bold('  选择刷新间隔:'));
  console.log('');
  core.INTERVALS.forEach((iv, i) => {
    const mark = iv.value === current ? c.green(' ●') : '  ';
    console.log(`  ${mark} ${c.bold(String(i + 1) + '.')}  ${iv.label}`);
  });
  console.log('');

  const choice = await ask(c.purple('  请选择 [1-5]: '));
  const idx = parseInt(choice) - 1;
  if (idx < 0 || idx >= core.INTERVALS.length) {
    console.log(c.red('  已取消'));
    return;
  }

  const selected = core.INTERVALS[idx];
  if (config) {
    config.checkInterval = selected.value;
    core.writeConfig(config);
  }

  console.log(c.green(`  ✓ 刷新间隔已设为: ${selected.label}`));
}

// ── 4. 查看详细状态 ──
async function doStatus() {
  const config = core.readConfig();
  const cache = core.readCache();
  const installed = core.isInstalled();

  console.log(c.purple('  ═══ 78code 详细状态 ═══'));
  console.log('');
  console.log(`  插件状态:    ${installed ? c.green('已安装') : c.red('未安装')}`);
  console.log(`  数据目录:    ${c.dim(core.MONITOR_DIR)}`);

  if (!config) {
    console.log(`  登录状态:    ${c.red('未登录')}`);
    return;
  }

  console.log('');
  console.log(c.purple('  ─── 账号 ───'));
  console.log(`  用户名:      ${config.username}`);
  console.log(`  用户ID:      ${config.userId}`);
  console.log(`  Session:     ${config.session ? config.session.substring(0, 20) + '...' : '无'}`);
  const iv = core.INTERVALS.find(i => i.value === config.checkInterval);
  console.log(`  刷新间隔:    ${iv ? iv.label : config.checkInterval + '秒'}`);

  if (cache) {
    console.log('');
    console.log(c.purple('  ─── 额度 ───'));
    console.log(`  剩余额度:    ${c.yellow('$' + core.formatQuota(cache.quota))}`);
    console.log(`  已用额度:    $${core.formatQuota(cache.usedQuota)}`);
    if (cache.group) console.log(`  用户组:      ${cache.group}`);
    console.log(`  状态:        ${cache.status === 'ok' ? c.green('OK') : c.red(cache.error || cache.status)}`);
    const ageSec = Math.round((Date.now() - cache.updatedAt) / 1000);
    const ageStr = ageSec < 60 ? `${ageSec}秒前` : `${Math.round(ageSec / 60)}分钟前`;
    console.log(`  更新时间:    ${ageStr}`);
  }
}

// ── 5. 立即刷新 ──
async function doRefresh() {
  const config = core.readConfig();
  if (!config) {
    console.log(c.yellow('  未登录，请先登录'));
    return;
  }

  console.log(c.dim('  正在刷新...'));
  try {
    let res = await core.apiGetUser(config.session, config.userId);

    if (res.data.success === false) {
      console.log(c.yellow('  Session 已过期，正在重新登录...'));
      const login = await core.apiLogin(config.username, config.password);
      if (!login.session) {
        console.log(c.red('  ✗ 重新登录失败，请检查密码'));
        return;
      }
      config.session = login.session;
      config.userId = login.data?.data?.id || config.userId;
      config.lastLogin = Date.now();
      core.writeConfig(config);
      console.log(c.green('  ✓ 重新登录成功'));
      res = await core.apiGetUser(config.session, config.userId);
    }

    const d = res.data?.data || res.data;
    const cache = core.buildCacheObj(d, config.username, config.userId);
    core.writeCache(cache);
    console.log(c.green(`  ✓ 剩余: $${core.formatQuota(cache.quota)}  已用: $${core.formatQuota(cache.usedQuota)}`));
  } catch (e) {
    console.log(c.red(`  ✗ 错误: ${e.message}`));
  }
}

// ── 6. 退出登录 ──
async function doLogout() {
  const config = core.readConfig();
  if (!config) {
    console.log(c.yellow('  当前未登录'));
    return;
  }

  const confirm = await ask(c.yellow(`  确定退出 ${config.username} 的登录? (y/N): `));
  if (confirm.toLowerCase() !== 'y') {
    console.log(c.dim('  已取消'));
    return;
  }

  for (const f of [core.CONFIG_FILE, core.CACHE_FILE]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  console.log(c.green('  ✓ 已退出登录，凭据已清除'));
  console.log(c.dim('  状态栏额度信息将不再显示'));
}

// ── 7. 卸载 ──
async function doUninstall() {
  const confirm = await ask(c.yellow('  确定卸载插件? 将恢复原始状态栏 (y/N): '));
  if (confirm.toLowerCase() !== 'y') {
    console.log(c.dim('  已取消'));
    return;
  }

  core.uninstallStatusline();
  console.log(c.green('  ✓ 状态栏已恢复'));

  // 清理文件
  const lockFile = path.join(core.MONITOR_DIR, '.lock');
  for (const f of [core.CONFIG_FILE, core.CACHE_FILE, lockFile, core.WRAPPER_FILE]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  console.log(c.green('  ✓ 本地数据已清除'));
  console.log(c.dim('  提示: 可运行 npm uninstall -g 78code-quota-monitor 移除全局包'));
}

// ── 也支持命令行直接调用 ──
const directCmd = process.argv[2];
if (directCmd) {
  const args = process.argv.slice(3);
  const run = async () => {
    switch (directCmd) {
      case 'install': await doInstall(); break;
      case 'uninstall': await doUninstall(); break;
      case 'login':
        if (args.length >= 2) {
          // 非交互式登录
          console.log(c.dim('  正在登录...'));
          try {
            const { data, session } = await core.apiLogin(args[0], args[1]);
            if (!session && data.success === false) {
              console.log(c.red(`  ✗ 登录失败: ${data.message}`));
              process.exit(1);
            }
            const userId = data.data?.id || '';
            const oldConfig = core.readConfig();
            core.writeConfig({
              username: args[0], password: args[1], session, userId,
              baseUrl: 'https://api.78code.cc',
              checkInterval: (oldConfig && oldConfig.checkInterval) || 300,
              lastLogin: Date.now(),
            });
            const res = await core.apiGetUser(session, userId);
            const d = res.data?.data || res.data;
            const cache = core.buildCacheObj(d, args[0], userId);
            core.writeCache(cache);
            console.log(c.green(`  ✓ 登录成功! ${args[0]}(${userId}) 余额: $${core.formatQuota(cache.quota)}`));
          } catch (e) {
            console.log(c.red(`  ✗ ${e.message}`));
            process.exit(1);
          }
        } else {
          await doLogin();
        }
        break;
      case 'logout': await doLogout(); break;
      case 'status': await doStatus(); break;
      case 'refresh': await doRefresh(); break;
      case 'interval': await doInterval(); break;
      default:
        console.log(`  未知命令: ${directCmd}`);
        console.log('  可用: install | uninstall | login | logout | status | refresh | interval');
    }
  };
  run().catch(e => console.error(c.red(e.message))).finally(() => rl.close());
} else {
  // 交互式菜单
  mainMenu().catch(e => console.error(c.red(e.message))).finally(() => rl.close());
}
