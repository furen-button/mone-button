# まとめ動画ジェネレーター化（createVideo）

## 目的

既存の `videoId` クリップ結合スクリプトを、YouTube まとめ動画形式のジェネレーターへ拡張する。後方互換は維持しない。

## 実装構成

| ファイル | 役割 |
|---|---|
| `scripts/create-video/index.js` | 引数解析、設定ロード、選択、描画、連結、BGM 最終パス |
| `scripts/create-video/config.js` | DEFAULTS、JSON deep merge、CLI/npm_config 上書き、RGB→ASS BGR 色変換、検証 |
| `scripts/create-video/select.js` | `videoId` / `category` / `files` のクリップ選択と並び替え |
| `scripts/create-video/ass.js` | ASS 生成、折り返し、ボックス描画、フェード、進行表示、カラオケ |
| `scripts/create-video/clip.js` | クリップの字幕焼き込み、解像度/fps/音声正規化 |
| `scripts/create-video/effects.js` | クリップ演出の解析・計画・filter_complex 構築 |
| `scripts/create-video/detect_anime_face.py` | OpenCV + lbpcascade_animeface によるアニメ顔検出 |
| `scripts/create-video/card.js` | 区切りカード、OP/ED カード、背景/サムネ/SE 合成 |
| `scripts/create-video/ffmpeg.js` | ffmpeg/ffprobe 解決、同一エンコード引数、concat guard/fallback、BGM |
| `scripts/create-video/assets.js` | サムネキャッシュ、高画質 DL、任意素材解決 |
| `scripts/create-video/config.json` | まとめプリセットのサンプル設定 |

`package.json` の `createVideo` は `node scripts/create-video/index.js` を指す。

## 主要仕様

- 設定優先順位は `DEFAULTS < config.json < CLI/npm_config_*`。
- 既定は `source: "existing"`、`1280x720@30`、カード ON、OP/ED ON、進行表示 ON、BGM OFF。
- 選択モードは `videoId`、`category`（`categories[]` と交差）、`files`。
- 並び順は `date`（uploadDate→startTime 昇順）、`date-desc`、`stream`、`shuffle`、`as-listed`。
- 色は設定では RGB hex、ASS 出力では `&HAABBGGRR` の BGR 順に変換する。
- クリップ/カード/OP/ED は同じ encode flags で mp4 化する。
- `--source cache`（高画質DL）は DL 後に `ffmpeg-normalize`（EBU R128 / 既定 -23 LUFS、`public/videos` の download.js と同基準）で**各クリップの音量を正規化**してから cache に保存する。映像は `-c:v copy` で高画質維持、音声のみ正規化。`normalizeCache`（既定 true、`--no-normalize` で無効）で切替。`ffmpeg-normalize` 不在時は警告して生DLを使用。既存 cache は正規化前なので、掛け直すには対象を削除して再DLする。
- 結合は ffprobe のストリーム署名が一致する場合、映像は `concat` デムクサで copy・音声は各セグメント入力から concat フィルタで再エンコードする（`concat-vcopy`）。不一致なら concat filter で全再エンコードにフォールバックする。
- BGM は結合後の最終パスで映像 `-c:v copy`、音声のみ `amix` する。
- `effects.zoom.enabled` または `--zoom` で、音声ピーク直前からパンチイン・ズームを自動挿入できる。既定は無効。

## 技術メモ

- **concat の音ズレ（AAC プライミング累積）**: `concat` デムクサはセグメント mp4 の edit list（AAC エンコーダ遅延 ≒ 2 フレーム / 約46ms の除去情報）を無視する。音声を `-c copy` で通すと、各セグメントの生パケットにプライミングが残ったまま連結され、**セグメント数に比例して音声が遅れていく**（17クリップ＋カード構成で末尾 +700ms を実測）。デコードさせても edit list は適用されないため、音声はデムクサを通さず**各セグメントを個別入力として concat フィルタで結合**する。その際、各音声をデムクサの前進量（コンテナ duration）ちょうどに `atrim`+`apad=whole_dur` で揃えることで映像タイムラインと厳密に一致させる（全17クリップでズレ ≤0.1ms を実測確認）。映像は従来どおり copy なので高速なまま。
- **カードの pix_fmt 正規化（concat-copy 維持の要）**: JPEG サムネを overlay したカードは full-range 由来で `yuvj420p` になり、`yuv420p` のクリップと署名が食い違って毎回 concat filter（全再エンコード）に落ちる。`card.js` の最終映像フィルタ末尾に `scale=out_range=tv,format=yuv420p` を付けて limited-range `yuv420p` に揃え、`concat -c copy` の高速経路を保つ。**この 1 行を外すと再エンコード経路に戻る**ので消さないこと（`-pix_fmt yuv420p` だけでは range が残り効かない）。

