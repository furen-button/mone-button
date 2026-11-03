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
- `npm run download` … `public/data/*.json` を元に yt-dlp で区間DL＋200p/crf28圧縮し `public/videos/*.mp4` を生成（既存mp4はスキップ。要 yt-dlp / ffmpeg-normalize）。 yt-dlp が使う ffmpeg には再接続と 20 秒の読み取りタイムアウトを渡す（googlevideo が無応答だと素の ffmpeg は永久に固まり、途中で切断されると映像だけ短いファイルを成功扱いで残すため。5 秒だと遅いサーバの初回応答に間に合わない）。DL 直後に ffprobe で映像尺をトリム尺と比べ、250ms 超短い・読めない・yt-dlp の異常終了・15 分超（SIGINT で中断。yt-dlp が ffmpeg に q を送って止める）のときは `_temp.mp4` と `.part` を消して 1 回だけ再 DL する。それでも失敗したクリップはスキップして末尾に一覧を出し、終了コード 1 にする。テストは `scripts/download.test.js`。

注意:
- serif / ruby / categories の入力は **youtube-clip-tool 側で行う**（取込後に上書きされない）。既存クリップの内容を直したい場合は `public/data` を直接編集するか、当該ファイルを削除して再取込する。
- dev サイトのクリップ編集モーダルの「🎤 文字起こし」は、ローカルの `whisper-cli` と Whisper モデルで現在の mp4 全体を文字起こしする。`WHISPER_CLI` / `WHISPER_MODEL_PATH` / `WHISPER_LANGUAGE` は `.env`・`.env.local` またはプロセス環境変数で設定できる（プロセス環境変数を優先）。`WHISPER_MODEL_PATH`（モデルの絶対パス）は必須で既定値は無く、マシン固有の値なので git 管理外の `.env.local` に書く。ruby は kuromoji で生成し（半角カナは NFKC で全角に揃えてからひらがなにする）、手修正後は「serif から読みを作る」で再生成できる。結果は入力欄に入り、**「保存」を押すまで JSON に書き込まない**。設定エディタ `editor.html` は対象外。
- dev サイトのクリップ編集モーダルの serif 区切りプレビューは、半角の `!` `?` を赤く囲って示し、「！？ 全角にする」で serif の半角 `!` `?` を全角 `！` `？` に置き換える（保存まで JSON には書かない）。モーダルは外側を押しても閉じない。フッター左の「🗑 削除」は 2 回押し（1 回目で「もう一度押すと削除」に変わり 4 秒で戻る）で、情報モーダルの削除と同じく json と mp4 を `trash/` へ退避してモーダルを閉じる。高画質キャッシュは退避しない。
- dev サイトのクリップ編集モーダルでは、波形を見ながら先頭・末尾を **短縮のみ** でトリムできる。ファイル名は変えず、旧 `public/videos` は `trash/videos`、高画質キャッシュは `trash/cache` へ退避して次回 createVideo で再 DL させる。
- 範囲を広げるときは波形トリムの「前 +20 秒」「後ろ +20 秒」を押す。JSON の範囲を広げて YouTube から取り直し（`POST /__data/extend`。`download.js` の 1 区間モード `--video-id --start --end --out` を子プロセスで走らせ、`cache/clip-extend/` に取ってから差し替える）、旧 mp4 と高画質キャッシュはトリムと同じく trash へ退避する。配信の先頭とメタデータの尺で切り詰め、取り直しに失敗したら何も変えない。`trimming.original` は既存値を維持し、`effects.camera` は広げた分だけずらす（`effects.zoom.at` は補正しない）。広げすぎた分は通常のトリムで詰める。1 回 30 秒〜3 分ほど（YouTube の応答次第）。詳細は docs/tasks/11-03-clip-extend.md。
- 波形の「この範囲を別クリップに切り出す」は、元の JSON・mp4・高画質キャッシュを残して新しい JSON と mp4 を作る。serif / ruby / categories / memo 等は元 JSON からコピーする（`effects.zoom.at` もクリップ先頭からの秒を補正せずコピーし、既存トリムと同じ扱い）。ファイル名は `<YYYY-MM-DD>-<videoId>-<pad6(floor(startTime))>-<pad6(floor(endTime))>`（日付は元ファイル名優先、なければ uploadDate）で、同名の JSON または mp4 があれば 409 で止める。切り出しても ASS golden が変わるため、意図どおりなら `npm run golden:ass` で更新する。
- トリムすると `public/data` 全体を見ている ASS golden が変わる。意図したトリム後は `npm run golden:ass` で `scripts/create-video/__fixtures__/ass-golden.json` を更新する。
- dev サイトでは各カードに要対応バッジ（📥 未DL / ✂️ 未カット / 🔤 ルビ / ␣ 区切り）を出し、並び替えの下の DEV ツールバーで件数の確認と種類ごとの絞り込み（絞り込み中はカテゴリの選択を無視）ができる。判定は `scripts/dev-server/lib/clip-review.js` に 1 か所で持つ。未DL は `public/videos` に mp4 が無い（`GET /__data/status` の一覧。タブに戻ると取り直す）、未カットは `trimming.original` が無く長さが 30 秒（youtube-clip-tool の ±15 秒窓）のまま、ルビは toRuby の字種（ひらがな・長音・数字・英字）以外を含むか空、区切りは半角スペース無しで 15 字超。編集モーダルの要対応パネルの「このままで良い」で JSON に `review`（`trim: true` / `ruby` / `serif` は確認したときの値）を記録でき、値が変わる・波形で切ると確認は自動で外れる。詳細は docs/tasks/10-30-clip-review-status.md。
- データは build 時に glob 取込されるため、取り込み後の表示反映には `npm run dev` または `npm run build` が必要。

詳細は docs/tasks/06-19-clip-import.md を参照。

## まとめ動画生成（createVideo）

`public/data/*.json` のクリップを選択し、YouTube まとめ動画形式（OP/ED、区切りカード、タイトルバー、セリフボックス、進行表示）で 1 本の mp4 にする。既定プリセットは `scripts/create-video/config.json`。

| プリセット | 用途 |
|---|---|
| `config.json` | 既定。緑のタイトルバー + 白地のセリフボックス。`source existing`（144p）でエフェクト無し |
| `config-mone.json` | 紫 + ピンクの公開用の見た目。`source cache`・zoom 全編アップ。OP 無し |
| `config-matome-01.json` | 名場面集 #1。`select.mode files` に 99 件を固定し、概要欄の文言も入る |
| `config-hq.json` | **公開用 高画質のひな形**。`source cache` 1080p + zoom punch + 顔回避 + Anime4K 補正 + カード/OP/ED。`--videoId` で配信を指定する |
| `config-category.json` | **カテゴリ横断まとめのひな形**。`select.mode category`（既定は「やられ」）。OP タイトルはカテゴリ名から自動生成される |
| `config-kirinuki.json` | **切り抜き風のひな形**。紫の 1 行帯（配信タイトル、左に日付・右に元動画時刻。進行表示は無し）+ ボックス無しの二重縁取りセリフ + 配信が変わる所だけホイップパン + ED はピンクの肉球背景の 10 秒エンドカード動画（`endcaps.ending.video` = `assets/create-video/endcard-pink-04-pop-bg035.mp4`。gitignore 済みの素材で、無ければ 20 秒のエンドスクリーンを生成する）。OP・区切りカード・zoom 無し、`source cache` + Anime4K。`select.mode category`（既定は「やられ」） |
| `config-shorts.json` | **Shorts 用**。1080×1920 / 30fps、元映像の顔中心を縦に切り出し + Anime4K CNN 拡大。紫帯とピンク二重縁取り、配信が変わる所だけホイップパン。配信単位で短尺をまとめて分割（既定「やられ」）、OP・カード・ED 無し。`output/shorts/` に出力 |

