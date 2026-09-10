import fs from 'fs';
import path from 'path';
import { formatTimestamp } from './ass.js';

// まとめ動画で使ったクリップの一覧を txt に書き出す。
// 形式（1クリップ = 2〜3行、クリップ間は空行区切り）:
//   [動画内での時間] [serif]
//   [元動画タイトル]            ← 直前と同じタイトルなら省略
//   [clipUrl]
export function writeSummary({ outPath, entries }) {
  const blocks = [];
  let prevTitle = null;
  for (const entry of entries) {
    const head = `${formatTimestamp(entry.atSec)} ${entry.serif}`.trimEnd();
    const lines = [head];
    if (entry.title && entry.title !== prevTitle) {
      lines.push(entry.title);
      prevTitle = entry.title;
    }
    if (entry.clipUrl) lines.push(entry.clipUrl);
    blocks.push(lines.join('\n'));
  }
  const text = blocks.join('\n\n') + '\n';
  fs.writeFileSync(outPath, text);
  return outPath;
}

// 出力動画のパスから概要 txt のパスを導く（拡張子だけ .txt に置換）。
export function summaryPathFor(videoOutPath) {
  const dir = path.dirname(videoOutPath);
  const base = path.basename(videoOutPath, path.extname(videoOutPath));
  return path.join(dir, `${base}.txt`);
}

// クリップと動画内の開始秒から 1 エントリ分の情報を作る。
export function buildSummaryEntry(clip, atSec) {
  const meta = clip.meta || {};
  const serif = String(clip.data?.serif || '').replace(/\s*\n\s*/g, ' ').trim();
  const startSec = Math.round(Number(clip.startTime) || 0);
  const clipUrl = clip.data?.clipUrl
    || (clip.videoId ? `https://youtube.com/watch?v=${clip.videoId}&t=${startSec}s` : '');
  return {
    atSec,
    serif,
    title: (meta.title || '').trim(),
    clipUrl,
  };
}
