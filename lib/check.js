#!/usr/bin/env node
// 9527code Quota Monitor - 后台检查 (由 statusline 触发)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const core = require('./core');

const LOCK = path.join(core.MONITOR_DIR, '.lock');

// 防止并发
if (fs.existsSync(LOCK)) {
  try {
    const t = parseInt(fs.readFileSync(LOCK, 'utf8'));
    if (Date.now() - t < 30000) process.exit(0);
  } catch (e) {}
}
core.ensureDir();
fs.writeFileSync(LOCK, String(Date.now()));
function cleanup() { try { fs.unlinkSync(LOCK); } catch (e) {} }
process.on('exit', cleanup);
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });

// ── 自动更新（每小时检查一次）──
async function autoUpdate() {
  const UPDATE_INTERVAL = 60 * 60 * 1000; // 1小时
  const flagFile = path.join(core.MONITOR_DIR, '.last_update_check');
  try {
    if (fs.existsSync(flagFile)) {
      const last = parseInt(fs.readFileSync(flagFile, 'utf8'));
      if (Date.now() - last < UPDATE_INTERVAL) return;
    }
    fs.writeFileSync(flagFile, String(Date.now()));

    // 获取当前版本（优先读 npm 全局包的 package.json，部署目录没有时用 npm list）
    let currentVersion;
    const pkgPath = path.join(__dirname, '..', 'package.json');
    if (fs.existsSync(pkgPath)) {
      currentVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    } else {
      try {
        const out = execSync('npm list -g 9527code-quota-monitor --json', { timeout: 10000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        currentVersion = JSON.parse(out).dependencies['9527code-quota-monitor'].version;
      } catch (e) {
        currentVersion = null;
      }
    }
    if (!currentVersion) return;
    const result = await core.httpFetch('https://registry.npmjs.org/9527code-quota-monitor/latest');
    const latest = JSON.parse(result).version;

    if (latest && latest !== currentVersion) {
      core.log(`AUTO-UPDATE: ${currentVersion} -> ${latest}`);
      execSync('npm install -g 9527code-quota-monitor@latest', { stdio: 'ignore', timeout: 60000 });
      // 重新读取最新 core 并同步脚本
      const freshCore = require(path.join(__dirname, 'core'));
      freshCore.installStatusline();
      core.log(`AUTO-UPDATE: Done v${latest}`);
    }
  } catch (e) {
    core.log(`AUTO-UPDATE: Failed: ${e.message}`);
  }
}

async function main() {
  const config = core.readConfig();
  if (!config) process.exit(0);

  let { session, userId, username, password } = config;
  core.log('CHECK: Starting quota check...');

  let res = await core.apiGetUser(session, userId);
  let body = res.data;

  // 认证失败 -> 自动重新登录
  if (body.success === false || res.status === 401 || res.status === 403) {
    core.log('CHECK: Auth failed, re-logging in...');
    const login = await core.apiLogin(username, password);
    if (login.session) {
      session = login.session;
      userId = login.data?.data?.id || userId;
      config.session = session;
      config.userId = userId;
      config.lastLogin = Date.now();
      core.writeConfig(config);
      core.log('CHECK: Re-login successful');
      res = await core.apiGetUser(session, userId);
      body = res.data;
    } else {
      core.log('CHECK: Re-login failed');
      const old = core.readCache() || {};
      core.writeCache({ ...old, updatedAt: Date.now(), status: 'auth_error', error: '登录失败' });
      return;
    }
  }

  if (body.success !== false) {
    const d = body.data || body;

    // 获取订阅、令牌、分组倍率
    let subscriptions = [];
    let currentToken = null;
    let groupRatio = null;
    try {
      const [subRes, tokenRes, groupRes] = await Promise.all([
        core.apiGetSubscription(session, userId),
        core.apiGetTokens(session, userId),
        core.apiGetGroups(session, userId),
      ]);
      if (subRes.data && subRes.data.success !== false && subRes.data.data) {
        subscriptions = subRes.data.data.subscriptions || [];
      }
      if (tokenRes.data && tokenRes.data.success !== false && tokenRes.data.data) {
        const tokens = tokenRes.data.data.items || [];
        currentToken = core.detectCurrentGroup(tokens);
      }
      if (groupRes.data && groupRes.data.success !== false && groupRes.data.data && currentToken) {
        const g = groupRes.data.data[currentToken.group];
        if (g) groupRatio = g.ratio;
      }
      core.log(`CHECK: Subs:${subscriptions.length} Token:${currentToken ? currentToken.group : '-'} Ratio:${groupRatio}`);
    } catch (e) {
      core.log(`CHECK: Extra fetch failed: ${e.message}`);
    }

    const cache = core.buildCacheObj(d, username, userId, subscriptions, currentToken, groupRatio);
    core.writeCache(cache);
    core.log(`CHECK: OK remaining=$${core.formatQuota(cache.quota)}`);
  } else {
    const old = core.readCache() || {};
    core.writeCache({ ...old, updatedAt: Date.now(), status: 'error', error: body.message || 'unknown' });
    core.log(`CHECK: Failed ${body.message}`);
  }
}

main().catch(e => core.log(`CHECK ERROR: ${e.message}`)).finally(cleanup);
autoUpdate().catch(() => {});
