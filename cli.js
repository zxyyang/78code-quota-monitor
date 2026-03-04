#!/usr/bin/env node
// 78code Quota Monitor - CLI 管理工具
// Usage:
//   node cli.js install              # 安装插件到状态栏
//   node cli.js uninstall            # 卸载插件
//   node cli.js login <user> <pass>  # 登录 / 切换账号
//   node cli.js logout               # 退出登录，清除本地凭据
//   node cli.js status               # 查看当前账号和额度
//   node cli.js refresh              # 手动刷新额度

const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DIR = __dirname;
const CONFIG = path.join(DIR, 'config.json');
const CACHE = path.join(DIR, 'cache.json');
const LOCK = path.join(DIR, '.lock');
const LOG = path.join(DIR, 'debug.log');
const STATUSLINE = path.join(DIR, '..', 'gsd-statusline.js');

const START_MARKER = '// [78code-quota-start]';
const END_MARKER = '// [78code-quota-end]';

// ── 原始 statusline Output 代码（卸载时恢复用） ──
const ORIGINAL_OUTPUT = `    // Output
    const dirname = path.basename(dir);
    if (task) {
      process.stdout.write(\`\${gsdUpdate}\\x1b[2m\${model}\\x1b[0m │ \\x1b[1m\${task}\\x1b[0m │ \\x1b[2m\${dirname}\\x1b[0m\${ctx}\`);
    } else {
      process.stdout.write(\`\${gsdUpdate}\\x1b[2m\${model}\\x1b[0m │ \\x1b[2m\${dirname}\\x1b[0m\${ctx}\`);
    }`;

// ── 注入到 statusline 的额度监控代码 ──
const QUOTA_BLOCK = `    ${START_MARKER}
    let quotaInfo = '';
    const quotaDir = path.join(homeDir, '.claude', 'hooks', 'quota-monitor');
    const quotaCache = path.join(quotaDir, 'cache.json');
    const quotaConfig = path.join(quotaDir, 'config.json');

    if (fs.existsSync(quotaCache)) {
      try {
        const q = JSON.parse(fs.readFileSync(quotaCache, 'utf8'));
        const divisor = 500000;
        if (q.status === 'ok' && q.quota != null) {
          const remaining = (q.quota / divisor).toFixed(2);
          quotaInfo = \` │ \\x1b[36m\${q.displayName || q.username}(\${q.userId})\\x1b[0m \\x1b[33m余额:$\${remaining}\\x1b[0m\`;
        } else if (q.status === 'auth_error') {
          quotaInfo = \` │ \\x1b[31mCookie过期 重登中...\\x1b[0m\`;
        } else if (q.status === 'error') {
          quotaInfo = \` │ \\x1b[31m额度查询异常\\x1b[0m\`;
        }

        // 缓存超过5分钟则触发后台刷新
        const age = Date.now() - (q.updatedAt || 0);
        if (age > 300000 && fs.existsSync(quotaConfig)) {
          const { spawn } = require('child_process');
          const child = spawn('node', [path.join(quotaDir, 'check.js')], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
        }
      } catch (e) {}
    } else if (fs.existsSync(quotaConfig)) {
      const { spawn } = require('child_process');
      const child = spawn('node', [path.join(quotaDir, 'check.js')], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      quotaInfo = \` │ \\x1b[2m额度加载中...\\x1b[0m\`;
    }

    // Output
    const dirname = path.basename(dir);
    if (task) {
      process.stdout.write(\`\${gsdUpdate}\\x1b[2m\${model}\\x1b[0m │ \\x1b[1m\${task}\\x1b[0m │ \\x1b[2m\${dirname}\\x1b[0m\${ctx}\${quotaInfo}\`);
    } else {
      process.stdout.write(\`\${gsdUpdate}\\x1b[2m\${model}\\x1b[0m │ \\x1b[2m\${dirname}\\x1b[0m\${ctx}\${quotaInfo}\`);
    }
    ${END_MARKER}`;

// ── HTTP 工具 ──
function httpReq(opts, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(opts.url);
    const r = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    r.on('error', reject);
    r.setTimeout(15000, () => { r.destroy(); reject(new Error('请求超时')); });
    if (body) r.write(body);
    r.end();
  });
}

async function doLogin(username, password) {
  const res = await httpReq({
    url: 'https://www.78code.cc/api/user/login?turnstile=',
    method: 'POST',
    headers: {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    },
  }, JSON.stringify({ username, password }));

  const data = JSON.parse(res.body);
  let session = '';
  const cookies = res.headers['set-cookie'] || [];
  for (const c of (Array.isArray(cookies) ? cookies : [cookies])) {
    const m = c.match(/session=([^;]+)/);
    if (m) { session = m[1]; break; }
  }
  return { data, session };
}

async function fetchQuota(session, userId) {
  const headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'cookie': `session=${session}`,
  };
  if (userId) headers['new-api-user'] = String(userId);
  const res = await httpReq({ url: 'https://www.78code.cc/api/user/self', headers });
  return JSON.parse(res.body);
}

function formatQuota(val) {
  return val != null ? (val / 500000).toFixed(2) : '?';
}

