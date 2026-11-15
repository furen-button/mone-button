---
name: category-video
description: もねボタンのカテゴリ（侍・異議あり・やられ など）のクリップを、侍まとめと同じ見た目の横の切り抜き風まとめ動画と縦の Shorts にし、サムネイルの下書きまで作る。「カテゴリ ○○ で動画を作りたい」「侍と同じように ○○ のまとめを」「○○ の Shorts も」「カテゴリまとめ動画」などと言われたら使う。配信 1 本（videoId）のまとめや、見た目そのものを新しく作る依頼には使わない。
---

# カテゴリまとめ動画（侍と同じ見た目）

侍まとめ（`config-samurai.json`、YouTube 公開済み）と侍の Shorts と同じ見た目で、任意カテゴリの動画を作る。
横・Shorts のプリセット作成 → L0 → 生成と QC → サムネイル下書き の順に進める。
アップロード（`npm run upload`）は外部への公開なので、ユーザーがはっきり頼んだときだけ行う。

## 0. 最初に確認すること

AskUserQuestion で次をまとめて聞く（分かっているものは聞かない）。

- カテゴリ名（`public/data/*.json` の `categories` の値そのもの）と slug（プリセット名に使う半角英小文字。例 異議あり → `igiari`）
- 形式: 横と Shorts の両方 / 横だけ / Shorts だけ
- どこまで進めるか: 生成と QC まで / サムネイル下書きまで / 非公開アップロードまで
- セリフの表記に気になる点があれば（半角カナ・半角 `!?`・5 行を超える長文など）、直すかこのまま使うか。public/data を直すと Web サイトと ASS golden も変わる
  - 半角カナはテロップで濁点が 1 字分の幅を取り、「ｲｷﾞｬｰﾘ」が「イギ ャーリ」のように間が空いて見える（異議ありで確認）。聞くときにこの見え方も添える

## 1. プリセットを作る

```
node .claude/skills/category-video/scripts/make-presets.mjs --category <カテゴリ> --slug <slug>
```

- `scripts/create-video/config-<slug>.json`（横。`config-samurai.json` の複製）と `config-shorts-<slug>.json`（Shorts。`config-shorts.json` の複製で `output.split.minSec` を侍と同じ 20 に）を書く
- 変えるのはカテゴリ・出力名（`output/<最古の配信日>-category-<カテゴリ>-kirinuki.mp4` / `output/shorts/...-shorts.mp4`）・概要欄の導入文とタグだけ。`select.exclude` は持ち込まない
- クリップ数・配信数・合計秒・未カットの件数を出す。未カット（30 秒窓のまま）が混じっていたら、生成前にユーザーに伝えて判断を仰ぐ
- 既存のプリセットは上書きしない（作り直すときは `--force`）

## 2. L0（生成前の静的検査）

```
PATH=/opt/homebrew/bin:$PATH npm run -s qc -- --preflight --config scripts/create-video/config-<slug>.json
PATH=/opt/homebrew/bin:$PATH npm run -s qc -- --preflight --config scripts/create-video/config-shorts-<slug>.json
```

- info の `static_clip_missing` は高画質キャッシュが無いだけで、生成時に DL される
- error があれば止めて報告する。warn（行数超過・禁則）は報告して続ける

## 3. 生成と QC

横を先に生成する（高画質キャッシュを DL するので、後の Shorts とサムネイルが速くなる）。どちらも `run_in_background: true` で走らせ、完了通知を待つ。

```
PATH=/opt/homebrew/bin:$PATH npm run createVideo -- --config scripts/create-video/config-<slug>.json --qc
PATH=/opt/homebrew/bin:$PATH npm run createVideo -- --config scripts/create-video/config-shorts-<slug>.json --qc
```

- `PATH=/opt/homebrew/bin:$PATH` を必ず付ける。pyenv の python3 には numpy/cv2 が無く、A/V 同期・pHash・焼き込みの検査が黙って skip される
- 高画質 DL は 1 クリップ 10〜30 秒ほど（YouTube の応答次第）。70 クリップの初回は 30 分前後かかることがある
- 結果は `output/<name>.qc.md`（Shorts は `output/shorts/<name>-NN.qc.md`）。終了コード 1 = error あり

QC の読み方（侍で判断した前例）:

