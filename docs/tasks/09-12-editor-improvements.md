# 設定エディタの改善（棚卸しと不具合対応）

## 目的

`feat/config-gui` で一気に作った設定エディタ（dev 専用 GUI。UI 5,861 行 + dev サーバ 2,759 行、15 コミット）は機能が一通り揃った一方で、「使ってみて分かる摩擦」が未整理だった。改善余地を一度に洗い出して固定し、まず不具合から潰す。

詳細の設計・API は [設定エディタ](09-11-config-editor.md) を参照。このドキュメントはその後続で、棚卸しの結果と対応状況を持つ。

## 調査方法

- `src/editor/**` と `scripts/dev-server/**` の実読み
- `cache/ui-shots/`（`npm run shots` で 2026-09-12 に撮影した 5 タブ）の実画面
- `docs/tasks/09-11-config-editor.md` の「注意・未実装」

## 確認した現状（問題なし）

- コンソールエラー・警告 0（`cache/ui-shots/*-console.log` 5 タブ分）
- `config.schema.json` の 255 フィールドすべてがフォームで編集可能。`unknown` 分類は 0 件で `schema-walk.test.js` が保証している
- プレビューは 250ms デバウンス + `AbortController` で、中断時はサーバ側 ffmpeg も止まる
- 保存は `raw ∪ dirty`。空 patch なら 1 バイトも変わらないことを `patch.test.js` が全プリセットで担保
- ガード（ループバック / Origin / トラバーサル / 禁止キー / allowlist）はサーバ側 47 ケースでテスト済み

## 不具合

いずれも「編集したものが消える」系。コード読解で特定し、実機で再現を確認してから直す。

| # | 症状 | 原因 | 対象 |
|---|---|---|---|
| P1 | プレビューの「プリセットに保存」で、タイトル上書きが保存されず textarea の入力も消える | `context.setValue(...)` を dispatch した直後に、その時点のレンダーの `patch` を閉じ込めた `handleSave` を同期呼び出ししている。保存成功後の `dispatch({type:'saved'})` が patch を空に戻すため、入れた値は保存されずに消える | `panels/PreviewPanel.tsx:137-148`, `EditorApp.tsx:202-223` |
| P2 | `stringList` の textarea に改行が打てない | `onChange` ごとに `split('\n').map(trim).filter(Boolean)` して値へ反映し、表示を `items.join('\n')` から作り直すため、改行を打った瞬間に空行が落ちる。実質「追加」ボタン専用になっている。`select.categories` / `select.exclude` / `summary.tags` など 6 箇所が該当 | `schema-form/fields/StringListField.tsx:42` |
| P3 | `stringMap` のキーを消して打ち直そうとすると行ごと消える | `setRows` が `key.trim()` の空行を落とすため、キーを全消しした瞬間に値ごと消える。`telops.title.overrides` と `summary.chapters.labels` が該当 | `schema-form/fields/StringMapField.tsx:16-18` |
| P4 | 「保存しました」「エラー」の帯が消えない | `status` を idle に戻す経路が無い（`SummaryPanel` のコピー通知だけ 2 秒で消える） | `EditorApp.tsx:214, 360-361` |

### 対応（2026-09-13 完了）

- P1 … `handleSave` が追加 patch を受け取れるようにし、プレビュー側は `setValue` を経由せずタイトル上書きの set / unset を直接渡す。保存が成功したときだけ入力欄を空にする。マージは `presetStore.mergePatchPayloads`（追加 patch が後勝ち）
- P2 … 表示用の生テキストをローカル state に持ち、確定値を作るときだけ空行を除く。**blur は待たず入力のたびに確定する**（textarea にフォーカスしたまま ⌘S を押すと、window の keydown では blur が起きず打った内容が保存されないため）。blur では表示を確定値に揃える
- P3 … 空キーの行も編集中は保持し、`setValue` に渡すオブジェクトを作るときだけ除く。キー重複は後勝ち
- P4 … 保存通知は 3 秒で消す。**エラーは自動では消さず × で閉じる**（読み逃すと原因が分からなくなるため）

検証: `npm test` 165 件 pass / `tsc -b` / ESLint クリーン / `npm run shots --strict` 5 枚・コンソール要注意 0 件。ブラウザでの手動操作確認は未実施。

## 改善案の棚卸し

