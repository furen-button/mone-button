# CLAUDE.md

## プロジェクト概要
「もねボタン」は、にじさんじ所属の VTuber「梢桃音」のボイスをボタンクリックで再生できる Web アプリケーション。

## テクニカルスタック
- **フレームワーク**: Vite + React + TypeScript
- **動画再生**: HTML5 Video API
- **データ管理**: JSON API 層
- **ファイル管理**: local file system

## プロジェクト構造
```
mone-button/
├── public/              # 静的リソース
│   ├── i18n/            # ロケールファイル
│   ├── videos/          # 動画ファイル
│   └── data/            # JSON 加工データ
├── src/
│   ├── App.tsx         # 状態管理と画面全体の組み立て
│   ├── i18n.ts         # ロケール管理と翻訳ヘルパー
│   ├── voiceData.ts    # ボイスデータ型とデータ読み込み
│   ├── components/     # UI コンポーネント群
│   │   ├── CategoryToolbar.tsx
│   │   ├── InfoModal.tsx
│   │   ├── PlaybackControls.tsx
│   │   ├── SortToolbar.tsx
│   │   ├── VideoStage.tsx
│   │   ├── VoiceList.tsx
│   │   └── VolumeDock.tsx
│   └── App.css         # 画面全体のスタイル
├── docs/               # ドキュメント
└── raw/                # 元データ
```

## コーディングルール

### TypeScript
- strict モード
- interface VoiceData を明示定義

### React Hook
- useMemo でデータ計算
- useCallback でイベント
- UI は責務ごとにコンポーネントへ分割する
- データ定義と読み込みは `src/voiceData.ts` にまとめる

### i18n
- UI 文言は `src/i18n.ts` の `t()` 経由で参照する
- 文字列の正本は `public/i18n/ja.json` と `public/i18n/en.json` に置く
- ハードコードされた UI ラベル、見出し、空状態文言は直接書かず翻訳キーに置き換える
- `URL`、`console.log`、変数名、HTML 属性値、データ値は翻訳対象にしない
- 新しい文言を追加したら、`ja.json` と `en.json` のキー構造を揃える

### ファイル命名
- コンポーネント：PascalCase
- 関数：camelCase

## データ取り込み（youtube-clip-tool 連携）

クリップは隣接プロジェクト `youtube-clip-tool` で作成し、`npm run import` で取り込む。

```
npm run import   # sync → extract → download を一括実行
```

- `npm run sync` … `youtube-clip-tool/output/json` を再帰探索し、未取込の JSON を `raw/` へコピー（既存はスキップ）。同期元は環境変数 `CLIP_TOOL_OUTPUT` で上書き可。
- `npm run extract` … `raw/*.json` を整形し `public/data/<YYYY-MM-DD>-<videoId>-<start>-<end>.json` を生成。**既存ファイルはスキップ**（`public/data` で手入力した serif/ruby/categories を保護）。
- `npm run download` … `public/data/*.json` を元に yt-dlp で区間DL＋200p/crf28圧縮し `public/videos/*.mp4` を生成（既存mp4はスキップ。要 yt-dlp / ffmpeg-normalize）。

注意:
- serif / ruby / categories の入力は **youtube-clip-tool 側で行う**（取込後に上書きされない）。既存クリップの内容を直したい場合は `public/data` を直接編集するか、当該ファイルを削除して再取込する。
- データは build 時に glob 取込されるため、取り込み後の表示反映には `npm run dev` または `npm run build` が必要。

詳細は docs/tasks/06-19-clip-import.md を参照。

## クリップ結合（createVideo）

指定した videoId の全クリップを 1 本の動画に結合し、テロップ（タイトル / 日付 / セリフ / 元動画タイムスタンプ）を焼き込む。

```
npm run createVideo -- --videoId gr9WJDYS_u0
```

- 対象クリップは `public/data/` のファイル名に `-<videoId>-` を含む JSON を `trimming.startTime` 昇順で結合する。
- 出力は `output/<YYYY-MM-DD>-<videoId>-combined.mp4`（`--out` で上書き可）。`cache/` と `output/` は .gitignore 済み。
- 実装は `scripts/create-video.js`。テロップは全要素を 1 つの `.ass` 字幕にまとめ `subtitles=`(libass) で焼き込む。長文は表示幅で自動折り返しする。

### オプション

| オプション | 既定 | 説明 |
|---|---|---|
| `--videoId <id>` | （必須） | 対象 videoId |
| `--source <existing\|cache>` | `existing` | `existing`=既存 `public/videos/*.mp4`(200p)を再利用 / `cache`=高画質DLして `cache/createVideo/<videoId>/` に保存し再実行時は再利用 |
| `--title <text>` / `--no-title` | メタタイトル（絵文字除去） | タイトル文言 / 非表示 |
| `--date` / `--no-date` | 表示 | 日付の有無 |
| `--serif` / `--no-serif` | 表示 | セリフの有無 |
| `--time` / `--no-time` | 表示 | 時間（元動画タイムスタンプ）の有無 |
| `--title-pos` / `--date-pos` / `--serif-pos` / `--time-pos` | 上中央 / 右上 / 下中央 / 右下 | 9 分割位置 |
| `--out <path>` | `output/...` | 出力先 |
| `--resolution <WxH>` | `1280x720` | 出力解像度 |
| `--font <name>` | `Hiragino Sans` | テロップフォント（fontconfig 名） |

`<anchor>` は `top-left, top-center, top-right, middle-left, center, middle-right, bottom-left, bottom-center, bottom-right`。

注意:
- npm の仕様上、引数は `--` の後に渡す（`--videoId=...` 形式の `npm_config_*` フォールバックにも対応）。
- テロップ焼き込みには `subtitles`(libass) 対応の ffmpeg が必要。通常の Homebrew `ffmpeg` は非対応のため `brew install ffmpeg-full` を導入する（keg-only。既存 ffmpeg は壊さない）。スクリプトが `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` を自動検出し、`FFMPEG_BIN` 環境変数で上書きも可。
- 高画質DLには yt-dlp が必要。

## ドキュメント管理

- docs/draft.md - 仕様元
- docs/design-concept.md - デザイン
- docs/feature/* - 機能要件
- docs/tasks/* - 開発タスク
