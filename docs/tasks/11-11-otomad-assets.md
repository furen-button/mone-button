# 音MAD の Premiere Pro 用素材出力

## 目的

天国と地獄に声を合わせた音MADを、Premiere Pro で差し替え・再編集できる素材一式として出力する。Node ESM と標準ライブラリ、ffmpeg / ffprobe / rubberband / yt-dlp を使い、XML の確認には OS の xmllint を使う。npm 依存は追加しない。既存の create-video と public/data は変更しない。

## 入力

`scripts/otomad/projects/tengoku-to-jigoku/` の project.json（拍・範囲・声・候補・出力）、melody.json（93 音）、boundaries.json（手動境界）、plan.md（編集案）を読む。クリップメタデータの読み込みとダウンロードは既存 create-video の関数を再利用する。

境界の基準は public/videos。高画質は cache/createVideo/<videoId>/<base>.mp4。未取得なら createVideo と同じ `downloadHighQuality(clip, path, { normalize: true })`（ffmpeg-normalize で -23 LUFS、44.1kHz）で取る。共有キャッシュなので createVideo と同じ取り方に揃える（実装当初は loudnorm 1 パス・48kHz で書いていたのを改めた）。取るのは各カテゴリ上位 `candidates.downloadPerCategory`（既定 5）件と、譜面で使う素材だけ。失敗は停止して理由を表示する。

ffmpeg は `FFMPEG_BIN` を指定したらそれをそのまま使い（無ければ止まる）、指定が無ければ createVideo の `resolveFfmpeg`（ffmpeg-full → PATH）で選ぶ。drawtext が使えればスペクトログラムに音節と秒数を描く。

## 使い方

```sh
npm run otomad -- --project tengoku-to-jigoku
npm run otomad -- --no-download --no-pitch-pack --candidates 2
npm run otomad -- --out output/otomad/my-assets
npm run otomad -- --import-boundaries output/otomad/assets-01
```

既定は output/otomad/assets-NN の最大番号 + 1。初回は 01。明示した出力先も既存なら上書きしない。生成途中は「生成中.txt」を残し、完了時だけ README.md を生成する。ダウンロードの禁止は既存の高画質キャッシュの利用を妨げない。未取得の映像は低画質を拡大し、README と samples/index に明記する。

## 出力

- README.md: Premiere の手順、素材説明、低画質一覧、境界修正と再生成コマンド。
- 編集方針.md: plan.md をコピーし、生成した区間表と使用素材を追記。
- premiere/<project>.xml: xmeml v4。V1 元動画、A1 曲、A2 旋律、A3 アクセント、A4 声完成ミックス（無効）。素材参照は出力内 samples の clip.mp4。繰り返し file 要素は id 参照。
- beats/: 全拍 JSON/CSV と小節頭の高い click.wav。
- melody/: 原旋律 JSON/CSV、480 tpq の SMF format 0 MIDI、正弦波 guide.wav。
- score/: 97 イベント（旋律 93 + アクセント 4）の JSON/CSV。音節、音高、移調量、伸縮、pre-roll、配置サンプル、映像フレーム、参照ファイルと効果。
- audio/: backing.wav、voice-mix.wav、mix.wav、events/。
- video/: 元音声つき効果なし cut/ と、反転・中心ズームを焼いた preview.mp4。
- samples/: カテゴリ別候補と index JSON/CSV。各素材に clip.mp4、clip.wav、spectrogram.png、units.json、生音節 units/、無音除去と音量調整した units-clean/、移調素材 pitch/。

## 判断

拍 b の原曲時刻は offsetSec + b × 60/bpm。小節は試作と同じ 0 始まり。タイムライン 0 は fromBar - 1 の頭、終了は toBar + 2 の頭とする。各映像の境界は絶対タイムラインから round(t × fps) で計算し、長さをその差分にする。冒頭 1 小節の映像は黒、最後のイベントは終了まで続ける。

### フレーム境界と音の位置

音声開始サンプルを round((拍時刻 - pre-roll) × sampleRate) として求める。その直前のフレーム境界から開始サンプルまでの無音をイベント WAV に付ける。XML はそのフレームから配置する。無音サンプル数とフレームの開始サンプルの和が実際の開始サンプルと一致することをテストする。

### 高画質と低画質の時間差

samples の clip.mp4 は高画質をそのままコピーせず、シーケンスと同じ 1920×1080・60fps 一定・48kHz に変換する。高画質キャッシュは 30fps と 60fps が混在し、FCP XML で元 fps とシーケンス fps が違うと in/out の解釈が曖昧になるため。変換は時刻の 0 を保つ。

低画質（public/videos）と clip.mp4 の音声を 8kHz モノラルへ復号し、±250ms の正規化相互相関を計算する。`clip.mp4 の時刻 = 低画質の時刻 + hqOffsetSec` の符号で記録する。相関 0.2 未満、または探索端に達したら、譜面で使う素材なら停止し、候補なら低画質に切り替えて続ける。units.json は低画質基準を保つ。負になる開始は 0 に丸める。2026-11-11 の生成では高画質 31 件すべて相関 0.97〜0.999・時間差 0 だった。