優先度は付けない。着手のたびにここから選び、済んだものに印を付ける。

### A. 保存・変更管理

| # | 現状 | 改善案 | 対象 |
|---|---|---|---|
| A1 | 変更量は「n 件」バッジだけで、保存前に何がどう変わるか見えない | バッジクリックで変更パス一覧（before → after）。`patchPayloadFromState` が path/value を持ち、before は `raw` から引ける | `EditorApp.tsx:329`, `state/presetStore.ts:58` |
| A2 | undo / redo が無い | reducer に patch 履歴スタックを足して ⌘Z / ⌘⇧Z | `state/presetStore.ts:29` |
| A3 | `FieldFrame` の × は「継承に戻す（unset）」で「編集前の値に戻す」ではない。個別の取り消しは再読込（全破棄）しかない | dirty のとき × とは別に「元に戻す」を出し分ける | `schema-form/FieldFrame.tsx:56-66` |
| A4 | 「変更をまとめて破棄」ボタンが無い。`presetStore` の `discard` アクションが定義されているが未接続 | `discard` を UI に繋ぐ | `state/presetStore.ts:19,45` |
| A5 | 離脱警告が無い。patch は sessionStorage にあるのでリロードは耐えるが、タブを閉じると失われる | dirty > 0 のとき `beforeunload` | `EditorApp.tsx:196-200` |
| A6 | 意図しない dirty 化が起きやすい。`SizeField` の %/px トグルは `Math.round` を通るので往復で誤差が乗り、`ColorField` はピッカーを開いた瞬間に setValue する | トグルは表示単位だけ変える / ピッカーは確定時のみ反映 | `fields/SizeField.tsx:29-39`, `fields/ColorField.tsx:22-26` |
| A7 | draft がプリセット名ごとに 1 ファイルなので、同じプリセットを 2 タブで開くと上書きし合う | セッション ID をファイル名に含める | `scripts/dev-server/lib/scratch.js:7-19` |

### B. 設定タブ

| # | 現状 | 改善案 | 対象 |
|---|---|---|---|
| B1 | 8 サブタブ × 255 フィールドに対し検索が無い | フィールド名・description の横断検索 → ヒットへジャンプ | `panels/SettingsPanel.tsx:51` |
| B2 | preflight 結果が `<details>` に畳まれ、error があっても自動で開かず該当フィールドへも飛べない。validation error はフィールド脇に出ているのに preflight は紐付いていない | error があれば開く + result に path があればフィールド脇表示へ載せる | `panels/SettingsPanel.tsx:64-76`, `schema-form/FieldFrame.tsx:28` |
| B3 | トップバーの error / warn バッジは設定タブへ切り替えるだけで、該当項目までスクロールしない | B2 とセットで最初のヒットまでスクロール | `EditorApp.tsx:337-350` |
| B4 | 「継承項目を隠す」はあるが「変更した項目だけ」フィルタが無い | dirty フィルタを足す（保存前レビュー用） | `panels/SettingsPanel.tsx:38-41` |
| B5 | JSON タブは読み取り専用で、貼り付けでの一括編集ができない | 編集可能にして、パースできたら patch に落とす | `panels/SettingsPanel.tsx:86` |
| B6 | 「すべて展開 / 折りたたむ」で `<details>` が再マウントされ、個別に開閉した状態が失われる | key に開閉トークンを含めない | `fields/ObjectFieldset.tsx:40` |
| B7 | `NumberField` は `min`/`max` を HTML 属性に渡すだけで範囲外でも setValue する。`ColorField` は不正時にクラスを付けるが理由の文言が無い | 範囲外は弾く / 理由を出す | `fields/NumberField.tsx:22-23`, `fields/ColorField.tsx:29` |

### C. プレビュータブ

