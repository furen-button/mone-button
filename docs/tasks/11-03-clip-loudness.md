# 波形トリム・切り出しの音量を揃える

## 背景

取り込み（`npm run download`）と範囲の拡張は ffmpeg-normalize（EBU R128、-23 LUFS / true peak -2 dBTP / LRA 7）で音量を揃えるが、dev サイトの波形トリムと「この範囲を別クリップに切り出す」は既存の `public/videos` mp4 を `-ss/-to` で切り直すだけで、音量を揃えていなかった。元の mp4 は取り込み時の範囲全体（多くは 30 秒窓）で -23 LUFS にしてあるので、静かな部分を落として叫びだけを残すと大きく、逆に静かな所だけを切ると小さく残る。

2026-11-03 に `public/videos` 全 1012 件を ebur128 で測った結果:

| | 件数 | 中央値 | p10〜p90 | ±2 LU 外 |
|---|---|---|---|---|
| 未トリム | 294 | -23.0 | -23.4〜-22.5 | 2 |
| トリム済み（`trimming.original` あり） | 718 | -23.1 | -24.0〜-19.9 | 131 |

- 3 秒未満は 63% が外れる（3〜6 秒は 11%、6〜15 秒は 8%）。大きい側が多い（-21 超 104 件、-25 未満 27 件）。
- 最大は -13.3（+9.7 LU）、最小は -41.0（-18 LU）。

createVideo の `source cache` は範囲どおりに高画質で取り直して正規化するので影響しない。影響は Web のボタン再生と `source existing`（既定の `config.json`）。

## 仕様

- `scripts/dev-server/lib/loudness.js` に計測とゲイン計算を置く。`measureLoudness` は `atrim` → `ebur128=peak=true` で区間を測る。出力側の `-ss/-to` は -af の後ろで効くため区間が測れない（2〜4 秒を測ると -23.2 になり、正しくは -27.6）。
- `loudnessGain` は目標 -23 LUFS へのゲインを返す。下げるときは常に目標まで、上げるときは true peak が -2 dBTP を超えない所で止める（ffmpeg-normalize は linear で収まらないと dynamic に切り替えるが、ここでは頭打ちにする）。-70 LUFS 以下（ゲートを通るブロックが無い = 無音・0.4 秒未満）は測れないものとして 0 dB。
- 波形トリムと切り出し（`plugins/vite-plugin-data-editor.ts` の `encodeRange`）は、切る前に元 mp4 の区間を測り、`AUDIO_RESAMPLE` の後ろに `volume=<dB>` を足して 1 回でエンコードする。レスポンスに `loudness`（`integrated` / `truePeak` / `gainDb` / `reason`）を返す（画面は使っていない）。
- 既存分は `npm run fixClipLoudness` で直す。`public/videos` を全件測り、-23 LUFS ±2 LU（`--tolerance` で変更）を外れたものを、映像 copy・音声だけ `AUDIO_RESAMPLE,volume` で AAC 96k / 44.1kHz / stereo に作り直す。元の mp4 は `trash/loudness/<base>.mp4`（同名があれば時刻付き）へ複製してから差し替える。`--dry-run` で対象だけ出し、`--only` で指定のクリップだけにできる。

## 自動確認

- `node --test scripts/dev-server/lib/loudness.test.js`：Summary の読み取り、目標どおり・true peak で頭打ち・測れないときのゲイン。
- `node --test scripts/fix-clip-loudness.test.js`：引数と対象の選び方。

## 検証結果（2026-11-03）

- 別ポートの dev サーバで、`2025-03-11-4D7qYRHKTPg-005304-005339` の複製に対して、切り出し（2〜4 秒、-27.6 LUFS → +4.6 dB）は -23.1 LUFS、トリム（0.5〜2 秒、-24.8 → +1.8 dB）は -23.1 LUFS になった。確認後に複製と生成物は消した。
- `npm run fixClipLoudness -- --dry-run` は 133 件（トリム済み 131 + 未トリム 2）を対象に出した。true peak で上げられないものは無かった。
- 聞き比べ用に 5 件を `--only` で直した（-41.0 → -23.0 / -13.3 → -23.0 / -14.4 → -23.1 / -19.2 → -23.0 / -25.7 → -22.9）。映像ストリームの md5 と映像・音声の尺は元と一致。ユーザーが聞いて確かめた後、残り 127 件を全件モードで揃えた（約 21 秒）。揃えた後は -23.3〜-22.7 LUFS で、もう一度 `--dry-run` すると対象は 0 件。元の mp4 は `trash/loudness/` に 132 件。
