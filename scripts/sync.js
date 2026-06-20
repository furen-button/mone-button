import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// extract.js と同じパス解決パターンを踏襲
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const parentDir = path.dirname(__dirname);

// 同期元: youtube-clip-tool の出力JSON。環境変数 CLIP_TOOL_OUTPUT で上書き可。
const sourceDir =
  process.env.CLIP_TOOL_OUTPUT ||
  path.resolve(parentDir, '../youtube-clip-tool/output/json');

// 同期先: 取込済み履歴として温存する raw フォルダ
const rawDir = path.join(parentDir, 'raw');

/**
 * ディレクトリ配下を再帰探索して .json のフルパス一覧を返す関数
 * (.DS_Store などは拡張子フィルタで除外される)
 */
function collectJsonFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsonFiles(fullPath));
    } else if (path.extname(entry.name).toLowerCase() === '.json') {
      results.push(fullPath);
    }
  }

  return results;
}

function main() {
  if (!fs.existsSync(sourceDir)) {
    console.log(`⚠️ 同期元が見つかりませんでした: ${sourceDir}`);
    console.log('   CLIP_TOOL_OUTPUT 環境変数で youtube-clip-tool の output/json を指定できます。');
    return;
  }

  if (!fs.existsSync(rawDir)) {
    fs.mkdirSync(rawDir, { recursive: true });
    console.log(`📁 同期先の '${rawDir}' フォルダを作成しました。`);
  }

  const jsonFiles = collectJsonFiles(sourceDir);

  if (jsonFiles.length === 0) {
    console.log(`⚠️ 同期元に JSON ファイルが見つかりませんでした: ${sourceDir}`);
    return;
  }

  console.log(`🚀 ${jsonFiles.length} 件の JSON を同期します...\n`);

  let copied = 0;
  let skipped = 0;

  jsonFiles.forEach((sourcePath) => {
    // basename そのままで raw/ 直下へコピー（サブフォルダ階層を潰す）
    // 注意: 別チャンネルで basename が衝突した場合は先勝ち（単独VTuber運用では実質発生しない）。
    const baseName = path.basename(sourcePath);
    const destPath = path.join(rawDir, baseName);

    if (fs.existsSync(destPath)) {
      console.log(`⏭️ 既存スキップ: ${baseName}`);
      skipped++;
      return;
    }

    try {
      fs.copyFileSync(sourcePath, destPath);
      console.log(`✅ コピー: ${baseName}`);
      copied++;
    } catch (err) {
      console.error(`❌ エラー (${baseName}):`, err.message);
    }
  });

  console.log(`\n--- 同期完了！ コピー ${copied} 件 / スキップ ${skipped} 件 ---`);
}

main();
