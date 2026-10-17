# 波形の選択範囲を別クリップに切り出す

## 仕様

dev サイトの「クリップ編集」モーダルで、「この範囲で切る」の隣に「この範囲を別クリップに切り出す」を配置する。波形の読み込み完了後、選択が元の範囲から 0.01 秒以上変化し、選択の長さが 0.3 秒以上で、トリム・切り出しの処理中でないときに押せる。処理中は両方のボタンを無効にする。元クリップを書き換える「この範囲で切る」と押し間違えないよう、切り出しボタンは紫の枠線だけのボタン（`.clip-trim-save.is-outline`）にする。

`POST /__data/excerpt` に `{ fileBaseName, keepStart, keepEnd }` を送り、現在の mp4 内の相対秒を切り出す。ローカルリクエスト限定で、入力・範囲検証はトリムと共通。元 mp4 がなければ 404。成功時は 200 `{ fileBaseName: targetBaseName, created }` を返す。

- 出力は `public/data/<targetBaseName>.json` と `public/videos/<targetBaseName>.mp4`。元の JSON・mp4・`cache/createVideo` の高画質キャッシュは変更・退避しない。
- 新しい絶対区間は元 JSON の `trimming.startTime + keepStart/keepEnd`。ファイル名は extract.js と同じ `<YYYY-MM-DD>-<videoId>-<pad6(floor(startTime))>-<pad6(floor(endTime))>`。pad6 は `String(n).padStart(6, '0')`。
- 日付は元ファイル名先頭の `YYYY-MM-DD-` を優先し、なければ `videoFile.metadata.uploadDate`（YYYYMMDD）を使う。どちらもなければ 400。videoId は `/^[\w-]+$/` で検証する。
- 元と同名になる場合は 409。同名 JSON または mp4 が既にある場合も 409 `同じ区間のクリップが既にあります: <targetBaseName>` で止め、上書きしない。並行リクエストの同じ出力も拒否する。
- serif / ruby / categories / memo などは保存済みの元 JSON からコピーする。モーダル内の未保存の入力は対象外。`clipUrl` の `t=` と `trimming.startTime/endTime/duration` を更新し、`trimming.original` は既存値を維持する。なければ元 JSON の区間を入れる。
- `effects.zoom.at` はクリップ先頭からの秒だが、そのままコピーする。既存トリムと同じ扱いで、切り出した区間への時刻補正はしない。
- ffmpeg の引数は既存トリムと共通（libx264 / yuv420p / veryfast / crf28、aac / 96k / 44100Hz / stereo、AUDIO_RESAMPLE、+faststart）。一時 mp4 のエンコード完了後に出力先へ rename し、JSON を書く。JSON の書き込みに失敗したら今回作成した mp4 を削除する。
- 成功時は `切り出しました: <targetBaseName>.json` を表示し、元クリップの state と選択範囲を維持する。onSaved は呼ばない。別の範囲を選べば、同じ元クリップから続けて切り出せる。失敗はトリムと共通の場所・スタイルで表示する。
- public/data の追加は Vite HMR で一覧に反映する。切り出しでも ASS golden が変わるため、意図した変更なら `npm run golden:ass` で更新する。

## 自動確認

1. `node --test scripts/dev-server/lib/trim.test.js`：既存トリムの挙動、新しいファイル名（切り捨て・ゼロ埋め・ハイフン入り videoId）、フィールド保持、元データ不変、URL・original、日付フォールバック、入力・範囲検証、元と同名の 409。
2. `npm test`：全テスト。ユーザーの未追跡 public/data により ASS golden が 1 件失敗する既知の状態では、fixture を変更せず他の失敗がないことを確認する。
3. `npm run lint` と `npx tsc -b`。

## 手動確認手順

実データを変更しない検証用コピーの環境で行う。

1. 元 JSON・mp4・高画質キャッシュのハッシュを控え、dev サイトで編集モーダルを開く。
2. 範囲を変更する前は切り出しが無効、変更後は有効になることを確認する。
3. 切り出し中はトリム・切り出しの両方が無効であることを確認する。
4. 成功メッセージ、選択範囲とモーダルの維持、新しいクリップの一覧追加を確認する。出力名・JSON の区間・字幕等・mp4 の再生範囲を確認する。
5. 同じ範囲を再度送ると 409 になり、既存出力が変わらないことを確認する。JSON だけ／mp4 だけ既存の場合も確認する。
6. 別の範囲を選んで再度切り出し、2 個のクリップが作成され、元 JSON・mp4・高画質キャッシュのハッシュが不変であることを確認する。
7. 元 mp4 不在の 404、元と同じファイル名になる範囲の 409 を確認する。
8. 一時環境で JSON 書き込み失敗を発生させ、今回の mp4 が削除され、元ファイルが変わらないことを確認する。

## 検証結果（2026-10-17）

- `node --test scripts/dev-server/lib/*.test.js` は 43 件すべて成功。`npm run lint` と `npx tsc -b` も成功。`npm test` で失敗するのは、未追跡の `public/data` による既知の ASS golden 1 件だけ。
- dev サーバ上で `2024-06-22-eguxJoekMyM-000306-000311`（5.01 秒）を使い、API を直接呼んで確認した。
  - 0.0–2.2 秒を切り出すと `…-000306-000308`、2.9–5.0 秒を切り出すと `…-000309-000311` ができた。mp4 はそれぞれ 2.200 / 2.100 秒、h264 256x144、aac 44100Hz stereo。`clipUrl` の `t=` は 306s / 309s、`trimming.original` には元の区間が入り、それ以外のフィールドは元と同じ
  - 同じ範囲をもう一度送ると 409、元と同じファイル名になる範囲（0.5–4.9 秒）も 409、範囲外は 400
  - 元の JSON と mp4 の md5 は切り出しの前後で変わらない
- headless Chrome でモーダルを操作し、末尾 − を押して 0.00–2.22 を選んで切り出したあと、同じモーダルのまま 2.90–5.01 に選び直して 2 つ目を切り出せた。ページはリロードされず（HMR で更新）、一覧は 823 → 825 件に増え、コンソールエラーは無い。
- 確認で作ったクリップは削除し、`public/data` と `public/videos` は確認前の状態に戻した。

注意: dev サーバを起動したまま「同じ名前のファイルを作る → 消す → また作る」を繰り返したとき、1 度だけ HMR ではなくページ全体がリロードされ、編集モーダルが閉じた（再起動後は再現しなかった）。データは保存済みなので、リロードされた場合はモーダルを開き直せばよい。
