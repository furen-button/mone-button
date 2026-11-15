#!/usr/bin/env node
// カテゴリまとめ（横）のサムネイル下書きを、侍まとめと同じ構成で作って保存する。
//
//   node .claude/skills/category-video/scripts/thumb-draft.mjs \
//     --base 2025-12-19-category-異議あり-kirinuki --title 異議あり --sub '〜objection〜' \
//     --clip 2026-05-02-G2T0DLX-P7Q-003784-003814 --at 1.2
//
// 1. テンプレート（既定 scripts/create-video/thumbnail-templates/category-kirinuki.json）を読む
// 2. 背景（slot frame）に --clip の高画質キャッシュから Anime4K で抜いたコマを入れる（POST /__cv/thumbnail/frame）
// 3. 大きい文字（title）・英字の副題（sub）・もねの切り抜き（mone）を差し替え、title の大きさを字数に合わせる
// 4. POST /__cv/thumbnail/project で mp4 の隣に <base>.thumbnail.json を保存する
// 5. headless Chrome で thumb.html?base=<base> を開き「保存」を押して <base>.thumbnail.jpg を書き出す（--no-save で省略）
//
// dev サーバ（npm run dev）が起動している必要がある。scripts/dev-server/** を直した後は再起動しておく。

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { launchChrome } from '../../../../scripts/ui/cdp.mjs';

const ROOT = process.cwd();
const THUMB_PATH = '/mone-button/thumb.html';
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
// 侍まとめで「侍」1 字を 302px で置いた位置。字数が増えたら中心を保ったまま縮める。
const TITLE_CENTER_X = 920;
const TITLE_CENTER_Y = 312;
const TITLE_MAX_SIZE = 302;
const TITLE_MAX_WIDTH = 640;
const SUB_MAX_RIGHT = 1240;
const DEFAULT_FACE = 'face:mone/0042_f00154974_r5_crop.png';

function parseArgs(argv) {
  const args = {
    base: null,
    title: null,
    sub: null,
    clip: null,
    at: null,
    face: DEFAULT_FACE,
    template: 'category-kirinuki',
    baseUrl: process.env.SHOTS_BASE_URL || 'http://localhost:5173',
    titleSize: null,
    save: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--base') {
      args.base = next();
    } else if (a === '--title') {
      args.title = next();
    } else if (a === '--sub') {
      args.sub = next();
    } else if (a === '--clip') {
      args.clip = next();
    } else if (a === '--at') {
      args.at = Number(next());
    } else if (a === '--face') {
      args.face = next();
    } else if (a === '--template') {
      args.template = next();
    } else if (a === '--base-url') {
      args.baseUrl = next();
    } else if (a === '--title-size') {
      args.titleSize = Number(next());
    } else if (a === '--no-save') {
      args.save = false;
    } else {
      throw new Error(`不明な引数: ${a}`);
    }
  }
  for (const key of ['base', 'title', 'clip']) {
    if (!args[key]) {
      throw new Error(`--${key} が必要です`);
    }
  }
  return args;
}

// Reggae One / RocknRoll One の字幅の目安（全角 1em、半角 0.6em）。
function estimateWidth(text, size) {
  return [...text].reduce((sum, ch) => sum + (/[ -~｡-ﾟ]/u.test(ch) ? 0.6 : 1) * size, 0);
}

async function api(baseUrl, endpoint, body) {
  const response = await fetch(`${baseUrl}/__cv/thumbnail/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${endpoint}: ${data.error || response.statusText}`);
  }
  return data;
}

