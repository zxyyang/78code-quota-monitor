#!/usr/bin/env node
// 78code Quota Monitor - Statusline 包装脚本
// 包装 gsd-statusline.js 输出并追加额度信息
// 安装时复制到 ~/.claude/hooks/quota-monitor/statusline-wrapper.js

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = os.homedir();
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');
const quotaDir = path.join(claudeDir, 'hooks', 'quota-monitor');
const quotaCache = path.join(quotaDir, 'cache.json');
const quotaConfig = path.join(quotaDir, 'config.json');
const gsdStatusline = path.join(claudeDir, 'hooks', 'gsd-statusline.js');

const stdinTimeout = setTimeout(() => process.exit(0), 3000);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    // 1. 执行原始 gsd-statusline.js，获取其输出
    let baseOutput = '';
    if (fs.existsSync(gsdStatusline)) {
      try {
        baseOutput = execFileSync(process.execPath, [gsdStatusline], {
          input: input,
          encoding: 'utf8',
          timeout: 3000,
        });
      } catch (e) {
        // gsd-statusline.js 执行失败，使用 fallback
        baseOutput = buildFallbackOutput(input);
      }
    } else {
      // gsd-statusline.js 不存在，使用 fallback
      baseOutput = buildFallbackOutput(input);
    }

    // 2. 构建额度信息
    const quotaInfo = buildQuotaInfo();

    // 3. 输出：基础输出 + 额度信息
    process.stdout.write(baseOutput + quotaInfo);
  } catch (e) {
    // 静默失败，不破坏状态栏
  }
});

function buildFallbackOutput(rawInput) {
  try {
    const data = JSON.parse(rawInput);
    const model = data.model?.display_name || 'Claude';
    const dir = data.workspace?.current_dir || process.cwd();
    const dirname = path.basename(dir);
    return `\x1b[2m${model}\x1b[0m │ \x1b[2m${dirname}\x1b[0m`;
  } catch (e) {
    return '';
  }
}

function buildQuotaInfo() {
  let quotaInfo = '';

  if (fs.existsSync(quotaCache)) {
    try {
      const q = JSON.parse(fs.readFileSync(quotaCache, 'utf8'));
      const divisor = 500000;

      if (q.status === 'ok' && q.quota != null) {
        const remaining = (q.quota / divisor).toFixed(2);
        quotaInfo = ` │ \x1b[38;5;177m💰 ${q.displayName || q.username}(${q.userId}) · 余额$${remaining}\x1b[0m`;
      } else if (q.status === 'auth_error') {
        quotaInfo = ` │ \x1b[38;5;177m💰 Cookie过期 重登中...\x1b[0m`;
      } else if (q.status === 'error') {
        quotaInfo = ` │ \x1b[38;5;177m💰 额度查询异常\x1b[0m`;
      }

      // 检查缓存是否过期，过期则后台刷新
      const age = Date.now() - (q.updatedAt || 0);
      let interval = 300000;
      try {
        const c = JSON.parse(fs.readFileSync(quotaConfig, 'utf8'));
        interval = (c.checkInterval || 300) * 1000;
      } catch (e) {}

      if (age > interval && fs.existsSync(quotaConfig)) {
        triggerCheck();
      }
    } catch (e) {}
  } else if (fs.existsSync(quotaConfig)) {
    // 有配置但无缓存，触发首次检查
    triggerCheck();
    quotaInfo = ` │ \x1b[38;5;177m💰 加载中...\x1b[0m`;
  }

  return quotaInfo;
}

function triggerCheck() {
  try {
    const child = spawn(process.execPath, [path.join(quotaDir, 'check.js')], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (e) {}
}
