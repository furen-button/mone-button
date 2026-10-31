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
- `download` は DL 直後に `ffprobe`（ffmpeg 同梱）で映像尺を検査する。無ければ警告して検査だけスキップする。

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
- `download` の区間 DL は yt-dlp が ffmpeg に googlevideo の URL を直接読ませる。素の ffmpeg は読み取りタイムアウトが無く、サーバが無応答だと永久に固まり、途中で切断されると映像だけ短いファイルを成功扱いで残す。そこで `--downloader-args ffmpeg_i:` で `-reconnect 1 -reconnect_streamed 1 -reconnect_on_network_error 1 -reconnect_delay_max 10 -rw_timeout 20000000` を渡し、20 秒無応答で切って Range で続きから再接続させる（5 秒だと遅いサーバの初回応答に間に合わず諦める）。
- DL 後に映像尺がトリム尺より 250ms 超短い（`assets.js` の `isDownloadTooShort` と同じ閾値）・ffprobe が読めない・yt-dlp が異常終了・15 分超（SIGINT で中断。yt-dlp は KeyboardInterrupt で ffmpeg に `q` を送って止めるので孤児にならない）のときは、`_temp.mp4` と `.part` などの途中ファイルを消して 1 回だけ再 DL する。2 回失敗したクリップはスキップし、末尾に失敗一覧を出して終了コード 1 で終わる。
- 2026-10-30 の実例: `2026-05-24-uP3di2wtQmw-006593-006623` は配信サーバ側が極端に遅く（2〜3KiB/s、別動画は同時刻に 288KiB/s）、素の設定では映像 18.9 秒 / 音声 30 秒の壊れたファイルになるか、ffmpeg が孤児として永久に残った。再接続 + 20 秒タイムアウトで正しい 30 秒のファイルが取れる（5 分かかる）。
  取込後の表示反映には `npm run dev` または `npm run build` が必要。
