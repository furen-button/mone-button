import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const parentDir = path.dirname(__dirname);

const inputDir = path.join(parentDir, 'public/data');
const outputDir = path.join(parentDir, 'public/videos');

/**
 * 1. JSONファイルを読み込んでオブジェクトを返す関数
 */
function readJson(filePath) {
  const rawData = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(rawData);
}

/**
 * 2. yt-dlp を実行して指定区間をダウンロードする関数
 */
function downloadVideo(videoUrl, startTime, endTime, outputPath) {
  // ダウンロード時点でもなるべく軽いものを狙う（200p以下）
  const command = `yt-dlp -f "bestvideo[height<=200][ext=mp4]+bestaudio[ext=m4a]/best[height<=200][ext=mp4]/best" --download-sections "*${startTime}-${endTime}" --force-keyframes-at-cuts -o "${outputPath}" "${videoUrl}"`;
  execSync(command, { stdio: 'inherit' });
}

/**
 * 3. ffmpeg-normalize を実行し、音量正規化と同時に動画を極限まで圧縮する関数
 */
function normalizeAudio(inputPath, outputPath) {
  // 音声: AAC形式 / 96kbps に削減
  const command = `ffmpeg-normalize "${inputPath}" -o "${outputPath}" -c:a aac -b:a 96k -c:v libx264 -e " -crf 28 "`;
  execSync(command, { stdio: 'inherit' });
}

/**
 * 4. 不要になった一時ファイルを安全に削除する関数
 */
function removeTempFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * 5. 1つのJSONファイルに対する一連の処理を行う関数
 */
function processSingleFile(file) {
  const inputFilePath = path.join(inputDir, file);
  const baseFileName = path.basename(file, '.json');
  const tempVideoPath = path.join(outputDir, `${baseFileName}_temp.mp4`);
  const finalVideoPath = path.join(outputDir, `${baseFileName}.mp4`);

  // 既にファイルが存在する場合はスキップ
  if (fs.existsSync(finalVideoPath)) {
    console.log(`⏭️ 既に存在するためスキップ: ${baseFileName}.mp4`);
    return;
  }

  try {
    const data = readJson(inputFilePath);
    const videoId = data.videoId;
    const startTime = data.trimming?.startTime;
    const endTime = data.trimming?.endTime;

    if (!videoId || startTime === undefined || endTime === undefined) {
      console.log(`⏭️ データ不足のためスキップ: ${file}`);
      return;
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // ダウンロード
    console.log(`\n⏳ [1/2] ダウンロード中... (${baseFileName})`);
    downloadVideo(videoUrl, startTime, endTime, tempVideoPath);

    // 音量正規化 ＆ 強力圧縮
    console.log(`\n⏳ [2/2] 音量正規化と動画圧縮中... (${baseFileName})`);
    normalizeAudio(tempVideoPath, finalVideoPath);

    // お掃除
    removeTempFile(tempVideoPath);
    console.log(`✅ 処理完了: ${finalVideoPath}`);

  } catch (err) {
    console.error(`❌ エラー (${file}):`, err.message);
    removeTempFile(tempVideoPath);
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

    console.log(`🚀 ${jsonFiles.length} 件の動画ダウンロードと処理を開始します...\n`);

    // 各ファイルに対して処理を実行
    jsonFiles.forEach(file => {
      processSingleFile(file);
    });

    console.log('\n--- すべての動画処理が完了しました！ ---');

  } catch (error) {
    console.error('💥 ディレクトリの読み込み中にエラーが発生しました:', error.message);
  }
}

// スクリプトの実行
main();
