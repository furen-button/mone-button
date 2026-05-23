import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 階層の設定を親ディレクトリ(parentDir)ベースに変更
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const parentDir = path.dirname(__dirname);

// スクリプトの親ディレクトリにある 'raw' と 'data' を指定
const inputDir = path.join(parentDir, 'raw');
const outputDir = path.join(parentDir, 'data');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`📁 出力先の '${outputDir}' フォルダを作成しました。`);
}

/**
 * YYYYMMDD を YYYY-MM-DD 形式にフォーマットする関数
 */
function formatDate(dateStr) {
  if (!dateStr || dateStr.length !== 8) return dateStr;
  return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

try {
  const files = fs.readdirSync(inputDir);
  const jsonFiles = files.filter(file => path.extname(file).toLowerCase() === '.json');

  if (jsonFiles.length === 0) {
    console.log('⚠️ raw フォルダに JSON ファイルが見つかりませんでした。');
  } else {
    console.log(`🚀 ${jsonFiles.length} 件のファイルを処理します...\n`);

    jsonFiles.forEach(file => {
      const inputFilePath = path.join(inputDir, file);

      try {
        const rawData = fs.readFileSync(inputFilePath, 'utf8');
        const data = JSON.parse(rawData);

        // --- 1. ファイル名用のパーツを生成 ---
        const uploadDateRaw = data.videoFile?.metadata?.uploadDate || '';
        const videoId = data.videoId || 'unknown-id';
        const startTimeRaw = data.trimming?.startTime;
        const endTimeRaw = data.trimming?.endTime;

        const formattedDate = formatDate(uploadDateRaw);

        // 小数点切り捨ての上、6桁のゼロ埋めでフォーマット
        const startFormat = startTimeRaw !== undefined 
          ? String(Math.floor(startTimeRaw)).padStart(6, '0') 
          : '000000';
        const endFormat = endTimeRaw !== undefined 
          ? String(Math.floor(endTimeRaw)).padStart(6, '0') 
          : '000000';

        // 新しいファイル名を組み立て (YYYY-MM-DD-<videoId>-<startTime>-<endTime>.json)
        const newFileName = `${formattedDate}-${videoId}-${startFormat}-${endFormat}.json`;
        const outputFilePath = path.join(outputDir, newFileName);

        // --- 2. 要素の抽出 ---
        const extractedData = {
          videoId: data.videoId,
          serif: data.serif,
          ruby: data.ruby,
          categories: data.categories,
          clipUrl: data.clipUrl,
          memo: data.memo,
          trimming: {
            startTime: data.trimming?.startTime,
            endTime: data.trimming?.endTime,
            duration: data.trimming?.duration
          },
          videoFile: {
            metadata: {
              videoId: data.videoFile?.metadata?.videoId,
              title: data.videoFile?.metadata?.title,
              duration: data.videoFile?.metadata?.duration,
              thumbnail: data.videoFile?.metadata?.thumbnail,
              uploader: data.videoFile?.metadata?.uploader,
              uploadDate: data.videoFile?.metadata?.uploadDate,
              viewCount: data.videoFile?.metadata?.viewCount,
              url: data.videoFile?.metadata?.url
            }
          }
        };

        // --- 3. 新しいファイル名で出力 ---
        fs.writeFileSync(outputFilePath, JSON.stringify(extractedData, null, 2));
        console.log(`✅ ${file} -> ${newFileName}`);

      } catch (err) {
        console.error(`❌ エラー (${file}):`, err.message);
      }
    });

    console.log('\n--- すべての処理が完了しました！ ---');
  }

} catch (error) {
  console.error('💥 ディレクトリの読み込み中にエラーが発生しました:', error.message);
}
