#!/usr/bin/env node
// 78code Quota Monitor - 后台检查 (由 statusline 触发)

const fs = require('fs');
const path = require('path');
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
    const cache = core.buildCacheObj(d, username, userId);
    core.writeCache(cache);
    core.log(`CHECK: OK remaining=$${core.formatQuota(cache.quota)}`);
  } else {
    const old = core.readCache() || {};
    core.writeCache({ ...old, updatedAt: Date.now(), status: 'error', error: body.message || 'unknown' });
    core.log(`CHECK: Failed ${body.message}`);
  }
}

main().catch(e => core.log(`CHECK ERROR: ${e.message}`)).finally(cleanup);
