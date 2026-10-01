# テロップ改行制御

## 目的

`createVideo` のタイトル・セリフテロップで、手動改行、禁則処理、行数に応じたボックス高さ、実測ベースの `autoShrink` を扱えるようにする。既存の `wrapText` golden は `kinsoku:false` の互換基準として保持し、再生成しない。

## 実装

| 項目 | 内容 |
|---|---|
| `stripEmoji` | 空白圧縮で改行を巻き込まないようにし、改行前後の空白だけを除去 |
| `wrapText` | 手動改行でセグメント分割し、先頭/末尾の空行を落として連続空行を 1 つに正規化 |
| 禁則処理 | 行頭禁則・行末禁則を分割位置の最大 4 文字後退で回避。`maxUnits < 4` と行数増加時は旧挙動を優先 |
| 泣き別れ回避 | 最終行が短い場合、1 行に収まるケースを除いて前行から最大 6 文字を送る |
| 行端の空白 | 折り返し後に各行の行頭・行末の空白を落とす。`\an5` の中央寄せでは行端の空白がその行だけ中心をずらすため |
| ボックス高さ | `boxHeightFor(lines, fs, pad, border)` と `countLines(text)` を抽出し、`textBoxRect` と `titleBar` で共有 |
| title バー | 全幅と最低高さ `height * 0.07` は維持し、複数行時は `boxHeightFor` に追従 |
| autoShrink | 閉形式から、実際の `wrapText` 結果を測る整数二分探索へ変更。`minSize > size` でも拡大しない |
| config/schema | `telops.title` に `autoShrink` / `minSize` / `maxHeight` / `marginH` / `text` / `overrides` を追加 |
| タイトル解決 | `resolveTitleText` に一元化。優先順位は `--title` > `telops.title.overrides[videoId]` > `telops.title.text` > `clip.data.title` > メタタイトル |
| Web 表示 | `src/voiceData.ts` で表示用 `serif` の改行を無かったものとして正規化（元から空白があれば空白を残し、語中で折っただけなら詰める）。`public/data` の生改行は保持 |

## 実測

### titleBar

同梱 3 プリセットはいずれも 1080p の 1 行タイトルバーが **76px のまま**。

| プリセット | 1 行タイトルバー |
|---|---:|
| `scripts/create-video/config.json` | 76px |
| `scripts/create-video/config-mone.json` | 76px |
| `scripts/create-video/config-matome-01.json` | 76px |

2 行タイトルは横幅も約 **1711px** まで伸びるため、`telops.date`（top-right）と `telops.progress`（top-left）に重なりうる。公開用プリセットでは `telops.title.marginH: 0.16` 程度へ広げる。

### autoShrink

`scripts/create-video/config.json`、1920x1080、109 serif で比較した。比較条件によって件数が変わるため両方を記録する。

- **autoShrink 単独の影響**（禁則を入れた状態の旧閉形式 vs 二分探索）… 10 件
- **変更前後の全体差分**（変更前の `ass.js` vs 変更後の `ass.js`。禁則・行端トリム・二分探索すべて込み）… 16 件

差の 6 件は fs が変わらず折り位置または行端の空白だけが動いたもの。どちらの条件でも **行数変化は 0 件**。

以下は autoShrink 単独の影響で fs が変わった 10 件:

| ファイル | fs 変更 | 行数 |
|---|---:|---:|
| `2024-06-22-eguxJoekMyM-000097-000107.json` | 58 → 67 | 3 → 3 |
| `2024-06-22-eguxJoekMyM-000141-000148.json` | 58 → 77 | 3 → 3 |
| `2024-06-22-eguxJoekMyM-000188-000200.json` | 54 → 65 | 3 → 3 |
| `2024-06-22-eguxJoekMyM-000713-000720.json` | 77 → 82 | 2 → 2 |
| `2024-07-13-gr9WJDYS_u0-009960-009973.json` | 58 → 62 | 3 → 3 |
| `2024-08-17-I98FMV6lWHQ-011266-011281.json` | 54 → 55 | 4 → 4 |
| `2024-08-17-I98FMV6lWHQ-016170-016184.json` | 54 → 62 | 3 → 3 |
| `2024-08-17-I98FMV6lWHQ-020897-020906.json` | 58 → 77 | 3 → 3 |
| `2026-05-02-N2YU5ETJs4I-000178-000191.json` | 77 → 82 | 2 → 2 |
| `2026-07-22-n5QHz9H5Rq0-001048-001054.json` | 58 → 67 | 3 → 3 |

プラン想定は 12 件だった。fs が変わるのは 10 件、折り位置や行端の空白まで含めた全体差分は 16 件で、いずれも行数変化は 0 件。多くはフォントが拡大する方向で、高さ上限の余白を使い切れていなかった過剰縮小の解消にあたる。

## 検証

### ユニットテスト

`npm test`:

- 19 tests / 19 pass
- `wrapText(text, maxUnits, { kinsoku: false })` は `scripts/create-video/__fixtures__/wrap-golden.json` と一致
- 実データで `lines(kinsoku:true) <= lines(kinsoku:false)`
- 実データで `maxUnits` を増やしても行数は増えない
- 実データの折り返し結果に行頭・行末の空白が残らない

`npm run lint`:

- 既存の `src/components/ToastLayer.tsx` 1 error / 1 warning のみ
- 今回変更による lint 問題の増加なし

`npx tsc -b`:

- pass

### 実クリップ回帰

変更前 baseline は `git worktree add --detach <dir> HEAD` で用意する。

`--videoId I98FMV6lWHQ --limit 3` は変化するクリップを含まないため差分が出ない。**変化するクリップを確実に含む選択で確認すること。** `eguxJoekMyM --limit 4` は 2 番目と 4 番目が変化対象になる。

```bash
export FFMPEG_BIN=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg KEEP_WORKDIR=1
node scripts/create-video/index.js --videoId eguxJoekMyM --limit 4 --no-cards --out output/_check.mp4
# baseline 側でも同じコマンドを実行し、両者の workDir を突き合わせる
diff <before>/clip-0001.ass <after>/clip-0001.ass
```

結果:

| セグメント | 差分 |
|---|---|
| `clip-0000.ass` | なし |
| `clip-0001.ass` | `\fs58` → `\fs67`。**テキストは完全に同一**（行端の空白が消えた） |
| `clip-0002.ass` | なし |
| `clip-0003.ass` | `\fs58` → `\fs77`。折り位置が変化（`そこの中央街にある 香屋の…` → `そこの中央街にある` / `香屋の… 調香師です。`） |

箱の高さも fs に追従している（clip-0001: 250 → 283px、clip-0003: 250 → 321px。上限は `maxHeight 0.3 × 1080 = 324px`）。

```bash
node scripts/create-video/index.js --videoId gr9WJDYS_u0 --limit 3 | grep 'concat:'
```

結果は `concat: concat-vcopy`。テロップ改行制御の変更で concat 高速パスは落ちていない。

## 注意

- `scripts/create-video/__fixtures__/wrap-golden.json` は互換基準なので編集しない。
- `src/components/ToastLayer.tsx` の lint 2 件は既存問題として扱い、このタスクでは触らない。
- 行頭禁則と行末禁則の実運用集合は素集合にしている。ASCII の `'` と `"` は開き/閉じの文脈を判定できないため、重複回避として行頭側で扱う。