function clipDuration(base) {
  const file = path.join(ROOT, 'public/data', `${base}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`public/data/${base}.json がありません`);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return data.trimming?.duration ?? 0;
}

function fillTemplate(template, { title, sub, face, frame, titleSize }) {
  const project = structuredClone(template);
  for (const layer of project.layers) {
    if (layer.type === 'image' && layer.slot === 'frame') {
      layer.src = frame.src;
      layer.recipe = frame.recipe;
    } else if (layer.type === 'image' && layer.slot === 'face') {
      layer.src = face;
    } else if (layer.type === 'text' && layer.id === 'title') {
      const size = titleSize || Math.min(TITLE_MAX_SIZE, (TITLE_MAX_SIZE * TITLE_MAX_WIDTH) / estimateWidth(title, TITLE_MAX_SIZE));
      const width = estimateWidth(title, size);
      const tilt = Math.sin(((layer.rotation || 0) * Math.PI) / 180);
      layer.text = title;
      layer.size = size;
      // 左端・上下中央が基準点で、そこを中心に回転する。回転後の文字の中心を侍と同じ位置に保つ。
      layer.x = TITLE_CENTER_X - (width / 2) * Math.cos(((layer.rotation || 0) * Math.PI) / 180);
      layer.y = TITLE_CENTER_Y - (width / 2) * tilt;
    } else if (layer.type === 'text' && layer.id === 'sub' && sub) {
      layer.text = sub;
      const room = SUB_MAX_RIGHT - layer.x;
      const width = estimateWidth(sub, layer.size);
      if (width > room) {
        layer.size = (layer.size * room) / width;
      }
    }
  }
  return project;
}

function resolveChrome() {
  const found = [process.env.CHROME_BIN, ...CHROME_CANDIDATES].find((p) => p && fs.existsSync(p));
  if (!found) {
    throw new Error('Chrome が見つかりません（CHROME_BIN で指定できます）');
  }
  return found;
}

async function evaluate(browser, sessionId, expression) {
  const result = await browser.send('Runtime.evaluate', { expression, returnByValue: true }, 30000, sessionId);
  return result.result.value;
}

async function waitFor(browser, sessionId, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(browser, sessionId, expression);
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} が ${timeoutMs} ms 以内に終わりません`);
}

// thumb.html で保存済みの project を開き、画面と同じ renderProject で JPEG を書き出す。
async function saveViaBrowser(baseUrl, base) {
  const chrome = await launchChrome({ chrome: resolveChrome(), width: 1600, height: 1000 });
  const { browser } = chrome;
  try {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    await browser.send('Page.enable', {}, 30000, sessionId);
    await browser.send('Runtime.enable', {}, 30000, sessionId);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false }, 30000, sessionId);
    await browser.send('Page.navigate', { url: `${baseUrl}${THUMB_PATH}?base=${encodeURIComponent(base)}` }, 30000, sessionId);
    await waitFor(browser, sessionId, "document.body && document.body.dataset.ready === '1'", 90000, 'サムネイルの描画');
    const clicked = await evaluate(
      browser,
      sessionId,
      "(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '保存'); if (!b) { return false; } b.click(); return true; })()",
    );
    if (!clicked) {
      throw new Error('「保存」ボタンが見つかりません');
    }
    const notice = await waitFor(
      browser,
      sessionId,
      "(() => { const t = document.body.innerText; const m = t.match(/保存しました[^\\n]*/u); if (m) { return m[0]; } const e = t.match(/Error[^\\n]*/u); return e ? 'ERROR ' + e[0] : null; })()",
      60000,
      '保存',
    );
    if (notice.startsWith('ERROR')) {
      throw new Error(notice);
    }
    return notice;
  } finally {
    await chrome.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const up = await fetch(`${args.baseUrl}${THUMB_PATH}`).then((r) => r.ok).catch(() => false);
  if (!up) {
    throw new Error(`dev サーバ（${args.baseUrl}）に繋がりません。npm run dev を起動してください`);
  }
  const templateFile = path.join(ROOT, 'scripts/create-video/thumbnail-templates', `${args.template}.json`);
  const template = JSON.parse(fs.readFileSync(templateFile, 'utf8'));
  const at = Number.isFinite(args.at) ? args.at : clipDuration(args.clip) / 2;
  const frame = await api(args.baseUrl, 'frame', { source: `cache:${args.clip}`, at, upscale: 'anime4k' });
  if (frame.fallback) {
    console.log(`⚠️ Anime4K を使えず Lanczos で抜きました: ${frame.reason}`);
  }
  const project = fillTemplate(template, { ...args, frame });
  await api(args.baseUrl, 'project', { target: args.base, project });
  console.log(`✅ ${args.base}.thumbnail.json を保存（背景 ${args.clip} @ ${at.toFixed(2)} 秒）`);
  if (!args.save) {
    return;
  }
  const notice = await saveViaBrowser(args.baseUrl, args.base);
  console.log(`✅ ${args.base}.thumbnail.jpg を保存: ${notice}`);
}

main().catch((error) => {
  console.error(`💥 ${error.message}`);
  process.exit(1);
});