function writeCache(d, username, userId) {
  const cache = {
    username: d.username || username,
    displayName: d.display_name || d.username || username,
    userId: d.id || userId,
    quota: d.quota,
    usedQuota: d.used_quota,
    group: d.group,
    updatedAt: Date.now(),
    status: 'ok',
  };
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  return cache;
}

// ── 命令实现 ──

async function cmdInstall() {
  if (!fs.existsSync(STATUSLINE)) {
    console.error('\x1b[31m找不到 statusline 脚本: ' + STATUSLINE + '\x1b[0m');
    process.exit(1);
  }

  let content = fs.readFileSync(STATUSLINE, 'utf8');

  if (content.includes(START_MARKER)) {
    console.log('\x1b[33m已安装，无需重复操作。\x1b[0m');
    return;
  }

  // 找到 "// Output" 行并替换为注入代码
  const outputRegex = /    \/\/ Output\n    const dirname = path\.basename\(dir\);\n    if \(task\) \{\n      process\.stdout\.write\(`\$\{gsdUpdate\}[^`]*`\);\n    \} else \{\n      process\.stdout\.write\(`\$\{gsdUpdate\}[^`]*`\);\n    \}/;

  if (!outputRegex.test(content)) {
    console.error('\x1b[31m无法定位 statusline 输出代码，请检查 gsd-statusline.js 格式。\x1b[0m');
    process.exit(1);
  }

  content = content.replace(outputRegex, QUOTA_BLOCK);
  fs.writeFileSync(STATUSLINE, content);

  console.log('\x1b[32m✓ 插件已安装到状态栏!\x1b[0m');
  console.log('\x1b[2m  下一步: node cli.js login <用户名> <密码>\x1b[0m');
}

function cmdUninstall() {
  // 1. 恢复 statusline
  if (fs.existsSync(STATUSLINE)) {
    let content = fs.readFileSync(STATUSLINE, 'utf8');
    if (content.includes(START_MARKER)) {
      const startIdx = content.indexOf(START_MARKER);
      const endIdx = content.indexOf(END_MARKER);
      if (startIdx !== -1 && endIdx !== -1) {
        const before = content.substring(0, startIdx).trimEnd();
        const after = content.substring(endIdx + END_MARKER.length);
        content = before + '\n' + ORIGINAL_OUTPUT + after;
        fs.writeFileSync(STATUSLINE, content);
        console.log('\x1b[32m✓ 状态栏已恢复原样\x1b[0m');
      }
    } else {
      console.log('\x1b[33m状态栏中未找到插件代码，跳过。\x1b[0m');
    }
  }

  // 2. 清理本地文件
  for (const f of [CONFIG, CACHE, LOCK]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  console.log('\x1b[32m✓ 本地配置和缓存已清除\x1b[0m');
  console.log('\x1b[32m✓ 卸载完成! 重启 Claude Code 生效。\x1b[0m');
}

async function cmdLogin(username, password) {
  console.log(`\x1b[36m正在登录 ${username}...\x1b[0m`);

  const { data, session } = await doLogin(username, password);

  if (!session && data.success === false) {
    console.error(`\x1b[31m登录失败: ${data.message || JSON.stringify(data)}\x1b[0m`);
    process.exit(1);
  }

  const userId = data.data?.id || data.data?.user_id || '';
  console.log(`\x1b[32m✓ 登录成功! 用户ID: ${userId}\x1b[0m`);

  const config = {
    username, password, session, userId,
    baseUrl: 'https://www.78code.cc',
    checkInterval: 300,
    quotaDivisor: 500000,
    lastLogin: Date.now(),
  };
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));

  // 立即查询额度
  console.log('\x1b[36m正在查询额度...\x1b[0m');
  const quota = await fetchQuota(session, userId);
  const d = quota.data || quota;
  const cache = writeCache(d, username, userId);

  console.log('');
  console.log(`  用户名:   \x1b[36m${cache.displayName}\x1b[0m`);
  console.log(`  用户ID:   \x1b[36m${cache.userId}\x1b[0m`);
  console.log(`  剩余额度: \x1b[33m$${formatQuota(cache.quota)}\x1b[0m`);
  console.log(`  已用额度: \x1b[2m$${formatQuota(cache.usedQuota)}\x1b[0m`);
  if (cache.group) console.log(`  用户组:   \x1b[2m${cache.group}\x1b[0m`);
  console.log('');
  console.log('\x1b[32m✓ 状态栏将在下次刷新时更新。\x1b[0m');
}

