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
- 併せて YouTube 公開用のメタデータを 3 系統書き出す（実装は `summary.js`、設定は `summary.*`）。時刻は各クリップのブロック先頭（区切りカードがあればその開始）を実尺の積み上げから算出する。
  - `output/<name>.youtube.txt` … 概要欄本文。チャプター + 配信単位の出典 + 導入文 + 非公式表記。`summary.siteUrl` などが未設定の節は見出しごと省く
  - `output/<name>.comment.txt` … 固定コメント用のクリップ単位一覧。1 クリップ = `[動画内での時間] [serif]` / `[元動画タイトル]` / `[clipUrl]` の 2〜3 行で、タイトルは直前と同じなら省略する。`summary.maxChars`（既定 5000）を超えると `.comment-1.txt` … へ分割し、各塊の先頭では必ずタイトルを出す
  - `output/<name>.meta.json` … タイトル案 / タグ / チャプター配列 / 出典。将来の Data API 自動化用
- チャプターは直前のクリップと videoId が変わった位置で切る。YouTube の要件（先頭 0:00 必須 / 3 つ以上 / 各 10 秒以上）に合わせ、先頭は 0:00 へ丸め、`summary.chapters.minSec` 未満の区間は隣へ吸収し、3 個未満になったら警告して概要欄から省く。ラベルは配信タイトルの `【】` `『』` を整形して使い、`summary.chapters.labels` で `videoId` または `videoId#2`（同じ配信の 2 回目の登場）を指定して上書きできる。
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
| `--enhance` / `--no-enhance` | 無効 | Anime4K（ffmpeg libplacebo）でアニメの線を補正する。1080p の `--source cache` 向けで、144p の既存 mp4 には掛からない |
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

`telops.serif.avoidFace`（既定 有効）で、セリフボックスが演者の顔と重なるクリップだけ、顔の無い側へ寄せて幅を狭める。ボックスは画面下端に張り付いていて下へ逃がせないため、顔の左右どちらか広い側に収める（既定プリセットでは右に立つ演者を避けて左寄せになり、幅 1612px → 約 1180px）。顔は zoom と同じ `detect_anime_face.py` でクリップ全体から `frames`（既定 3）枚を抜いて検出し、検出した矩形はすべてまとめて避ける。zoom が効くクリップでは切り出し後の座標へ変換してから判定する。`gap`（既定 0.0125 = 24px）は顔との間隔、`minWidth`（既定 0.45）は狭めた幅の下限で、満たせないときは全幅のままにして QC が `serif_face_fallback` を warn で知らせる。顔が検出できない・重ならないときは従来どおり。折り返し幅もボックスに合わせて狭くなるため行数が増えることがある。`--avoid-face` / `--no-avoid-face` でグローバルに切り替え、クリップ JSON の `effects.avoidFace` で `false`（抑止）/ `true` / `{"side": "left"|"right"}`（寄せる側を指定）を個別指定できる。判断は render.json の `avoidFace` に残る。

`effects.enhance`（既定 無効）は、Anime4K の GLSL シェーダを ffmpeg の `libplacebo` フィルタで掛けるアニメ向け線補正。YouTube 1080p の圧縮でにじんだ線を整える用途で、`--source cache` の 1080p ソースを想定する。scale+pad+fps の後に等倍の復元（`restore`、既定 `Restore_CNN_M`）を入れ、zoom の切り出し後の拡大を lanczos から CNN（`upscale`、既定 `Upscale_CNN_x2_M`）に置き換える（Anime4K 公式の Mode A = Restore → Upscale の順。1080p に復元を 2 回掛けると過剰シャープになるので 1 回だけ）。シェーダ名は `Anime4K_` 接頭辞と `.glsl` を除いた形で、`Restore_CNN_{S,M,L,VL,UL}` / `Restore_CNN_Soft_*`（軽いボケ向き）/ `Upscale_CNN_x2_*` から選ぶ。サイズは 1 段上がるごとに処理時間が約 2 倍。`Anime4K_Clamp_Highlights` を先頭に付けて元より明るくならないよう抑える（`clampHighlights`）。`minSourceHeight`（既定 720）未満のソースには掛けないので `public/videos`（256×144）は自動で対象外。ソースを差し替えるのではなくフィルタ列に入るだけなので、キャッシュ・中間ファイル・追加バイナリは無く、顔検出やテロップ座標も変わらない。`--enhance` / `--no-enhance` でグローバルに切り替え、クリップ JSON の `effects.enhance` で `false` / `true`（`minSourceHeight` を無視）/ `{"restore": "Restore_CNN_Soft_M", "upscale": null}` を個別指定できる。判断は render.json の `enhance` に残り、libplacebo が使えない・シェーダが無いときは警告して補正なしで続行し、QC が `enhance_fallback` を warn で知らせる（`required: true` なら error で停止）。

