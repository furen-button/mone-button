# 生成動画の自動品質レビュー（QC）

## 目的

`npm run createVideo` の生成物を、**意図（レンダー設定）と実物（ffprobe 実測）の差分**として自動検査する。過去に実際に出た欠陥がいずれも機械的に検出可能だったため、目視ではなく差分検査を本体に置く。

| 過去の実害 | 検出指標 |
|---|---|
| concat デムクサが AAC プライミングを無視し音声が +46ms→+711ms 累積ズレ | 音声相互相関 |
| カードの `pix_fmt` が `yuvj420p` で concat -c copy が毎回フォールバック | `concatMethod` |
| 2 行タイトルが 1711px に伸びて date / progress を覆う | 文字矩形の重なり面積比 |
| `--source cache` の音量ばらつき | セグメント別 LUFS |

## 構成

3 層。L0 は生成前に走り、error があればエンコードを始めずに止める。

| 層 | 実行時期 | 内容 |
|---|---|---|
| L0 静的 | 生成前（ffmpeg 不要・純関数） | 素材存在、テロップのはみ出し・重なり、autoShrink 張り付き、行数、禁則残存、クリップ重複・並び、チャプター要件 |
| L1 実測 | 生成後 | 署名・尺、concat 経路、A/V 同期、クリップ同一性、音量、無音、黒、フリーズ、テロップ焼き込み、概要欄時刻 |
| manifest | 生成時 | `output/<name>.render.json` に「何を作ろうとしたか」を残す |

### レンダーマニフェスト

`index.js` が積み上げている実尺とテロップ矩形を `output/<name>.render.json` に書き出す。位置ズレとクリップ抜けは manifest があって初めて判定できる。`config.qc.manifest: false` で抑止できる。

```jsonc
{ "version": 1, "video": "...", "signature": { "width": 1920, "height": 1080, "fps": 30 },
  "concatMethod": "concat-vcopy", "totalSec": 34.6,
  "segments": [ { "kind": "clip", "base": "...", "atSec": 12.53, "durationSec": 13.4,
                  "telops": [ { "name": "serif", "rect": {...}, "boxFill": "1A1A1A" } ] } ] }
```

## 入口

```
npm run qc -- --video output/xxx.mp4        # 単体レビュー
npm run createVideo -- --videoId xxx --qc   # 生成前 L0 + 生成後 L1
npm test                                     # L0 とログ解析の単体テスト
```

- 出力は `output/<name>.qc.json`（機械可読）と `output/<name>.qc.md`（人が読む）
- **終了コードは error が 1 件以上で 1、warn / info のみなら 0**
- manifest が無い mp4 でも動く。manifest 依存の検査は info で skip する
- python（numpy / cv2）が無い場合はその検査のみ skip し、QC 全体は続行する
- 日本語 OCR 辞書が無い環境のため、**文字認識には依存しない**。テロップは矩形と塗り色でのみ検証する

## しきい値

`config.qc.thresholds.*` で上書きする。既定は下記。

| キー | 既定 | 根拠 |
|---|---:|---|
| `driftMs` | 50 | 過去実害が 711ms。300ms 注入で 277ms を検出できることを実測 |
| `durationFrames` | 1 | 総尺は 1 フレーム以内 |
| `phashDistance` | 12 | クリップ差し替わり検出 |
| `integratedLufsMin` / `Max` | -25 / -21 | 取り込み側が `ffmpeg-normalize`（EBU R128 / **-23 LUFS**）で揃えるため |
| `segmentLufsRange` | 3 | クリップ間のばらつき |
| `collisionAreaRatio` | 0.2 | 1 行タイトル×date の接触が 3%、2 行タイトルの実害が 77% |
| `silenceMinDuration` | 0.8 | 切り出しミス疑い |
| `blackMinDuration` / `freezeMinDuration` | 0.5 / 0.5 | |
| `telopFillRatio` | 0.3 | 焼き込み色の一致率 |

## 実測（2026-09-10）

`--videoId gr9WJDYS_u0 --limit 3`（1920x1080、既定プリセット、`--source existing`）で確認した。

- QC 実行時間: 35 秒の動画に対し約 2 秒
- `--qc` の有無で出力 mp4 は SHA-256 一致。ASS 出力も 3 プリセット × 5 配信で完全一致
- 音声を 300ms 遅らせた変種を食わせると `sync_audio_drift` を 277ms として error 検出（差 23.2ms は AAC パケット境界へのスナップ分）
- `loudness_segment_range` は 3.9 LU を報告。同クリップを個別に測った実測値は -23.3 / -23.0 / -26.8 LUFS = 差 3.8 LU で一致する。`--source existing` は音量正規化されていない `public/videos` を使うため、この警告は真の検出

### 実装時に潰した誤検出

| 症状 | 原因 | 対処 |
|---|---|---|
| 既定プリセットで衝突 error 6 件が出て生成がブロックされた | 文字矩形の幅が `charWidth` 推定で実測より広く（1 行タイトルで 1501px 対 実測約 1270px）、date と端が 23x9px 触れていた。実フレームでは全幅の緑タイトルバーの上に date と progress が乗る意図的なデザイン | 重なり面積比 `collisionAreaRatio` で判定（接触 3% は通し、実害 77% は止める） |
| フリーズ警告 6 件 | 区切りカード・OP・ED は静止画背景なので設計どおり止まる | manifest がある場合はクリップ区間だけを見る |
| クリップ間音量差 13.0 LU | momentary 値を dB のまま単純平均し、クリップ内の間や小声に引っ張られていた | BS.1770 に倣いエネルギー領域で平均し、絶対ゲート -70 LUFS と相対ゲート -10 LU を適用 |
| 全体音量が常に範囲外 | 目標を -16〜-13 LUFS にしていたが、パイプライン自身は -23 LUFS へ正規化している | 目標を -23 LUFS ±2 に変更 |

## 未実装（今回のスコープ外）

- コンタクトシート PNG と代表フレームの SSIM 視覚回帰
- コンタクトシートを LLM に読ませる目視レビュー（非ゲート）