function cmdLogout() {
  for (const f of [CONFIG, CACHE, LOCK]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  console.log('\x1b[32m✓ 已退出登录，凭据和缓存已清除。\x1b[0m');
  console.log('\x1b[2m  状态栏额度信息将不再显示。\x1b[0m');
  console.log('\x1b[2m  重新登录: node cli.js login <用户名> <密码>\x1b[0m');
}

function cmdStatus() {
  if (!fs.existsSync(CONFIG)) {
    console.log('\x1b[33m未登录。请先运行: node cli.js login <用户名> <密码>\x1b[0m');
    return;
  }

  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  console.log('');
  console.log('\x1b[36m=== 78code 账号信息 ===\x1b[0m');
  console.log(`  账号:     ${config.username}`);
  console.log(`  用户ID:   ${config.userId}`);
  console.log(`  Session:  ${config.session ? config.session.substring(0, 20) + '...' : '无'}`);

  if (fs.existsSync(CACHE)) {
    const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    const ageSec = Math.round((Date.now() - cache.updatedAt) / 1000);
    const ageStr = ageSec < 60 ? `${ageSec}秒前` : `${Math.round(ageSec / 60)}分钟前`;
    console.log('');
    console.log('\x1b[36m=== 额度信息 ===\x1b[0m');
    console.log(`  剩余额度: \x1b[33m$${formatQuota(cache.quota)}\x1b[0m`);
    console.log(`  已用额度: $${formatQuota(cache.usedQuota)}`);
    if (cache.group) console.log(`  用户组:   ${cache.group}`);
    console.log(`  状态:     ${cache.status === 'ok' ? '\x1b[32mOK\x1b[0m' : '\x1b[31m' + (cache.error || cache.status) + '\x1b[0m'}`);
    console.log(`  更新于:   ${ageStr}`);
  } else {
    console.log('\x1b[33m  额度数据尚未获取，请运行: node cli.js refresh\x1b[0m');
  }

  // 检查插件是否已安装
  let installed = false;
  if (fs.existsSync(STATUSLINE)) {
    const content = fs.readFileSync(STATUSLINE, 'utf8');
    installed = content.includes(START_MARKER);
  }
  console.log('');
  console.log(`  插件状态: ${installed ? '\x1b[32m已安装\x1b[0m' : '\x1b[31m未安装\x1b[0m'}`);
  console.log('');
}

async function cmdRefresh() {
  if (!fs.existsSync(CONFIG)) {
    console.log('\x1b[33m未登录。请先运行: node cli.js login <用户名> <密码>\x1b[0m');
    return;
  }

  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  console.log('\x1b[36m正在刷新额度...\x1b[0m');

  let quota;
  try {
    quota = await fetchQuota(config.session, config.userId);
  } catch (e) {
    console.error(`\x1b[31m请求失败: ${e.message}\x1b[0m`);
    process.exit(1);
  }

  // 检查是否需要重新登录
  if (quota.success === false) {
    console.log('\x1b[33mSession 已过期，正在重新登录...\x1b[0m');
    const { data, session } = await doLogin(config.username, config.password);
    if (!session) {
      console.error('\x1b[31m重新登录失败，请检查密码是否正确。\x1b[0m');
      process.exit(1);
    }
    config.session = session;
    config.userId = data.data?.id || config.userId;
    config.lastLogin = Date.now();
    fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));
    console.log('\x1b[32m✓ 重新登录成功\x1b[0m');

    quota = await fetchQuota(config.session, config.userId);
  }

  const d = quota.data || quota;
  const cache = writeCache(d, config.username, config.userId);
  console.log(`\x1b[32m✓ 剩余额度: $${formatQuota(cache.quota)}  已用: $${formatQuota(cache.usedQuota)}\x1b[0m`);
}

// ── 帮助信息 ──
function showHelp() {
  console.log(`
\x1b[36m78code Quota Monitor - 额度监控插件\x1b[0m

\x1b[1m命令:\x1b[0m
  node cli.js \x1b[32minstall\x1b[0m                  安装插件到 Claude Code 状态栏
  node cli.js \x1b[32muninstall\x1b[0m                卸载插件，恢复原始状态栏
  node cli.js \x1b[32mlogin\x1b[0m <用户名> <密码>    登录 / 切换账号
  node cli.js \x1b[32mlogout\x1b[0m                   退出登录，清除本地凭据
  node cli.js \x1b[32mstatus\x1b[0m                   查看当前账号和额度
  node cli.js \x1b[32mrefresh\x1b[0m                  手动刷新额度

\x1b[1m首次使用:\x1b[0m
  1. node cli.js install              # 安装到状态栏
  2. node cli.js login myuser mypass   # 登录账号
  3. 重启 Claude Code                  # 状态栏显示额度

\x1b[1m切换账号:\x1b[0m
  node cli.js login 新用户名 新密码     # 直接登录新账号即可

\x1b[2m数据存储: ${DIR}\x1b[0m
`);
}

// ── 入口 ──
const [cmd, ...args] = process.argv.slice(2);

const run = async () => {
  switch (cmd) {
    case 'install':
      await cmdInstall();
      break;
    case 'uninstall':
      cmdUninstall();
      break;
    case 'login':
      if (args.length < 2) {
        console.error('\x1b[31m用法: node cli.js login <用户名> <密码>\x1b[0m');
        process.exit(1);
      }
      await cmdLogin(args[0], args[1]);
      break;
    case 'logout':
      cmdLogout();
      break;
    case 'status':
      cmdStatus();
      break;
    case 'refresh':
      await cmdRefresh();
      break;
    default:
      showHelp();
  }
};

run().catch(e => {
  console.error(`\x1b[31m错误: ${e.message}\x1b[0m`);
  process.exit(1);
});