```
npm run createVideo -- --videoId gr9WJDYS_u0
```

- 実装は `scripts/create-video/`（index/config/select/ass/clip/card/ffmpeg/assets）。
- `--mode videoId` / `--mode category` / `--mode files` に対応。既定は `videoId`。
- 既定出力は `output/<YYYY-MM-DD>-<videoId>-combined.mp4`。`--out` または config の `output.name` で上書き可。
- 併せて YouTube 公開用のメタデータを 3 系統書き出す（実装は `summary.js`、設定は `summary.*`）。時刻は各クリップのブロック先頭（区切りカードがあればその開始）を実尺の積み上げから算出する。
  - `output/<name>.youtube.txt` … 概要欄本文。チャプター + 動画ごとの出典（タイムスタンプ付き URL）+ 導入文 + 非公式表記。`summary.siteUrl` などが未設定の節は見出しごと省く
  - `output/<name>.comment.txt` … 固定コメント用のクリップ単位一覧。1 クリップ = `[動画内での時間] [serif]` / `[元動画タイトル]` / `[clipUrl]` の 2〜3 行で、タイトルは直前と同じなら省略する。`summary.maxChars`（既定 5000）を超えると `.comment-1.txt` … へ分割し、各塊の先頭では必ずタイトルを出す
  - `output/<name>.meta.json` … タイトル案 / タグ / チャプター配列 / 出典。将来の Data API 自動化用
- チャプターは既定（`summary.chapters.by: clip`）でセリフ（クリップ）ごとに切る。YouTube の要件（先頭 0:00 必須 / 3 つ以上 / 各 10 秒以上）に合わせ、先頭は 0:00 から測り、`summary.chapters.minSec`（10 以上。YouTube の要件より短くはできない）に届くまで後続のクリップを前から順にまとめ、末尾だけ短く残ったら直前へ寄せる。見出しはまとめたセリフを「 / 」でつなぐ（セリフが無ければ配信タイトル）。出典はチャプターとは別に、元動画（videoId）ごとに 1 つにまとめて初登場の順に並べる。離れた位置で再登場したクリップも同じまとまりに入れ、見出し（時刻なし。行頭の時刻は YouTube がチャプターと読み取るため）はその動画のセリフを「 / 」でつなぎ、URL は初登場のクリップのタイムスタンプ付き URL を 1 本だけ出す。チャプターが 3 個未満で省かれても出典は残す。`summary.chapters.labels` はチャプター先頭のクリップ名（base）でチャプターの見出しだけを上書きする（出典の見出しには効かない）。meta.json のチャプターには `bases` と `urls` が入り、QC の `probe_chapter_time` は先頭クリップのブロック先頭と突き合わせる。
- `summary.chapters.by: stream` は従来の配信単位。直前のクリップと videoId が変わった位置で切り、`minSec` 未満の区間は隣へ吸収し、3 個未満になったら警告して概要欄から省く。ラベルは配信タイトルの `【】` `『』` を整形して使い、`summary.chapters.labels` で `videoId` または `videoId#2`（同じ配信の 2 回目の登場）を指定して上書きできる。出典は配信一覧。
- `by: clip` のチャプターはクリップ数に、出典は元動画の本数に比例して長くなる（やられ 25 クリップ・7 本で概要欄 約 1400 文字、侍 73 クリップ・55 本で約 4300 文字。名場面集 #1 の 99 クリップ・14 本は出典だけで約 2900 文字）。概要欄が `summary.maxChars`（既定 5000 = YouTube の上限）を超えると警告だけ出る。
- クリップ、カード、OP/ED はすべて h264/yuv420p/30fps + aac/44100/stereo に正規化してから concat する。署名が揃えば映像は `concat` デムクサで copy、音声は AAC プライミングの累積音ズレを避けるため各セグメントから直接 concat フィルタで再エンコードする（`concat-vcopy`）。署名不一致なら全再エンコードの concat filter に fallback。
- 音声は常に `AUDIO_RESAMPLE`（`aresample=44100:async=1:min_hard_comp=0.001:first_pts=0`、`ffmpeg.js`）で通す。yt-dlp の区間切り出しで作った **96kHz 音声のソースには数十 ms の pts の穴**（タイムスタンプだけ飛んでサンプルが無い）が混ざり、`async` 無しだと穴が AAC パケット 1 個の長い duration として残る。プレイヤーは pts を尊重するので穴以降の音声が遅れ、連結でクリップごとに積み上がる（2026-09 の 109 クリップ動画で 599ms）。`min_hard_comp` を 1ms に下げるのは、`async=1` だけだと既定 0.1 秒未満の穴が埋まらず、穴を捨てて音声が早まるため。44.1kHz のソースには穴は無い。
- `execClip` の音声に `apad` + `-shortest` を足してはいけない。`encodeArgs` の `-r`（CFR）と組み合わさると `-shortest` が効かず、無限長になった音声に映像フレームが追従してセグメントが際限なく伸びる（映像 11 秒に対し音声 79 秒、完成動画 147 秒→876 秒を実測）。
- `npm run fixCacheAudio [-- --dry-run] [--tolerance <ms>] [--dir <path>]` … `cache/createVideo/**` の高画質クリップで pts の穴がある（1ms 超）・音声長と映像長がずれている（既定 24ms = AAC 1 フレーム超）ものを、映像 copy のまま音声だけ再エンコードして揃える（`assets.js` の `alignAudioToVideo`。連結側と同じ `atrim`/`apad` で映像ストリーム尺ちょうどに揃える。`-shortest` は AAC フレーム粒度で ±23ms 残るので使わない）。再ダウンロード不要。`downloadHighQuality` は取得直後に同じ整列を掛け、yt-dlp の音声選択は `asr<=48000` の m4a を優先する。
- タイトル文言は `--title` > `telops.title.overrides[videoId]` > `telops.title.text` > `clip.data.title` > メタタイトル（絵文字除去）の順で解決する。手動改行は `telops.title.overrides` の文字列へ直接入れるか、CLI では `--title '上段\n下段'` のように 2 文字の `\n` で渡せる。
- セリフテロップは `public/data/*.json` の `serif` に生の改行を書ける。動画生成では手動改行を強制改行の起点として扱い、各セグメント内で自動折り返しと禁則処理を行う。Web サイト表示用の `serif` は `src/voiceData.ts` で改行を無かったものとして正規化する（元から空白で区切られていた箇所は空白を残し、語中で折っただけの箇所は詰める）ため、JSON 側の改行は保持される。dev のクリップ編集モーダルは正規化前の値（`VoiceClip.rawSerif`）を編集するので、保存しても改行と強調記法は消えない。
- `wrapText` は行頭禁則（句読点、終わり括弧、小書き仮名など）と行末禁則（始め括弧）を分割位置の後退で避ける。ぶら下げは使わない。`maxUnits < 4` では禁則と泣き別れ回避を無効化し、行数が増える場合も禁則より行数維持を優先する。折り返し後は各行の行頭・行末の空白を落とす（`\an5` の中央寄せでは行端の空白がその行だけ中心をずらすため）。`serif` の半角空白は折り返し位置の指定として扱い、空白で折った最終行が短いときの泣き別れ回避は、1 文字ずつではなく空白区切りの語ごと前の行から送る（語の途中では割らない。送ると前の行のほうが短くなる場合や、収まらない場合は送らない）。
- `autoShrink` は実際に折り返した行数から `boxHeightFor(lines, fs, pad, border)` を測り、二分探索で高さ上限に収まる最大の整数フォントサイズを選ぶ。`minSize` が `size` より大きい場合でも拡大しない。ボックスが無いときは `pad`・`border` を 0 として行数×行送りだけで測る。
- `telops.*.outlines`（`[{ width, color }, ...]` 内側→外側）で二重縁取りにできる。外側ほど太い `\bord` の同じ本文を外側から同じ Layer に重ね（同 Layer は記述順に描かれる）、影は最外層だけに付ける。未指定なら従来どおり 1 行。
- `serif` の強調記法: `{語}` は `telops.serif.emphasis.color`（既定 `FFD800`）、`{語|RRGGBB}` はその色で描く。閉じていない括弧・空の括弧は従来どおり文字（全角 ｛｝）。折り返し・autoShrink・QC の矩形は記号を除いた本文で測り、`wrapText` 自体は変えない（`wrap-golden.json` を守るため、記号除去 → 折り返し → 色の再適用の順）。強調は `serif` という名前のテロップ（クリップのセリフ・区切りカードの nextSerif）だけで解く。概要欄・固定コメント・ED の一覧・Web サイト（`src/voiceData.ts`）では記号だけを落とす。
- `telops.title.format` に `{date}`（YYYY/MM/DD）と `{title}` を書くと日付と配信タイトルを 1 本の文言にする（`telops.date.enabled: false` と併用）。`singleLine: true` で `marginH` の内側に 1 行で収まるまで `size` から `minSize` へ縮め、それでも入らなければタイトル末尾を「…」で省く。`--title` / `overrides` はタイトル部分だけを置き換える。帯の最低高さは `box.minHeight`（既定 0.07）で下げられる。

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

