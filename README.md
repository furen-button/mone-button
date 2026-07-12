# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Google Analytics (GA4)

### 設定

1. `.env.local` を作成し、測定IDを設定します。

```bash
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

2. 本番ビルドで配信してください（開発環境では送信しません）。

### 実装仕様

- 初回アクセス時に同意バナーを表示します。
- 同意前は GA の初期化・イベント送信を行いません。
- 同意後のみ `page_view` と各種イベントを送信します。

### 送信イベント

- `playback_start`
- `sequential_toggle`
- `sequential_advance`
- `youtube_link_click`
- `category_toggle`
- `sort_change`

## まとめ動画生成（createVideo）

クリップを 1 本の「まとめ動画」に結合します。各クリップにテロップ（タイトルバー / 日付 / セリフボックス / 元動画タイムスタンプ / 進行表示）を焼き込み、クリップ間には次クリップの予告カード（背景動画＋サムネイル＋番号＋次のセリフ＋動画情報＋SE）を挿入。冒頭に OP、末尾に ED カードを付け、任意で BGM をミックスします。

```bash
# 既定（まとめプリセット）: 1 配信のクリップを結合
npm run createVideo -- --videoId gr9WJDYS_u0
```

- 実装は `scripts/create-video/`（機能別モジュール）。設定は `scripts/create-video/config.json` を既定で読み込みます。
- 出力は `output/` 配下（`--out` で変更可）。`cache/` と `output/` は Git 管理外です。
- **設定の優先順位**は `組込みDEFAULTS < config.json < CLI フラグ（--flag）`。CLI が常に最優先です。
- npm の仕様上、オプションは `--` の後に渡してください（`--videoId=...` 形式の `npm_config_*` フォールバックにも対応）。

### オプション（CLI）

主要な指定は CLI フラグで上書きでき、細かな見た目は設定ファイルで調整します。

**クリップ選択**

| オプション | 既定 | 説明 |
|---|---|---|
| `--mode <videoId\|category\|files>` | `videoId` | クリップ選択モード（`--videoId`/`--category`/`--files` 指定時は自動でそのモードに） |
| `--videoId <id>` | なし | ファイル名に `-<id>-` を含むクリップを対象にする |
| `--category <name>` | なし | `categories[]` が一致するクリップを**複数配信横断**で収集。カンマ区切り / 複数指定可 |
| `--files <base,base>` | なし | クリップの basename を明示列挙（順序も指定どおり） |
| `--order <date\|date-desc\|stream\|shuffle\|as-listed>` | `date` | 並び順。`date`=投稿日→開始時刻の昇順（古→新） |
| `--limit <n>` | なし | 先頭 n 件に制限 |

**出力・ソース**

| オプション | 既定 | 説明 |
|---|---|---|
| `--source <existing\|cache>` | `existing` | `existing`=既存 `public/videos/*.mp4`(200p) を再利用 / `cache`=高画質DL＋音量正規化して `cache/createVideo/<videoId>/` に保存 |
| `--normalize` / `--no-normalize` | 正規化する | `--source cache` のDL時に `ffmpeg-normalize`（EBU R128 / -23 LUFS）で各クリップの音量を揃える |
| `--resolution <WxH>` | `1280x720` | 出力解像度 |
| `--out <path>` | `output/...` | 出力先 |
| `--font <name>` | `Hiragino Sans` | テロップフォント（fontconfig 名） |
| `--config <path>` | `scripts/create-video/config.json` | 設定ファイルのパス |

**テロップ表示（要素の有無）**

| オプション | 既定 | 説明 |
|---|---|---|
| `--title <text>` / `--no-title` | メタタイトル（絵文字除去） | タイトル文言の上書き / 非表示 |
| `--date` / `--no-date` | 表示 | 日付 |
| `--serif` / `--no-serif` | 表示 | セリフ |
| `--time` / `--no-time` | 表示 | 元動画タイムスタンプ |
| `--progress` / `--no-progress` | 表示 | 進行表示（`n / 全体`＋バー） |

**カード・音声**

| オプション | 既定 | 説明 |
|---|---|---|
| `--cards` / `--no-cards` | 有効 | クリップ間の区切りカード＋OP/ED をまとめて有効/無効 |
| `--opening` / `--no-opening` | 有効 | OP カード |
| `--ending` / `--no-ending` | 有効 | ED カード |
| `--bgm` / `--no-bgm` | 無効 | 全編に BGM を薄くミックス（設定の `bgm.file` を使用） |

### 設定ファイル（config.json）

CLI で扱わない詳細（色・ボックス・フェード・カード背景/サムネ/SE・BGM 音量・OP/ED 文言など）は `scripts/create-video/config.json` で調整します。主なセクション:

- `telops.{title,date,time,serif,progress}` … 各テロップの `enabled` / `align`（9分割位置）/ `size`（高さ比）/ `color`（RGB hex）/ `box`（背景ボックス・枠色）/ `fade` / `karaoke`(serif)。
- `cards` … `duration`、`background`（`type: video|image|solid|gradient` と素材パス）、`thumbnail`、`show`（番号・次セリフ・タイトル・日付・投稿者の表示可否）、`se`。
- `bgm` … `enabled` / `file` / `volume` / `fade`。
- `endcaps.{opening,ending}` … OP/ED の `duration` / 文言。

位置（align）は `top-left, top-center, top-right, middle-left, center, middle-right, bottom-left, bottom-center, bottom-right`。色は RGB hex で書き、内部で ASS の BGR 色へ変換します。

### 使用例

```bash
# 既定のまとめ動画（OP/カード/テロップ/ED すべて有効）
npm run createVideo -- --videoId gr9WJDYS_u0

# カテゴリー「やられ」を複数配信横断で日付順に、先頭10件で結合
npm run createVideo -- --category やられ --limit 10

# カード無しでクリップだけ素早く結合（確認用）
npm run createVideo -- --videoId gr9WJDYS_u0 --no-cards

# 高画質ソース（DL＋音量正規化）＋BGM＋1080p 出力
npm run createVideo -- --videoId gr9WJDYS_u0 --source cache --bgm --resolution 1920x1080

# 別の設定ファイルを使う
npm run createVideo -- --videoId gr9WJDYS_u0 --config scripts/create-video/config.json
```

### 素材

区切りカードの背景動画・SE・BGM は `assets/create-video/` の素材を参照します（設定でパス指定）。素材が欠落・無効でも処理は止めず、該当機能をスキップして続行します。サムネイルは YouTube から取得し `cache/createVideo/thumbnails/<videoId>.jpg` にキャッシュします（`maxresdefault` 失敗時は `hqdefault` へフォールバック）。

### 必要なツール

- **ffmpeg（libass 対応）**: テロップ焼き込みに `subtitles`(libass) フィルタが必要です。通常の Homebrew `ffmpeg` は非対応のため、次で導入してください。
  ```bash
  brew install ffmpeg-full
  ```
  `ffmpeg-full` は keg-only（既存 ffmpeg を壊しません）。スクリプトが `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` を自動検出します。別パスを使う場合は環境変数 `FFMPEG_BIN` で指定できます。
- **yt-dlp**: `--source cache` の高画質ダウンロードに必要です。
- **ffmpeg-normalize**: `--source cache` の音量正規化に必要です（不在時は警告して生ダウンロードを使用）。`pip install ffmpeg-normalize` で導入できます。
