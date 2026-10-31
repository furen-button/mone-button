import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

import { isDownloadTooShort, probeStreamDurations } from './create-video/assets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const parentDir = path.dirname(__dirname);

const inputDir = path.join(parentDir, 'public/data');
const outputDir = path.join(parentDir, 'public/videos');

// ダウンロード時点でもなるべく軽いものを狙う（短辺200p以下）
// 縦長動画（ショート等）は最小でも 144x256 で height 条件に合わず、
// 映像と音声が分離したストリームしか無いため best にも落ちない。width 側の条件で拾う。
export const YTDLP_FORMAT = [
  'bestvideo[height<=200][ext=mp4]+bestaudio[ext=m4a]',
  'bestvideo[width<=200][ext=mp4]+bestaudio[ext=m4a]',
  'best[height<=200][ext=mp4]',
  'best',
].join('/');

// 区間 DL では yt-dlp が ffmpeg に googlevideo の URL を直接読ませる。素の ffmpeg は読み取りタイムアウトが
// 無いのでサーバが無応答だと永久に固まり、途中で接続が切れると映像だけ短いファイルを成功扱いで残す。
// 20 秒無応答で切って Range で続きから再接続させる（5 秒だと遅いサーバの初回応答が間に合わず諦める）。
export const FFMPEG_INPUT_ARGS = [
  '-reconnect', '1',
  '-reconnect_streamed', '1',
  '-reconnect_on_network_error', '1',
  '-reconnect_delay_max', '10',
  '-rw_timeout', '20000000',
].join(' ');

// yt-dlp 1 回の上限。遅いサーバでも 30 秒クリップは 5 分程度で終わる。
// SIGINT なのは、yt-dlp が KeyboardInterrupt で ffmpeg に q を送って止めるため（SIGTERM だと ffmpeg が孤児として残る）。
export const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
export const DOWNLOAD_ATTEMPTS = 2;

/**
 * 1. JSONファイルを読み込んでオブジェクトを返す関数
 */
function readJson(filePath) {
  const rawData = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(rawData);
}

/**
 * 2. yt-dlp の引数を組み立てる関数
 */
export function buildYtDlpArgs({ videoUrl, startTime, endTime, outputPath }) {
  return [
    '-f', YTDLP_FORMAT,
    '--download-sections', `*${startTime}-${endTime}`,
    '--force-keyframes-at-cuts',
    '--downloader-args', `ffmpeg_i:${FFMPEG_INPUT_ARGS}`,
    '-o', outputPath,
    videoUrl,
  ];
}

/**
 * 3. yt-dlp が残す途中ファイル（<temp>.part、<temp>.f394.mp4 など）ごと消す関数
 */
export function removeDownloadArtifacts(tempVideoPath) {
  const dir = path.dirname(tempVideoPath);
  if (!fs.existsSync(dir)) {
    return;
  }
  const name = path.basename(tempVideoPath);
  const prefix = `${path.basename(tempVideoPath, path.extname(tempVideoPath))}.`;
  for (const entry of fs.readdirSync(dir)) {
    if (entry === name || entry.startsWith(prefix)) {
      fs.rmSync(path.join(dir, entry), { force: true });
    }
  }
}

/**
 * 4. ffprobe が使えるか確かめる関数（無ければ尺検査をスキップする）
 */
export function resolveFfprobe() {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return 'ffprobe';
  } catch {
    return null;
  }
}

// 問題なければ null、あれば理由の文字列を返す。
function verifyDownload({ tempVideoPath, expectedSec, ffprobe }) {
  if (!fs.existsSync(tempVideoPath)) {
    return 'yt-dlp は正常終了しましたが出力ファイルがありません';
  }
  if (!ffprobe) {
    return null;
  }
  const durations = probeStreamDurations({ ffprobe, filePath: tempVideoPath });
  if (!durations) {
    return '映像・音声の尺を取得できません（ファイルが壊れている可能性があります）';
  }
  if (isDownloadTooShort(expectedSec, durations.video)) {
    return `映像が短すぎます（期待 ${expectedSec.toFixed(3)}s / 実尺 ${durations.video.toFixed(3)}s）`;
  }
  return null;
}

// execFileSync の Error は message にコマンド全文が入って長いので、終了コードや信号だけにする。
// yt-dlp 自身の ERROR 行は stdio: 'inherit' で既に画面に出ている。
function describeFailure(err, timeoutMs) {
  if (err?.code === 'ETIMEDOUT') {
    return `yt-dlp が ${Math.round(timeoutMs / 1000)} 秒以内に終わらなかったので中断しました`;
  }
  if (Number.isInteger(err?.status)) {
    return `yt-dlp が終了コード ${err.status} で失敗しました`;
  }
  if (err?.signal) {
    return `yt-dlp が ${err.signal} で止まりました`;
  }
  return err?.message || String(err);
}

/**
 * 5. yt-dlp で指定区間をダウンロードし、映像尺を検査する関数
 *    失敗・短い・壊れているときは途中ファイルを消して attempts 回まで試し、それでも駄目なら throw する。
 */