`transitions`（既定 `mode: none`）は、クリップ同士の繋ぎ目に横モーションブラーのホイップパン（`type: whip`）を入れる。`stream` は直前のクリップと videoId が変わる繋ぎ目だけ、`all` はすべての繋ぎ目。区切りカードがあるとクリップが隣り合わないので、`cards.enabled: false` のときだけ効く。出る側は自分のセグメントの末尾 `duration/2` 秒（既定 0.25 秒、片側はクリップ尺の 1/3 まで）で加速しながら左へ流れ、入る側は先頭 `duration/2` 秒で右から減速して止まる。画面を横に回り込ませる 2 枚の `overlay`（`eval=frame` の `t` 式）と、速さに比例した横だけの `gblur`（`sigmaV=0`）を 1 フレームずつ `enable` で掛ける。ブラーが最大の瞬間に切り替わるので、2 本を素のカットで繋いでも継ぎ目は見えない。テロップを焼いた後に掛けるので帯もセリフも画面ごと流れる。各セグメントの中で完結するため、concat-vcopy・manifest の実尺・summary の時刻・still の共有経路は変わらない（still でトランジション中の時刻を指定すれば本番と同じ絵になる）。入る側の先頭に `transitions.se`（既定 `assets/create-video/シーン切り替え1.mp3`、gitignore 済みの素材なので各自で置く）を、`AUDIO_RESAMPLE` 後のクリップ音声へ `amix duration=first` で重ねる。この SE 単体は -18 LUFS と台詞（-23 LUFS）より大きいので、`config-kirinuki` は `volume: 0.5` にしている（1.0 だと QC の `loudness_segment_range` が 3 LU を超えた）。render.json のセグメントに `transition`（`in` / `out` の区間と SE）が残り、QC の pHash とテロップ焼き込みは入りの区間を避けて測る。

`endcaps.ending.layout: endscreen` で ED を YouTube の終了画面用の枠にする。背景は最後のクリップの最終フレームをぼかして暗くした静止画（`endscreen.background.type: lastClip`、`-sseof -0.5` で末尾だけ読み、`reverse` で最後の 1 枚を採って `tpad` で複製）。画面ほぼいっぱいの枠を 1 つ描き、上辺左寄りに「おすすめアーカイブはこちら」、下辺右寄りに「登録がまだの方はこちら」を置いて、ラベルの所だけ枠線を途切れさせる。途切れの幅は `elementTextRect` の推定（全角 1 字 = 文字サイズ、QC 向けに広め）ではなく、libass で Hiragino を描いた実測（全角 1 字 ≈ 文字サイズ × 0.66、`frame.glyphRatio`）から求める。音声は無音（カード SE も鳴らさない）。ソースが無ければ `cards.background` に戻し、still は `card_background_fallback` を出す。要素（動画・登録ボタン）は YouTube Studio 側で置く。

`effects.enhance`（既定 無効）は、Anime4K の GLSL シェーダを ffmpeg の `libplacebo` フィルタで掛けるアニメ向け線補正。YouTube 1080p の圧縮でにじんだ線を整える用途で、`--source cache` の 1080p ソースを想定する。scale+pad+fps の後に等倍の復元（`restore`、既定 `Restore_CNN_M`）を入れ、zoom の切り出し後の拡大を lanczos から CNN（`upscale`、既定 `Upscale_CNN_x2_M`）に置き換える（Anime4K 公式の Mode A = Restore → Upscale の順。1080p に復元を 2 回掛けると過剰シャープになるので 1 回だけ）。シェーダ名は `Anime4K_` 接頭辞と `.glsl` を除いた形で、`Restore_CNN_{S,M,L,VL,UL}` / `Restore_CNN_Soft_*`（軽いボケ向き）/ `Upscale_CNN_x2_*` から選ぶ。サイズは 1 段上がるごとに処理時間が約 2 倍。`Anime4K_Clamp_Highlights` を先頭に付けて元より明るくならないよう抑える（`clampHighlights`）。`minSourceHeight`（既定 720）未満のソースには掛けないので `public/videos`（256×144）は自動で対象外。ソースを差し替えるのではなくフィルタ列に入るだけなので、キャッシュ・中間ファイル・追加バイナリは無く、顔検出やテロップ座標も変わらない。`--enhance` / `--no-enhance` でグローバルに切り替え、クリップ JSON の `effects.enhance` で `false` / `true`（`minSourceHeight` を無視）/ `{"restore": "Restore_CNN_Soft_M", "upscale": null}` を個別指定できる。判断は render.json の `enhance` に残り、libplacebo が使えない・シェーダが無いときは警告して補正なしで続行し、QC が `enhance_fallback` を warn で知らせる（`required: true` なら error で停止）。

