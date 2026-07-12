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
- 結合は ffprobe のストリーム署名が一致する場合 `concat -c copy`、不一致なら concat filter で再エンコードする。
- BGM は結合後の最終パスで映像 `-c:v copy`、音声のみ `amix` する。

## 技術メモ

- **カードの pix_fmt 正規化（concat-copy 維持の要）**: JPEG サムネを overlay したカードは full-range 由来で `yuvj420p` になり、`yuv420p` のクリップと署名が食い違って毎回 concat filter（全再エンコード）に落ちる。`card.js` の最終映像フィルタ末尾に `scale=out_range=tv,format=yuv420p` を付けて limited-range `yuv420p` に揃え、`concat -c copy` の高速経路を保つ。**この 1 行を外すと再エンコード経路に戻る**ので消さないこと（`-pix_fmt yuv420p` だけでは range が残り効かない）。

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