注意:
- npm の仕様上、引数は `--` の後に渡す（`--videoId=...` 形式の `npm_config_*` フォールバックにも対応）。
- テロップ焼き込みには `subtitles`(libass) 対応の ffmpeg が必要。通常の Homebrew `ffmpeg` は非対応のため `brew install ffmpeg-full` を導入する（keg-only。既存 ffmpeg は壊さない）。スクリプトが `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` を自動検出し、`FFMPEG_BIN` 環境変数で上書きも可。
- 区切りカードの背景/SE/BGM は `assets/create-video/` の素材を参照する。欠落時は該当機能をスキップして続行する。
- `--enhance` は `libplacebo` フィルタ入りの ffmpeg（`ffmpeg-full`）と Vulkan ドライバが必要。macOS では `brew install molten-vk`（無いと `VK_ERROR_INCOMPATIBLE_DRIVER` で補正だけスキップされる）。シェーダは初回に bloc97/Anime4K の release zip（GLSL テキスト）を `cache/createVideo/tools/anime4k/glsl/` へ自動取得し、連結したプリセットを同所の `.presets/` に置く。
- 高画質DLには yt-dlp が必要。`--source cache` の音量正規化には `ffmpeg-normalize` が必要（不在時は警告して生DLを使用）。映像は copy で高画質のまま、音声のみ正規化する。サムネイルは `cache/createVideo/thumbnails/` にキャッシュする。

### 静止画プレビュー（still）

```
npm run -s still -- --config scripts/create-video/config-matome-01.json --still <base>
npm run -s still -- --videoId gr9WJDYS_u0 --still '#3' --at 50% --json
npm run -s still -- --videoId gr9WJDYS_u0 --still <base> --print-ass
npm run -s still -- --config scripts/create-video/config-mone.json --videoId gr9WJDYS_u0 --still <base> --zoom --avoid-face
npm run -s still -- --videoId gr9WJDYS_u0 --limit 3 --sheet 8
npm run -s still -- --videoId gr9WJDYS_u0 --still '#1' --frames 6
npm run -s still -- --videoId gr9WJDYS_u0 --limit 3 --still 'card:#2'   # 区切りカード
npm run -s still -- --videoId gr9WJDYS_u0 --limit 3 --still opening     # OP（ED は ending）
```

- 本番と同じ `planClipRender → buildAss → subtitles` を通し、1 フレームだけ PNG に焼く。
- 区切りカード（`card:<base>` / `card:#N`）と OP / ED（`opening` / `ending`）も同じ考え方で、`planCardRender` と `buildCardVideoGraph` を本番（`card.js`）と共有する。背景・サムネイル・ASS の入力は本番と同一で、音声グラフだけ外す。`endcaps.*.video` に完成動画が指定されていればその動画から抜く。サムネイルはキャッシュ済みのものだけを使い、未取得なら `thumbnail_missing` を出して背景だけで描く。
- `-ss` は `-i` の後に置く。libass と zoom の PTS を本番フィルタチェーンと揃えるため。`-vf` 経路では `trim=start=<t-0.5 秒を 1/fps に切り下げ>` を本番チェーンの前に置き、それより前のフレームはデコードだけで捨てる（pts は保たれるので PNG は全フレーム処理と md5 一致。zoom punch の `filter_complex` は `setpts=PTS-STARTPTS` があるため前置しない）。
- 既定では zoom・顔回避は OFF で、テロップ位置は不変。`--zoom` `--avoid-face` で opt-in でき、顔検出が走ると +2〜3 秒ほど掛かる。
- `source: cache` のキャッシュミスでも yt-dlp は起動しない。期待パスを `source_missing` warning に出す。
- 256x144 の既存 mp4 を 1080p へ拡大する場合は `source_upscaled` を出す。
- 出力は既定で `cache/createVideo/preview/<preset>/`。単体 still は `<base>-t<sec>.png`、シートは `sheet-<n>x<cols>.png`。
- `--json` は 1 行 JSON。主要キーは `ok,out,assPath,at,requestedAt,index,total,clip,size,source,zoom,avoidFace,enhance,elements,overlays,warnings,key,ms`。
- 2026-09-11 実測（1080p 出力）: ffmpeg 単体 約 0.6 秒、`renderStill` を同一プロセスで繰り返すと約 0.7 秒/枚（`resolveFfmpeg` はプロセス内で 1 回だけ）、CLI は node 起動込みで約 0.9 秒。`config-mone` の `--zoom --avoid-face` は顔検出込みで約 3.7 秒。3 セルの `--sheet 3` と `--frames 4` はどちらも約 1.2 秒。
- 本番との一致は「完成セグメントから抜いたフレームとの PSNR」で確認する。値は内容依存で、既定プリセットは 41 dB、zoom 全編は 37 dB。どちらも静止画を x264 crf23 で往復させた圧縮の床（39 dB / 36 dB）と同じ帯にあり、t±1 フレームとは 8 dB 以上離れる。ASS は `--print-ass` で本番 `clip-NNNN.ass` と完全一致する。
- カード / OP / ED も同様に、既定プリセットで 39.3 / 41.3 / 43.4 dB（それぞれの圧縮床は 40.8 / 42.7 / 44.9 dB）。ASS は本番 `card-NNNN.ass` / `opening.ass` / `ending.ass` と完全一致する。カードは背景がほぼ静止しているため t±1 フレームでも PSNR が下がらず、一致の根拠は ASS の一致と圧縮床との距離で見る。

