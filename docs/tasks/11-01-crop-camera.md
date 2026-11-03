# 切り出しツール（crop.html）とクリップごとのキーフレーム切り出し（2026-11-01）

ブランチ `feat/crop-camera`（`feat/create-video-shorts` から分岐）。実装済み・コミット済み。

## 背景と決まったこと

effects.reframe（Shorts の縦切り出し）と effects.zoom（横動画のパンチイン）は全体設定なら設定エディタで変えられたが、クリップごとの枠は GUI から決めることも保存することもできなかった（`/__data/save` は serif / ruby / memo / categories / review だけを許し、`effects` を持つクリップは 0 件）。

ユーザーへの確認で次のように決めた。

- 新しい dev 専用ページ `crop.html` を作る。任意の動画をドラッグ＆ドロップで読み込める
- 元映像の上の枠をドラッグして位置と倍率を決める。数値欄でも直せる
- キーフレームで枠を動かす。区間ごとに 滑らか（既定）/ 一定速度 / カット を選べる
- 縦横比は 9:16 / 16:9 / 1:1。拡大は Anime4K が既定で、Lanczos も選べる
- 出力は 2 通り。どの動画でも mp4 を書き出せる。public/data のクリップならキーフレームを JSON に保存し、createVideo（本番・still・QC）にも反映する

## データ形式

```json
"effects": {
  "camera": {
    "9:16": [
      { "t": 0,   "x": 0.75, "y": 0.55, "zoom": 1.0, "ease": "smooth" },
      { "t": 3,   "x": 0.80, "y": 0.50, "zoom": 1.8, "ease": "cut" },
      { "t": 6,   "x": 0.40, "y": 0.50, "zoom": 1.2, "ease": "linear" },
      { "t": 9,   "x": 0.60, "y": 0.45, "zoom": 1.5 }
    ]
  }
}
```

- `t` は mp4 先頭からの秒、`x` / `y` は枠の中心（元映像の幅・高さ比）、`zoom` はその縦横比で元映像に収まる最大の枠を 1 とした倍率（1〜4）
- `ease` はそのキーフレームから次までの動き。`cut` は次の時刻まで止めておき、そこで切り替える
- 中心は線形、倍率は対数で補間する。枠は毎フレーム元映像の内側に収める（はみ出さないので fill は要らない）
- 拡大方法は JSON に持たない。createVideo ではプリセットの `effects.enhance` に従い、画面の Anime4K / Lanczos は書き出しにだけ効く

## 実装

### createVideo（`scripts/create-video/camera.js` / `camera-render.js`）

- `camera.js` はブラウザとも共有する純関数（`normalizeCamera` / `aspectKey` / `baseRect` / `cameraFrameAt` / `cameraRectAt` / `cameraExprAst` / `exprToString` / `evalExpr` / `shiftCamera` / `applyCameraPatch`）。tsconfig に allowJs が無いので `camera.d.ts` を手で書いた
- `planCamera` は出力の縦横比のキーフレームが無ければ ffprobe より前に null を返す。効いたら `planClipRender` で reframe・zoom・顔回避を null にする（有効だったものだけログに出す）
- `cameraFilters` は `scale`（SAR を寸法へ） → `fps` → （補正ありなら）restore → `libplacebo=w:h:crop_*='式'` に Anime4K の upscale シェーダ（補正なしなら `upscaler=ewa_lanczossharp`）→ `setsar=1`。libplacebo が使えるかは `ffmpegLibplaceboStatus` で直接見る。使えなければ workDir に毎フレームの `sendcmd` を書いて `crop` + `scale=lanczos`
- `probeVideoStream` / still の probe は回転と SAR を考えた表示サイズを返す（`displayVideoSize`）
- still は同じ `planClipRender` を通る。`normalizePlans` に `camera: true`、`--print-ass` 用の `normalizeAssPlans` に `camera: false`。`source_upscaled` に camera の分岐を足した
- QC: manifest に `camera`、`camera_fallback` warn。pHash は時刻で求めた静的な crop で同じ構図を作り、比較範囲は `reframeCompareCrop` を camera にも使う（`reframe?.target` で落ちないよう直した）
- 波形トリム・切り出し（`scripts/dev-server/lib/trim.js`）は `shiftCamera(keyframes, keepStart, keepEnd - keepStart)` で境界に補間したキーフレームを足してずらす。何も切らないトリムでは変えない
- `effects.camera.enabled`（既定 true）と `--camera` / `--no-camera`
- `crop-export.js`（`npm run cropVideo`）は任意の mp4 を同じフィルタで書き出す。Anime4K は `exportEnhance` で enhance を有効にし、クリップ上書き `{}` で 720p 未満の入力にも掛ける

### dev サーバ（`scripts/dev-server/handlers/crop.js`）

- `POST /crop/upload`（rawBody）・`GET /crop/clip/<base>`・`POST /crop/still`・`POST /crop/export`
- プラグインは経路を先に決め、`rawBody` の経路だけ JSON の解析を飛ばし、`checkLocalRequest` の `allowContentTypes` で `video/*` と `application/octet-stream` を許す
- 元動画は `upload:<id>` / `cache:<base>` / `public:<base>` で指し、`/file?kind=crop-source` で Range 付きで配る。書き出し結果は `kind=crop`
- `createHandlers` で JobManager を 1 つ作り、ビルドと切り出しで共有する
- クリップへの保存は `/__data/save` が `camera: { aspect, keyframes | null }` を受け、`applyCameraPatch` を通す