| # | 現状 | 改善案 | 対象 |
|---|---|---|---|
| C1 | `--avoid-face` を GUI から効かせられない。`/still` は `plans: { zoom }` しか受けず顔回避は常に OFF。プリセット既定は有効なので、セリフボックスの幅と折り返しが本番と食い違う（実画面に `avoid_face_skipped` が出続けている） | `/still` に `avoidFace` を通し、zoom と並べてトグルを置く | `handlers/still.js:63`, `panels/PreviewPanel.tsx:198-205` |
| C2 | `enhance` も同様に反映できない。144p では無関係だが `source: cache` の 1080p では差が出る | C1 と同じ経路で通す | 同上 |
| C3 | コンタクトシート `/sheet` がサーバにあるのに UI から未接続 | 「全クリップを一覧で確認」ボタン | `api.ts:104-109`, `panels/PreviewPanel.tsx` |
| C4 | Before / After 比較が無い | `raw` ベースの still も並べて 2 枚表示。`useStill` はキャッシュ付きなので追加コストは小さい | `hooks/useStill.ts` |
| C5 | `public/data` に保存できるのは serif だけ。ruby / categories / memo は `ClipEditModal` にしかなく、同じ `/__data/save` を叩く入口が二重になっている | 保存対象を広げる、または入口を片方へ寄せる | `panels/PreviewPanel.tsx:128`, `src/components/dev/ClipEditModal.tsx` |
| C6 | 代表フレームへのジャンプが無く、0.05 秒刻みのスライダで手探り | CLI の `--frames` 相当のサムネ帯 | `panels/PreviewPanel.tsx:233-250` |
| C7 | 保存側に検証が無い。`/__cv/still` は `serifOverride` を 500 字に制限するのに `/__data/save` は長さも行数も見ない。501 字を保存すると保存は通り、その後プレビューだけ 400 で落ちる | 保存側にも同じ上限を掛ける | `plugins/vite-plugin-data-editor.ts:54-66`, `handlers/still.js:14,146` |
| C8 | serif を保存すると `npm test` のゴールデンが落ちる（`ass-golden.json` は 3 プリセット × 109 クリップ = 327 ハッシュ）。エディタは保存できるだけで `npm run golden:ass` が要ることを知らせない | 保存後に「ゴールデン更新が必要」と表示 | `panels/PreviewPanel.tsx:122-135` |
| C9 | ←/→ `[` `]` のキー操作は `<div tabIndex={0}>` 頼みで、`outline: none` のためフォーカス状態が見えない | フォーカスリングを出す / ツールバーにフォーカスを載せる | `panels/PreviewPanel.tsx:162`, `editor.css:1029` |
| C10 | still の 429（同時 2 本超過）と 422（`source_missing`）に専用表示が無く、生の英語メッセージが出る | コード別の日本語文言 | `panels/PreviewPanel.tsx:257` |

### D. クリップタブ

| # | 現状 | 改善案 | 対象 |
|---|---|---|---|
| D1 | 選択リストにスクロール枠が無く、99 件でページ全高 7519px。候補ペインだけ `max-height: 72svh` なので、下の行を触るとツールバーも候補も画面外 | 2 ペイン独立スクロール + ツールバー sticky | `editor.css:865-881, 1008-1017` |
| D2 | サムネイルが videoId 単位で、同じ配信のクリップは全部同じ絵 | クリップ代表フレーム（still キャッシュ）に差し替え | `panels/ClipsPanel.tsx:276` |
| D3 | 複数選択・範囲選択・一括除外が無く 1 件ずつ。候補の追加も 1 件ずつ | Shift 範囲選択 + 一括操作 | `panels/ClipsPanel.tsx:287,319` |
| D4 | 遠距離移動が DnD と Alt+↑↓ のみで、99 件の中で「10 番目へ」は事実上できない | 「先頭へ / 末尾へ / n 番目へ」 | `panels/ClipsPanel.tsx:59-96` |
| D5 | クリップ行からプレビューへ飛べない | 行クリックでプレビュータブ + 該当クリップ選択 | `panels/ClipsPanel.tsx:242`, `EditorApp.tsx:404` |
| D6 | exclude の自由入力に存在チェックが無く、打ち間違いが静かに無視される | カタログ照合して未知なら警告 | `panels/ClipsPanel.tsx:209-222` |
| D7 | 「files に固定」が一度に 4 つの dirty を作るが説明が無い | 実行前に変更内容を示す（A1 と同じ仕組み） | `panels/ClipsPanel.tsx:52-57` |
| D8 | 選択リスト・候補リストとも仮想化なし | D1 の後に検討 | `panels/ClipsPanel.tsx:241-331` |

### E. ビルド・結果・概要欄

