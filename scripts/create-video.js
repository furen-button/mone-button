import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const parentDir = path.dirname(__dirname);

const dataDir = path.join(parentDir, 'public/data');
const videosDir = path.join(parentDir, 'public/videos');
const cacheRoot = path.join(parentDir, 'cache/createVideo');
const outputDir = path.join(parentDir, 'output');

// 日本語の焼き込みに使うフォント（fontconfig で解決）。--font で上書き可。
const DEFAULT_FONT = 'Hiragino Sans';
const SYSTEM_FONTS_DIR = '/System/Library/Fonts';

// 9 分割の位置名 → ASS alignment（テンキー配列）
const ALIGN = {
  'top-left': 7, 'top-center': 8, 'top-right': 9,
  'middle-left': 4, 'center': 5, 'middle-right': 6,
  'bottom-left': 1, 'bottom-center': 2, 'bottom-right': 3,
};

/* -------------------------------------------------------------------------- */
/* 共通ユーティリティ                                                          */
/* -------------------------------------------------------------------------- */

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// YYYYMMDD → YYYY-MM-DD（extract.js と同一ロジック）
function formatDate(dateStr) {
  if (!dateStr || dateStr.length !== 8) return dateStr || '';
  return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

// 秒（float）→ 元動画タイムスタンプ H:MM:SS
function formatTimestamp(seconds) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// 絵文字を除去（libass が tofu になるのを防ぐ）
function stripEmoji(text) {
  if (!text) return '';
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[️‍\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// 1 文字の表示幅（全角=1 / 半角=0.5）
function charWidth(ch) {
  const c = ch.codePointAt(0);
  if (c <= 0x2ff) return 0.5;                  // ASCII + Latin-1
  if (c >= 0xff61 && c <= 0xff9f) return 0.5;  // 半角カタカナ
  return 1;                                     // CJK・かな・全角など
}

// libass は日本語を自動折り返ししないため、表示幅で手動改行する
function wrapText(text, maxUnits) {
  if (maxUnits <= 0) return text;
  const out = [];
  let line = '';
  let width = 0;
  let lastSpace = -1;
  const flush = () => { out.push(line); line = ''; width = 0; lastSpace = -1; };
  for (const ch of text) {
    if (ch === '\n') { flush(); continue; }
    line += ch;
    width += charWidth(ch);
    if (ch === ' ') lastSpace = line.length - 1;
    if (width >= maxUnits) {
      if (lastSpace > 0 && lastSpace < line.length - 1) {
        const rest = line.slice(lastSpace + 1);
        out.push(line.slice(0, lastSpace));
        line = rest;
        width = 0;
        for (const c2 of line) width += charWidth(c2);
        lastSpace = -1;
      } else {
        flush();
      }
    }
  }
  if (line) out.push(line);
  return out.join('\n');
}

// 余白・フォントサイズから 1 行に収まる表示幅（全角換算）を求める
function maxUnitsFor(width, marginL, marginR, size) {
  return Math.floor(((width - marginL - marginR) / size) * 0.97);
}

// ASS 本文用エスケープ（override ブロックの誤認・改行を回避）
function escapeAssText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '｛')
    .replace(/\}/g, '｝')
    .replace(/\r?\n/g, '\\N');
}

// subtitles フィルタのファイルパス用エスケープ
function escapeFilterPath(p) {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/* -------------------------------------------------------------------------- */
/* 引数パース                                                                  */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    let token = argv[i];
    if (!token.startsWith('--')) continue;
    token = token.slice(2);

    if (token.startsWith('no-')) {
      opts[token.slice(3)] = false;
      continue;
    }
    const eq = token.indexOf('=');
    if (eq >= 0) {
      opts[token.slice(0, eq)] = token.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      opts[token] = next;
      i++;
    } else {
      opts[token] = true;
    }
  }
  return opts;
}

// npm run createVideo --videoId=... 形式（npm_config_*）からのフォールバック取得
function npmConfig(key) {
  const lower = key.toLowerCase();
  for (const [envKey, value] of Object.entries(process.env)) {
    if (envKey.toLowerCase() === `npm_config_${lower}`) return value;
  }
  return undefined;
}

function getOpt(opts, key, fallback) {
  if (opts[key] !== undefined) return opts[key];
  const env = npmConfig(key);
  if (env !== undefined) return env;
  return fallback;
}

// 真偽オプション（既定 true、--no-xxx で false）
function getBool(opts, key, fallback) {
  const v = getOpt(opts, key, undefined);
  if (v === undefined) return fallback;
  if (v === false || v === 'false' || v === '0' || v === 'no') return false;
  return true;
}

function resolveAlign(name, key) {
  if (!name) return null;
  const align = ALIGN[name];
  if (!align) {
    console.error(`❌ ${key} の位置指定が不正です: "${name}"`);
    console.error(`   指定可能: ${Object.keys(ALIGN).join(', ')}`);
    process.exit(1);
  }
  return align;
}

/* -------------------------------------------------------------------------- */
/* ffmpeg（subtitles=libass 対応）の解決                                        */
/* -------------------------------------------------------------------------- */

