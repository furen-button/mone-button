# createVideo 静止画プレビュー CLI

## 目的

`npm run createVideo` を最後まで回さず、選択クリップのテロップ・zoom・顔回避・補正を 1 フレーム単位で確認できる CLI を追加する。

編集直後の serif や title の見え方、公開用プリセットの顔回避、低解像度ソースの引き伸ばし警告を短時間で見るための入口にする。実装は本番の `planClipRender → buildAss → subtitles` を通し、静止画専用のテロップ配置ロジックは持たない。

## 構成・実装

| 領域 | 実装 | 理由 |
|---|---|---|
| `clip.js` | `clipSourcePathFor` / `resolveClipSource(... allowDownload)` / `planClipRender` を export | preview でも本番と同じ計画・ASS・フィルタグラフを使うため |
| `qc/contact.js` | `resolveContactFont` / `labelDrawtext` / `tileFrames` を export | シートのラベル描画と tile 合成を QC と共有するため |
| `preview.js` | `renderStill` / `buildStillAss` / `renderSheet` と純関数群を追加 | CLI とテストから同じ API を使うため |
| `preview.test.js` | `parseAt`、target 解決、出力パス、ffmpeg args、warnings、`planClipRender` seam、矩形をテスト | ffmpeg なしで主要な分岐を固定するため |
| `package.json` | `npm run still` を追加 | 手元確認の入口を短くするため |

`renderStill` は `loadConfig(argv)` と `collectClips(config)` を通したうえで、対象 clip の shallow patch、キャッシュミス時の download 抑止、非同期 ffprobe、ASS 書き出し、ffmpeg 1 フレーム出力を行う。`--json` / `--print-ass` では既存関数の stdout ログを stderr へ逃がし、stdout を機械可読に保つ。

ffmpeg の `-ss` は `-i` の後（出力シーク）に置く。入力シークは pts が 0 に再基準化され libass がフェードイン途中を描くため使えない（`-copyts` を付ければ一致するが、ソースの開始 pts に依存する）。出力シークだけだと t までの全フレームが 1080p の scale と libass を通るので、`-vf` 経路では `trim=start=<t-0.5 秒を 1/fps に切り下げ>` を本番チェーンの前に置き、それより前はデコードだけで捨てる。trim は pts を保つので libass の時刻も `fps` フィルタのグリッド（k/fps）も本番と同じで、PNG は全フレーム処理と md5 一致する（775→605 ms）。zoom punch の `filter_complex` は `setpts=PTS-STARTPTS` で先頭を 0 に戻すため前置せず、従来どおり全フレームを流す。

ASS ファイル名には設定（`__meta` を除く）・`clipPatch`・plans・`{i}/{n}` のハッシュを入れる。ffmpeg には `subtitles=` にパスしか渡せないので、同じクリップ・同じ時刻でも設定が違えば別ファイルにし、GUI の連続リクエストが互いの ASS を上書きしないようにする。中断（`AbortSignal`）は ffprobe 中にも来るため、ffprobe から後をすべて try に入れて `StillAbortedError` に包む。

`renderSheet` は各セルを `renderStill` で並列生成し、失敗セルは同じ番号位置の placeholder PNG に置き換えてから `tileFrames` で合成する。`--frames <n>` は 1 クリップ内の `duration * (i + 0.5) / n` を抜く。

## 使い方

```
npm run -s still -- --config scripts/create-video/config-matome-01.json --still <base>
npm run -s still -- --videoId gr9WJDYS_u0 --still '#3' --at 50% --json
npm run -s still -- --videoId gr9WJDYS_u0 --still <base> --print-ass
npm run -s still -- --config scripts/create-video/config-mone.json --videoId gr9WJDYS_u0 --still <base> --zoom --avoid-face
npm run -s still -- --videoId gr9WJDYS_u0 --limit 3 --sheet 8
npm run -s still -- --videoId gr9WJDYS_u0 --still '#1' --frames 6
```

- `--still` は clip base、`base.json`、`base.mp4`、`#12`（選択順 1-based）を受け付ける。
- `--at` は秒数または `N%`。省略時は `max(0.2, min(duration / 2, duration - 0.2))`。
- 既定では zoom と顔回避を preview から外し、テロップ位置を固定した確認を優先する。`--zoom` / `--avoid-face` を付けると本番と同じ計画を走らせる。
- `source: cache` のソースが無い場合でも yt-dlp は起動せず、`source_missing` と期待パスを返す。
- 出力は既定で `cache/createVideo/preview/<preset>/`。ASS は同ディレクトリの `.ass/` に保存する。
- `--json` は 1 行 JSON。主なキーは `ok,out,assPath,at,requestedAt,index,total,clip,size,source,zoom,avoidFace,enhance,elements,overlays,warnings,key,ms`。

## 検証結果（2026-09-11）

対象は `gr9WJDYS_u0 --limit 3`。ffmpeg は `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`。

