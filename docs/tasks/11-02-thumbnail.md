# まとめ動画のサムネイル（thumb.html）実装結果

## 状態

2026-11-02: 実装・検証済み。ブランチ `feat/thumbnail`（`feat/crop-camera` から分岐）。実装は Codex（dev サーバを起動できない環境）、Chrome での実機確認・見た目の手直し・新規ファイルの整形（Prettier）はその後に行った。

## 実装したこと

- `npm run thumb` で開く dev 専用ページ。通常の Vite 本番ビルドのエントリには追加していない。DEV ツールバーと設定エディタの概要欄からも開ける。
- 1280×720 の canvas で表示・書き出しを共通化。文字、コマ、透過切り抜き、アップロード画像、矩形を重ねる。
- 強調記法 `{語}` / `{語|RRGGBB}` は `emphasis.js` を ASS と共有。手動改行、字間、行送り、揃え、回転、内側から累積する多重縁取りに対応。
- 画像の cover / 自由配置、倍率、反転、透明度、ぼかし、明るさ、24方向のアルファシルエットによるフチ、影。矩形は単色 / 線形グラデーション / 角丸。
- クリック選択、ドラッグ、四隅で倍率、上の丸で回転、非 passive ホイール、中央8px吸着。矢印1px / Shiftで10px、Delete、⌘Z / ⌘⇧Z。操作中の入力欄はキーを奪わず、ポインタ操作は1回の履歴にまとめる（50件）。
- レイヤーの前後移動、表示、ロック、複製、削除。右下の再生時間表示の目安は切り替え可能。
- 切り抜き94枚を種類別・rating順で表示。原寸の代わりにサーバ生成256pxプレビューを一覧に使用。画像アップロードの MIME 型を明示。
- テンプレート3種を追加。`kirinuki-left-title` / `kirinuki-band-frame` / `kirinuki-center-duo`。作成した配置もテンプレートとして保存可能。
- `?base=<出力名>&template=<name>` に対応。出力選択時に保存済みプロジェクトを優先し、空の frame slot には利用可能な先頭クリップの中ほどを自動で入れる。recipe 付きコマは再オープン時にサーバで確認・再生成する。
- JPEG は品質0.92から始め、2MiBを超えれば0.1ずつ下げる。PNG は2MiB超をエラーにする。プロジェクトJSONと画像は別APIで保存する。

## API とファイル

`/__cv/thumbnail/` 以下:

| method / path | 用途 |
|---|---|
| GET outputs | output直下と0_reviewed直下のmp4一覧（Shortsは除外） |
| GET context?name= | meta・renderを両ディレクトリから解決、クリップ重複除去、タイトル候補、既存プロジェクト |
| GET assets | 切り抜き・256pxプレビュー・アップロード画像・テンプレート |
| POST frame | `{ source: 'cache:<base>', at, upscale: 'none' / 'anime4k' }` |
| POST image?name= | PNG / JPEG / WebP、raw body、20MiBまで |
| POST project | `{ target, project }` |
| POST save?target=&format=jpg\|png | JPEG / PNG、raw body、2MiBまで |
| GET templates / POST template | 一覧 / `{ name, template }` 保存 |

