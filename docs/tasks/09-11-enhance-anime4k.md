# アニメ向け線補正（Anime4K / libplacebo）

## 目的

「元動画をアニメ系の超解像で補正できるか」という問いから、対象を **`--source cache` の 1080p（YouTube 圧縮でにじんだ線）** に絞り、Anime4K の GLSL シェーダを ffmpeg の `libplacebo` フィルタで掛ける形で統合した。Real-ESRGAN（ncnn-vulkan）は brew 外・未署名バイナリの導入を避けるため不採用。

## 前提（2026-09-11 調査）

| 項目 | 実測 |
|---|---|
| `public/videos`（`--source existing`） | 256×144 h264 30fps 約 65kbps。yt-dlp の `height<=200` 制限 + crf28 |
| `cache/createVideo/<videoId>/`（`--source cache`） | 1920×1080 h264 約 2.4Mbps。47 本中 4 本は 60fps。公開用 `config-mone.json` は既にこちら |
| ffmpeg | `ffmpeg-full` 8.1.2 に `libplacebo` が同梱。Vulkan ドライバ（MoltenVK）が無いと `VK_ERROR_INCOMPATIBLE_DRIVER`。`brew install molten-vk` で解消 |
| Anime4K | release v4.0.1（`Anime4K_v4.0.zip` 776KB、39 ファイルがフラットに入っている）。公式ガイド: ネイティブ 1080p には Mode A（Restore → Upscale）を 1 回だけ。A+A は過剰シャープ |
| libplacebo の `custom_shader_path` | 1 ファイルしか受けないが mpv .hook 形式の複数ブロックを順に読むので、`Clamp_Highlights` + `Restore_CNN_M` のように連結した 1 ファイルを渡す |

## 実装

| 項目 | 内容 |
|---|---|
| `enhance.js` | `enhanceRequested`（設定・CLI・クリップ上書きの判定）、`planEnhance`（ffprobe で高さゲート → libplacebo の可用性 → シェーダ取得 → プリセット連結）、`restoreFilter` / `upscaleFilter`（フィルタ文字列）、`ensureAnime4kShaders`（zip 自動取得）、`buildPreset` |
| `ffmpeg.js` | `probeVideoStream`（寸法と fps）、`ffmpegLibplaceboStatus`（1 プロセス 1 回だけ lavfi 入力で Vulkan 初期化を確かめる） |
| `clip.js` | `baseFilters` の `fps=` の後に等倍の復元、zoom の切り出し後の `scale=lanczos` を CNN 拡大へ差し替え。判断を `enhance` として返す |
| `effects.js` | `zoomCropFilters` / `buildZoomFilterComplex` に `upscale` 引数（未指定なら従来どおり） |
| `config.js` / schema | `effects.enhance { enabled, backend, shadersDir, restore, upscale, clampHighlights, minSourceHeight, required }`、CLI `--enhance` / `--no-enhance`（`--zoom` と `out.effects` を merge） |
| manifest / QC | セグメントに `enhance` を記録。見送りは `enhance_fallback` の warn |

### フィルタ列

```
scale=W:H:force_original_aspect_ratio=decrease,pad=...,setsar=1,fps=30,
libplacebo=custom_shader_path='<glsl>/.presets/Clamp_Highlights+Restore_CNN_M.glsl':format=yuv420p:dithering=none,setsar=1,
[zoom 時] crop=...,libplacebo=w=W:h=H:custom_shader_path='...Clamp_Highlights+Upscale_CNN_x2_M.glsl':upscaler=ewa_lanczossharp:format=yuv420p:dithering=none,setsar=1,
subtitles=...
```

- 復元は fps を揃えた後なので 60fps ソースでも処理枚数は出力 fps 分
- Anime4K の Upscale は `//!WHEN OUTPUT.w MAIN.w / 1.200 >` で「出力が入力の 1.2 倍超」のときだけ CNN x2 が走り、余りは libplacebo の downscaler で戻る。zoom 1.3 倍で自然に成立する
- `dithering=none` で 8bit への戻しを決定的にする。`colorspace` / `range` は auto でフレームのタグ（bt709 / tv）を踏襲

