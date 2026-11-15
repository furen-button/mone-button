import fs from 'node:fs';
import path from 'node:path';
import { timelineStart, barTime } from './project.js';

/**
 * README（Premiere Pro で作業する人向けの使い方）を組み立てる。
 * 読む順番: まず見るもの → Premiere で開く → 声を差し替える → 境界を直す → 注意 → 生成情報。
 */
export function readmeText(p, out, score, index, gains, options, command) {
  const {width, height, fps, sampleRate} = p.output;
  const trackDb = (20 * Math.log10(p.output.trackGain)).toFixed(1);
  const low = index.filter((s) => s.lowQuality);
  const lowUsed = low.filter((s) => score.some((e) => e.base === s.base));
  const categories = [...new Set(index.map((s) => s.category))];
  const lines = [
    `# ${p.title}：Premiere Pro 用の素材一式`,
    '',
    `音MAD を Premiere Pro で仕上げるための素材です。このフォルダだけで編集できます` +
      `（${width}×${height}・${fps}fps・${sampleRate}Hz）。`,
    '',
    '## まず見るもの',
    '',
    '- `video/preview.mp4` … AI 案の通し（映像効果と声・曲のミックス入り）',
    '- `編集方針.md` … AI の編集方針、区間ごとの声と演出案、使った素材',
    '- `audio/mix.wav` … 試聴用のミックス（音だけ）',
    '',
    '## Premiere Pro で開く',
    '',
    `1. 「ファイル → 読み込み」で \`premiere/${p.name}.xml\` を選ぶ。シーケンスが 1 本できる。`,
    '2. トラックは次のとおり。',
    '',
    '| トラック | 中身 |',
    '|---|---|',
    '| V1 | 拍に合わせて切った映像。`samples/` の元動画を in/out 付きで参照しているので、前後を伸ばせる |',
    `| A1 | 曲（\`audio/backing.wav\`）。音量 ${trackDb} dB を設定済み |`,
    `| A2 | 旋律の声（\`audio/events/\` の ${score.filter((e) => e.kind === 'melody').length} 本） |`,
    `| A3 | 句末の「へんたい」（${score.filter((e) => e.kind === 'accent').length} 本） |`,
    '| A4 | 声の完成ミックス（`audio/voice-mix.wav`）。既定は無効。A2・A3 を触らずに通しで聞くとき用 |',
    '',
    '3. マーカーは小節ごと・句の頭・演出の提案（反転・ズーム）に付いている。反転・ズームは preview にだけ焼いて' +
      'あり、XML には入れていないので、マーカーを見て Premiere で付ける。',
    '4. A2・A3 の各 WAV は、先頭に「直前のフレーム境界から声の頭までの無音」を足してある。クリップの頭を' +
      'フレームに置いたままなら、声の頭がサンプル単位で拍に合う（頭を切り詰めるとずれる）。',
    '5. フォルダを移動したら、Premiere の「メディアをリンク」でこのフォルダを指定する（XML は絶対パス）。',
    '',
    '## 声を差し替える',
    '',
    `- \`samples/<カテゴリ>/<順位>_<クリップ名>/\` にカテゴリ（${categories.join('・')}）ごとの候補がある。` +
      '`samples/index.csv` に点数の内訳と、各カテゴリ上位 3 件の「推奨」印がある。',
    '- `pitch/<音節>/<音名>.wav` … その音節を各音名（ト長調、素材の声の高さ ±7 半音）へずらしたもの。' +
      '譜面（`score/score.csv`）の `pitch` と同じ音名のファイルを置けばよい。ファイル名の `s` は `#`（`Fs4` = F#4）。',
    '- `units-clean/` … 前後の無音を詰めて音量を揃えた音節。`units/` は切っただけの音節。',
    '- `clip.mp4` … 元動画（高画質を 1920×1080・60fps に揃えたもの）。`clip-hold.mp4` は最後のフレームを止めたもの。',
    '- 拍の位置は `beats/beats.csv`（タイムライン上の秒・フレーム）、旋律は `melody/`（MIDI もある）、' +
      'クリックは `beats/click.wav`、旋律の確認用の正弦波は `melody/guide.wav`。',
    '',
    '## 音節の境界を直す',
    '',
    '`units.json` の `units` は `[かな, 開始秒, 母音の始まり秒, 終了秒]`。時刻は `clip.wav`（public/videos 版）の' +
      '先頭からの秒。`spectrogram.png` の白線が開始、緑線が母音の始まり、上の文字が音節、下の数字が秒。',
    '',
    '1. `units` を直し、`source` を `"manual"` にする。',
    '2. リポジトリで次を実行する（差分を表示してプロジェクトの boundaries.json に取り込み、新しい assets-NN を作る）。',
    '',
    '```sh',
    `npm run otomad -- --project ${p.name} --import-boundaries ${JSON.stringify(out)}`,
    command,
    '```',
    '',
    '## 注意',
    '',
    '- `source: "auto"` の境界は自動で切った候補で、精度は低い（音節数が読みと合わないと `#1` などの番号になる）。',
    '- 声の音源は、高画質があればその音声（低画質版との時間差を補正）、無ければ public/videos の音声。',
    '  候補の高画質で時間差が取れないときは、その候補だけ低画質に切り替える（使う素材なら生成を止める）。',
    lowUsed.length
      ? `- ⚠️ 低画質のまま使っている素材: ${lowUsed.map((s) => s.base).join('、')}`
      : '- 譜面で使う素材はすべて高画質。',
    low.length
      ? `- 低画質の候補 ${low.length} 件（\`samples/index.csv\` の quality 列）。高画質は上位の候補と使う素材だけ取得する。`
      : '- 候補はすべて高画質。',
    options.noPitchPack ? '- 音階素材（pitch/）は `--no-pitch-pack` で省略した。' : '',
    '',
    '## 生成情報',
    '',
    `- タイムラインの 0 = 小節 ${p.range.fromBar - 1} の頭（原曲 ${timelineStart(p).toFixed(3)} 秒）。` +
      `曲は小節 ${p.range.toBar + 2} の頭まで。小節・拍の番号は 0 始まり。`,
    `- 声のピーク調整ゲイン ${gains.voiceGain.toFixed(3)}（A2・A3 と A4 で同じ）、試聴ミックスのゲイン ${gains.mixGain.toFixed(3)}。`,
    `- 再生成: \`${command}\``,
    '',
  ];
  return lines.filter((line, i) => line !== '' || lines[i - 1] !== '').join('\n');
}