- 出力を選んだ場合はmp4の隣に `<base>.thumbnail.jpg` / `.png` / `.json`。レビュー済み出力もmp4の置き場に保存する。
- 出力なしのtargetは `name:<保存名>`。`output/thumbnails/` に保存する。
- `thumbnailPathsFor` が命名の正本。`files.js` と `jobs.js` のsidecars、エディタの型に `thumbnail` を追加した。
- 素材は `frame:<sha1>` / `image:<32桁hex>` / `face:<kind>/<file>`。画像は `output/thumbnail-assets/` に保持、コマは `cache/thumbnail/frames/`、プレビューは `cache/thumbnail/previews/`。
- `/__cv/file?kind=thumbnail-asset&name=<参照>` と `kind=thumbnail-out&name=<target>` で取得。thumbnail-outのPNG取得は `index=1`、既定はJPEG。
- テンプレートは `scripts/create-video/thumbnail-templates/`。名前は `^[a-z0-9][a-z0-9-]{0,40}$`。slotのsrcとrecipe、face以外のsrcを拒否する。
- 保存する型・座標・数値範囲・色・フォントの太さ・参照・80レイヤー上限をNodeとブラウザで同じ関数で検証する。
- raw bodyの許可型を経路ごとに指定。loopback / Origin / Sec-Fetchガードは保持。共有の上限付き書き込みは一時ファイルに書き、成功後にrenameする。容量超過・中断で既存ファイルを壊さない。保存先は親を含めシンボリックリンクを拒否。
- ハンドラは遅延importのため、変更後はdevサーバの再起動が必要。

## フォントの確認

2026-11-02、Google Fonts公式リポジトリの `ofl/<family>/METADATA.pb` でlicense・japanese subset・weightを確認した。全10種がOFLで、未確認による除外はない。Noto Sans JPは可変軸100〜900から100刻みをUIで使用。CSSはfamilyごとに1本、確認済みの太さだけを要求する。CSSロード後に実際の文字列で `document.fonts.load` し、空の結果も失敗扱いにする。

| family | 使用する太さ | license / 確認資料 |
|---|---|---|
| Dela Gothic One | 400 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/delagothicone/METADATA.pb) |
| Mochiy Pop One | 400 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/mochiypopone/METADATA.pb) |
| M PLUS Rounded 1c | 100,300,400,500,700,800,900 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/mplusrounded1c/METADATA.pb) |
| RocknRoll One | 400 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/rocknrollone/METADATA.pb) |
| Reggae One | 400 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/reggaeone/METADATA.pb) |
| Rampart One | 400 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/rampartone/METADATA.pb) |
| Potta One | 400 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/pottaone/METADATA.pb) |
| Zen Maru Gothic | 300,400,500,700,900 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/zenmarugothic/METADATA.pb) |
| Noto Sans JP | 100〜900（100刻み） | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/METADATA.pb) |
| Kaisei Decol | 400,500,700 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/kaiseidecol/METADATA.pb) |

2026-11-16、汎用のゴシック体を 8 種足した。上と同じく `ofl/<family>/METADATA.pb` で license（全て OFL）・japanese subset・weight を確認した。M PLUS 2 と Murecho は可変軸 100〜900 から 100 刻みを使う。Kosugi は `apache/`（Apache License 2.0）にあるので、OFL だけの方針に合わせて入れていない。M PLUS 1 は M PLUS 1p とほぼ同じ字形なので 1p だけにした。Google Fonts 以外のフォント（源暎・モボ/モガ・闘龍・勘亭流・ホラー体）も規約を調べたが、ユーザーの判断で Google Fonts だけにした。

| family | 使用する太さ | license / 確認資料 |
|---|---|---|
| M PLUS 1p | 100,300,400,500,700,800,900 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/mplus1p/METADATA.pb) |
| M PLUS 2 | 100〜900（100刻み） | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/mplus2/METADATA.pb) |
| Zen Kaku Gothic New | 300,400,500,700,900 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/zenkakugothicnew/METADATA.pb) |
| Zen Kaku Gothic Antique | 300,400,500,700,900 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/zenkakugothicantique/METADATA.pb) |
| BIZ UDPGothic | 400,700 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/bizudpgothic/METADATA.pb) |
| Murecho | 100〜900（100刻み） | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/murecho/METADATA.pb) |
| IBM Plex Sans JP | 100,200,300,400,500,600,700 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsansjp/METADATA.pb) |
| Sawarabi Gothic | 400 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/sawarabigothic/METADATA.pb) |

