# クリップ取り込みパイプライン（youtube-clip-tool 連携）

## 目的
`youtube-clip-tool` で作成したボイスクリップを、`npm run import` 一発で
mone-button の `public/data` / `public/videos` に取り込めるようにする。
従来は手作業だった「output/json → raw/ コピー」を `scripts/sync.js` で自動化した。

## フロー
```
youtube-clip-tool/output/json/<チャンネル名>/<冗長名>.json   ← クリップ作成（serif/ruby/categories もここで入力）
        │  npm run sync     … 再帰探索して未取込JSONを raw/ へコピー（既存スキップ）
        ▼
mone-button/raw/*.json
        │  npm run extract  … 整形・リネーム（既存スキップ）
        ▼
mone-button/public/data/<YYYY-MM-DD>-<videoId>-<start6>-<end6>.json
        │  npm run download … yt-dlp区間DL＋200p/crf28圧縮（既存mp4スキップ）
        ▼
mone-button/public/videos/*.mp4
```

`npm run import` は上記 sync → extract → download を順に実行する。

## スクリプト
| コマンド | スクリプト | 役割 |
|---|---|---|
| `npm run sync` | scripts/sync.js | output/json を再帰探索し未取込JSONを raw/ へコピー |
| `npm run extract` | scripts/extract.js | raw/ を整形し public/data へ（既存スキップ） |
| `npm run download` | scripts/download.js | public/data から動画を生成し public/videos へ |
| `npm run import` | — | 上記3つを一括実行 |

## 前提・依存
- 同期元のデフォルト: `../youtube-clip-tool/output/json`。別の場所なら環境変数で指定:
  ```
  CLIP_TOOL_OUTPUT=/path/to/output/json npm run sync
  ```
- `download` には `yt-dlp` と `ffmpeg-normalize` のインストールが必要。

## 重要な仕様（既存スキップ）
- extract / download は **既に存在する出力を上書きしない**。
- serif / ruby / categories は `public/data` に手入力されている既存分があるため、
  上書きすると消える。これを防ぐため extract は既存 public/data をスキップする。
- 今後の編集は **youtube-clip-tool 側で入力** する（取込時に保持される）。
  既存クリップの内容を直す場合は `public/data` を直接編集するか、
  該当ファイルを削除してから再取込する。

## 注意点
- `raw/` は取込済み履歴として温存される（sync は既存をスキップ）。
- 別チャンネルで basename が衝突した場合、sync は先勝ち（単独VTuber運用では実質発生しない）。
- データは Vite の `import.meta.glob`（eager）で **build 時** に取り込まれる。
  取込後の表示反映には `npm run dev` または `npm run build` が必要。
