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

## 残件

- ホイールでの拡大は 1 ノッチごとに履歴が 1 件増える（⌘Z で 1 ノッチずつ戻る）
- アップロード画像は一覧に入るだけで、配置には一覧の画像を押す必要がある
- Shorts（縦）用のサムネイルは対象外
- `public/face-focus/`（197MB）は `public/` 配下なので `vite build` で dist に入る（以前からの状態）