| # | 現状 | 改善案 | 対象 |
|---|---|---|---|
| E1 | ビルドは保存済みファイルを読むため dirty > 0 だと開始ボタンが disabled。保存しに行って戻る往復が要る | ボタンを「保存してビルド」にして 1 アクションで通す | `panels/BuildPanel.tsx:100,168` |
| E2 | ログは全文べた表示。フィルタもエラー行ジャンプも無い。5000 行を超えると古い行は消える | level フィルタ + 次のエラーへジャンプ | `panels/BuildPanel.tsx:225-279` |
| E3 | 残り時間の推定ロジックがクリップタブにあるのにビルド中は出ない | `estimateBuildSeconds` を共有 | `panels/ClipsPanel.tsx:351`, `panels/BuildPanel.tsx:79-80` |
| E4 | `--title` / `--resolution` は型と argv 生成にはあるが UI に入力欄が無い | 入力欄を足す | `types.ts:221-222`, `panels/BuildPanel.tsx` |
| E5 | ジョブ履歴が見られない。`GET /__cv/jobs` は実装済みだが UI から未使用 | 直近ジョブの一覧を出す | `api.ts:129-131` |
| E6 | エラー文言がサーバの機械可読キーそのままで、二重起動が「busy (409)」と出る | 日本語文言へマッピング | `EditorApp.tsx:441-446` |
| E7 | 概要欄タブは読み取り専用で、`summary.*` は設定タブへ往復する | 概要欄タブから該当設定を直接編集 | `panels/SummaryPanel.tsx` |

### F. 横断（品質・保守・アクセシビリティ）

| # | 現状 | 改善案 |
|---|---|---|
| F1 | UI 側のテストが 1 件も無い。`presetStore` の set/unset 正規化、`resolveSchema` の分類、`FieldFrame` の 3 状態判定という編集の中核が無テストで、回帰は `npm run shots` の目視のみ | まず純関数（`presetStore` / `resolveSchema`）に node:test を足す。次に `scripts/ui/cdp.mjs` を使った最小の受け入れテスト |
| F2 | クライアントとサーバで分類器が二重管理（`resolveSchema.ts` と `lib/schema-walk.js` が同じロジックの写し）。テストはサーバ側だけ | 片方に寄せる、または両方に同じテストを当てる |
| F3 | `/schema` が返す `align` を誰も読まず、`AlignField.tsx:7-17` にハードコードの重複定義がある | サーバの値を使う |
| F4 | `scripts/dev-server/**` を直すたび dev サーバ手動再起動（遅延 import のため） | ハンドラのモジュールキャッシュを落として再起動を不要にする |
| F5 | フォーカス可視化が `.cv-clipRow` の 1 箇所のみ | `:focus-visible` を統一 |
| F6 | タブに `role="tab"` / `aria-selected` / 矢印キー移動が無い。`role="radiogroup"` の中身が `aria-pressed` のボタン。`NewPresetDialog` にフォーカストラップが無い | 役割ロールとキーボード操作を揃える |
| F7 | 初回 boot が `getSchema` → `listPresets` → `getPreset` の直列 3 往復で、その間は空のシェル | 並列化 + スケルトン |
| F8 | 狭幅対応は `@media` 2 本のみ。クリップ行は 7 カラムグリッドのまま、ビルドタブの 12 個のセレクトは横スクロール前提 | dev 専用なので優先度は低め |

## 着手順

1. ~~**不具合 P1〜P4**~~（2026-09-13 完了）
2. 以降は棚卸しから選んで進める。塊の候補:
   - 本番一致: C1 + C2
   - 日常の摩擦: D1 + D5
   - 編集の安心感: A1 + A3 + A5
   - 土台: F1（以降の改修が安全になる）

## 検証方法

1. `npm test`（サーバ側 47 ケースを含む全件）、`tsc -b`、`eslint src/editor plugins scripts/dev-server`
2. `npm run dev` → `npm run shots -- --preset config-matome-01.json --strict` で 5 タブを撮り、`cache/ui-shots/` の現行分と比較
3. 保存系を触ったら、全プリセットを空 patch で保存して `git diff` が空であること（`patch.test.js` と同じ担保）
4. プレビュー系を触ったら、`npm run -s still -- --config <preset> --still <base> --json` の CLI 結果と GUI の表示（矩形・warnings）が一致すること
5. 不具合は実機で再現手順を踏んでから直し、直後に同じ手順で確認する