/** 素材の使い方と原曲秒基準の編集方針を保存する。 */
export function writeReports(p, dir, out, score, index, gains, options) {
  const command =
    `npm run otomad -- --project ${p.name}${options.noDownload ? ' --no-download' : ''}` +
    `${options.noPitchPack ? ' --no-pitch-pack' : ''}` +
    `${options.candidates !== undefined ? ' --candidates ' + options.candidates : ''}`;
  fs.writeFileSync(path.join(out, 'README.md'), readmeText(p, out, score, index, gains, options, command));
  const rows = p.sections
    .map(
      (s) =>
        `| ${s.fromBar}〜${s.toBar} 未満 | ${barTime(p, s.fromBar).toFixed(3)}〜` +
        `${barTime(p, s.toBar).toFixed(3)} | ${p.voices[s.voice].label} ` +
        `| ` +
        `${
          score.filter((e) => e.kind === 'melody' && e.bar >= s.fromBar && e.bar < s.toBar).length
        } ` +
        `|`,
    )
    .join('\n');
  const used = [...new Set(score.map((e) => e.base))]
    .map((base) => {
      const s = index.find((s) => s.base === base);
      return `- ${base}: ${s.serif}（${s.quality}、${s.source}、映像時間差 ${s.hqOffsetSec.toFixed(6)} 秒）`;
    })
    .join('\n');
  fs.writeFileSync(
    path.join(out, '編集方針.md'),
    fs.readFileSync(path.join(dir, 'plan.md'), 'utf8') +
      (`\n` +
        `\n` +
        `## 生成した区間表\n` +
        `\n` +
        `時刻は原曲基準。\n` +
        `\n` +
        `| 小節 | 時刻（秒） | 声（笑い声挿入前） | 旋律音数 |\n` +
        `|---|---|---|---|\n` +
        `${rows}\n` +
        `\n` +
        `## 使用素材\n` +
        `\n` +
        `${used}\n` +
        `\n` +
        `生成した映像効果は中心ズームと左右反転です。分割画面、揺れ、テロップは Premiere で加える編集案です。` +
        `\n`),
  );
}