- `sync_phash_mismatch` … 高コントラストのゲーム画面に大きいテロップが乗ると距離が上限 12 を超える。完成動画とキャッシュのフレームを並べて同じ場面なら誤検知
- `sync_audio_drift` … 高画質キャッシュの映像 start_time が音声より遅いと起きる。そのクリップのキャッシュを `trash/cache/<videoId>/` へ退避して再 DL・再生成する（ユーザーに確認してから）
- `frames_freeze_in_clip` … 配信の画面自体が止まっていることがある。キャッシュ元で freezedetect して同じなら問題なし
- `loudness_segment_range`（warn）… 1 秒前後の短いクリップの頭に配信切り替えの SE（`transitions.se`、volume 0.5）が重なると、そのクリップだけ 1.5〜2 LU 上がる。異議ありでは素材はどれも -23 LUFS 前後で、完成動画の差は 4.5 LU だった。SE を下げるかはユーザー判断
- 概要欄が 5000 字を超える警告 … 侍では設定を変えず、投稿時に出典を手で詰めた
- Shorts のアップロード用タイトルは、パート内の全セリフを「 / 」でつなぐ（`{serifs}`。公開済みの Shorts の付け方に合わせた）。100 文字を超えると末尾のセリフから外れるので、アップロード前に dry-run でタイトルを見せる
- 判断が要るもの（誤検知として受け入れるか、キャッシュを撮り直すか）は、止めてユーザーに聞く

## 4. サムネイル下書き（横のみ）

侍まとめのサムネイルと同じ構成のテンプレート `scripts/create-video/thumbnail-templates/category-kirinuki.json` を使う
（背景 = クリップのコマ、右寄りにもねの切り抜き、「梢桃音」「<カテゴリ>」「〜<英字>〜」「まとめ」）。

1. dev サーバを起動しておく（`npm run dev` を `run_in_background: true` で。`scripts/dev-server/**` を直した後は再起動）
2. 背景にするコマを選ぶ。候補クリップの高画質キャッシュ（`cache/createVideo/<videoId>/<base>.mp4`）から ffmpeg で数枚抜いて Read で見比べ、演者が大きく映り文字と重ならない場面を選ぶ
3. 下書きを作って保存する

```
node .claude/skills/category-video/scripts/thumb-draft.mjs \
  --base <出力名（拡張子なし）> --title <カテゴリ> --sub '〜<英字>〜' --clip <背景のクリップ base> --at <秒>
```

- 背景は Anime4K で 2560×1440 に拡大したコマ。大きい文字は字数に合わせて縮め、侍の「侍」と同じ中心に置く（`--title-size` で上書き可）
- mp4 の隣に `<base>.thumbnail.json` と `<base>.thumbnail.jpg` を保存する（`--no-save` で JSON だけ）
- 保存した JPEG を Read で確認して見せる。仕上げはユーザーが `thumb.html?base=<base>` で調整して「保存」する

## 5. アップロード（頼まれたときだけ）

- 先に `npm run upload -- --video <mp4> --dry-run` で事前検査とタイトルを見せる。Shorts は glob（`'output/shorts/<name>-*.mp4'`）でまとめて渡せる
- 概要欄が 5,000 バイトを超えたら、侍・異議ありと同じく `▼出典` の節をセリフの見出しなしの URL だけにする。元は `<name>.youtube.txt.bak` に残す
- QC の error を目視で誤検知と確かめ、ユーザーが了承したら `--allow-qc-error` を付ける
- 非公開の動画にはコメントできない（`commentThreads.insert` が HTTP 403 forbidden）。Shorts は `--no-comment` で上げる。横の固定コメントは、Studio で公開に切り替えてから同じコマンドを再実行して投稿する（upload は未完了の段から再開する）
- 10 本前後を続けて上げると HTTP 400 で止まったことがある。止まったら翌日に同じコマンドで続きから上げる

## 6. 報告とあと片付け

- 出力ファイル、総尺、Shorts の本数、QC の error / warn と判断が要る点、サムネイルの画像を報告する
- 新しいプリセット（`config-<slug>.json` / `config-shorts-<slug>.json`）はコミット候補。コミットはユーザーに頼まれてから
- プリセットを増やしても ASS golden（固定 3 プリセット）は変わらない。public/data を直したときだけ `npm run golden:ass` が要る
- 背景で dev サーバを起動したら止める