注意:
- npm の仕様上、引数は `--` の後に渡す（`--videoId=...` 形式の `npm_config_*` フォールバックにも対応）。
- テロップ焼き込みには `subtitles`(libass) 対応の ffmpeg が必要。通常の Homebrew `ffmpeg` は非対応のため `brew install ffmpeg-full` を導入する（keg-only。既存 ffmpeg は壊さない）。スクリプトが `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` を自動検出し、`FFMPEG_BIN` 環境変数で上書きも可。
- 区切りカードの背景/SE/BGM は `assets/create-video/` の素材を参照する。欠落時は該当機能をスキップして続行する。
- `--enhance` は `libplacebo` フィルタ入りの ffmpeg（`ffmpeg-full`）と Vulkan ドライバが必要。macOS では `brew install molten-vk`（無いと `VK_ERROR_INCOMPATIBLE_DRIVER` で補正だけスキップされる）。シェーダは初回に bloc97/Anime4K の release zip（GLSL テキスト）を `cache/createVideo/tools/anime4k/glsl/` へ自動取得し、連結したプリセットを同所の `.presets/` に置く。
- 高画質DLは音量正規化・音声尺合わせの前に映像ストリーム尺をトリム期待尺と比較する（ffprobe がある場合）。250ms を超えて短ければ途中ファイルを削除して一度だけ再 DL し、再び短ければキャッシュを削除して生成を停止する。既存キャッシュの再利用時はこの DL 検査を行わない。
- 高画質DLには yt-dlp が必要。`--source cache` の音量正規化には `ffmpeg-normalize` が必要（不在時は警告して生DLを使用）。映像は copy で高画質のまま、音声のみ正規化する。サムネイルは `cache/createVideo/thumbnails/` にキャッシュする。

### 縦切り出しと分割（Shorts）

```
PATH=/opt/homebrew/bin:$PATH npm run createVideo -- --config scripts/create-video/config-shorts.json --part 1 --qc
PATH=/opt/homebrew/bin:$PATH npm run createVideo -- --config scripts/create-video/config-shorts.json --category 侍 --qc
```

- `effects.reframe` は既定 `enabled: false`。元映像の座標系でクリップ全体から等間隔に `frames`（既定3）枚を抽出し、フレームごとに選んだ顔の中心を各軸の中央値でまとめる。顔の高さの中央値（元高さ比）も `faceHeight` に残す。`detectFaceRects` / `detect_anime_face.py` を共有し、`allFaces: true` のときだけフレームごとの全候補を返す（既存のzoom・顔回避の呼び出しは最大顔のまま）。
- `pick`（既定 `largest`）は `right` なら最大顔（面積）の高さの50%以上の候補から中心xが最も右の顔を選ぶ。Shortsプリセットは全クリップで演者が右側にいるため `right`。全体設定の `x/y`（既定null、0〜1）は顔未検出時の予備位置で、両方無ければ中央。Shortsは `x: 0.92 / y: 0.72`。Detroitの右端で顔が切れるクリップをstillで確認して採用した。`python` は既定 `python3`、`cascade` は既定null。cv2入りのPythonをPATHで選び、マシン固有のパスは設定に保存しない。
- `target`（既定 `{x:0.5,y:0.45}`）は出力上の顔中心の目標位置（xは0〜1、yは0〜0.5）。倍率は **max(zoom下限, targetに顔を置いて枠が元映像内に収まる最小倍率, minFaceHeightに届く倍率)** を1〜`maxZoom`に制限する。`zoom`は既定1、`maxZoom`は既定3（ともに1〜3）、`minFaceHeight`は既定0（顔サイズによる追加ズーム無し）。顔未検出・手動位置では顔サイズ条件を使わない。Shortsは **target=(0.5,0.46)、maxZoom=1.8、minFaceHeight=0.26**。指定10クリップのstillで、前回より少し下・中央より上に顔が来ることを確認した。拡大上限1.8は維持する。
- 上限で枠が収まらなければ横だけ元映像内にクランプし、縦は顔の目標高さを守る。`fill`（既定 `blur`、`blur | black`）で縦の不足を埋める。blurは元映像全体をcoverで敷き、1/4出力サイズでboxblurして少し暗くし、拡大した背景に前景をoverlayする。blackはpad。前景は枠と元映像の重なりだけをcropし、fps → restore → CNN upscale → ASS → whipの順。`reframeFilters` が本番・still（先頭trim付きの-vf）・QCで共有され、QCと補正無効時の前景拡大はLanczos。背景と前景のfpsも揃える。旧横動画のフィルタ順は変えない。
- クリップJSONの `effects.reframe: false` で個別OFF、`{"x":0.8,"y":0.7,"zoom":1.2}` で手動焦点と倍率の下限を指定（全体OFFでも有効）。zoomのみなら検出を継承。reframe中は `effects.zoom` と `effects.avoidFace` / `telops.serif.avoidFace` を警告してスキップする。個別OFFのクリップは従来のscale+padへ戻る。
- `output.split` は既定null。`{"by":"stream","minSec":10}` で、選択・除外・並び替え・limit 後のクリップ列を**連続する**同じ videoId の塊へ分け、合計尺が minSec 未満なら次の塊を足し、短い末尾だけ直前へ寄せる。尺は各 `endTime - startTime` の和で、OP/カード/ED は含まない。離れた位置で再登場する配信は別の塊。全体が短ければ1本になる。
- `<name>-01.mp4`, `-02.mp4` …（1本だけでも `-01`）とし、render.json / youtube.txt / comment.txt / meta.json / QC も同じ連番名で各パートへ出す。自動名の基準日は選択全体の先頭で固定。`--out` のファイル名にも連番を挿入する。`--part N` は分割後の1始まり番号を選び、他パートを描画しない（split 無効・範囲外はエラー）。ffmpeg の解決は全パートを通じて1回。
- `telops.title.layout` は既定 `default`（従来のformat/singleLine）、Shortsは `date-title`。末尾の【…】/『…』をchapterLabelForの最初の置換と同じ規則で取り、タイトル最大2行＋最下行に日付YYYY/MM/DDの1行にする（帯を最下部に置くので、日付が動画の最下部に来る。ユーザー指定）。【の直前・】の直後で改行し、それぞれを20コードポイントごとに折る。2行を超えたら2行目を最大19文字＋…にする。このモードはsize/minSize/autoShrink/format/singleLineを使わず、20全角文字が内幅へ収まる最大サイズを算出する（1080幅・左右3.5%=38pxずつで48px）。`box.anchor` は既定 `top`、Shortsは **bottom**。`box.offsetY:0` はユーザー指定のまま保ち、`minHeight:0.11 / pad:8` で帯の下端を出力下端に付ける（高さ211px、上端1709px）。offsetYは指定した端からの距離で、anchor未指定の上端配置は変えない。日付を帯の1行目に置くので独立したdateは非表示。元動画時刻・進行表示も非表示。
- `telops.serif.layout` は既定 `wrap`（既存のwrapText/autoShrink）、Shortsは `space-lines`。半角スペースと手動改行のみで分け（連続区切りの空行は捨てる）、全角空白を区切りへ変換しない。同じ画面のセリフは全行を同じ大きさにする（ユーザー指定）。最も長い行が内幅に収まる大きさ（上限size）に揃え、合計行送りがmaxHeightを超えたら全行を同じだけ縮める。行の幅はlibassで描くHiraginoの実測（全角1字≈fs×0.66、`GLYPH_RATIO`）で見積もる（「1字=fs」の推定だと実際は約2/3の幅にしかならない）。minSize・自動折り返し・禁則での送り・karaokeは使わない。行ごとのDialogueでも強調記法・outlines・fadeを維持し、行サイズと位置は描画・矩形・QCで共有する。意図した行数や禁則はL0で警告せず、画面外・衝突は検査する。
- Shortsのセリフは **marginH=50/1080（各50px、内幅980px）/ size:0.5（上限960px）**、配色は config-kirinuki と同じピンク文字 FF4FA0＋白縁 9px＋紫 6B3FA0 の外縁 4px＋影 3（白＋濃紫の太縁も試したが、ユーザーの判断でこの配色に戻した）。トランジションの SE は鳴らさない（`transitions.se.enabled:false`、ホイップパンの映像は残す）。`telops.serif.faceRange`（既定enabled:false）で上端〜前髪付近に収める。Shortsは `enabled:true / top:0.02 / minHeight:0.12 / maxHeight:0.30 / fallbackBottom:0.24`。顔の枠の上端をreframeの元座標から実出力へ写し、topからそこまでの高さを12〜30%に制限する。reframeなし・顔未検出・手動焦点で顔サイズ不明のときは固定2〜24%。範囲内で上下中央に置き、合計行送りが範囲を超えると全行を同率縮小する（fitSpaceLinesの0.97の余裕は維持）。狭い範囲を最低12%に広げた場合は前髪への軽い重なりを許す。rangeを`serifOverrides`と同じく共有描画計画から渡し、`serifRange`としてセグメントとstillのJSONへ残す。描画・manifestの行別矩形・QCは同じ計画を使う。描画前のL0は未検出相当の固定範囲で検査する。
- 2026-11-01のデータで、やられ25クリップ→7本（11.01〜51.13秒）、侍73クリップ→23本（10.20〜37.54秒）。本数はクリップの追加で変わるので、`split.test.js` は本数を固定せず「漏れなく分ける・各パートが minSec 以上」だけを実データで確かめる。

