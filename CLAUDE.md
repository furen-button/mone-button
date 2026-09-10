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

## まとめ動画生成（createVideo）

`public/data/*.json` のクリップを選択し、YouTube まとめ動画形式（OP/ED、区切りカード、タイトルバー、セリフボックス、進行表示）で 1 本の mp4 にする。既定プリセットは `scripts/create-video/config.json`。

```
npm run createVideo -- --videoId gr9WJDYS_u0
```

- 実装は `scripts/create-video/`（index/config/select/ass/clip/card/ffmpeg/assets）。
- `--mode videoId` / `--mode category` / `--mode files` に対応。既定は `videoId`。
- 既定出力は `output/<YYYY-MM-DD>-<videoId>-combined.mp4`。`--out` または config の `output.name` で上書き可。
- 併せて同名の `output/<...>.txt` に使用クリップの一覧を書き出す（実装は `summary.js`）。1 クリップ = `[動画内での時間] [serif]` / `[元動画タイトル]` / `[clipUrl]` の 2〜3 行で、タイトルは直前と同じなら省略する。時刻は各クリップのブロック先頭（区切りカードがあればその開始）を実尺の積み上げから算出する。
- クリップ、カード、OP/ED はすべて h264/yuv420p/30fps + aac/44100/stereo に正規化してから concat する。署名が揃えば映像は `concat` デムクサで copy、音声は AAC プライミングの累積音ズレを避けるため各セグメントから直接 concat フィルタで再エンコードする（`concat-vcopy`）。署名不一致なら全再エンコードの concat filter に fallback。
- タイトル文言は `--title` > `telops.title.overrides[videoId]` > `telops.title.text` > `clip.data.title` > メタタイトル（絵文字除去）の順で解決する。手動改行は `telops.title.overrides` の文字列へ直接入れるか、CLI では `--title '上段\n下段'` のように 2 文字の `\n` で渡せる。
- セリフテロップは `public/data/*.json` の `serif` に生の改行を書ける。動画生成では手動改行を強制改行の起点として扱い、各セグメント内で自動折り返しと禁則処理を行う。Web サイト表示用の `serif` は `src/voiceData.ts` で改行を無かったものとして正規化する（元から空白で区切られていた箇所は空白を残し、語中で折っただけの箇所は詰める）ため、JSON 側の改行は保持される。
- `wrapText` は行頭禁則（句読点、終わり括弧、小書き仮名など）と行末禁則（始め括弧）を分割位置の後退で避ける。ぶら下げは使わない。`maxUnits < 4` では禁則と泣き別れ回避を無効化し、行数が増える場合も禁則より行数維持を優先する。折り返し後は各行の行頭・行末の空白を落とす（`\an5` の中央寄せでは行端の空白がその行だけ中心をずらすため）。
- `autoShrink` は実際に折り返した行数から `boxHeightFor(lines, fs, pad, border)` を測り、二分探索で高さ上限に収まる最大の整数フォントサイズを選ぶ。`minSize` が `size` より大きい場合でも拡大しない。

注意:
- 2 行タイトルは横幅も約 1711px（1080p）まで伸びるため、`telops.date`（top-right）と `telops.progress`（top-left）に重なることがある。公開用プリセットでは `telops.title.marginH: 0.16` 程度へ広げて回避する。

### オプション