export function downloadClip({
  videoUrl,
  startTime,
  endTime,
  tempVideoPath,
  ffprobe = 'ffprobe',
  attempts = DOWNLOAD_ATTEMPTS,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
}) {
  const expectedSec = endTime - startTime;
  const args = buildYtDlpArgs({ videoUrl, startTime, endTime, outputPath: tempVideoPath });
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let failure = null;
    try {
      execFileSync('yt-dlp', args, { stdio: 'inherit', timeout: timeoutMs, killSignal: 'SIGINT' });
      failure = verifyDownload({ tempVideoPath, expectedSec, ffprobe });
    } catch (err) {
      failure = describeFailure(err, timeoutMs);
    }
    if (failure === null) {
      return;
    }
    removeDownloadArtifacts(tempVideoPath);
    if (attempt < attempts) {
      console.warn(`⚠️ ダウンロードに失敗したので再試行します (${attempt}/${attempts}): ${failure}`);
      continue;
    }
    throw new Error(`ダウンロードに ${attempts} 回失敗しました: ${failure}`);
  }
}

/**
 * 6. ffmpeg-normalize を実行し、音量正規化と同時に動画を極限まで圧縮する関数
 */
function normalizeAudio(inputPath, outputPath) {
  // 音声: AAC形式 / 96kbps に削減。-e の値の前後の空白は、ffmpeg-normalize が -crf を自分のオプションと誤認しないため。
  execFileSync('ffmpeg-normalize', [
    inputPath,
    '-o', outputPath,
    '-c:a', 'aac',
    '-b:a', '96k',
    '-c:v', 'libx264',
    '-e', ' -crf 28 ',
  ], { stdio: 'inherit' });
}

/**
 * 7. 1つのJSONファイルに対する一連の処理を行う関数
 *    戻り値は { status: 'skipped' | 'done' | 'failed', message? }
 */
export function processSingleFile(file, { ffprobe = 'ffprobe' } = {}) {
  const inputFilePath = path.join(inputDir, file);
  const baseFileName = path.basename(file, '.json');
  const tempVideoPath = path.join(outputDir, `${baseFileName}_temp.mp4`);
  const finalVideoPath = path.join(outputDir, `${baseFileName}.mp4`);

  // 既にファイルが存在する場合はスキップ
  if (fs.existsSync(finalVideoPath)) {
    console.log(`⏭️ 既に存在するためスキップ: ${baseFileName}.mp4`);
    return { status: 'skipped' };
  }

  try {
    const data = readJson(inputFilePath);
    const videoId = data.videoId;
    const startTime = data.trimming?.startTime;
    const endTime = data.trimming?.endTime;

    if (!videoId || startTime === undefined || endTime === undefined) {
      console.log(`⏭️ データ不足のためスキップ: ${file}`);
      return { status: 'skipped' };
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // ダウンロード（映像尺の検査と再試行込み）
    console.log(`\n⏳ [1/2] ダウンロード中... (${baseFileName})`);
    downloadClip({ videoUrl, startTime, endTime, tempVideoPath, ffprobe });

    // 音量正規化 ＆ 強力圧縮
    console.log(`\n⏳ [2/2] 音量正規化と動画圧縮中... (${baseFileName})`);
    normalizeAudio(tempVideoPath, finalVideoPath);

    // お掃除
    removeDownloadArtifacts(tempVideoPath);
    console.log(`✅ 処理完了: ${finalVideoPath}`);
    return { status: 'done' };
  } catch (err) {
    console.error(`❌ エラー (${file}):`, err.message);
    // 途中ファイルと、正規化の途中で止まった不完全な完成ファイルを残さない（残ると次回「既に存在」で飛ばされる）。
    removeDownloadArtifacts(tempVideoPath);
    fs.rmSync(finalVideoPath, { force: true });
    return { status: 'failed', message: err.message };
  }
}

/**
 * メイン処理（全体を制御する関数）
 */
function main() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`📁 出力先の '${outputDir}' フォルダを作成しました。`);
  }

  try {
    const files = fs.readdirSync(inputDir);
    const jsonFiles = files.filter(file => path.extname(file).toLowerCase() === '.json');

    if (jsonFiles.length === 0) {
      console.log('⚠️ data フォルダに JSON ファイルが見つかりませんでした。');
      return;
    }

    const ffprobe = resolveFfprobe();
    if (!ffprobe) {
      console.warn('⚠️ ffprobe が見つからないため、ダウンロード後の尺検査をスキップします。');
    }

    console.log(`🚀 ${jsonFiles.length} 件の動画ダウンロードと処理を開始します...\n`);

    // 各ファイルに対して処理を実行
    const failed = [];
    for (const file of jsonFiles) {
      const result = processSingleFile(file, { ffprobe });
      if (result.status === 'failed') {
        failed.push({ file, message: result.message });
      }
    }

    if (failed.length > 0) {
      console.error(`\n❌ ${failed.length} 件のダウンロードに失敗しました:`);
      for (const { file, message } of failed) {
        console.error(`  - ${file}: ${message}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log('\n--- すべての動画処理が完了しました！ ---');

  } catch (error) {
    console.error('💥 ディレクトリの読み込み中にエラーが発生しました:', error.message);
    process.exitCode = 1;
  }
}

// スクリプトとして実行されたときだけ動かす（テストからの import では動かさない）
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