同日、バラエティのテロップ向きを 8 種足した（確認方法は同じ、全て OFL・japanese subset あり）。収録する漢字は google/fonts の TTF の cmap（format 4 / 12）を読んで数えた（css2 の unicode-range は範囲でまとめて書かれるので、字の有無の判定には使えない。最初はそれで見積もって数を誤った）。Darumadrop One・Rock 3D はかなと英数字だけで漢字が無く（全角の「！」も無い）、Chokokutai も漢字は 1 字だけ。漢字はブラウザの代替フォントで描かれて見た目が混ざるので、かなや数字の見出し（「ガハハ」「204」など）に使う。Mochiy Pop P One は既存の Mochiy Pop One の字間を詰めた版なので入れていない。Zen Tokyo Zoo は japanese subset が無いので対象外。

| family | 使用する太さ | 漢字（cmap） | license / 確認資料 |
|---|---|---|---|
| Train One | 400 | 2,966 字 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/trainone/METADATA.pb) |
| Hachi Maru Pop | 400 | 6,682 字 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/hachimarupop/METADATA.pb) |
| Yusei Magic | 400 | 6,687 字 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/yuseimagic/METADATA.pb) |
| Kaisei Tokumin | 400,500,700,800 | 6,713 字 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/kaiseitokumin/METADATA.pb) |
| Yuji Boku | 400 | 6,746 字 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/yujiboku/METADATA.pb) |
| Darumadrop One | 400 | 0 字（かな・英数字のみ） | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/darumadropone/METADATA.pb) |
| Rock 3D | 400 | 0 字（かな・英数字のみ） | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/rock3d/METADATA.pb) |
| Chokokutai | 400 | 1 字 | OFL / [公式metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/chokokutai/METADATA.pb) |

## 検証結果

- `PATH=/opt/homebrew/bin:$PATH npm test`: **347件成功、失敗0、skip0**。ASS / wrapのgoldenは変更なし。
- `npx tsc -b`: 成功。
- 変更したTS / TSXと追加した型定義のESLint: エラー0・警告0。
- `git diff --check`: 成功。
- テストで確認: normalizeProject・templateの参照制限・slot適用・初期テンプレート、レビュー済み出力のsidecar解決、contextの重複除去とタイトル優先順、素材rating・プレビュー再利用、保存先と名前、2MiB / 20MiB超過、シンボリックリンク拒否、書き込み中断・abortの後始末、RGBフィルタ・GPU描画失敗時のLanczos再試行。
- 実ファイルを使い、HTTPを介さずハンドラを直接呼んで確認:
  - output / 0_reviewedから計22出力を取得。
  - `2024-07-13-category-やられ-matome`: 22クリップ、すべて高画質キャッシュあり、タイトルは `{やられ}集`。
  - `2024-07-13-category-やられ-kirinuki`: レビュー済みとして一覧に出る。25クリップ、すべて高画質キャッシュあり、タイトルは `{やられ}集`。
  - 切り抜き94枚（通常47・衣装36・3D11）の256pxプレビューを生成。3テンプレートを読み込める。
  - 指定の `2025-05-02-01W-2BtWTq0-005752-005812.mp4` の3秒を約855msで抽出。ffprobeで **2560×1440 / rgb24** を確認し、画像を目視した。
  - resolveFfmpegはffmpeg-fullを検出。Vulkanの実測は `VK_ERROR_INCOMPATIBLE_DRIVER`。**Anime4K成功とは扱わず、Lanczos fallbackが返ることを確認した。**

## 判断したこと

- 上限は既存アップロードと同じ1024基準（MiB）で実装した。
- 最大80レイヤー、縁取り8層、画像4000万画素までとした。大きな画像のデコード負荷を抑える。
- 初期の顔はrating順の先頭をslotに入れる。コマは高画質キャッシュが使える先頭クリップを選ぶ。
- テンプレート切り替えは配置を初期化し、選択中の出力からタイトル・素材を入れ直す。既存プロジェクトの読み込みは出力選択時を優先する（URLでtemplateを明示した場合はそのテンプレートを優先）。
- テンプレート保存時はslotのsrcとrecipe、アップロード画像などの一時的な参照を取り除く。slotなしのface参照は保持する。
- Anime4Kの復元と拡大はともにRGB24用フィルタを組む。利用不可だけでなく実描画失敗時もLanczosへ再試行し、その旨を返す。
- 仕様末尾の `11-01-thumbnail.md` はファイル名の不一致と判断し、依頼で指定されたこの `11-02-thumbnail.md` を結果文書として更新した。

