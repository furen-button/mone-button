# dev サイトの要対応バッジ（未ダウンロード・未カット・ルビ・区切り）

## 背景

youtube-clip-tool から取り込んだ直後のクリップは、ライブチャットの盛り上がりを中心にした 30 秒の窓のままで、
serif と ruby がチャットの文言（例: `ｲｷﾞｬｰﾘ！`）のコピーになっている。mp4 も `npm run download` を
走らせるまで無い。1000 件を超える一覧の中で、どれがまだ手を入れていないクリップかを dev サイト上で
見分けられるようにする。

## 仕様

### 判定（`scripts/dev-server/lib/clip-review.js`）

Node の API に依存しない純粋な規則として 1 か所に置き、ブラウザ（カードのバッジ・DEV ツールバー・
編集モーダル）と dev サーバ（保存時の `review` の正規化・トリム）で同じ関数を使う。型は
`clip-review.d.ts`。

| 種類 | 表示 | 条件 |
|---|---|---|
| `video` | 📥 未DL | `public/videos/<base>.mp4` が無い。一覧は `GET /__data/status` で取る。未取得（undefined）のあいだは判定しない |
| `trim` | ✂️ 未カット | `trimming.original` が無く、`trimming.duration` が 30 秒（±0.05）。30 秒は youtube-clip-tool の「現在位置 ±15 秒を範囲にする」の窓。波形トリム（trim.js）は必ず `original` を残すので、切ってあれば外れる。youtube-clip-tool 側で範囲を手で決めたクリップは 30 秒ちょうどにならないので対象外 |
| `ruby` | 🔤 ルビ | 空、または toRuby（transcribe.js）が出力しない字種を含む。許す字種はひらがな（`ぁ`〜`ゖ`・`ゝゞ`）・長音 `ー`・`\p{Number}`・`\p{Script=Latin}`。カタカナ・半角カナ・漢字・記号・空白は要対応 |
| `serif` | ␣ 区切り | 半角スペース無しで 15 字（半角 0.5 字）を超える区間がある。数え方は SerifSpacingPreview と同じで、絵文字と強調記法の記号は数えず、改行も区切りとして扱う |

`reviewClip(data, { hasVideo })` が `{ issues, acknowledged }` を返す。`issues` は表示順（video → trim → ruby → serif）。
serif は JSON の生の値（改行・強調記法入り）で判定する。一覧側では `VoiceClip.rawSerif` を渡す。

### データ: `review`（任意）

「このままで良い」と人が判断したことを JSON に残す。

```json
"review": {
  "trim": true,
  "ruby": "ｲｷﾞｬｰﾘ！",
  "serif": "およめさんにしてくださいおよめさんにしてください"
}
```

- `trim: true` … 30 秒の窓のままで良い。波形で切ると（`original` が付くと）意味を失うので trim.js が落とす
- `ruby` / `serif` … 確認したときの値。今の値と違えば確認は無効（判定に戻る）
- `video` は記録できない（ファイルの有無なので）
- 保存（`POST /__data/save`）は `review` を受け取り、`normalizeReview` で今の値と合わないもの・切り終えた `trim`・未知のキーを落とし、何も残らなければキーごと消す。`review` を送らない保存でも既存の `review` を同じ規則で整える
- extract.js は `review` を書かない。取り込み直後は常に未確認

### サーバ（`plugins/vite-plugin-data-editor.ts`）

- `GET /__data/status` → `{ videos: string[] }`。`public/videos` の `*.mp4` の拡張子なしの一覧。ダウンロード中の `<base>_temp.mp4` とトリムの一時ファイル `<base>.mp4.trim-*.mp4` は除く。`Cache-Control: no-store`。ループバック以外は従来どおり 403
- `POST /__data/save` の payload に `review` を追加

### 画面

- **カード**（`VoiceList`）: 要対応があれば下段にチップを並べる。チップの title に理由と対処が出る。mp4 が無いカードは枠を赤の破線、背景を斜めの縞にする
- **DEV ツールバー**（`DevReviewToolbar`、並び替えの下）: 「要対応 N / 全件」と種類ごとの件数。件数はカテゴリで絞る前の全クリップ。種類を押すと絞り込み（複数可）、「要対応のみ」で全種類。**絞り込み中はカテゴリの選択を無視**して、その種類の要対応をすべて見せる（カテゴリで隠れて件数と合わないのを避ける）。動画一覧の取得前は未DL の件数を「…」にする
- **編集モーダル**（`ClipReviewPanel`、ヘッダーの直下）: 入力中の serif / ruby と `review` の state から判定して並べる。trim / ruby / serif には「このままで良い」があり、押すと `review` の state に入る（保存するまで JSON には書かない。「保存で確定」と出す）。記録済みは「✓ 種類 このままで良いと記録済み [取り消す]」。すべて無ければ「✓ 要対応はありません」
- 動画が無いクリップでは、波形トリムが fetch せずに `npm run download` の案内を出し、「🎤 文字起こし」を無効にする（既存の 404 でも同じ案内）
- mp4 の一覧は起動時、タブに戻ったとき（`focus` / `visibilitychange`）、編集モーダルを閉じたとき、削除したときに取り直す（`useDevVideoStatus`）。別ターミナルで `npm run download` したあとはタブに戻れば反映される
- 本番ビルドでは `enableDevEditor` が false なので判定・取得・ツールバーのどれも動かない

## 自動確認