### クリップごとのキーフレーム切り出し（effects.camera）

```
npm run cropVideo -- --input <mp4> --camera <keyframes.json> --aspect 9:16 --size 1080x1920 --scaler anime4k|lanczos [--out output/crop/x.mp4]
npm run cropVideo -- --clip <base> --aspect 9:16      # public/data のキーフレームと高画質キャッシュで書き出す
```

- クリップ JSON の `effects.camera` に縦横比（`"9:16"` / `"16:9"` / `"1:1"`）ごとのキーフレーム列 `[{ t, x, y, zoom, ease }]` を持つ。`t` は mp4 先頭からの秒、`x` / `y` は枠の中心（元映像の幅・高さ比）、`zoom` はその縦横比で元映像に収まる最大の枠を 1 とした倍率（1〜4）、`ease` はそのキーフレームから次までの動き（`smooth` 既定 / `linear` / `cut` = 次の時刻まで止めて切り替え）。中心は線形、倍率は対数で補間し、枠は毎フレーム元映像の内側に収める。最初より前・最後より後は端の枠のまま。ふつうは切り出しツール（crop.html）で作って保存する。
- createVideo は出力サイズの比で該当するキーフレーム列を選び、あればそのクリップでは reframe・zoom・顔回避を使わない（ログに出す）。無ければ従来どおり。`effects.camera.enabled: false` / `--no-camera` で全体を止められる。拡大方法は JSON に持たず、プリセットの `effects.enhance` に従う。
- 描画は `libplacebo` の `crop_x/y/w/h` に時刻 `t` の式を渡す（フレームごとに評価、小数位置なのでゆっくり寄ってもガタつかない。Anime4K の Upscale_CNN_x2 もそのまま効く。静的 crop との差は PSNR 75.6 dB、CNN 無しとは 35.7 dB）。式は `camera.js` の小さな AST から ffmpeg の文字列（`exprToString`）と JS の評価（`evalExpr`）を作り、`cameraRectAt`（プレビュー・QC・fallback が使う）と一致することをテストで確かめる。書き出した mp4 の各時刻のフレームは、`cameraRectAt` で求めた静的な枠と PSNR 46〜49 dB（crf18 の床）、0.1 秒ずらすと動いている区間で 15〜18 dB。
- libplacebo が使えないときは `sendcmd` で `crop` の w/h/x/y を毎フレーム変えて `scale=lanczos`（整数 px）にし、QC が `camera_fallback` を warn で出す。`sendcmd` で libplacebo の crop を変える方法は通らなかった（Filter not found）。
- 元映像の大きさは回転と SAR を考えた表示サイズ（`ffmpeg.js` の `displayVideoSize`）。ブラウザの `videoWidth` / `videoHeight` と同じ座標になる。
- 波形トリム・切り出しで先頭を切ると、切った位置と新しい末尾に補間したキーフレームを足して `t` をずらす（`shiftCamera`。`effects.zoom.at` は従来どおり補正しない）。
- `cropVideo` は任意の mp4 を同じフィルタで書き出す（fps は元のまま、h264 crf18、音声は `-map 0:a?` で aac）。`--scaler anime4k` は 720p 未満の入力にも Anime4K を掛ける。進捗は `🎬 [<pct>/100] 描画中: <name>` と `✅ 完成: <path>` で出し、設定エディタのジョブ表示がそのまま読める。1080p 7.5 秒の 9:16 書き出しは Anime4K で約 7.6 秒、Lanczos で約 4.4 秒（2026-11-01 実測）。
- render.json のセグメントに `camera`（縦横比・キーフレーム・元寸法・`backend` = libplacebo / sendcmd・fallback）が残る。QC の pHash は `-ss` を `-i` の前に置いて `t` が 0 から始まるため、式ではなく比較時刻の `cameraRectAt` で求めた静的な crop で同じ構図を作る。セリフの範囲（faceRange）は顔が分からないので固定範囲になる。

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