## フォントを見本付きで選ぶ（2026-11-16）

- プロパティ欄のフォントの select を、見本付きの一覧 `src/thumb/FontPicker.tsx` に置き換えた。種類（ゴシック / 丸ゴシック / 太字・見出し / 手書き・筆 / 明朝。未定義は「その他」）と「かな・英数字のみ」の注記は `src/thumb/fonts.ts` に持つ。
- 各項目は、選んでいる文字の層の本文（強調記法を外し、改行を空白にした先頭 12 字。空なら「梢桃音 ガハハ 204」）をそのフォントと切り替え後の太さで描く。一覧は高さ 320px 程度でスクロールし、種類の見出しは sticky。開いたときに選択中の項目まで一覧の中だけをスクロールする。
- 乗せる（mouseenter）・フォーカスで、初回に編集の `start`、以降 `move` でキャンバスに即反映（履歴に積まない）。クリック・Enter・Space は `move` → `end` で履歴 1 回。一覧から外れる・フォーカスが外へ出る・Esc は、確定済みの値へ `move` → `end`（同じ状態なので履歴は増えない）。マウスで乗せただけではフォーカスが一覧に無いので、Esc はプレビュー中だけ window で受ける。レイヤーの切り替え・ロックでは元に戻して終える。
- フォントを替えたときの太さは、今の太さがあればそのまま、無ければ一番近いもの（同じ距離なら小さい方）。以前は一律 400 に戻していた。
- 素材パネルの「フォント」タブも family 名をそのフォントで描く。
- 確認（Chrome・CDP の実マウス・キー操作）: 26 種が 5 種類に分かれて出る、3 種に注記、Train One に乗せるとキャンバスが変わり確定表示は元のまま、一覧の外で元に戻る、Esc で元に戻る、クリックで確定し一覧から出ても戻らない、⌘Z 1 回で確定前に戻る。`npx tsc -b`・`npx eslint src/thumb`・サムネイル関連のテスト 37 件が通る。

## Chrome での実機確認（2026-11-02、ローカル・Vulkan あり）

- 別ポートの dev サーバ（5199）で `thumb.html?base=2024-07-13-category-やられ-matome&template=…` を CDP で操作した。3 テンプレートとも 0.3〜2.8 秒で `data-ready` になり、コンソールのエラー 0
- テンプレート → 文字のドラッグ（x 70→130・y 300→345）→ ホイールで拡大（140→187px）→ ⌘Z で 1 段戻る → 文字の書き換え → 保存。保存した JPEG は 1280×720・229KB。画面の canvas を書き出した PNG との PSNR は 34.5 dB（ブラウザの JPEG 0.92 の圧縮分。4px ずらすと 14.6 dB）で、構図は同じ
- 素材パネル: 3 番目のクリップを 1.0 秒にシークして「このコマを使う」でコマが差し替わった。もねのタブから別の切り抜きに差し替わった。PNG のアップロードは一覧に入る（押すと配置）
- コマ抽出は Anime4K（libplacebo）が効いた（`applied: true`、2560×1440・rgb24、1 枚 3〜4MB）
- Google Fonts の Dela Gothic One が読み込まれて描かれた
- レビュー済みの出力 `2024-07-13-category-やられ-kirinuki` は一覧に「（レビュー済み）」で出て、保存先は mp4 のある `output/0_reviewed/`
- `SHOTS_BASE_URL=http://localhost:5199 npm run shots -- --page thumb --base 2024-07-13-category-やられ-matome --template kirinuki-left-title,kirinuki-band-frame,kirinuki-center-duo --strict` で 3 枚撮れた（コンソール要注意 0）

