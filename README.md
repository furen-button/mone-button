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

## クリップ結合（createVideo）

指定した videoId の全クリップを 1 本の動画に結合し、テロップ（タイトル / 日付 / セリフ / 元動画タイムスタンプ）を焼き込みます。

```bash
npm run createVideo -- --videoId gr9WJDYS_u0
```

- 対象は `public/data/` のファイル名に `-<videoId>-` を含むクリップを開始時刻順に結合します。
- 出力は `output/<YYYY-MM-DD>-<videoId>-combined.mp4`（`--out` で変更可）。`cache/` と `output/` は Git 管理外です。
- npm の仕様上、オプションは `--` の後に渡してください（`--videoId=...` 形式の `npm_config_*` フォールバックにも対応）。

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

位置（anchor）は `top-left, top-center, top-right, middle-left, center, middle-right, bottom-left, bottom-center, bottom-right` から指定します。

```bash
# 例: 日付を消し、タイトルを上書き、セリフを上中央・時間を左上に配置
npm run createVideo -- --videoId gr9WJDYS_u0 --no-date --title "マリオ耐久まとめ" --serif-pos top-center --time-pos top-left

# 例: 高画質ソースで結合（初回はDL、2回目以降はキャッシュ再利用）
npm run createVideo -- --videoId gr9WJDYS_u0 --source cache --resolution 1920x1080
```

### 必要なツール

- **ffmpeg（libass 対応）**: テロップ焼き込みに `subtitles`(libass) フィルタが必要です。通常の Homebrew `ffmpeg` は非対応のため、次で導入してください。
  ```bash
  brew install ffmpeg-full
  ```
  `ffmpeg-full` は keg-only（既存 ffmpeg を壊しません）。スクリプトが `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` を自動検出します。別パスを使う場合は環境変数 `FFMPEG_BIN` で指定できます。
- **yt-dlp**: `--source cache` の高画質ダウンロードに必要です。