## パンチイン・ズーム

`effects.zoom` は、ffmpeg の `astats` で 0.1 秒刻みの RMS を取り、3 窓移動平均後のピークを見せ場として扱う。ピークの `lead` 秒前から静的 `crop` + `scale` に切り替え、クリップ末尾までアップを保持する。`zoompan` は使わないためジッターがなく、動画時間・fps・音声は変えない。ASS テロップは crop 後に焼き込むので、タイトル・セリフ・進行表示の画面位置も固定される。

`mode` は 2 方式から選ぶ。`punch`（既定）は上記のピーク直前カット、`full` は音声解析を行わず最初から最後までクリップ全編をアップにする（短尺・無音・平坦スキップも適用しない）。`full` でも焦点の顔検出・フォールバックは同様に働く。

焦点は `focus.mode: "face"` の場合、scale+pad 済みの出力キャンバス座標系で PNG を抽出し、`detect_anime_face.py` が `lbpcascade_animeface.xml` で検出する。検出できない場合は `focus.x/y`、さらに中央 `(0.5, 0.5)` へフォールバックする。OpenCV は 5.0 で `CascadeClassifier` が削除されているため、導入コマンドは `pip install "opencv-python-headless<5"` とする。カスケードは `cache/createVideo/models/lbpcascade_animeface.xml` に置き、無ければ `https://raw.githubusercontent.com/nagadomi/lbpcascade_animeface/master/lbpcascade_animeface.xml` から自動取得する。

clip JSON では次のように個別指定できる。

```jsonc
"effects": { "zoom": false }
"effects": { "zoom": true }
"effects": { "zoom": { "at": 2.5, "scale": 1.4, "x": 0.8, "y": 0.75 } }
"effects": { "zoom": { "mode": "full" } }
```

優先順位は `--no-zoom`（グローバル kill switch） > `zoom:false` > `mode`/`at` 指定 > `zoom:true` > 純自動。クリップの `mode` はグローバル `mode` より優先し、`mode` なしで `at` を指定した場合は punch として扱う（グローバルが `full` でも `at` 指定クリップはピーク位置固定の punch になる）。無音、音声解析失敗、ズーム区間を確保できない短さではスキップする。200p の `source: existing` でも動くが、ズーム画質を保つ本番用途では `--source cache` を推奨する。将来は sibling キーでオチ演出（引き・モノクロ化）を追加し、必要になった時点で smooth モード、release、解析キャッシュを検討する。

## 素材

`assets/create-video/` を参照する。素材が無効または欠落しても処理は落とさず、該当機能をスキップする。

| 種別 | 既定 |
|---|---|
| カード背景 | `5bg191クロスするハート背景.mp4` |
| カード SE | `パッ.mp3` |
| BGM | `kamatamago_C00003_heaven-and-hell.mp3`（既定 OFF） |

サムネイルは `cache/createVideo/thumbnails/<videoId>.jpg` に保存し、`maxresdefault.jpg` 失敗時は `hqdefault.jpg` へ fallback する。取得不能ならサムネ無しでカードを描く。

## コマンド例

```bash
npm run createVideo -- --videoId gr9WJDYS_u0
npm run createVideo -- --videoId gr9WJDYS_u0 --no-cards
npm run createVideo -- --mode category --category やられ --limit 10
npm run createVideo -- --config scripts/create-video/config.json --source cache
```

## 検証

最小 smoke:

```bash
npm run createVideo -- --videoId gr9WJDYS_u0 --no-cards
```

期待:

- `output/2024-07-13-gr9WJDYS_u0-combined.mp4` を生成。
- ffprobe 上で video=h264/yuv420p/1280x720/30fps、audio=aac/44100/stereo。
- concat は署名一致時 `concat-copy`。

## 関連

- 旧仕様: `docs/tasks/06-29-create-video.md`
- 運用メモ: `CLAUDE.md`