### 実機確認のあとで直したこと

- 保存形式の選択欄が全幅に伸びて「保存」ボタンが別の行に落ちていた → ラベルの中の select だけ幅いっぱいにした
- もねの切り抜きは正方形で切られているので、白フチが切り口（画像の端で体が切れている所）にも白い線を出していた → 縁取りを画像の矩形の内側だけに描く
- 素材パネルが狭く「フォント」のタブ名が折り返していた → パネルを 300px にし、タブ名を折り返さない
- レイヤー一覧の名前が slot の英語（frame / face）だった → 背景のコマ / もね / 図形 / タイトル

## 文字色のグラデーション（2026-11-17）

- 文字の層に任意の `gradient: { type: 'linear', from, to, angle, scope }` を追加した。`color` は単色用として保持する。共有の `normalizeProject` で検証し、テンプレートでも使用できる。省略値は開始色 `#FFFFFF`、終了色はその層の `color`、角度 0、範囲 `line`。角度は -360〜360、範囲は `line` / `block` のみ。
- 本文の強調以外の字を CanvasGradient で塗る。強調色・個別指定色・縁取りは単色のまま。矩形と同じく、中心から sin / cos で端点を取り、0 度は上→下、90 度は左→右。
- `setupText` は `textBaseline = 'middle'`、`textAlign = 'left'`。行ごとの横範囲は揃えを反映した行の開始 X と行幅、縦範囲は描画 Y ± 文字サイズ / 2 とした。行送りの余白は含めない。全体の横範囲は `layerBox` の最長行と同じ、縦範囲は先頭行の字の上端〜最終行の字の下端（高さは `(行数 - 1) × 文字サイズ × 行送り + 文字サイズ`）。選択枠の `layerBox` 自体は変更しない。
- 文字色の「グラデーション」をオンにすると開始色・終了色・角度・範囲（行ごと / 全体）を表示し、単色の欄を隠す。初期値は白→現在の文字色、角度 0、行ごと。現在色の RGB 各成分が 240 以上なら白に近いと判定し、終了色を `#FF4FA0` にする。
- オフは既存の edit に `{ gradient: undefined }` を渡す。patch のマージ後は通常編集・move とも必ず正規化され、`gradient !== undefined` の場合だけ出力するため、状態と保存 JSON からキーが消える。編集基盤の変更は不要。gradient のない既存データにはキーを追加しない。
- 確認結果: `npx tsc -b`、`npx eslint src/thumb` は成功。`node --test scripts/create-video/thumbnail.test.js scripts/dev-server/handlers/thumb.test.js` は **13 件成功、失敗 0**。既定値・明示値・不正値拒否・テンプレート適用・旧形式の完全な出力・undefined patch によるキー削除を確認した。同梱 5 テンプレートは通常 / template 両モードで変更前の正規化結果と JSON が完全一致した。
- Chrome での確認（別ポートの dev サーバ・CDP、保存は押さない）: 「ダジャレ」の層を 2 行（ダジャレ / 大連発）にして、オンでキャンバスが変わる、開始色・終了色・角度・範囲が出て文字色の欄が隠れる、範囲の既定は行ごと、全体に切り替えると描画が変わる（1 行目が白寄り・2 行目が色寄り）、角度 90 で左→右になる、オフで単色の描画と完全に一致する、強調だけの層（`{200}`）は掛けても描画が変わらない、の 10 項目が通った。npm test 全体は実行していない（public/data に作業中のクリップがあり ASS golden が変わるため）。

## 残件

- ホイールでの拡大は 1 ノッチごとに履歴が 1 件増える（⌘Z で 1 ノッチずつ戻る）
- アップロード画像は一覧に入るだけで、配置には一覧の画像を押す必要がある
- Shorts（縦）用のサムネイルは対象外
- `public/face-focus/`（197MB）は `public/` 配下なので `vite build` で dist に入る（以前からの状態）
