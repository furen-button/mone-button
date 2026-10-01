# createVideo 設定エディタ（dev 専用 GUI）

## 目的

`scripts/create-video/config*.json` を GUI で作成・編集・プレビュー・実行できるようにする。これまでは VSCode で JSON を手書きし、結果を見る手段がフル書き出し（#1 総集編で約 8 分）しかなかった。テロップの見え方は [静止画プレビュー CLI](09-11-still-preview.md) と同じレンダラで 1 フレームだけ焼いて確認し、`select.files` の並べ替えはドラッグ&ドロップで行う。

レンダラが Hiragino Sans + libass で macOS に縛られているため、**ローカルの dev サーバ専用**にする。ホスティングすると改行位置が変わる。

## 入口

```
npm run dev            # いつもの dev サーバ
npm run editor         # /mone-button/editor.html を開く
http://localhost:5173/mone-button/editor.html?tab=preview&preset=config-mone.json
```

`?tab=`（clips / preview / settings / build / summary）、`?preset=`、`?job=`（実行中ジョブへの再接続）は sessionStorage より優先する。`vite build` の入力は `index.html` だけなので `editor.html` と `src/editor/**` は dist に入らない（`main.tsx` でも `import.meta.env.DEV` 以外では throw する）。

## 構成

| 領域 | ファイル | 役割 |
|---|---|---|
| Vite プラグイン | `plugins/vite-plugin-create-video.ts` | `/__cv/*` を遅延 import したハンドラへ委譲する約 180 行のアダプタ。json / stream（Range）/ SSE の 3 形態を `ServerResponse` へ落とす。dev サーバ close で実行中ジョブを止める |
| 共通 HTTP | `plugins/lib/dev-http.ts` | `readBody`（1 MiB 上限）/ `sendJson` / `assertLocalRequest`。既存 `vite-plugin-data-editor.ts` も同じガードを通す |
| ガード | `scripts/dev-server/lib/guards.js` | ループバック・Origin・`Sec-Fetch-Site`・Content-Type、プリセット名 / 出力名 / クリップ base の検証、`__proto__` 等の禁止キー |
| 書き戻し | `scripts/dev-server/lib/patch.js` | `raw ∪ dirty`（set / unset）、`__meta` / `titleOverride` の除去、2 スペース + 末尾改行のシリアライズ |
| scratch | `scripts/dev-server/lib/scratch.js` | 未保存 draft を `cache/createVideo/editor/<preset>.draft.json` に原子的に書く。検証・プレビューはこれを `--config` で読む |
| ハンドラ | `scripts/dev-server/handlers/{presets,validate,clips,still,jobs,files}.js` | 下記 API。素の関数 `(req) => Promise<HandlerResult>` で、将来 `node:http` 単体でも使える |
| ジョブ | `scripts/dev-server/handlers/jobs.js` + `lib/log-parser.js` + `lib/build-options.js` | createVideo / qc の spawn、絵文字行の進捗解釈、allowlist → argv 変換、SSE リングバッファ |
| UI | `editor.html`, `src/editor/**` | React 19。`state/presetStore.ts`（raw + patch → draft / resolved）、`schema-form/**`（スキーマ駆動フォーム）、`panels/**`（5 画面 + 新規作成）、`hooks/**`（preflight / clips / still / build SSE） |

## API（`/__cv/*`、dev サーバ専用）

| Method / Path | 内容 |
|---|---|
| `GET /schema` | `config.schema.json`、`DEFAULTS`、`ALIGN` |
| `GET /presets` / `GET /preset?name=` | 一覧 / `{ raw, text, hash, resolved, validation }` |
| `POST /preset` | `{ mode: 'update', name, ifMatch, patch }` / `{ mode: 'create', name, base, patch }`。409 / 412 |
| `POST /validate` | `{ name, draft }` → scratch → `loadConfig` → `runPreflight`（L0、ffmpeg 不要）。`selectError` は別枠 |
| `POST /clips` | `{ draft }` → `collectClips` の順 + カタログ（全クリップ・カテゴリ・配信） |
| `POST /still` / `POST /sheet` | `{ name, draft, kind, clipBase, at, title, serifOverride, zoom }` → PNG + `X-Still-Meta`（矩形・warnings）。`kind` は `clip`（既定）/ `card` / `opening` / `ending` で、前 2 つは `clipBase` 必須。入力の sha1 でキャッシュ、同時 2 本 |
| `POST /build` / `POST /qc` | `{ name, options }` / `{ name, video, contact }` → ジョブ開始（同時 1 本、409） |
| `GET /jobs`, `GET /jobs/:id`, `GET /build/:id/log`（SSE）, `POST /build/:id/cancel` | ジョブ状態・ログ・中断 |
| `GET /file?kind=&name=` | mp4（Range 対応）/ contact / render / qc-json / qc-md / youtube / comment / meta / log / thumb / still / sheet |
| `GET /outputs` / `GET /result?name=` | `output/*.mp4` の一覧 / QC・概要欄・meta・render 要約 |

## 保存の意味論