| オプション | 既定 | 説明 |
|---|---|---|
| `--config <path>` | `scripts/create-video/config.json` | 設定 JSON |
| `--mode <videoId\|category\|files>` | `videoId` | クリップ選択モード |
| `--videoId <id>` | なし | 対象 videoId |
| `--category <name>` | なし | カテゴリー横断選択。カンマ区切り/複数指定可 |
| `--exclude <name>` | なし | 選択後に除外するクリップ。ファイル名（base）または videoId をカンマ区切りで指定し、videoId ならその配信の全クリップを落とす。全モードに適用 |
| `--order <date\|date-desc\|stream\|shuffle\|as-listed>` | `date` | 並び順 |
| `--limit <n>` | なし | クリップ上限 |
| `--source <existing\|cache>` | `existing` | `existing`=既存 `public/videos/*.mp4` / `cache`=高画質DL＋音量正規化して `cache/createVideo/<videoId>/` に保存 |
| `--normalize` / `--no-normalize` | 正規化する | `--source cache` の DL 時に `ffmpeg-normalize`（EBU R128 / -23 LUFS）で各クリップの音量を揃える |
| `--no-cards` | cards有効 | 区切りカードと OP/ED を無効化 |
| `--bgm` / `--no-bgm` | 無効 | BGM ミックスの有無 |
| `--zoom` / `--no-zoom` | 無効 | 音声ピークに合わせたパンチイン・ズームの有無 |
| `--title <text>` / `--no-title` | メタタイトル（絵文字除去） | タイトル文言 / 非表示。2 文字の `\n` は手動改行として扱う |
| `--date` / `--no-date` | 表示 | 日付の有無 |
| `--serif` / `--no-serif` | 表示 | セリフの有無 |
| `--time` / `--no-time` | 表示 | 時間（元動画タイムスタンプ）の有無 |
| `--progress` / `--no-progress` | 表示 | 進行表示の有無 |
| `--out <path>` | `output/...` | 出力先 |
| `--resolution <WxH>` | `1280x720` | 出力解像度 |
| `--font <name>` | `Hiragino Sans` | テロップフォント（fontconfig 名） |

設定ファイルでは `telops.*.align` に `top-left, top-center, top-right, middle-left, center, middle-right, bottom-left, bottom-center, bottom-right` を指定できる。色は RGB hex で書き、ASS の BGR 色へ変換する。

`--zoom` または `effects.zoom.enabled: true` で、ffmpeg astats の RMS ピーク直前から静的 crop+scale のパンチインを入れる。`effects.zoom.mode` は `punch`（既定。ピーク直前でカット）と `full`（最初から最後まで全編アップ）を指定できる。テロップは crop 後に焼くため画面上の位置は固定され、出力時間・fps・音声パスは変えないので `concat -c copy` を維持できる。焦点は `scripts/create-video/detect_anime_face.py` が scale+pad 済みフレームからアニメ顔を検出し、失敗時は `effects.zoom.focus.x/y`、さらに中央へフォールバックする。顔検出には `pip install "opencv-python-headless<5"` と `cache/createVideo/models/lbpcascade_animeface.xml`（無ければ自動取得）が必要。

クリップ JSON では `effects.zoom` で個別上書きできる。`false` は抑止、`true` は短尺/平坦スキップを無視して自動検出、`{"at": 2.5, "scale": 1.4, "x": 0.8, "y": 0.75}` は開始秒・倍率・焦点を手動指定、`{"mode": "full"}` はそのクリップだけ全編アップにする（`mode` はグローバル設定より優先。`at` 指定時は punch 扱い）。`--no-zoom` はグローバル kill switch として個別指定より優先する。

注意:
- npm の仕様上、引数は `--` の後に渡す（`--videoId=...` 形式の `npm_config_*` フォールバックにも対応）。
- テロップ焼き込みには `subtitles`(libass) 対応の ffmpeg が必要。通常の Homebrew `ffmpeg` は非対応のため `brew install ffmpeg-full` を導入する（keg-only。既存 ffmpeg は壊さない）。スクリプトが `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` を自動検出し、`FFMPEG_BIN` 環境変数で上書きも可。
- 区切りカードの背景/SE/BGM は `assets/create-video/` の素材を参照する。欠落時は該当機能をスキップして続行する。
- 高画質DLには yt-dlp が必要。`--source cache` の音量正規化には `ffmpeg-normalize` が必要（不在時は警告して生DLを使用）。映像は copy で高画質のまま、音声のみ正規化する。サムネイルは `cache/createVideo/thumbnails/` にキャッシュする。

## ドキュメント管理

- docs/draft.md - 仕様元
- docs/design-concept.md - デザイン
- docs/feature/* - 機能要件
- docs/tasks/* - 開発タスク
