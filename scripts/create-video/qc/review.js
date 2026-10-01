import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

// コンタクトシートを claude CLI に読ませて、可読性や配置の指摘をもらう。
// 出力は非決定的なので **ゲートにはしない**（結果は常に info 扱い）。
export function runVisualReview({ sheetPath, cells, outPath, config }) {
  const options = config.qc?.review || {};
  const bin = String(options.claudeBin || 'claude');
  if (!hasBin(bin)) {
    return { skipped: `${bin} が見つからないため LLM 目視レビューをスキップします。` };
  }
  if (!fs.existsSync(sheetPath)) {
    return { skipped: 'コンタクトシートが無いため LLM 目視レビューをスキップします。' };
  }

  const prompt = buildPrompt({ sheetPath, cells });
  let out;
  try {
    out = execFileSync(bin, [
      '-p', prompt,
      '--allowed-tools', 'Read',
    ], {
      encoding: 'utf8',
      timeout: Number(options.timeoutMs ?? 300000),
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (err) {
    return { skipped: `LLM 目視レビューに失敗しました: ${firstLine(err.stderr || err.message)}` };
  }

  const body = stripAgentFooter(String(out || ''));
  if (!body) {
    return { skipped: 'LLM 目視レビューの出力が空でした。' };
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${renderHeader(sheetPath, cells)}\n${body}\n`);
  return { outPath };
}

export function reviewPathFor(videoPath) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  return path.join(dir, `${base}.review.md`);
}

function buildPrompt({ sheetPath, cells }) {
  const list = cells.map((cell) => `#${cell.index} ${cell.base}（動画内 ${cell.atSec.toFixed(1)}s）`).join('\n');
  return [
    `次の画像を読んでください: ${sheetPath}`,
    '',
    'これは YouTube まとめ動画の各クリップから 1 フレームずつ抜き出して並べたコンタクトシートです。',
    '左上のラベルはマス番号と動画内の時刻です。マスの対応は以下です。',
    '',
    list,
    '',
    '視聴者の目で見て、直すべき点だけを日本語で箇条書きにしてください。観点は次の 4 つです。',
    '1. 可読性: セリフの文字サイズ、背景とのコントラスト、1 画面の文字数',
    '2. 配置: テロップどうしの被り、画面端の余白、被写体（演者の顔）が隠れていないか',
    '3. 情報量: 同時に出ている要素が多すぎないか',
    '4. 絵の選び方: そのクリップの representative frame として妥当か（暗転・ぶれ・無関係な画面でないか）',
    '',
    '出力形式の指定:',
    '- 指摘は `- #マス番号: 内容` の形で書く。全体に対する指摘は `- 全体: 内容`',
    '- 問題がなければ「指摘なし」だけを返す',
    '- 推測で断定しない。判断できない場合はそう書く',
    '- ファイルの編集や他のコマンド実行はしない。読んで答えるだけ',
  ].join('\n');
}

function renderHeader(sheetPath, cells) {
  return [
    '# LLM 目視レビュー',
    '',
    `- コンタクトシート: ${sheetPath}`,
    `- マス数: ${cells.length}`,
    '- この結果は非決定的なので QC の合否には反映しません（info 扱い）。',
    '',
    '## 指摘',
    '',
  ].join('\n');
}

// 呼び出した claude は利用者の運用ルール（CLAUDE.md）も読むため、
// レビュー本文とは関係のない定型の報告行が末尾に付くことがある。レポートには残さない。
export function stripAgentFooter(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => !/^\s*BM\s*:/u.test(line))
    .join('\n')
    .trim();
}

function hasBin(bin) {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function firstLine(text) {
  return String(text || '').split(/\r?\n/).find(Boolean) || '詳細なし';
}
