#!/usr/bin/env node
// 78code Quota Monitor - 核心 API 和工具模块

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const MONITOR_DIR = path.join(CLAUDE_DIR, 'hooks', 'quota-monitor');
const CONFIG_FILE = path.join(MONITOR_DIR, 'config.json');
const CACHE_FILE = path.join(MONITOR_DIR, 'cache.json');
const LOG_FILE = path.join(MONITOR_DIR, 'debug.log');
const WRAPPER_FILE = path.join(MONITOR_DIR, 'statusline-wrapper.js');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
const SETTINGS_LOCAL_FILE = path.join(CLAUDE_DIR, 'settings.local.json');
const STATUSLINE = path.join(CLAUDE_DIR, 'hooks', 'gsd-statusline.js');

// 旧版注入标记（用于清理兼容）
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

async function apiGetTokens(session, userId) {
  const headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-store',
    'user-agent': UA,
    'cookie': `session=${session}`,
  };
  if (userId) headers['new-api-user'] = String(userId);
  const res = await httpReq({ url: 'https://www.78code.cc/api/token/?p=1&size=100', headers });
  return { status: res.status, data: JSON.parse(res.body) };
}

function detectCurrentGroup(tokens) {
  if (!tokens || tokens.length === 0) return null;
  // 读取环境变量或 settings 中的 API key
  let apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    try {
      const settingsPath = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      apiKey = (settings.env && settings.env.ANTHROPIC_API_KEY) || '';
    } catch (e) {}
  }
  if (!apiKey) return null;
  // 去掉 sk- 前缀
  const rawKey = apiKey.replace(/^sk-/, '');
  const matched = tokens.find(t => t.key === rawKey);
  return matched ? { name: matched.name, group: matched.group, id: matched.id } : null;
}

async function apiGetGroups(session, userId) {
  const headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-store',
    'user-agent': UA,
    'cookie': `session=${session}`,
  };
  if (userId) headers['new-api-user'] = String(userId);
  const res = await httpReq({ url: 'https://www.78code.cc/api/user/self/groups', headers });
  return { status: res.status, data: JSON.parse(res.body) };
}

async function apiGetSubscription(session, userId) {
  const headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-store',
    'user-agent': UA,
    'cookie': `session=${session}`,
  };
  if (userId) headers['new-api-user'] = String(userId);
  const res = await httpReq({ url: 'https://www.78code.cc/api/subscription/self', headers });
  return { status: res.status, data: JSON.parse(res.body) };
}

function formatQuota(val) {
  return val != null ? (val / 500000).toFixed(2) : '?';
}

function buildCacheObj(d, username, userId, subscriptions, currentToken, groupRatio) {
  return {
    username: d.username || username,
    displayName: d.display_name || d.username || username,
    userId: d.id || userId,
    quota: d.quota,
    usedQuota: d.used_quota,
    group: d.group,
    subscriptions: subscriptions || [],
    currentToken: currentToken || null,
    groupRatio: groupRatio,
    updatedAt: Date.now(),
    status: 'ok',
  };
}

function formatSubscriptions(subs) {
  if (!subs || subs.length === 0) return '';
  const divisor = 500000;
  return subs.map(s => {
    const sub = s.subscription || s;
    const used = (sub.amount_used / divisor).toFixed(2);
    const total = (sub.amount_total / divisor).toFixed(2);
    const endDate = new Date(sub.end_time * 1000);
    const dateStr = `${endDate.getFullYear()}/${endDate.getMonth() + 1}/${endDate.getDate()} ${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}:${endDate.getSeconds().toString().padStart(2, '0')}`;
    const name = sub.upgrade_group || `套餐#${sub.plan_id}`;
    return `订阅:${name}(${dateStr}) 额度:¥${used}/¥${total}`;
  }).join(' ');
}

// ── Settings 管理 ──

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { return null; }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

const WRAPPER_CMD = `node "${WRAPPER_FILE}"`;

function updateSettings() {
  for (const settingsPath of [SETTINGS_FILE, SETTINGS_LOCAL_FILE]) {
    const settings = readJsonFile(settingsPath);
    if (!settings) continue;
    if (!settings.statusLine) settings.statusLine = {};

    // 保存原始 command（仅首次）
    const config = readConfig();
    if (config && !config.originalStatusLineCmd && settings.statusLine.command) {
      config.originalStatusLineCmd = settings.statusLine.command;
      writeConfig(config);
    }

    settings.statusLine.type = 'command';
    settings.statusLine.command = WRAPPER_CMD;
    writeJsonFile(settingsPath, settings);
  }
}

function restoreSettings() {
  const config = readConfig();
  const originalCmd = config && config.originalStatusLineCmd;
  if (!originalCmd) return;

  for (const settingsPath of [SETTINGS_FILE, SETTINGS_LOCAL_FILE]) {
    const settings = readJsonFile(settingsPath);
    if (!settings || !settings.statusLine) continue;
    settings.statusLine.command = originalCmd;
    writeJsonFile(settingsPath, settings);
  }
}

// ── 旧版注入清理（兼容） ──

const ORIGINAL_OUTPUT = `    // Output
    const dirname = path.basename(dir);
    if (task) {
      process.stdout.write(\`\${gsdUpdate}\\x1b[2m\${model}\\x1b[0m │ \\x1b[1m\${task}\\x1b[0m │ \\x1b[2m\${dirname}\\x1b[0m\${ctx}\`);
    } else {
      process.stdout.write(\`\${gsdUpdate}\\x1b[2m\${model}\\x1b[0m │ \\x1b[2m\${dirname}\\x1b[0m\${ctx}\`);
    }`;

function cleanOldInjection() {
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

// ── Statusline 安装 ──

function installStatusline() {
  ensureDir();

  // 清除旧版注入代码（兼容升级）
  cleanOldInjection();

  // 复制运行时脚本到 MONITOR_DIR
  const filesToCopy = ['statusline-wrapper.js', 'check.js', 'core.js'];
  for (const f of filesToCopy) {
    const src = path.join(__dirname, f);
    const dst = path.join(MONITOR_DIR, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    } else {
      return { ok: false, msg: `找不到 ${f} 源文件` };
    }
  }

  // 修改 settings 指向 wrapper
  updateSettings();

  return { ok: true, msg: '插件已安装到状态栏（全局生效）' };
}

function uninstallStatusline() {
  // 恢复 settings 指回原始 statusline
  restoreSettings();

  // 删除 wrapper 文件
  if (fs.existsSync(WRAPPER_FILE)) fs.unlinkSync(WRAPPER_FILE);

  // 清除旧版注入代码（兼容）
  cleanOldInjection();
}

function isInstalled() {
  if (!fs.existsSync(WRAPPER_FILE)) return false;
  // 检查 settings 是否指向 wrapper
  const settings = readJsonFile(SETTINGS_LOCAL_FILE) || readJsonFile(SETTINGS_FILE);
  if (!settings || !settings.statusLine) return false;
  return settings.statusLine.command === WRAPPER_CMD;
}

module.exports = {
  MONITOR_DIR, CONFIG_FILE, CACHE_FILE, WRAPPER_FILE, STATUSLINE,
  INTERVALS,
  ensureDir, readConfig, writeConfig, readCache, writeCache, log,
  apiLogin, apiGetUser, apiGetTokens, apiGetGroups, apiGetSubscription, formatQuota, buildCacheObj, formatSubscriptions, detectCurrentGroup,
  installStatusline, uninstallStatusline, isInstalled,
};