1. `node --test scripts/dev-server/lib/clip-review.test.js` … 字種の判定、長い区間（半角 0.5 字・改行・強調記法・絵文字）、30 秒窓の判定、`normalizeReview`、`reviewClip` の順序と確認済みの扱い、件数の集計
2. `node --test scripts/dev-server/lib/trim.test.js` … 切ったあとに `review.trim` が落ち、ruby / serif の確認は残る
3. `npm test`、`npm run lint`、`npx tsc -b`

## 手動確認手順

1. `npm run dev` を起動し、一覧の並び替えの下に DEV ツールバーが出ること、件数が `public/data` の実態と合うことを見る
2. 「📥 未DL」を押すと mp4 の無いクリップだけになり、カードが赤の破線になること。`npm run download` を別ターミナルで走らせてタブに戻ると件数が減ること
3. 「✂️ 未カット」のクリップを開き、波形で切ると要対応パネルから未カットが消えること
4. 「🔤 ルビ」のクリップで「serif から読みを作る」を押すとルビの要対応が消えること。「このままで良い」→ 保存で JSON に `review.ruby` が入り、ruby を変えて保存すると消えること
5. 本番ビルド（`npm run build && npm run preview`）ではバッジもツールバーも出ないこと

## 検証結果（2026-10-30）

- `node --test scripts/dev-server/lib/clip-review.test.js scripts/dev-server/lib/trim.test.js` は 31 件すべて成功。`npx tsc -b`、`npm run lint`、`npm run build` も成功。`npm test` で失敗するのは、未追跡の `public/data` 99 件による既知の ASS golden 1 件だけ（HEAD のクリーンなワークツリーでは通る。進行表示の「N/全件」が全クリップの ASS に効くため、クリップが増えると既存クリップのハッシュも変わる）。
- 別ポート（5199）で dev サーバを立て、headless Chrome（CDP）で操作して確認した。データは変更していない（モーダルで「このままで良い」を押したあと保存せずに閉じた。保存 API は一時的に複製したクリップで試し、終了後に削除した）。
  - `GET /__data/status` は 988 件の mp4 を返し、`Origin` がループバックでないと 403
  - DEV ツールバーは「要対応 118 / 1004 件」、未DL 16 / 未カット 77 / ルビ 95 / 区切り 28。「要対応のみ」で一覧は 370 → 118 枚、「未DL」で 16 枚（すべて赤の破線と縞）
  - 未DL のクリップのモーダルは、要対応パネルに 3 件、波形トリムに `npm run download` の案内、「🎤 文字起こし」は無効。「このままで良い」（未カット）を押すと「✓ 未カット このままで良いと記録（保存で確定） 取り消す」に変わる
  - 動画のある未カットのクリップは「残す範囲 0.00–30.00 / 30.00 秒」で、要対応は未カットとルビの 2 件。要対応の無いクリップは「✓ 要対応はありません」
  - 保存 API に `{ review: { trim: true, ruby: "<今の値>", serif: "<違う値>", bogus: 1 } }` を送ると `{ trim: true, ruby }` だけが残り、続けて ruby を変えて保存すると `{ trim: true }` になった
  - コンソールに error は無い
- 本番ビルドの bundle に `dev-review-toolbar` / `clip-edit-review` は含まれない（DevReviewToolbar と ClipReviewPanel は tree-shake される）。`clip-review.js` の判定関数と VoiceList のバッジ描画の分岐は数 KB だけ残るが、`reviews` が undefined なので動かない。

## 追加（2026-10-31）: 半角の ! ? の全角化と、編集モーダルの削除

### 半角の ! ?

- 区切りプレビュー（`SerifSpacingPreview`）で、半角の `!` `?` を赤く囲って示す。全角の文に混ざると細く詰まって見えるため
- 1 個以上あれば「半角の ! ? が N 個あります。[！？ 全角にする]」を出す。押すと serif の state の半角 `!` `?` だけを全角 `！` `？` に置き換える。保存まで JSON には書かない
- 置き換えと数え方は `clip-review.js` の `toFullwidthPunctuation` / `countHalfwidthPunctuation`。改行・強調記法・ほかの半角文字は変えない
- 全角は 1 字、半角は 0.5 字で数えるので、置き換えると区切りの字数が増え、「区切り」の警告が新たに出ることがある
- 要対応バッジの種類には入れていない

### 削除

- 編集モーダルのフッター左（保存から遠い位置）に「🗑 削除」を置く。1 回目で赤く塗った「もう一度押すと削除」に変わり、4 秒押さなければ戻る。2 回目で `POST /__data/delete` を呼ぶ
- 情報モーダルの削除と同じ `handleClipDelete`（App）を使う。json と mp4 を `trash/` へ退避し、一覧から外し、そのクリップの情報モーダルと編集モーダルを閉じ、mp4 の一覧を取り直す
- 保存・文字起こし・読み生成の実行中は押せない。失敗したらモーダルを閉じずに「⚠ 削除に失敗しました: …」を出す

### 検証結果

- `clip-review.test.js` に全角化のテストを足して 17 件成功。`npx tsc -b` と `npm run lint` も成功
- 別ポートの dev サーバで、既存クリップから複製した一時クリップ（serif `削除テスト!? ほんと!`）を headless Chrome で操作した
  - プレビューで 3 個が強調され、「全角にする」で textarea が `削除テスト！？ ほんと！` になり、強調と案内が消えた
  - 削除は 1 回目で「もう一度押すと削除」、4.5 秒後に「🗑 削除」へ戻り、2 回続けて押すとモーダルが閉じてカードが消えた。json と mp4 は `trash/` に移り、複製元のクリップは md5 が変わらなかった
  - コンソールに error は無い。確認後、一時クリップの trash の 2 ファイルを削除した