- 本番と同じ `planClipRender → buildAss → subtitles` を通し、1 フレームだけ PNG に焼く。reframe は既定で設定どおり適用し、顔検出・crop・Anime4K 拡大も共有する。`--part N --still '#1'` はそのパートの先頭。part 指定無しの `#N` は選択全体の順番で、番号表示・トランジションは所属パート内の条件に揃える。`--print-ass` は従来どおり検出・動画フィルタを実行しない。
- 区切りカード（`card:<base>` / `card:#N`）と OP / ED（`opening` / `ending`）も同じ考え方で、`planCardRender` と `buildCardVideoGraph` を本番（`card.js`）と共有する。背景・サムネイル・ASS の入力は本番と同一で、音声グラフだけ外す。`endcaps.*.video` に完成動画が指定されていればその動画から抜く。サムネイルはキャッシュ済みのものだけを使い、未取得なら `thumbnail_missing` を出して背景だけで描く。
- `-ss` は `-i` の後に置く。libass と zoom の PTS を本番フィルタチェーンと揃えるため。`-vf` 経路では `trim=start=<t-0.5 秒を 1/fps に切り下げ>` を本番チェーンの前に置き、それより前のフレームはデコードだけで捨てる（pts は保たれるので PNG は全フレーム処理と md5 一致。zoom punch の `filter_complex` は `setpts=PTS-STARTPTS` があるため前置しない）。
- 既定では zoom・顔回避は OFF で、テロップ位置は不変。`--zoom` `--avoid-face` で opt-in でき、顔検出が走ると +2〜3 秒ほど掛かる。
- `source: cache` のキャッシュミスでも yt-dlp は起動しない。期待パスを `source_missing` warning に出す。
- 256x144 の既存 mp4 を 1080p へ拡大する場合は `source_upscaled` を出す。
- 出力は既定で `cache/createVideo/preview/<preset>/`。単体 still は `<base>-t<sec>.png`、シートは `sheet-<n>x<cols>.png`。
- `--json` は 1 行 JSON。主要キーは `ok,out,assPath,at,requestedAt,index,total,clip,size,source,zoom,avoidFace,enhance,reframe,camera,elements,overlays,warnings,key,ms`。
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
- **L1（生成後）**… 署名と総尺、クリップ実尺とトリム期待尺の差（`clip_duration_mismatch`、`qc.thresholds.clipDurationMs` 既定 250ms。`expectedSec` の無い旧 manifest は対象外）、A/V 尺差（`probe_av_duration_gap`、`qc.thresholds.avGapMs` 既定 50ms）、音声 pts の穴（`probe_audio_pts_hole`、`qc.thresholds.audioHoleMs` 既定 10ms）、concat 経路、A/V 同期（音声相互相関）、クリップ同一性（pHash）、音量（ebur128）、無音、黒、フリーズ、テロップ焼き込み（矩形内の塗り色一致率）、概要欄の時刻。A/V 尺差と pts の穴は ffprobe だけで測れるので python 不在でも必ず効く。
- `sync_audio_drift` は出力を `-ss` で切り出して相互相関を取るため **pts を尊重した位置**を測る。サンプル列を連結し直す測り方（wav に落として numpy で切る等）では pts の穴が消えて 0 に見えるので、検証には使わない。
- 出力は `output/<name>.qc.json` と `output/<name>.qc.md`。**終了コードは error が 1 件以上で 1、warn / info のみなら 0。**
- `--contact` は各クリップの代表フレームをラベル付きで並べた `output/<name>.contact.png` を書き出す。`--review` はそれを `claude` CLI に読ませて `output/<name>.review.md` に指摘を残す。どちらも結果は info 扱いで、**合否には影響しない**（LLM の出力は非決定的なため）。
- render manifest には mp4 のサイズと SHA-256 が入る（version 2）。古い manifest が残っている場合は `manifest_stale` を error にする。検証目的で無視したいときだけ `--allow-stale-manifest` を使う。
- テロップの衝突は「不透明なボックスがあればボックス、無ければ行ごとの文字矩形」で判定する。`title` のボックスは全幅の背景バーで date と progress がその上に乗る意図的なデザインなので、判定から除く。
- ASS 出力は `scripts/create-video/__fixtures__/ass-golden.json` で固定している（3 プリセット × `public/data` 全クリップのハッシュ + 要注意 15 件の全文）。テロップ描画を意図的に変えたときは `npm run golden:ass` で更新する。`wrap-golden.json` は別物で再生成禁止。
- 音量の目標は **-23 LUFS ±2**（取り込み側の `ffmpeg-normalize` が EBU R128 / -23 LUFS で揃えるため）。YouTube 基準に寄せたい場合は `config.qc.thresholds.integratedLufsMin/Max` を変更する。
- 区切りカード・OP・ED は静止画背景で無音なため、manifest がある場合はフリーズ・無音・音量差の検査をクリップ区間だけに限定する。
- `reframe` は枠（はみ出し込みのframe）・重なりのcrop・元寸法・焦点の出所（face/manual/config/center）・顔高さ比faceHeight・pick・target・zoom・zoomReason（min/center/face size/cap）・zoomNeeded・fill（未使用null）・前景の出力矩形・fallbackを各セグメントに残す。顔未検出は `reframe_face_fallback` warn、余白使用は `reframe_fill` info。pHashは共有のreframeFiltersで同じ構図を再現する。serifRangeがある新構図では範囲下端＋2.5%より下（最小25%）〜75%を比較し、上のセリフと下のタイトルを避ける。比較余地が5%未満ならinfoでskipする。旧構図の範囲は維持する。space-linesのテロップにはlineSizes/lineRectsも残す。
- `camera` は縦横比・キーフレーム・元寸法・backend・fallback を各セグメントに残す。libplacebo が使えず sendcmd + Lanczos で切り出したクリップは `camera_fallback` warn。
- `effects.enhance` を設定したのに libplacebo 不可やシェーダ欠落で補正なしになったクリップは `enhance_fallback` を warn にする。manifest のセグメントに `enhance`（`applied` / `restore` / `upscale` / `from`、または `fallback` と `reason`）が残る。
- テロップの衝突は重なり面積比（既定 0.2）で判定する。文字矩形の幅は `charWidth` 推定で実測より広く出るため、端が触れただけでは error にしない。

注意:
- manifest が無い mp4 でも動くが、位置ズレ・クリップ抜け・焼き込み・音量差の検査は info で skip する。
- 日本語 OCR 辞書が無い環境を前提に、**文字認識には依存しない**。テロップは矩形と塗り色でのみ検証する。
- A/V 同期と pHash には python（numpy / cv2）が必要。無ければその検査だけ skip して続行する。

詳細は docs/tasks/09-10-video-qc.md を参照。

## YouTube アップロード

createVideo の mp4 と付随ファイルを非公開で上げ、サムネイルとコメントまで投稿する。公開への切り替えは Studio で手作業。

```
npm run upload -- --login                    # 初回の OAuth 認可（macOS のブラウザで開く）
npm run upload -- --video 'output/shorts/*.mp4' --dry-run
npm run upload -- --video output/0_reviewed/example.mp4
npm run upload -- --video output/0_reviewed/example.mp4 --retry-video
```

