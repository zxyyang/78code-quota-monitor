#!/usr/bin/env node
// 78code Quota Monitor - 后台检查 (由 statusline 触发)
// 读取配置 -> 查询额度 -> cookie过期自动重登 -> 写入缓存

const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DIR = __dirname;
const CONFIG = path.join(DIR, 'config.json');
const CACHE = path.join(DIR, 'cache.json');
const LOCK = path.join(DIR, '.lock');
const LOG = path.join(DIR, 'debug.log');

function log(msg) {
  const ts = new Date().toISOString();
  try { fs.appendFileSync(LOG, `[${ts}] CHECK: ${msg}\n`); } catch (e) {}
}

// 防止并发检查
if (fs.existsSync(LOCK)) {
  try {
    const lockTime = parseInt(fs.readFileSync(LOCK, 'utf8'));
    if (Date.now() - lockTime < 30000) process.exit(0);
  } catch (e) {}
}
fs.writeFileSync(LOCK, String(Date.now()));
function cleanup() { try { fs.unlinkSync(LOCK); } catch (e) {} }
process.on('exit', cleanup);
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });

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
    r.setTimeout(15000, () => { r.destroy(); reject(new Error('timeout')); });
    if (body) r.write(body);
    r.end();
  });
}

async function login(username, password) {
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
  const cookieList = Array.isArray(cookies) ? cookies : [cookies];
  for (const c of cookieList) {
    const m = c.match(/session=([^;]+)/);
    if (m) { session = m[1]; break; }
  }
  return { data, session };
}

async function checkQuota(session, userId) {
  const headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'cookie': `session=${session}`,
  };
  if (userId) headers['new-api-user'] = String(userId);
  return await httpReq({ url: 'https://www.78code.cc/api/user/self', headers });
}

async function main() {
  if (!fs.existsSync(CONFIG)) {
    log('No config found, exiting');
    process.exit(0);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  let { session, userId, username, password } = config;

  log('Starting quota check...');

  // 第一次尝试查询
  let res = await checkQuota(session, userId);
  let body;
  try {
    body = JSON.parse(res.body);
  } catch (e) {
    log(`Parse error: ${res.body}`);
    throw new Error('Invalid response');
  }

  // 认证失败 -> 自动重新登录
  if (body.success === false || res.status === 401 || res.status === 403) {
    log(`Auth failed (${res.status}), re-logging in...`);

    const loginResult = await login(username, password);
    if (loginResult.session) {
      session = loginResult.session;
      userId = loginResult.data?.data?.id || userId;
      config.session = session;
      config.userId = userId;
      config.lastLogin = Date.now();
      fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));
      log('Re-login successful');

      // 重试查询
      res = await checkQuota(session, userId);
      try {
        body = JSON.parse(res.body);
      } catch (e) {
        log(`Parse error on retry: ${res.body}`);
        throw new Error('Invalid response on retry');
      }
    } else {
      log('Re-login failed');
      const oldCache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
      fs.writeFileSync(CACHE, JSON.stringify({
        ...oldCache,
        updatedAt: Date.now(),
        status: 'auth_error',
        error: '登录失败，请重新运行 cli.js login',
      }, null, 2));
      return;
    }
  }

  // 写入缓存
  if (body.success !== false) {
    const d = body.data || body;
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
    log(`Quota updated: remaining=$${(cache.quota / 500000).toFixed(2)}, used=$${(cache.usedQuota / 500000).toFixed(2)}`);
  } else {
    const oldCache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
    fs.writeFileSync(CACHE, JSON.stringify({
      ...oldCache,
      updatedAt: Date.now(),
      status: 'error',
      error: body.message || 'unknown',
    }, null, 2));
    log(`Quota check failed: ${body.message}`);
  }
}

main()
  .catch(e => log(`ERROR: ${e.message}`))
  .finally(cleanup);
