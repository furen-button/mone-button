#!/usr/bin/env node
// 設定エディタ（dev 専用 GUI）の画面を headless Chrome で撮る道具。
// UI を直したときの目視確認とコンソールエラーの検出を再現可能にするためのもの。
//
//   npm run shots                                   # 既定プリセットの 5 タブ
//   npm run shots -- --preset config-mone.json      # プリセットを変える
//   npm run shots -- --tab preview,build            # タブを絞る
//   npm run shots -- --strict                       # コンソールに深刻な出力があれば exit 1
//   npm run shots -- --out docs/screenshots         # 出力先を変える
//
// dev サーバが動いていなければ自分で `npm run dev` を起動し、撮り終えたら止める。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { capturePage, launchChrome } from './cdp.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EDITOR_PATH = '/mone-button/editor.html';
const TABS = ['clips', 'preview', 'settings', 'build', 'summary'];
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
// 見逃したくないもの。level が error のものに加えて、本文で拾う。
const SERIOUS_TEXT = [/Uncaught/u, /net::ERR/u, /Failed to load resource/u, /^Warning: /u];

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.SHOTS_BASE_URL || 'http://localhost:5173',
    preset: 'config-matome-01.json',
    tabs: TABS,
    out: path.join(projectRoot, 'cache/ui-shots'),
    width: 1600,
    height: 1000,
    settleMs: 2500,
    timeoutMs: 45000,
    serverTimeoutMs: 90000,
    fullPage: true,
    keepServer: false,
    strict: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--base-url') {
      options.baseUrl = next().replace(/\/$/u, '');
    } else if (arg === '--preset') {
      options.preset = next();
    } else if (arg === '--tab' || arg === '--tabs') {
      options.tabs = next().split(',').map((tab) => tab.trim()).filter(Boolean);
    } else if (arg === '--out') {
      const value = next();
      options.out = path.isAbsolute(value) ? value : path.join(projectRoot, value);
    } else if (arg === '--width') {
      options.width = Number(next());
    } else if (arg === '--height') {
      options.height = Number(next());
    } else if (arg === '--settle') {
      options.settleMs = Number(next());
    } else if (arg === '--timeout') {
      options.timeoutMs = Number(next());
    } else if (arg === '--viewport') {
      options.fullPage = false;
    } else if (arg === '--keep-server') {
      options.keepServer = true;
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`不明なオプション: ${arg}`);
    }
  }

  const unknown = options.tabs.filter((tab) => !TABS.includes(tab));
  if (unknown.length > 0) {
    throw new Error(`不明なタブ: ${unknown.join(', ')}（${TABS.join(' / ')}）`);
  }
  return options;
}

function usage() {
  console.log(`使い方: npm run shots -- [options]

  --preset <name>     プリセット（既定 config-matome-01.json）
  --tab <a,b>         撮るタブ（既定 ${TABS.join(',')}）
  --base-url <url>    dev サーバ（既定 http://localhost:5173）
  --out <dir>         出力先（既定 cache/ui-shots）
  --width/--height    ビューポート（既定 1600x1000。既定はページ全体を撮る）
  --viewport          ページ全体ではなくビューポートだけ撮る
  --settle <ms>       load 後に待つ時間（既定 2500）
  --timeout <ms>      1 枚あたりの上限（既定 45000）
  --strict            コンソールに深刻な出力があれば exit 1
  --keep-server       自分で起動した dev サーバを止めない`);
}

function resolveChrome() {
  const fromEnv = process.env.CHROME_BIN;
  if (fromEnv) {
    if (!fs.existsSync(fromEnv)) {
      throw new Error(`CHROME_BIN が見つからない: ${fromEnv}`);
    }
    return fromEnv;
  }
  const found = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('Chrome が見つからない。CHROME_BIN で実行ファイルを指定する。');
  }
  return found;
}

async function isServerUp(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}${EDITOR_PATH}`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerUp(baseUrl)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// dev サーバは detached で起こしてプロセスグループごと止める（vite の子を残さない）。
function startDevServer() {
  console.log('🚀 dev サーバを起動します');
  const child = spawn('npm', ['run', 'dev'], {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  child.unref();
  return child;
}

function stopDevServer(child) {
  if (!child?.pid) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // すでに終わっている
  }
}

function isSerious(message) {
  return message.level === 'error' || SERIOUS_TEXT.some((pattern) => pattern.test(message.text));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return 0;
  }

  const chrome = resolveChrome();
  fs.mkdirSync(options.out, { recursive: true });

  let server = null;
  if (!(await isServerUp(options.baseUrl))) {
    server = startDevServer();
    if (!(await waitForServer(options.baseUrl, options.serverTimeoutMs))) {
      stopDevServer(server);
      throw new Error(`dev サーバが起動しない: ${options.baseUrl}`);
    }
  }

  const presetBase = options.preset.replace(/\.json$/u, '');
  const results = [];
  const session = await launchChrome({ chrome, width: options.width, height: options.height });
  try {
    for (const tab of options.tabs) {
      const out = path.join(options.out, `${presetBase}-${tab}.png`);
      const url = `${options.baseUrl}${EDITOR_PATH}?tab=${tab}&preset=${encodeURIComponent(options.preset)}`;
      const startedAt = Date.now();
      try {
        const { data, messages } = await capturePage({
          browser: session.browser,
          url,
          width: options.width,
          height: options.height,
          settleMs: options.settleMs,
          timeoutMs: options.timeoutMs,
          fullPage: options.fullPage,
        });
        fs.writeFileSync(out, data);
        const serious = messages.filter(isSerious);
        results.push({ tab, out, ok: true, ms: Date.now() - startedAt, messages, serious });
        console.log(`📸 ${tab.padEnd(9)} ${path.relative(projectRoot, out)} (${Date.now() - startedAt} ms)`);
        for (const message of serious) {
          console.log(`   ⚠️ [${message.level}] ${message.text.slice(0, 200)}`);
        }
      } catch (error) {
        results.push({ tab, out, ok: false, ms: Date.now() - startedAt, messages: [], serious: [], error });
        console.log(`❌ ${tab.padEnd(9)} ${error.message}`);
      }
    }
  } finally {
    await session.close();
    if (server && !options.keepServer) {
      stopDevServer(server);
    }
  }

  const logPath = path.join(options.out, `${presetBase}-console.log`);
  fs.writeFileSync(
    logPath,
    results.map((result) => `# ${result.tab}\n${result.messages.map((m) => `[${m.level}] ${m.text}`).join('\n')}\n`).join('\n'),
    'utf8',
  );

  const failed = results.filter((result) => !result.ok);
  const serious = results.reduce((sum, result) => sum + result.serious.length, 0);
  console.log(`\n${results.length - failed.length}/${results.length} 枚 · コンソール要注意 ${serious} 件 · ${path.relative(projectRoot, options.out)}`);
  if (failed.length > 0) {
    console.error(`撮影に失敗: ${failed.map((result) => result.tab).join(', ')}`);
    return 1;
  }
  return options.strict && serious > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  });