声（events、units、units-clean、pitch）は、高画質があればその音声から時間差を足して切る（低画質は AAC 96k の再エンコードで劣化しているため）。f0 の解析と clip.wav は境界の基準なので低画質のまま。解析は 44.1kHz、出力は 48kHz。声の音源を替えても、音程の一致率は試作 proto-02 と同じだった（笑い声 26/29、侍 28/30、布団 7/13、梅酒 9/14）。

### 試作への追従

YIN の差分・累積平均正規化・放物線補間で音節の f0 を測る。音節カウンターは声と 8 小節ブロックで分け、笑い声は進めない。オクターブは同じ声の全イベントの移調量中央値の絶対値が最小になる -24/-12/0（同点なら前の選択肢）。笑い声のみ音ごとに選ぶ。

長さは次の旋律音まで、最大 1 拍。音節が目標の 0.85 倍未満のときだけ最大 2 倍に伸縮する。rubberband -3 -F を使い、子音は最大 60ms 先行させる。アクセントは指定 units の開始から終了までを原音で置き、試作と同じ 20ms 先行・1.2 倍の音量とする。共通のピーク調整ゲインをイベントと完成声ミックスへ適用する。

### 自動区切りと候補の限界

有声判定をした音量の山を核とし、近い山を統合し、間の谷で区切る。ruby（なければ serif）からモーラをまとめ、数が一致しなければ #番号を付ける。自動区切りは精度が低く、必ず聴いて確認する。無声音の音高は同じ素材の中央値で補う。

候補は声と背景の音量差、有声割合、音節内 f0 の安定、短さを合算する。笑い声は山の数と音量の谷の深さも加点する。点数は編集の出発点であって品質保証ではない。上位件数を選び、使用する声は順位外でも必ず含める。pitch は上位指定件数と使用素材について、素材の f0 中央値 ±7 半音のト長調音を全音節に作る。

### Premiere での編集

XML に元動画の in/out を入れ、効果はマーカーで提案する。映像が足りない部分は、最後のフレームを 10 秒止めた別ファイル clip-hold.mp4 を置く（Time Remap の速度 0 は Premiere の読み込みで再現されない恐れがあるため使わない）。preview では ffmpeg tpad で延長する。XML の構文とトラック・音数・マーカー・参照・in/out をテストするが、Premiere 本体の読み込みは別途確認が必要。

A1 の音量は XML の Audio Levels に trackGain 相当を設定する。Premiere の読み込み後に確認する。A2+A3 と A4 は二重に鳴らさない。出力を移動した場合は Premiere の「メディアをリンク」で出力フォルダ内を指定する。

### 境界の修正

samples/**/units.json の [かな, 開始, 母音の始まり, 終了] を clip.wav とスペクトログラム（開始は白、母音は緑、上に音節の番号とかな、下端に 0.1 秒の目盛りと 0.5 秒ごとの秒数）で修正する。source を manual にし、--import-boundaries を実行する。差分表示後にプロジェクトの boundaries.json を更新し、取り込みだけで終了する。通常コマンドを再実行すると新しい出力ができる。重複素材の矛盾した境界、範囲外の時刻は取り込まない。

## 検証

`node --test scripts/otomad/*.test.js` と `npm test`。実データは `npm run otomad -- --no-download --no-pitch-pack --candidates 2` で確認する。外部コマンドがない・失敗した場合は停止する。既存テストの失敗は原因を区別して報告し、既存 create-video やデータを直して隠さない。

### 実装時の確認結果

- 新規 18 テストを通過。試作と同じ 97 イベント、笑い声の小節、移調・オクターブ、MIDI、XML 構造、サンプル位置を確認。実音源の移調量は試作の小数 2 桁記録との差が最大 0.0043 半音。
- ffmpeg を使う実映像テストでは、色メタデータが異なる映像をつないでも総フレーム数を維持する。concat 後はフレーム番号で PTS を再生成し、色メタデータ変更によるフィルター再初期化を無効にする。各カット・効果映像・通しのフレーム数も生成時に検査する。
- ネットワークなし・音階素材省略・カテゴリごと 2 候補の実データ生成を確認。高画質キャッシュと低画質代替の両方を使用。音階素材は「へんたい」カテゴリの上位候補と必須素材で別途実生成を確認。
- `npm test` は既存の ASS ゴールデン 1 件が失敗する。追加テストを除いた既存テストだけでも 409 件中 408 成功、同じ 1 件が失敗する。開始前の public/data・ASS の作業ツリーと固定スナップショットの差分が原因であり、既存ファイル・fixture は更新していない。
- Premiere Pro 本体での XML 読み込み、ネットワーク経由の新規高画質取得、既定候補数での全音階素材生成は未確認。