function ffmpegHasSubtitles(bin) {
  try {
    const out = execFileSync(bin, ['-hide_banner', '-filters'], { encoding: 'utf8' });
    return /\bsubtitles\b/.test(out);
  } catch {
    return false;
  }
}

function resolveFfmpeg() {
  const candidates = [
    process.env.FFMPEG_BIN,
    '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
    '/usr/local/opt/ffmpeg-full/bin/ffmpeg',
    'ffmpeg',
  ].filter(Boolean);

  for (const bin of candidates) {
    if (ffmpegHasSubtitles(bin)) return bin;
  }

  console.error('❌ subtitles(libass) フィルタ対応の ffmpeg が見つかりません。');
  console.error('   テロップ焼き込みには libass 対応ビルドが必要です。次で導入してください:');
  console.error('     brew install ffmpeg-full');
  console.error('   既にある場合は FFMPEG_BIN 環境変数でパスを指定できます。');
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* ASS（字幕）生成                                                             */
/* -------------------------------------------------------------------------- */

function buildAss(elements, width, height, font) {
  const lines = [];
  lines.push('[Script Info]');
  lines.push('ScriptType: v4.00+');
  lines.push(`PlayResX: ${width}`);
  lines.push(`PlayResY: ${height}`);
  lines.push('WrapStyle: 0');
  lines.push('ScaledBorderAndShadow: yes');
  lines.push('');
  lines.push('[V4+ Styles]');
  lines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
  // 白文字 + 黒縁取り + 影。サイズ・配置・余白は行ごとに上書きする。
  lines.push(`Style: Default,${font},48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,3,1,2,40,40,40,1`);
  lines.push('');
  lines.push('[Events]');
  lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

  for (const el of elements) {
    const override = `{\\an${el.align}\\fs${el.size}}`;
    lines.push(
      `Dialogue: 0,0:00:00.00,9:59:59.99,Default,,${el.marginL},${el.marginR},${el.marginV},,${override}${escapeAssText(el.text)}`
    );
  }

  return lines.join('\n') + '\n';
}

/* -------------------------------------------------------------------------- */
/* yt-dlp（高画質キャッシュ DL）                                                */
/* -------------------------------------------------------------------------- */

function downloadHighQuality(videoId, startTime, endTime, outputPath) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  execFileSync('yt-dlp', [
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--download-sections', `*${startTime}-${endTime}`,
    '--force-keyframes-at-cuts',
    '--merge-output-format', 'mp4',
    '-o', outputPath,
    url,
  ], { stdio: 'inherit' });
}