- 実装は `scripts/youtube-upload/`。認証情報は `.env.local` の `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` / `YOUTUBE_REFRESH_TOKEN` / `YOUTUBE_CHANNEL_ID`。優先順位はプロセス環境変数 > `.env.local` > `.env`。`VITE_` を付けない。Google Cloud でデスクトップアプリ用 OAuth クライアントを作り、同意画面を本番にして使う。
- `--login` は 127.0.0.1 の空きポートで OAuth（PKCE、offline、consent）を受け、認可されたチャンネルを表示する。設定済み ID と違えば token を保存しない。token 行と、未設定時のチャンネル行だけを書き換える。認証情報は端末に出さない。
- 付随ファイルは mp4 の隣 → output → output/0_reviewed。meta / youtube は必須、サムネイルとコメントは無ければ省略する。`--title` でタイトルを上書き、`--no-thumbnail` / `--no-comment` で段を省略できる。`--video` は繰り返し指定と glob に対応し、順に処理して失敗時は止まる。
- 事前検査は通信なし。タイトル 1〜100 文字・概要欄 5,000 バイト・両方の `< >`、タグ合計 500 文字（カンマと空白入りタグの引用符も含む）、サムネイル jpeg/png・50MB、manifest v2 の SHA-256、QC の error、二重アップロードを検査する。全候補の error が無い場合だけ送信する。QC は SHA が一致した manifest の隣にあるものだけ採用する。QC の error を目視で誤検出と確かめたときだけ `--allow-qc-error` で警告に下げられ、upload.json に `qcErrorAllowed: true` が残る（qc.json の形式不正は下げない）。
- 送信前にチャンネルを再確認する。`privacyStatus: private` は固定。動画は公式ライブラリの multipart 一括送信で、自動再送しない。`<name>.upload.json` に段ごとの結果とコメント ID を残し、再実行では未完了の段から再開する。送信中の中断も含め動画送信は `failed` を残すので、Studio で動画が無いことを確認してから `--retry-video`。SHA が変わったら古い動画を Studio で削除してから記録を削除する。
- プリセットの `upload.title` は `{category}` / `{title}` / `{date}` / `{serif}` / `{n}` / `{part}` / `{parts}` を createVideo が解決して meta.json に書く。100 文字超過時はセリフ、配信タイトルの順に「…」で詰める。未指定なら upload の `--title` が必要。`categoryId` は既定 `24`、`containsSyntheticMedia` は既定 false。設定エディタの「概要欄」で編集できる。`summary.maxBytes` は既定 5000 で概要欄の超過を警告する（既存の maxChars とは独立）。
- 完了後は Studio で権利の最終確認（二次創作ガイドライン・コラボ相手の条件・出典・非公式表記）、コメントのピン留め、終了画面、公開への切り替えを行う。分割コメントの 2 個目以降は先頭への返信になる。
- テストは `scripts/youtube-upload/*.test.js`。偽クライアントと一時ディレクトリだけを使い、実 API や手元の認証情報には触れない。

詳細・Google Cloud の準備・残件は docs/tasks/11-03-youtube-upload.md を参照。

## 設定エディタ（dev 専用 GUI）

`scripts/create-video/config*.json` を GUI で作成・編集・プレビュー・実行する。dev サーバ専用で、`vite build` には入らない。

```
npm run dev                 # いつもの dev サーバ
npm run editor              # /mone-button/editor.html を開く
http://localhost:5173/mone-button/editor.html?tab=preview&preset=config-mone.json
```