### 判断の流れ

1. `--no-enhance`（kill switch）→ 対象外。`effects.enhance.enabled` もクリップ上書きも無ければ対象外（ffprobe も呼ばない）
2. クリップ JSON の `effects.enhance: false` → 手動 OFF
3. ソース高さ < `minSourceHeight`（既定 720）→ 見送り（クリップ JSON の `true` / object は無視）
4. libplacebo が Vulkan デバイスを作れない → 警告 1 回 + 補正なし（manifest `fallback`、QC warn）。`required: true` なら error
5. シェーダ取得・プリセット連結に失敗 → 同上

## 結果（2026-09-11、M3 Pro）

| 項目 | 実測 |
|---|---|
| 1080p 復元（Restore_CNN_M） | 2 秒クリップ 62 フレームを x264 veryfast 込みで 0.8 秒（約 75fps） |
| 色 | 同一フレームの `signalstats` 平均: Y 89.88→89.70 / U 136.26→136.13 / V 133.50→133.43（差 0.2 未満）。セグメントの `color_space=bt709` / `color_range=tv` は維持 |
| 決定性 | 同条件で 2 回描画した mp4 の SHA-256 が一致 |
| 19 クリップ（config-mone、zoom 全編、`--enhance --qc --contact`） | 全クリップに適用。QC error 0 / warn 4（顔回避見送り 1・音量差 1・フリーズ 2、いずれも補正と無関係）。所要 176 秒（`output/eval-4-enhance.mp4`） |
| 同条件で補正なし（`--contact` なし） | 所要 110 秒（`output/eval-4-noenhance.mp4`）。差の約 66 秒が補正 + コンタクトシートのコストで、1 クリップあたり 3 秒台。QC は warn 5 で、境界ぎりぎりのフリーズ 0.50 秒が 1 件だけ補正あり側で消えた（復元で画素の揺らぎが変わるため） |
| pHash（`--no-zoom --enhance` 3 クリップ） | ソース（scale+pad 後）と補正済み出力の中央 crop で距離 0（閾値 12）。復元は低周波の構造を変えないので同一性検査はそのまま使える |
| 見送り・停止 | `--source existing`（144p）→ `補正: なし (ソース 144p < 720p)`。Vulkan ドライバを隠す（`VK_DRIVER_FILES=/nonexistent`）→ 警告 1 回で描画継続、QC `enhance_fallback` warn。`required: true` → 「補正が必須…」で exit 1 |

### 目視

`output/eval-4-enhance-compare-{restore,zoom,sheet}.png`（顔 crop を nearest で 2 倍）。

- 復元（Restore_CNN_M）: 目の輪郭・髪の線がわずかに引き締まる。1080p ソースは元から破綻していないので差は控えめ
- zoom 1.3 倍の拡大: lanczos より CNN の方が線が明確で、差は復元より分かりやすい
- 3 クリップ（会話 / ゲーム画面あり / 60fps）× `なし / M / Soft_M / VL`: VL が最も鋭く、Soft_M は元に近い。ゲーム画面のドット絵や配信 UI の文字に崩れ・ハローは見えない。既定は処理時間と効果のバランスで `M`

## 注意

- 最終 mp4 の `color_space` / `color_range` が `unknown` になるのは補正前からの挙動（concat の先頭がカードで、カードは画像由来でタグを持たない）。補正の回帰ではない
- `public/videos`（144p）には掛からない。144p を本当に上げたいなら別方式（Real-ESRGAN 等）が必要で、それでも 1080p の cache には届かない
- libplacebo は GPU 演算だが同一マシンでは決定的だった。別マシン・別ドライバでは出力ビットが変わり得る
- テストは GPU・ネットワーク不要（`planEnhance` に probe / status を注入）。CI でもそのまま回る