### 画面（`crop.html` + `src/crop/`）

- `CropApp`（状態・読み込み・キーボード）、`SourceView`（動画 + 枠の canvas。ホイールは非 passive のネイティブリスナー）、`OutputPreview`、`Timeline`、`KeyframeFields`、`ExportPanel`、`ClipPanel`
- 再生位置のキーフレームを「選択中」とみなす（選択状態を別に持たない）。枠や数値を変えると、そこにキーフレームが無ければ差し込む
- `?clip=<base>&at=<秒>&aspect=<a>` で開ける。`npm run shots -- --page crop --clip <base> --at <秒> --aspect <a>` で撮れる
- dev サイトの DEV ツールバーに「切り出しツール」「設定エディタ」、クリップ編集モーダルに「切り出しツールで開く」のリンクを置いた（別タブ）

### ついでに直した既存の不具合

- 設定エディタの still / シートのキャッシュキーにクリップ JSON や mp4 の変更が入っておらず、波形トリムや保存の後に古い画像が返っていた。`stillFileStamp`（入力ファイルの mtime と size）をサーバのキーに入れ、エディタの LRU もクリップの更新時刻で外す（別コミット）

## 検証

- `PATH=/opt/homebrew/bin:$PATH npm test`: 336 件成功（失敗・skip 0）。ASS / wrap golden は変更なし
- `npx tsc -b` 成功。追加・変更した TS の ESLint は成功（既存の `src/editor/schema-form/EditorContext.tsx` の react-refresh エラー 1 件は今回の変更前からある）
- libplacebo の時刻式と JS の一致: キーフレーム 4 つ（smooth / cut / linear）で書き出した mp4 の 1.5 / 2.95 / 3.5 / 6.0 / 7.2 秒のフレームを、`cameraRectAt` で求めた静的な crop と比べて PSNR 46.6〜48.7 dB。0.1 秒ずらした枠とは動く区間で 15.5〜18.3 dB（カットの保持区間は同じ値）
- Anime4K と Lanczos の等倍比較で、Anime4K は文字やフリルの線がはっきりした。1080p・7.5 秒の 9:16 書き出しは Anime4K で 7.6 秒、Lanczos で 4.4 秒
- still（config-shorts、`effects.camera` を一時的に足したクリップ）で、滑らかに寄る途中とカット後の 1.8 倍が描けた。テロップは Shorts の配置のまま
- dev サーバ: アップロード（`text/plain` は 415、`Sec-Fetch-Site: cross-site` は 403、`/crop/export` は `video/mp4` を 415）、照合、Range 206、still（Anime4K・libplacebo・1.2 秒）、書き出しジョブ（進捗 100/100 と outPath）、`/__data/save` の保存・不正値 400・削除（削除後の JSON は元と同一）
- 画面（headless Chrome + CDP）: クリップを開く → 枠のドラッグでキーフレーム → 2.5 秒でホイール → 5 秒で K → 2.5 秒の区間をカット → 3.75 秒で倍率が保たれる → 高画質で確認。別に、日本語・括弧・空白入りのファイル名の縦動画（1080×1920）を選んでアップロード → 16:9 に切り出し → Lanczos で書き出し（1920×1080・7.5 秒）。コンソールのエラー 0

## 制限・残件

- `sendcmd` の fallback（libplacebo 無し）は Codex の環境で書き出しが通ることだけ確認した。ローカルは Vulkan があるので本経路で確認している
- 回転メタデータ付きのスマホ動画は実機で通していない（`displayVideoSize` の単体テストのみ）
- `createVideo --qc` で camera 付きクリップを含む動画を通しで作る確認はしていない（still と書き出しで描画経路は確認済み）
- トリム後の smooth 補間は、境界の位置は保つが元の速度曲線（smoothstep の途中から）までは保たない
- 編集中のキーフレームはブラウザに保存しない。クリップに保存するか書き出す前にページを閉じると消える

## 変更ファイル

- createVideo: `scripts/create-video/camera.js` / `camera.d.ts` / `camera-render.js` / `crop-export.js`（新規）、`clip.js`、`preview.js`、`ffmpeg.js`、`config.js`、`config.schema.json`、`qc/manifest.js`、`qc/checks/probe.js`、`qc/checks/sync.js`
- dev サーバ: `scripts/dev-server/handlers/crop.js` / `lib/crop-source.js`（新規）、`handlers/index.js` / `index.d.ts` / `jobs.js` / `files.js` / `still.js` / `clips.js` / `validate.js`、`lib/guards.js` / `guards.d.ts`、`lib/trim.js`、`plugins/vite-plugin-create-video.ts`、`plugins/vite-plugin-data-editor.ts`、`plugins/lib/dev-http.ts`
- 画面: `crop.html`、`src/crop/*`（新規）、`src/editor/types.ts`、`src/editor/panels/PreviewPanel.tsx`、`scripts/ui/shots.mjs`
- テスト: `camera.test.js` / `camera-integration.test.js`（新規）、`handlers/crop.test.js` / `handlers/still.test.js`（新規）、`config.test.js`、`trim.test.js`、`guards.test.js`、`schema-walk.test.js`
