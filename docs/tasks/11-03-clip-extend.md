# 波形トリムで範囲を広げる

## 仕様

dev サイトの「クリップ編集」モーダルの波形トリムに「前 +20 秒」「後ろ +20 秒」を置く。手元の mp4 は切った範囲しか持たないので、押すたびに JSON の範囲を広げて YouTube から取り直し、mp4 と JSON を置き換える。広げすぎた分は、取り直し後の波形で従来の「この範囲で切る」を使って詰める。広げる量は 20 秒固定（ユーザー指定）。

`POST /__data/extend` に `{ fileBaseName, extendStart, extendEnd }`（秒。0〜60、どちらかは正）を送る。ローカルリクエスト限定。成功時は 200 `{ updated, moved, addedStart, addedEnd }`。

- 新しい範囲は `startTime - extendStart` と `endTime + extendEnd`。配信の先頭（0 秒）と `videoFile.metadata.duration` を超える分は切り詰め、どちらにも広がらなければ 400。画面のボタンも、先頭が 0 秒・末尾が配信の尺に達していれば無効にする。
- 取り直しは `scripts/download.js` の 1 区間モード（`--video-id <id> --start <秒> --end <秒> --out <mp4>`）を子プロセスで走らせる。`npm run download` と同じ yt-dlp の区間 DL・尺検査・1 回の再 DL・ffmpeg-normalize（200p / crf28）を通る。download.js は execFileSync で yt-dlp を待つため、dev サーバを止めないよう子プロセスにしている。
- 取り直し先は `cache/clip-extend/<base>-<pid>-<時刻>.mp4`。`public/` に置くと途中で止まったファイルが build に混ざるので避ける。取り直しに失敗したら JSON・mp4・高画質キャッシュは何も変えず、子プロセスの出力の最後のエラー行を返す。
- 成功したら JSON を読み直して範囲を当て直す（取り直しの間に保存された serif などを消さない）。範囲が取り直し前と変わっていたら 409 で捨てる。旧 mp4 は `trash/videos`、高画質キャッシュは `trash/cache/<videoId>` へ退避し、新しい mp4 を `public/videos/<base>.mp4` に置いてから JSON を書く。同じクリップへの並行リクエストは 409。
- JSON はトリムと同じ `createRangeData` で作る。`clipUrl` の `t=` と `trimming.startTime/endTime/duration` を更新し、`trimming.original` は既存値を維持する（無ければ広げる前の範囲を入れる）。`effects.camera` は広げた分だけキーフレームを後ろへずらし、広げた区間は端の枠で埋める（`shiftCamera` に負のずれを渡す）。`effects.zoom.at` は既存トリムと同じく補正しない。`review` はトリムと同じく `normalizeReview` で整える。
- ファイル名は変えない（トリムと同じ）。ASS golden は `public/data` 全体を見ているので、意図どおりなら `npm run golden:ass` で更新する。
- 画面は取り直し中「YouTube から取り直し中…（数十秒かかります）」を出し、トリム・切り出し・拡張のボタンを無効にする。成功すると「前を 20.00 秒広げました。」を出し、波形を読み直す（選択は新しい全範囲）。
- 従来は波形を読み直すたびに結果表示を消していたため、「切り直しました。」も一瞬で消えていた。結果表示はクリップが替わったときだけ消すようにした。

## 自動確認

1. `node --test scripts/dev-server/lib/trim.test.js`：先頭・末尾の拡張、original の維持、0 秒とメタデータの尺での切り詰め、広がらないときの 400、payload と videoId の検証、camera のずらし。
2. `node --test scripts/download.test.js`：1 区間モードの引数（無ければ従来の一括 DL、不正な値は日本語のエラー）。
3. `npm test`、`npm run lint`、`npx tsc -b`。

## 検証結果（2026-11-03）

- 上記のテストと lint・型チェックは成功。`npm test` で失敗するのは、取り込み中の未追跡 `public/data`（`2024-11-28-O3kaWzTJW_s-*`）による ASS golden 1 件だけ。
- `node scripts/download.js --video-id eguxJoekMyM --start 68.1 --end 92.15 --out <一時パス>` で 24.10 秒・256x144 の mp4 ができ、`_temp` と `.part` は残らなかった（約 31 秒）。
- 別ポートの dev サーバで、`2024-06-22-eguxJoekMyM-000088-000092` を複製した使い捨てクリップに `extendStart: 20` を送った。範囲は 88.11–92.15 → 68.11–92.15、`original` に元の範囲、`clipUrl` は `t=68s`、serif は不変、mp4 は 24.10 秒、旧 mp4 は `trash/videos` へ移った。YouTube の応答が遅く 2 分 45 秒かかった。確認後に複製と退避ファイルは消した。
- ユーザーが dev サイトで実データ 2 件を広げ、`2025-03-11-4D7qYRHKTPg-005304-005339` は末尾 +20 秒で JSON 24.81 秒・mp4 24.90 秒になった。
