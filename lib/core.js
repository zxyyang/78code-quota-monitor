#!/usr/bin/env node
// 78code Quota Monitor - 核心 API 和工具模块

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

const MONITOR_DIR = path.join(os.homedir(), '.claude', 'hooks', 'quota-monitor');
const CONFIG_FILE = path.join(MONITOR_DIR, 'config.json');
const CACHE_FILE = path.join(MONITOR_DIR, 'cache.json');
const LOG_FILE = path.join(MONITOR_DIR, 'debug.log');
const STATUSLINE = path.join(os.homedir(), '.claude', 'hooks', 'gsd-statusline.js');

const START_MARKER = '// [78code-quota-start]';
const END_MARKER = '// [78code-quota-end]';

const INTERVALS = [
  { label: '1 分钟', value: 60 },
  { label: '2 分钟', value: 120 },
  { label: '5 分钟 (默认)', value: 300 },
  { label: '10 分钟', value: 600 },
  { label: '30 分钟', value: 1800 },
];

// ── 文件工具 ──

function ensureDir() {
  if (!fs.existsSync(MONITOR_DIR)) fs.mkdirSync(MONITOR_DIR, { recursive: true });
}

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

function writeConfig(config) {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function readCache() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
}

function writeCache(data) {
  ensureDir();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

function log(msg) {
  const ts = new Date().toISOString();
  try { fs.appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`); } catch (e) {}
}

// ── HTTP ──

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

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

async function apiLogin(username, password) {
  const res = await httpReq({
    url: 'https://www.78code.cc/api/user/login?turnstile=',
    method: 'POST',
    headers: {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'user-agent': UA,
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

async function apiGetUser(session, userId) {
  const headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'user-agent': UA,
    'cookie': `session=${session}`,
  };
  if (userId) headers['new-api-user'] = String(userId);
  const res = await httpReq({ url: 'https://www.78code.cc/api/user/self', headers });
  return { status: res.status, data: JSON.parse(res.body) };
}

function formatQuota(val) {
  return val != null ? (val / 500000).toFixed(2) : '?';
}

function buildCacheObj(d, username, userId) {
  return {
    username: d.username || username,
    displayName: d.display_name || d.username || username,
    userId: d.id || userId,
    quota: d.quota,
    usedQuota: d.used_quota,
    group: d.group,
    updatedAt: Date.now(),
    status: 'ok',
  };
}

// ── Statusline 注入 ──

function buildQuotaBlock(checkIntervalMs) {
  return `    ${START_MARKER}
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
          quotaInfo = \` │ \\x1b[38;5;177m💰 \${q.displayName || q.username}(\${q.userId}) · 余额$\${remaining}\\x1b[0m\`;
        } else if (q.status === 'auth_error') {
          quotaInfo = \` │ \\x1b[38;5;177m💰 Cookie过期 重登中...\\x1b[0m\`;
        } else if (q.status === 'error') {
          quotaInfo = \` │ \\x1b[38;5;177m💰 额度查询异常\\x1b[0m\`;
        }

        const age = Date.now() - (q.updatedAt || 0);
        let _interval = ${checkIntervalMs};
        try { const _c = JSON.parse(fs.readFileSync(quotaConfig, 'utf8')); _interval = (_c.checkInterval || 300) * 1000; } catch(e) {}
        if (age > _interval && fs.existsSync(quotaConfig)) {
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
      quotaInfo = \` │ \\x1b[38;5;177m💰 加载中...\\x1b[0m\`;
    }

    // Output
    const dirname = path.basename(dir);
    if (task) {
      process.stdout.write(\`\${gsdUpdate}\\x1b[2m\${model}\\x1b[0m │ \\x1b[1m\${task}\\x1b[0m │ \\x1b[2m\${dirname}\\x1b[0m\${ctx}\${quotaInfo}\`);
    } else {
      process.stdout.write(\`\${gsdUpdate}\\x1b[2m\${model}\\x1b[0m │ \\x1b[2m\${dirname}\\x1b[0m\${ctx}\${quotaInfo}\`);
    }
    ${END_MARKER}`;
}

const ORIGINAL_OUTPUT = `    // Output
    const dirname = path.basename(dir);
    if (task) {
      process.stdout.write(\`\${gsdUpdate}\\x1b[2m\${model}\\x1b[0m │ \\x1b[1m\${task}\\x1b[0m │ \\x1b[2m\${dirname}\\x1b[0m\${ctx}\`);
    } else {
      process.stdout.write(\`\${gsdUpdate}\\x1b[2m\${model}\\x1b[0m │ \\x1b[2m\${dirname}\\x1b[0m\${ctx}\`);
    }`;

function installStatusline() {
  if (!fs.existsSync(STATUSLINE)) {
    return { ok: false, msg: '找不到 gsd-statusline.js，请确认已安装 GSD statusline' };
  }
  let content = fs.readFileSync(STATUSLINE, 'utf8');
  if (content.includes(START_MARKER)) {
    return { ok: true, msg: '已安装，无需重复操作' };
  }
  const outputRegex = /    \/\/ Output\n    const dirname = path\.basename\(dir\);\n    if \(task\) \{\n      process\.stdout\.write\(`\$\{gsdUpdate\}[^`]*`\);\n    \} else \{\n      process\.stdout\.write\(`\$\{gsdUpdate\}[^`]*`\);\n    \}/;
  if (!outputRegex.test(content)) {
    return { ok: false, msg: '无法定位 statusline 输出代码，格式可能已变更' };
  }
  const config = readConfig();
  const intervalMs = ((config && config.checkInterval) || 300) * 1000;
  content = content.replace(outputRegex, buildQuotaBlock(intervalMs));
  fs.writeFileSync(STATUSLINE, content);
  return { ok: true, msg: '插件已安装到状态栏' };
}

function uninstallStatusline() {
  if (!fs.existsSync(STATUSLINE)) return;
  let content = fs.readFileSync(STATUSLINE, 'utf8');
  if (!content.includes(START_MARKER)) return;
  const startIdx = content.indexOf(START_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) return;
  const before = content.substring(0, startIdx).trimEnd();
  const after = content.substring(endIdx + END_MARKER.length);
  content = before + '\n' + ORIGINAL_OUTPUT + after;
  fs.writeFileSync(STATUSLINE, content);
}

function isInstalled() {
  if (!fs.existsSync(STATUSLINE)) return false;
  return fs.readFileSync(STATUSLINE, 'utf8').includes(START_MARKER);
}

module.exports = {
  MONITOR_DIR, CONFIG_FILE, CACHE_FILE, STATUSLINE,
  INTERVALS,
  ensureDir, readConfig, writeConfig, readCache, writeCache, log,
  apiLogin, apiGetUser, formatQuota, buildCacheObj,
  installStatusline, uninstallStatusline, isInstalled,
};