- `npm test`: 112 pass / 0 fail。
- V-1: 既定プリセット（`--no-avoid-face`）と `config-mone`（zoom 全編 + 顔回避）の両方で、リファクタ前後の `clip-0000..0002.ass` は完全一致。映像 ES md5（`ffmpeg -map 0:v -c copy -f md5 -`）も 3 本すべて一致。`concat: concat-vcopy` も維持。
- V-2: 完成セグメントから抜いたフレームと still PNG の PSNR は、既定プリセットで 41.12 dB（SSIM 0.979）、`config-mone --zoom --avoid-face` で 37.34 dB（SSIM 0.957）。t±1 フレーム（±1/30 秒）では 29 dB 台に落ちるので時刻は一致している。still を x264 crf23 で往復させた圧縮の床は 39.3 dB / 35.7 dB で、どちらも同じ帯にあり、差は x264 の再圧縮で説明できる。zoom 全編は 1.3 倍拡大で高周波が増える分だけ床が下がるので、当初目安の 40 dB は内容依存の値として扱う。
- V-2: `--print-ass` は本番 `clip-0000.ass` と完全一致（`--limit 3` を揃えること。選択件数が違うと進行テロップ `{i}/{n}` と進行バーの塗りが変わる）。zoom/顔回避込みの ASS も `.ass/` に保存されたものが本番と完全一致。
- V-2: trim 先読みを入れた PNG は、出力シークで全フレームを流した PNG と既定・zoom 全編とも md5 一致。
- V-3: `--json` のキーは `ok,out,assPath,at,requestedAt,index,total,clip,size,source,zoom,avoidFace,enhance,elements,overlays,warnings,key,ms`。stdout は 1 行。出力 PNG は 1920x1080。
- V-3: `config-mone` の既定 preview（`--zoom --avoid-face` なし）は `zoom_skipped` と `avoid_face_skipped` を warnings に出す。`--source cache` でキャッシュの無い videoId は `source_missing` で exit 1 になり、yt-dlp は起動しない。
- V-3: `AbortController` を 20 / 60 / 300 ms 後に abort すると、ffprobe 中・ffmpeg 中のどちらでも `StillAbortedError` になり、`.tmp.png` は残らず ffmpeg / ffprobe プロセスも消える。
- V-4: `--limit 3 --sheet 3` は 3 セルの `sheet-3x3.png` を生成し、`cells.length === 3`。`--frames 4` は 4 セルの `<base>-frames4.png` を生成した。
- 実測レイテンシ（1080p 出力、Apple Silicon）: ffmpeg 単体 約 0.6 秒。`renderStill` を同一プロセスで繰り返すと約 0.7 秒/枚。CLI（`npm run -s still`）は node 起動込みで約 0.9 秒。`config-mone --zoom --avoid-face` は顔検出（python + OpenCV）込みで約 3.7 秒。3 セル sheet と 4 frames はどちらも約 1.2 秒。内訳は `resolveFfmpeg` 76 ms（プロセス内で 1 回だけ）、ffprobe 69 ms、`collectClips` 20 ms、残りが ffmpeg（libass/fontconfig 初期化 + 先読み 0.5 秒分のフィルタ処理）。

## カード / OP / ED（2026-09-12 追加）

クリップと同じ seam 抽出で、区切りカード・OP・ED も 1 フレーム焼けるようにした。

- `card.js` の `renderCard` から `planCardRender()`（要素と ASS 本文）を、`buildCardCommand` から `buildCardVideoGraph()`（`[v]` を作るまでの入力とフィルタ）を切り出し、音声グラフ（SE / anullsrc / afade / apad）と分けた。本番は両方を連結するので **ffmpeg の argv は 1 要素も変わらない**（3 プリセット × サムネ有無 × カード/OP/ED の 12 パターンで、リファクタ前の実装をコピーして突き合わせた）。
- `--still card:<base>` / `card:#N` は、そのクリップの**前に入る**区切りカード。`--still opening` / `ending` は端のカードで、`endcaps.*.video` に完成動画があればその動画から抜く（`endcapVideoFilter` は本番と同じ scale/pad/setsar/fps）。
- サムネイルは `cacheThumbnail(videoId, config, { allowDownload: false })` でキャッシュ済みのみ使う。未取得なら `thumbnail_missing` を出して背景だけで描く（プレビューが外へ取りに行かない）。
- 背景素材が欠けて色にフォールバックしたときは `card_background_fallback`。
- `StillResult` はクリップと同じ形で、`clip` は OP/ED では null、`card: { kind, duration, thumbnail }` が増える。`source.kind` は `card-video` / `card-image` / `card-gradient` / `card-color` / `endcap-video`。
- 検証（既定プリセット `gr9WJDYS_u0 --limit 3`）: `--print-ass` は本番 `card-0001.ass` / `opening.ass` / `ending.ass` と完全一致。完成セグメントから抜いたフレームとの PSNR は 39.30 / 41.31 / 43.43 dB で、それぞれの圧縮床（still を x264 crf23 で往復）40.80 / 42.74 / 44.93 dB の 1.5 dB 以内。カードは背景の動きが小さく t±1 フレームでも PSNR が落ちないので、時刻の一致は ASS と尺で見る。所要は 0.6〜1.9 秒/枚。

## 注意

- `--source cache` はキャッシュ済み mp4 のみ読む。CLI preview から download は発生しない。
- `public/videos` の 256x144 ソースを 1080p へ伸ばす場合は `source_upscaled` を出す。
- `--print-ass` は ffmpeg 不要の ASS 確認用で、既定 plans はすべて false。zoom / 顔回避込みの ASS 比較は `renderStill` が保存した `.ass/` を見る。