- 画面は `クリップ`（select の編集、files + as-listed のときドラッグ&ドロップ / Alt+↑↓ で並べ替え、「この選択を files に固定」）/ `プレビュー`（`npm run still` と同じレンダラで 1 フレーム、矩形オーバーレイ、セリフ改行の試し、`public/data に保存` と `プリセットに保存` の 2 ボタン。`OP / カード / クリップ / ED` の切り替えで区切りカードと OP/ED も見られる）/ `設定`（`config.schema.json` から生成したフォーム。明示 / 継承 / 未保存の 3 状態、× で継承に戻す、「継承項目を隠す」で差分ビュー）/ `ビルド`（`--limit` などを選んで createVideo を起動、SSE ログ、結果の動画・QC・コンタクトシート）/ `概要欄`（`.youtube.txt` / `.comment*.txt` / `meta.json` のコピー）。「＋ 新規」で `config-<name>.json` を空または複製で作る
- 設定フォームの種類は `$defs` の名前で決まる（`scripts/dev-server/lib/schema-walk.js` と `src/editor/schema-form/resolveSchema.ts` の `SPECIAL_DEFS`）。縁取りの配列（`$defs/outlines`）は 1 層 1 行の専用欄、`transitions` は「効果」タブに出る。オブジェクトの配列を新しく足すときは専用の種類を作らないと `schema walk classification` のテストが落ちる
- 保存は **`raw ∪ dirty`**（触った項目だけをファイルへ当てる）。解決済み全体や DEFAULTS からの差分は書かない。空 patch の保存は無変更。検証失敗でも保存は止めない
- 未保存の draft は `cache/createVideo/editor/<preset>.draft.json` に書き、検証（`runPreflight`）とプレビュー（`renderStill`）はそれを `--config` で読む。ビルドは保存済みプリセットで走る
- still / シートのキャッシュキーには入力ファイル（クリップ JSON・`public/videos`・高画質キャッシュ）の mtime と size が入る（`stillFileStamp`。クリップとカードはそのクリップだけ、OP / ED とシートは全件）。エディタ側の LRU もクリップの更新時刻で外すので、波形トリムや保存の後に古い画像は返らない
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
npm run shots -- --page crop --clip <base> --at 1.5   # 切り出しツール（crop.html）
```

- 実装は `scripts/ui/shots.mjs` と `scripts/ui/cdp.mjs`（Node 組み込みの WebSocket だけで CDP を話す。依存は増やさない）。
- Chrome の `--screenshot` フラグは使わない。あれは「読み込みが落ち着いた」と Chrome が判断した瞬間に 1 枚撮って終わりで、後から届く `/__cv/clips` や `/__cv/still` の結果が写らず、さらに PNG を書いた後もプロセスが終了しない。CDP で `Page.loadEventFired` の後に `--settle`（既定 2500ms）待ってから `Page.captureScreenshot` する。
- 既定はページ全体（`Page.getLayoutMetrics` の高さ）。`--viewport` でビューポートだけにできる。
- dev サーバが動いていなければ自分で `npm run dev` を起動し、撮り終えたら止める。
- 出力は `cache/ui-shots/<preset>-<tab>.png` と `<preset>-console.log`（gitignore 済み）。
- `console.error` / 例外 / `net::ERR` / `Failed to load resource` / React の `Warning:` を要注意として数える。1 枚あたり約 2.8 秒。

## 切り出しツール（crop.html、dev 専用）

任意の動画をドロップし、元映像の上の枠とキーフレームで切り出し・拡大する。dev サーバ専用で、`vite build` には入らない。

```
npm run crop                # /mone-button/crop.html を開く
http://localhost:5173/mone-button/crop.html?clip=<base>&at=1.5&aspect=9:16
```

- dev サイトからも開ける。DEV ツールバー（並び替えの下）に「切り出しツール」「設定エディタ」、クリップ編集モーダルのファイル名の下に「切り出しツールで開く」（`crop.html?clip=<base>`）があり、どちらも別タブで開く

- 画面: 左に元映像と切り出し枠（中をドラッグで移動、四隅のドラッグとホイールで倍率、外を押すとそこへ中心を移す。枠の外は暗くする）、右に完成形の目安（ブラウザの拡大）、下にタイムライン（◆ = キーフレーム、帯の色 = 区間の動き。帯を押してシーク、◆ を横にドラッグで時刻変更）、数値欄、書き出し、クリップ。縦横比 9:16 / 16:9 / 1:1 ごとにキーフレームを別に持つ
- 枠を動かす・数値を変えると、再生位置のキーフレームを書き換える（無ければその時刻に差し込む）。再生中に枠を触ると止める。キーボード: Space 再生 / K 追加 / Delete 削除 / ←→ 1 フレーム（Shift で 1 秒）/ [ ] 前後のキーフレーム
- 読み込んだ動画はすぐ object URL で表示し、裏で `POST /__cv/crop/upload` に本文のまま送る（`cache/crop/uploads/`、上限 4GB、新しい 10 本だけ残す）。ファイル名が `public/data` のクリップ名なら照合し、保存済みのキーフレームを読み込む。サーバ上に同じ大きさの元動画（高画質キャッシュ・`public/videos`）があればアップロードを省く
- 「高画質で確認」（`POST /__cv/crop/still`）は本番と同じ拡大で 1 枚だけ描く（`-ss` を `-i` の前に置き、枠は時刻で求めた静的な値。1080×1920 の Anime4K で約 1.2 秒）。「書き出す」（`POST /__cv/crop/export`）はキーフレームを `cache/crop/jobs/` に書いて `cropVideo` を走らせ、`output/crop/<名前>-<縦横比>-<日時>.mp4` に出す。ビルドと同じ JobManager を共有するので、どちらかの実行中にもう片方を始めると 409（画面で知らせる）。ログ・キャンセルは `/build/<id>/*`
- クリップと照合できたら「クリップに保存（縦横比）」で `/__data/save` に `camera: { aspect, keyframes }` を送り、`effects.camera[aspect]` だけを書き換える（`keyframes: null` で消し、空になった `camera` / `effects` も消す）。保存すると createVideo の本番・still・QC にも効く
- 元動画はブラウザに実パスを渡さず `upload:<id>` / `cache:<base>` / `public:<base>` で指す（`scripts/dev-server/lib/crop-source.js`）。`/file?kind=crop-source`（Range 対応）と `kind=crop`（書き出し結果）で配る
- プラグインは経路を先に決め、`rawBody: true` の経路（アップロード）だけ JSON の解析を飛ばして `video/*` と `application/octet-stream` を許す。loopback・Origin・Sec-Fetch の検査は他の経路と同じ
- 実装は `src/crop/`（`CropApp` / `SourceView` / `OutputPreview` / `Timeline` / `KeyframeFields` / `ExportPanel` / `ClipPanel`）と `scripts/dev-server/handlers/crop.js`。枠の計算はブラウザも `scripts/create-video/camera.js` を import して本番と同じ式を使う
- UI の確認は `npm run shots -- --page crop --clip <base> --at 1.5 --aspect 9:16`

詳細は docs/tasks/11-01-crop-camera.md を参照。

## サムネイル（thumb.html、dev 専用）

横のまとめ動画の YouTube サムネイルをブラウザの canvas で作る。1280×720。`npm run thumb`、DEV ツールバーの「サムネイル」、設定エディタの概要欄の「サムネイルを作る」から開く。本番ビルドには含めない。

- `thumb.html?base=<出力名>&template=<name>`。output直下と0_reviewed直下のmp4を選び、meta・renderを両方から探す。クリップ一覧の構築ではffprobeを呼ばない。Shortsは対象外。
- 切り抜き風3テンプレート（左タイトル / 帯とコマ / 中央と左右の顔）から始め、レイヤーを移動・拡大・回転・並べ替え・複製・非表示・ロックできる。文字・図形の追加、画像差し替え、テンプレート保存に対応。矢印1px（Shiftで10px）、Delete、⌘Z / ⌘⇧Z。右下の再生時間領域は表示切替できる。
- コマは高画質キャッシュのみ。Anime4Kを要求し、Vulkanや描画が失敗したらLanczosへ戻して画面で知らせる。最大2560×1440のRGB PNG。recipeをプロジェクトに保存するのでキャッシュ削除後も再生成できる。
- もねの透過切り抜きは94枚。rating順・種類フィルタ付き、一覧は256pxプレビュー。アップロード画像はPNG / JPEG / WebP（20MiBまで）をoutput/thumbnail-assetsに保持。
- Google Fontsの日本語OFLフォント10種を使用（太さと公式metadataの根拠はタスク文書）。各familyのCSSと実文字列のfontロードを待って描く。文字の強調はASSと同じ `{語}` / `{語|RRGGBB}`。多重縁取り、画像の白フチ・影・反転・ぼかし・明るさ、矩形のグラデーションに対応。
- 保存はmp4の隣の `<base>.thumbnail.jpg` / `.png` と `.thumbnail.json`。出力なしはoutput/thumbnailsへ。JPEGは0.92から品質を下げて2MiB以内に収め、PNGの超過はエラーにする。表示と保存は同じrenderProjectを使う。
- 実装はsrc/thumbとscripts/dev-server/handlers/thumb.js。共有形式の検証はscripts/create-video/thumbnail.js、強調解析はemphasis.js。サムネイルのAPI・kind・キャッシュはthumbnail名に統一し、従来の配信サムネイルkind=thumbとは区別する。
- POSTの画像経路だけraw MIME型を指定する。上限付き書き込みはcropと共通。一時ファイルからrenameし、容量超過・中断で既存データを壊さない。テンプレートはscripts/create-video/thumbnail-templatesのJSONでgit管理する。
- `npm run shots -- --page thumb --base <出力名> --template kirinuki-left-title,kirinuki-band-frame,kirinuki-center-duo`。描画完了のdata-readyを待つ。ハンドラ変更後はdevサーバを再起動する。
- 2026-11-02 に Chrome で確認: 3 テンプレートの表示、ドラッグ・拡大・元に戻す・文字編集・コマともねの差し替え・保存（1280×720・約 230KB。画面の canvas と構図が一致）、Anime4K のコマ抽出（2560×1440・rgb24）、Google Fonts の描画、レビュー済み出力の横への保存。
- 切り抜きは正方形で切られているので、白フチは画像の矩形の内側だけに描く（切り口に白い線を出さない）。

詳細・判断・検証残件は docs/tasks/11-02-thumbnail.md を参照。

## ドキュメント管理

- docs/draft.md - 仕様元
- docs/design-concept.md - デザイン
- docs/feature/* - 機能要件
- docs/tasks/* - 開発タスク