/* -------------------------------------------------------------------------- */
/* メイン                                                                      */
/* -------------------------------------------------------------------------- */

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const videoId = getOpt(opts, 'videoId', undefined);
  if (!videoId || videoId === true) {
    console.error('❌ --videoId は必須です。');
    console.error('   例: npm run createVideo -- --videoId gr9WJDYS_u0');
    process.exit(1);
  }

  const source = getOpt(opts, 'source', 'existing');
  if (source !== 'existing' && source !== 'cache') {
    console.error(`❌ --source は existing か cache を指定してください（指定値: ${source}）`);
    process.exit(1);
  }

  const [width, height] = String(getOpt(opts, 'resolution', '1280x720'))
    .split('x')
    .map((n) => parseInt(n, 10));
  if (!width || !height) {
    console.error('❌ --resolution は WxH 形式で指定してください（例: 1280x720）');
    process.exit(1);
  }

  const font = getOpt(opts, 'font', DEFAULT_FONT);

  // 表示要素ごとの有無・位置
  const showTitle = getBool(opts, 'title', true) && getOpt(opts, 'title', undefined) !== false;
  const titleOverride = (() => {
    const v = getOpt(opts, 'title', undefined);
    return typeof v === 'string' ? v : null;
  })();
  const showDate = getBool(opts, 'date', true);
  const showSerif = getBool(opts, 'serif', true);
  const showTime = getBool(opts, 'time', true);

  const titleAlign = resolveAlign(getOpt(opts, 'title-pos', 'top-center'), '--title-pos');
  const dateAlign = resolveAlign(getOpt(opts, 'date-pos', 'top-right'), '--date-pos');
  const serifAlign = resolveAlign(getOpt(opts, 'serif-pos', 'bottom-center'), '--serif-pos');
  const timeAlign = resolveAlign(getOpt(opts, 'time-pos', 'bottom-right'), '--time-pos');

  // 解像度基準のフォントサイズ・余白
  const sizes = {
    title: Math.round(height * 0.060),
    date: Math.round(height * 0.042),
    time: Math.round(height * 0.042),
    serif: Math.round(height * 0.058),
  };
  const marginV = Math.round(height * 0.045);
  const marginH = Math.round(width * 0.035);
  const serifMarginH = Math.round(width * 0.08);

  const ffmpeg = resolveFfmpeg();

  // 対象クリップを収集（ファイル名に -<videoId>- を含む JSON）
  if (!fs.existsSync(dataDir)) {
    console.error(`❌ データディレクトリがありません: ${dataDir}`);
    process.exit(1);
  }
  const clipFiles = fs.readdirSync(dataDir)
    .filter((f) => f.endsWith('.json') && f.includes(`-${videoId}-`))
    .sort();

  if (clipFiles.length === 0) {
    console.error(`❌ videoId "${videoId}" のクリップが public/data に見つかりません。`);
    process.exit(1);
  }

  // 開始時刻順に整列
  const clips = clipFiles
    .map((file) => {
      const data = readJson(path.join(dataDir, file));
      return { file, base: path.basename(file, '.json'), data };
    })
    .sort((a, b) => (a.data.trimming?.startTime ?? 0) - (b.data.trimming?.startTime ?? 0));

  console.log(`🚀 videoId="${videoId}" のクリップ ${clips.length} 件を 1 本に結合します（source=${source}）\n`);

  // 出力ファイル名
  const firstMeta = clips[0].data.videoFile?.metadata || {};
  const dateStr = formatDate(firstMeta.uploadDate);
  const defaultOut = path.join(outputDir, `${dateStr}-${videoId}-combined.mp4`);
  const outPath = path.resolve(getOpt(opts, 'out', defaultOut));

  // タイトル文言（既定はメタタイトルの絵文字除去）
  const titleText = titleOverride !== null ? titleOverride : stripEmoji(firstMeta.title || '');

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'createVideo-'));
  const concatList = [];

  try {
    if (source === 'cache') {
      fs.mkdirSync(path.join(cacheRoot, videoId), { recursive: true });
    }

    clips.forEach((clip, idx) => {
      const num = idx + 1;
      const startTime = clip.data.trimming?.startTime;
      const endTime = clip.data.trimming?.endTime;

      // 1) 結合元 mp4 を用意
      let sourceMp4;
      if (source === 'existing') {
        sourceMp4 = path.join(videosDir, `${clip.base}.mp4`);
        if (!fs.existsSync(sourceMp4)) {
          console.warn(`⚠️ [${num}/${clips.length}] 既存 mp4 が無いためスキップ: ${clip.base}.mp4`);
          return;
        }
      } else {
        sourceMp4 = path.join(cacheRoot, videoId, `${clip.base}.mp4`);
        if (fs.existsSync(sourceMp4)) {
          console.log(`♻️  [${num}/${clips.length}] キャッシュ再利用: ${clip.base}.mp4`);
        } else {
          console.log(`⏬ [${num}/${clips.length}] 高画質ダウンロード中: ${clip.base}`);
          downloadHighQuality(videoId, startTime, endTime, sourceMp4);
        }
      }

      // 2) この区間用のテロップ要素を組み立て（長文は表示幅で手動折り返し）
      const elements = [];
      const addElement = (text, align, size, mH) => {
        const wrapped = wrapText(String(text), maxUnitsFor(width, mH, mH, size));
        elements.push({ text: wrapped, align, size, marginL: mH, marginR: mH, marginV });
      };
      if (showTitle && titleText) {
        addElement(titleText, titleAlign, sizes.title, marginH);
      }
      if (showDate && dateStr) {
        addElement(dateStr, dateAlign, sizes.date, marginH);
      }
      if (showTime && startTime !== undefined) {
        addElement(formatTimestamp(startTime), timeAlign, sizes.time, marginH);
      }
      if (showSerif && clip.data.serif) {
        addElement(clip.data.serif, serifAlign, sizes.serif, serifMarginH);
      }

      // 3) ASS を書き出して subtitles で焼き込み（解像度統一 → 再エンコード）
      const assPath = path.join(workDir, `clip-${idx}.ass`);
      fs.writeFileSync(assPath, buildAss(elements, width, height, font));

      const burnedPath = path.join(workDir, `clip-${String(idx).padStart(4, '0')}.mp4`);
      const vf =
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,` +
        `subtitles=filename='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(SYSTEM_FONTS_DIR)}'`;

      console.log(`🎬 [${num}/${clips.length}] テロップ焼き込み中: ${clip.base}`);
      execFileSync(ffmpeg, [
        '-y',
        '-i', sourceMp4,
        '-vf', vf,
        '-r', '30',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
        burnedPath,
      ], { stdio: 'inherit' });

      concatList.push(burnedPath);
    });

    if (concatList.length === 0) {
      console.error('❌ 結合できるクリップがありませんでした。');
      process.exit(1);
    }

    // 4) 連結
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const listPath = path.join(workDir, 'concat.txt');
    fs.writeFileSync(listPath, concatList.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n');

    console.log(`\n🔗 ${concatList.length} 本を連結中...`);
    execFileSync(ffmpeg, [
      '-y',
      '-f', 'concat', '-safe', '0',
      '-i', listPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      outPath,
    ], { stdio: 'inherit' });

    console.log(`\n✅ 完成: ${outPath}`);
  } catch (err) {
    console.error('💥 処理中にエラーが発生しました:', err.message);
    process.exitCode = 1;
  } finally {
    // 一時ディレクトリの後始末
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main();