## 生成動画の自動品質レビュー（QC）

`createVideo` の生成物を「意図（レンダー設定）と実物（ffprobe 実測）の差分」として検査する。

```
npm run qc -- --video output/xxx.mp4        # 既存 mp4 を単体レビュー
npm run qc -- --preflight --videoId xxx     # 生成せず L0 だけ（ffmpeg 不要・数十ms）
npm run qc -- --all [--dir output]          # ディレクトリ内の mp4 を一括レビューして表で出す
npm run qc -- --video xxx.mp4 --contact     # 代表フレーム一覧 PNG を書き出す
npm run qc -- --video xxx.mp4 --review      # 上記を claude CLI に読ませて指摘を書き出す（非ゲート）
npm run createVideo -- --videoId xxx --qc   # 生成前 L0 + 生成後 L1
```

- 実装は `scripts/create-video/qc/`（index/manifest/report/checks/*）。しきい値は `config.qc.*`。
- `--qc` を付けると生成時に `output/<name>.render.json`（レンダーマニフェスト）を書き出す。セグメントの実尺・テロップ矩形・zoom・concat 経路を残し、QC の期待値にする。`config.qc.manifest: false` で抑止可。manifest は `--qc` なしの通常実行でも書き出す（出力が 1 ファイル増えるだけで mp4 は変わらない）。
- **L0（生成前・ffmpeg 不要）**… 素材存在、テロップのはみ出し・重なり、autoShrink の張り付き、行数、禁則残存、クリップ重複、`--order` の単調性、チャプター要件。error があればエンコードを始めずに止める。`npm test` でも回る。
- **L1（生成後）**… 署名と総尺、concat 経路、A/V 同期（音声相互相関）、クリップ同一性（pHash）、音量（ebur128）、無音、黒、フリーズ、テロップ焼き込み（矩形内の塗り色一致率）、概要欄の時刻。
- 出力は `output/<name>.qc.json` と `output/<name>.qc.md`。**終了コードは error が 1 件以上で 1、warn / info のみなら 0。**
- `--contact` は各クリップの代表フレームをラベル付きで並べた `output/<name>.contact.png` を書き出す。`--review` はそれを `claude` CLI に読ませて `output/<name>.review.md` に指摘を残す。どちらも結果は info 扱いで、**合否には影響しない**（LLM の出力は非決定的なため）。
- render manifest には mp4 のサイズと SHA-256 が入る（version 2）。古い manifest が残っている場合は `manifest_stale` を error にする。検証目的で無視したいときだけ `--allow-stale-manifest` を使う。
- テロップの衝突は「不透明なボックスがあればボックス、無ければ行ごとの文字矩形」で判定する。`title` のボックスは全幅の背景バーで date と progress がその上に乗る意図的なデザインなので、判定から除く。
- ASS 出力は `scripts/create-video/__fixtures__/ass-golden.json` で固定している（3 プリセット × `public/data` 全クリップのハッシュ + 要注意 15 件の全文）。テロップ描画を意図的に変えたときは `npm run golden:ass` で更新する。`wrap-golden.json` は別物で再生成禁止。
- 音量の目標は **-23 LUFS ±2**（取り込み側の `ffmpeg-normalize` が EBU R128 / -23 LUFS で揃えるため）。YouTube 基準に寄せたい場合は `config.qc.thresholds.integratedLufsMin/Max` を変更する。
- 区切りカード・OP・ED は静止画背景で無音なため、manifest がある場合はフリーズ・無音・音量差の検査をクリップ区間だけに限定する。
- `effects.enhance` を設定したのに libplacebo 不可やシェーダ欠落で補正なしになったクリップは `enhance_fallback` を warn にする。manifest のセグメントに `enhance`（`applied` / `restore` / `upscale` / `from`、または `fallback` と `reason`）が残る。
- テロップの衝突は重なり面積比（既定 0.2）で判定する。文字矩形の幅は `charWidth` 推定で実測より広く出るため、端が触れただけでは error にしない。

注意:
- manifest が無い mp4 でも動くが、位置ズレ・クリップ抜け・焼き込み・音量差の検査は info で skip する。
- 日本語 OCR 辞書が無い環境を前提に、**文字認識には依存しない**。テロップは矩形と塗り色でのみ検証する。
- A/V 同期と pHash には python（numpy / cv2）が必要。無ければその検査だけ skip して続行する。

詳細は docs/tasks/09-10-video-qc.md を参照。

## 設定エディタ（dev 専用 GUI）

`scripts/create-video/config*.json` を GUI で作成・編集・プレビュー・実行する。dev サーバ専用で、`vite build` には入らない。

```
npm run dev                 # いつもの dev サーバ
npm run editor              # /mone-button/editor.html を開く
http://localhost:5173/mone-button/editor.html?tab=preview&preset=config-mone.json
```

- 画面は `クリップ`（select の編集、files + as-listed のときドラッグ&ドロップ / Alt+↑↓ で並べ替え、「この選択を files に固定」）/ `プレビュー`（`npm run still` と同じレンダラで 1 フレーム、矩形オーバーレイ、セリフ改行の試し、`public/data に保存` と `プリセットに保存` の 2 ボタン。`OP / カード / クリップ / ED` の切り替えで区切りカードと OP/ED も見られる）/ `設定`（`config.schema.json` から生成したフォーム。明示 / 継承 / 未保存の 3 状態、× で継承に戻す、「継承項目を隠す」で差分ビュー）/ `ビルド`（`--limit` などを選んで createVideo を起動、SSE ログ、結果の動画・QC・コンタクトシート）/ `概要欄`（`.youtube.txt` / `.comment*.txt` / `meta.json` のコピー）。「＋ 新規」で `config-<name>.json` を空または複製で作る
- 保存は **`raw ∪ dirty`**（触った項目だけをファイルへ当てる）。解決済み全体や DEFAULTS からの差分は書かない。空 patch の保存は無変更。検証失敗でも保存は止めない
- 未保存の draft は `cache/createVideo/editor/<preset>.draft.json` に書き、検証（`runPreflight`）とプレビュー（`renderStill`）はそれを `--config` で読む。ビルドは保存済みプリセットで走る
- API は `/__cv/*`（`plugins/vite-plugin-create-video.ts` → `scripts/dev-server/handlers/*.js`）。ハンドラは遅延 import なので **`scripts/dev-server/**` や `scripts/create-video/**` を直したら dev サーバを再起動する**（`r` + Enter）
- ガード: ループバック以外・Origin 不一致・`Sec-Fetch-Site: cross-site` は 403、プリセット名は `config-*.json` のみ、`/file` は kind ごとに基底ディレクトリ固定、ビルドオプションは allowlist。子プロセスは detached でグループ化し、cancel / サーバ close / Ctrl-C でまとめて止める。残った場合は `pkill -f create-video/index.js`
- テストは `scripts/dev-server/**/*.test.js`（`npm test` に含まれる）。ブラウザ操作テストは無いので、UI は headless Chrome のスクリーンショットで確認する（`?tab=` / `?preset=` / `?job=` / `?kind=` で初期状態を指定できる）

詳細は docs/tasks/09-11-config-editor.md を参照。

### 画面のスクリーンショット（shots）

エディタの各タブを headless Chrome で撮り、コンソール出力も拾う。UI を直したときの目視確認と
リグレッション検出に使う。

```
npm run shots                                # config-matome-01.json の 5 タブ
npm run shots -- --preset config-mone.json --tab preview,build
npm run shots -- --tab preview --kind card       # 区切りカードのプレビュー
npm run shots -- --strict                    # コンソールに深刻な出力があれば exit 1
```

- 実装は `scripts/ui/shots.mjs` と `scripts/ui/cdp.mjs`（Node 組み込みの WebSocket だけで CDP を話す。依存は増やさない）。
- Chrome の `--screenshot` フラグは使わない。あれは「読み込みが落ち着いた」と Chrome が判断した瞬間に 1 枚撮って終わりで、後から届く `/__cv/clips` や `/__cv/still` の結果が写らず、さらに PNG を書いた後もプロセスが終了しない。CDP で `Page.loadEventFired` の後に `--settle`（既定 2500ms）待ってから `Page.captureScreenshot` する。
- 既定はページ全体（`Page.getLayoutMetrics` の高さ）。`--viewport` でビューポートだけにできる。
- dev サーバが動いていなければ自分で `npm run dev` を起動し、撮り終えたら止める。
- 出力は `cache/ui-shots/<preset>-<tab>.png` と `<preset>-console.log`（gitignore 済み）。
- `console.error` / 例外 / `net::ERR` / `Failed to load resource` / React の `Warning:` を要注意として数える。1 枚あたり約 2.8 秒。

## ドキュメント管理

- docs/draft.md - 仕様元
- docs/design-concept.md - デザイン
- docs/feature/* - 機能要件
- docs/tasks/* - 開発タスク
