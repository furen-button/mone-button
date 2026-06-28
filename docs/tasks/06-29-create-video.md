# クリップ結合・テロップ焼き込み（createVideo）

## 目的
指定した `videoId` の全クリップを 1 本の動画に結合し、テロップ（タイトル / 日付 / セリフ / 元動画タイムスタンプ）を焼き込む `npm run createVideo` を追加する。
従来は個別クリップ（[クリップ取り込みパイプライン](06-19-clip-import.md)）までで、同一配信のクリップをまとめて 1 本にする手段が無かった。

```
npm run createVideo -- --videoId gr9WJDYS_u0
```

## 要件決定のやり取り
抽象的な要望（「videoId 指定で一括DL→結合、テロップは有無・位置を引数制御」）に対し、実装前に 4 点を確認して仕様を確定した。

| 論点 | 選択肢 | 決定 |
|---|---|---|
| 文字描画の方法 | ffmpeg を入れ直す / Node Canvas で描画 | **ffmpeg を入れ直す**（後述の発見により libass 対応が必須） |
| 「時間表示」の意味 | 経過タイマー / 元動画のタイムスタンプ / クリップ番号 | **元動画のタイムスタンプ**（例 `1:32:22`。クリップ毎の固定値） |
| 表示位置の指定方法 | 9 分割で個別 / 上下のみ | **9 分割で個別指定**（要素ごとにアンカー指定、引数で上書き可） |
| 結合元の動画 | 既存mp4再利用 / 常に再DL | **両対応**（`--source existing`＝既存再利用 / `cache`＝高画質DL＋キャッシュ再利用） |

## 技術的な発見と判断
- **発見**: ローカルの Homebrew `ffmpeg`(8.x) は libfreetype/libass 無効ビルドで、`drawtext`/`subtitles` フィルタが Unknown filter になりテロップを焼き込めなかった。Homebrew は `ffmpeg`（通常）と `ffmpeg-full`（追加ライブラリ入り）に分かれている。
- **判断**: `brew install ffmpeg-full`（keg-only。libass/freetype/fontconfig/harfbuzz 入り）を導入。keg-only なので既存 `ffmpeg` / `ffmpeg-normalize` を壊さない。スクリプトは `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` を優先解決し、`subtitles` フィルタの有無で自動判定（`FFMPEG_BIN` で上書き可）。
- **フォント**: fontconfig 経由で `Hiragino Sans`（ヒラギノ角ゴシック）が解決（`fc-match :lang=ja` で確認）。既定フォントに採用。
- **折り返し**: libass は日本語を自動折り返ししないため、表示幅（全角=1 / 半角=0.5）で手動 `\N` 改行する `wrapText` を実装。長いメタタイトル・長セリフのはみ出しを解消。
- **連結**: テロップ焼き込み済みクリップを解像度統一（scale+pad）して再エンコード → concat デマルチプレクサ(`-c copy`)。AAC priming 由来の Non-monotonic DTS 警告は出るが ffmpeg が補正し、境界での実害は ±20ms 程度で許容。

## フロー
```
public/data/<...>-<videoId>-<start>-<end>.json   ← 対象クリップ（ファイル名に -<videoId>- を含む）
        │  startTime 昇順にソート
        ▼
結合元 mp4 を用意（--source）
   existing: public/videos/<basename>.mp4（200p）を再利用
   cache   : yt-dlp で高画質DL → cache/createVideo/<videoId>/ に保存（再実行時は再利用）
        │  クリップ毎に .ass 字幕生成 → subtitles=(libass) で焼き込み＋解像度統一して再エンコード
        ▼
（一時ファイル）焼き込み済みクリップ
        │  concat デマルチプレクサで連結
        ▼
output/<YYYY-MM-DD>-<videoId>-combined.mp4
```

## スクリプト / コマンド
| コマンド | スクリプト | 役割 |
|---|---|---|
| `npm run createVideo -- --videoId <id>` | scripts/create-video.js | videoId の全クリップを結合しテロップを焼き込む |

テロップは全要素（タイトル / 日付 / セリフ / 時間）を 1 つの `.ass` 字幕にまとめ、各要素を ASS の `\an`（テンキー配列の 9 分割）で配置する。

## オプション
| オプション | 既定 | 説明 |
|---|---|---|
| `--videoId <id>` | （必須） | 対象 videoId |
| `--source <existing\|cache>` | `existing` | 結合元クリップの取得方法 |
| `--title <text>` / `--no-title` | メタタイトル（絵文字除去） | タイトル文言 / 非表示 |
| `--date` / `--no-date` | 表示 | 日付の有無 |
| `--serif` / `--no-serif` | 表示 | セリフの有無 |
| `--time` / `--no-time` | 表示 | 時間（元動画タイムスタンプ）の有無 |
| `--title-pos` / `--date-pos` / `--serif-pos` / `--time-pos` | 上中央 / 右上 / 下中央 / 右下 | 9 分割位置 |
| `--out <path>` | `output/...` | 出力先 |
| `--resolution <WxH>` | `1280x720` | 出力解像度 |
| `--font <name>` | `Hiragino Sans` | テロップフォント（fontconfig 名） |

位置（anchor）: `top-left, top-center, top-right, middle-left, center, middle-right, bottom-left, bottom-center, bottom-right`

```bash
# 日付を消し、タイトルを上書き、セリフを上中央・時間を左上へ
npm run createVideo -- --videoId gr9WJDYS_u0 --no-date --title "マリオ耐久まとめ" --serif-pos top-center --time-pos top-left

# 高画質ソースで結合（初回DL、2回目以降はキャッシュ再利用）
npm run createVideo -- --videoId gr9WJDYS_u0 --source cache --resolution 1920x1080
```

## 前提・依存
- **ffmpeg（libass 対応）**: `brew install ffmpeg-full`（keg-only）。スクリプトが自動検出。`FFMPEG_BIN` で上書き可。
- **yt-dlp**: `--source cache` の高画質DLに必要。
- npm の仕様上、引数は `--` の後に渡す（`--videoId=...` 形式の `npm_config_*` フォールバックにも対応）。

## 重要な仕様
- 結合元のクリップは `public/data/` のファイル名に `-<videoId>-` を含む JSON を `trimming.startTime` 昇順で並べる。
- `cache/`（高画質キャッシュ）と `output/`（生成物）は `.gitignore` 済みでコミット対象外。
- タイトル既定値はメタデータのタイトルから絵文字を除去したもの（libass の tofu 回避）。`--title` で任意文言に上書き可。

## 動作確認（gr9WJDYS_u0・全19クリップ）
- 1分53秒の 1280x720 mp4 を開始時刻順に結合（期待 112.7s ≈ 出力 113.5s）。
- タイトル / 日付 / セリフ / タイムスタンプを所定位置に描画（日本語OK・絵文字除去・長文折り返し）をフレーム抽出で目視確認。
- オプション（`--no-date`・`--title` 上書き・各 `--*-pos`）の反映を確認。
- `--source cache` で高画質DL（1920x1080）→ 再実行で 19 件すべてキャッシュ再利用・DL 0 件。

## 関連ファイル
- `scripts/create-video.js` … 本体
- `package.json` … `createVideo` スクリプト
- `.gitignore` … `cache` / `output`
- `CLAUDE.md` / `README.md` … 使い方