- プリセットは **`raw ∪ dirty`** で書く。ファイルを verbatim に読み、フォームが触ったパスだけ `set` / `unset` を当てて書き戻す。解決済みツリー全体を書くと今日の DEFAULTS が凍結され、DEFAULTS からの最小差分にすると手書きの意図が消えるため。配列は丸ごと置換（`deepMerge` と同じ）
- 書式は `JSON.stringify(obj, null, 2)` + 末尾改行に固定する。元ファイルの書式（1 行配列、`3.0` のような小数表記）は保たないので、追跡中のプリセットは同じ書式で揃えておく。`patch.test.js` が `scripts/create-video/config*.json` 全件を空 patch で書き戻して元テキストと突き合わせるため、ずれれば `npm test` が落ちる
- 検証失敗でも保存は止めない。`config.json` 自体が単体では invalid（videoId 無し）で、CLI フラグで補完される前提
- **セリフ = `public/data`（既存 `/__data/save`）、タイトル上書き = プリセットの `telops.title.overrides`**。プレビュー画面の保存ボタン 2 つがこの粒度に対応する
- 新規作成は `config-<name>.json` のみ（`.vscode/settings.json` のスキーマ紐付けに一致）。空 `{}` は全項目が DEFAULTS を継承する正当なプリセット

## ガード

| 経路 | ガード |
|---|---|
| すべて | ループバック以外 403、`Origin` の host 不一致 403、`Sec-Fetch-Site: cross-site` 403、POST の非 JSON 415、body 1 MiB |
| `POST /preset` | `^config(-[a-z0-9][a-z0-9-]{0,40})?\.json$`、`dirname` 一致、update は既存のみ、create は `config.json` 不可、`ifMatch`、禁止キー、`patch.set ≤ 500` |
| `/still` `/sheet` `/validate` `/clips` | draft の禁止キー、clipBase は `public/data` に実在、`title ≤ 200` / `serifOverride ≤ 500` |
| `/build` `/qc` | options は allowlist（`lib/build-options.js`）。生 argv は受けない。`--out` は basename のみ |
| `GET /file` | kind ごとに基底ディレクトリと拡張子を固定、`..` と区切り文字を拒否、`lstat` でディレクトリ・シンボリックリンクを拒否 |
| 子プロセス | `spawn` は配列 argv・`shell: false`・`detached: true`。cancel / dev サーバ close / SIGINT でグループごと SIGTERM → 5 秒後 SIGKILL |

## 検証結果（2026-09-11）

- `npm test` 159 件 pass（guards / patch / log-parser / build-options / schema-walk / presets / validate / clips / files / jobs）。`tsc -b`、`eslint src/editor plugins scripts/dev-server` ともにクリーン。`npm run build` の dist に `editor.html` も `__cv` も含まれない
- curl のガード: Origin 不一致 403 / `Sec-Fetch-Site: cross-site` 403 / `text/plain` 415 / `../evil.json` 400 / `__proto__` 400 / 同名 create 409 / `ifMatch` 不一致 412 / `kind=mp4&name=../../package.json` 400。全プリセットの空 patch 保存で `git diff` は空
- `/validate`: `config-matome-01.json` は 99 クリップ・warn 1・約 43 ms。videoId 欠落は `validation.ok=false`、不明 files は `selectError`
- `/still`: 既定プリセットで 1 枚目 1.9 秒（cold）、同じ要求はキャッシュで 2 ms。`serifOverride` の改行が 2 行の矩形に反映。`clipBase: ../x` は 400
- `/build`（`--limit 2 --no-cards --no-avoid-face`）: SSE に started 1 / progress 2 / stage 6 / log 575 / done 1。`concat-vcopy`、sidecar（render / youtube / meta / comment）。二重起動は 409。`/qc --contact` ジョブで `.qc.json` / `.qc.md` / `.contact.png` が生成され `/result` に反映。mp4 は `Range: bytes=0-99` で 206。終了後に子プロセスは残らない
- headless Chrome（`--headless=new --screenshot`）で 5 タブを実データで描画し、コンソールエラーなし。ビルドタブは `?job=` で実行中ジョブに接続し、ログ・段階・QC 集計・結果の `<video>` が表示された。`--qc` 付きビルドは L0 の `static_telop_collision`（既定プリセットの time と serif）で止まり、GUI 側も同じ error を事前にバッジ表示していた

## 注意・未実装

- ハンドラは `vite.config.ts` の依存に入れないため遅延 import している。`scripts/dev-server/**` や `scripts/create-video/**` を編集したら dev サーバを手動再起動する（`r` + Enter）
- Vite は Ctrl-C（SIGINT）を捕まえないので、ジョブ実行中だけ SIGINT ハンドラを登録して子プロセスを止める。残った場合は `pkill -f create-video/index.js`
- カード / OP / ED の静止画プレビューは 2026-09-12 に対応（`planCardRender` / `buildCardVideoGraph` を本番と共有）。プレビュー画面の `OP / カード / クリップ / ED` で切り替える。詳細は [静止画プレビュー CLI](09-11-still-preview.md)
- ブラウザ操作の自動テストは無い（node:test はサーバ側のみ）。実機確認は `npm run shots`（`scripts/ui/shots.mjs`）のスクリーンショットで行う。`?tab=` / `?preset=` / `?job=` / `?kind=` で初期状態を指定できる
- 実装は Codex へ委任して進めたが、Phase 4b の途中でクレジット切れになり、以降（クリップ / プレビュー / ビルド / 結果 / 概要欄 / 新規作成 / docs）は Claude が実装した
