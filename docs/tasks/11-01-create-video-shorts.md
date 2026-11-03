# createVideo Shorts（2026-11-01）

ブランチ `feat/create-video-shorts`、未コミット。初版の全30本はユーザー環境で生成・目視済み、Anime4Kも適用できることを確認済み。今回はその結果を受け、コラボ時の顔選択、顔を中央より上へ置く構図、タイトルとセリフの配置を改修した。

ユーザーが前回後に入れた制御文の波括弧・1文1行の整理と、split.test.jsの本数を固定しない方針を保持している。summary.js / summary.test.js の出典集約ロジック、split.js / split.test.js、public/data、ASS / wrap goldenは今回編集していない。

## 設定

| キー | 既定値 | config-shorts.json |
|---|---|---|
| effects.reframe.enabled | false | true |
| pick | largest | right |
| frames | 3 | 3 |
| zoom（下限） | 1 | 1 |
| target | x:0.5, y:0.45 | x:0.5, y:0.46 |
| maxZoom | 3 | 1.8 |
| minFaceHeight（出力高さ比） | 0 | 0.26 |
| fill | blur | blur |
| x/y（検出失敗時、元映像比） | null / null | 0.92 / 0.72 |
| python / cascade | python3 / null | 継承 |
| telops.title.layout | default | date-title |
| telops.serif.layout | wrap | space-lines |
| telops.serif.faceRange.enabled | false | true |
| faceRange.top | 0.02 | 0.02 |
| faceRange.minHeight / maxHeight | 0.12 / 0.30 | 0.12 / 0.30 |
| faceRange.fallbackBottom | 0.24 | 0.24 |
| telops.title.box.anchor | top（省略時） | bottom |
| telops.title.box.offsetY | 0（省略時） | 0（ユーザーの変更を維持） |

### 顔選択と構図

元映像の座標系でクリップ全体から等間隔に3枚を抽出する。`detectFaceRects({allFaces:true})`はフレームごとの全候補を返す。既存のzoom・avoidFaceの呼び出しは各フレームの最大顔のまま。

rightは面積最大の顔の高さの50%以上の候補から、中心xが最も右の顔を選ぶ。選んだ顔の中心の各軸中央値と、高さの中央値（元映像高さ比）を計画に残す。顔未検出は全体設定のx/y（両方必要）、中央の順。個別`effects.reframe:false`と`{x,y,zoom}`は維持し、個別x/yは検出より優先、zoomは自動倍率の下限。手動焦点・検出失敗では顔の高さが不明なのでminFaceHeight条件を使わない。

倍率は `clamp(max(zoom, 枠が元映像内に収まる最小倍率, minFaceHeightに届く倍率), 1, maxZoom)`。元映像内の最大アスペクト矩形の幅・高さを基準にする。targetはx=0〜1、y=0〜0.5、zoomとmaxZoomは1〜3、minFaceHeightは0〜1。枠の寸法と原点は偶数に揃える。上限で収まらなければ横だけクランプし、縦は顔をtargetへ置いたまま、枠と元映像の重なりを前景として切り出す。

前景は `crop → fps → restore → CNN upscale`。不足部分はblurなら元映像全体のcover背景（1/4出力サイズ → boxblur=8:1 → brightness=-0.06 → 拡大）にoverlayし、blackならpadする。背景も前景とfpsを揃える。その後ASS、whip。`reframeFilters`が本番・still（先頭trimを付ける-vf経路）・QCのsourceCompareFiltersで共有され、QCは補正無し・Lanczosで前景を拡大する。既存のzoom・avoidFaceはreframe中に警告してスキップする。

manifestのreframeには、はみ出しを含むframe、元映像と重なるcrop、前景の出力矩形foreground、focus、faceHeight、pick、target、zoom、zoomReason（min / center / face size / cap）、zoomNeeded、fill（未使用null）、fallbackを残す。顔未検出はQC `reframe_face_fallback` warn、fill使用は `reframe_fill` info。

### タイトルとセリフ

タイトルのdate-titleモードは、末尾の【…】/『…』をchapterLabelForの最初の置換と同じ規則で落とし、タイトルを最大2行、その下（帯の最下行＝動画の最下部）に日付YYYY/MM/DDを1行置く（当初は日付が1行目だったが、ユーザーの指定で最下行へ移した）。【の直前・】の直後で改行した後、各行を20コードポイントで折る。3行以上なら2行目を最大19文字＋…にする。2行目が短い強制改行の行なら、その末尾に…を付ける。summary.jsは編集していない。

ユーザーの例の文字列は、19文字＋…という規則では2行目が「スーパーマリオブラザーズそろそろ終止符…」になる（例示の「終止…」より1文字多い）。実装とテストは明示された19文字＋…を採用した。

1080幅では左右マージン3.5%（各38px）で48px。`box.anchor`を追加した。既定topで上端からoffsetYの距離を使い、bottomなら下端からの距離を使う。Shortsは`anchor:bottom / offsetY:0 / minHeight:0.11 / pad:8`、上端1709px・高さ211pxで下端1920pxに付く。ユーザーが指定したoffsetY=0をそのまま残し、新しいanchorだけで配置を変える。既存プリセットの帯位置とgoldenは変えない。

セリフはspace-linesを維持する。半角スペースと手動改行だけで分ける。当初は行ごとに幅へ合わせていたが、ユーザーの指定で同じ画面の全行を同じ大きさ（最も長い行が幅に収まる大きさ。高さが足りなければ全行を同じだけ縮める）にした。行の幅はHiraginoの実測（全角1字≈fs×0.66）で見積もる。配色はstillの4案比較（ピンク＋白縁 / 白＋濃紫の太縁 / ピンク＋白＋濃紫の外縁 / 黄＋黒縁）で、一度は白文字＋濃紫3B2366の太縁10px＋影4にしたが、ユーザーの判断で元のピンク文字FF4FA0＋白縁9px＋紫6B3FA0の外縁4px＋影3に戻した。トランジションのSEはShortsでは鳴らさない。Shortsは`marginH:50/1080`で左右50px、内幅980px、`size:0.5`で上限960pxに上げた。fitSpaceLinesの0.97の余裕はそのまま。強調記法・縁取り・fadeは維持する（行ごとのDialogueと行サイズの配列は残し、値を全行同じにしている）。

範囲は`telops.serif.faceRange`で設定する。既定enabled:false、top:0.02 / minHeight:0.12 / maxHeight:0.30 / fallbackBottom:0.24。Shortsでenabled:trueとし、顔の枠の上端を元の顔中心・高さからreframeの実際のframeを通して出力座標へ変換する。top〜その上端の範囲を、高さ12〜30%に制限する。最低12%へ広げた場合は前髪に少し掛かってもよい。顔未検出・顔サイズ不明の手動焦点・reframe無しは固定2〜24%。範囲内でブロックを上下中央に置く。

planClipRenderがreframe後に範囲を決め、buildClipElementsへ渡す。`serifRange`としてセグメントとstillのJSONにsource / faceTop / top / bottom / height / clampedを残す。実際の行別サイズ・位置は描画・manifest・QCで共有する。描画前のL0は顔検出を行わないので固定範囲で検査する。QCのpHashはserifRange下端＋2.5%（最小25%）〜75%を比較し、上部セリフと下端帯を避ける。比較範囲が5%未満の特殊設定はinfoでskipする。旧manifestの比較範囲は維持する。

### stillで決めた値

指定10枚でtarget.y=0.46を確認し、そのまま採用した。全10枚でセリフは計算した範囲内に収まり、顔の枠との重なりは無かった。4行のn5QHz9H5Rq0も38.4〜545.1pxの範囲に504px高のブロックが収まった。上端の小さな余白から前髪付近に置き、最下部の帯へ日付・【タグ】・本文を分離できている。全10枚でタイトル帯の下端は1920px。

## 分割（変更なし）

output.splitは既定null、Shortsは`{by:stream,minSec:10}`。選択・除外・並び替え・limit後の連続する同じvideoIdの塊を使い、短い塊を次へ、短い末尾を直前へまとめる。尺はendTime-startTimeの和。離れた位置の同じ配信を一つにはしない。

`--part N`は分割後の1始まり番号。`<name>-01.mp4`から連番で、render.json / youtube.txt / comment.txt / meta.json / QCも各パート単位。stillは共有planClipRenderを通り、番号・トランジションは所属パートに合わせる。

初版データではやられ25クリップ→7本、侍73クリップ→23本。本数はクリップ追加で変わるため、split.test.jsでは本数を固定せず「漏れなく分ける・各パートがminSec以上」を検証する。

## 今回の検証

- `PATH=/opt/homebrew/bin:$PATH npm test`: **313件成功、失敗0・skip0**。ASS / wrap goldenは変更なし。
- `npx tsc -b`と変更対象のESLint: 成功。
- 指定10クリップを生成して目視確認した（今回はblack比較の追加撮影なし）。ソースの実尺の中央を指定し、クリップJSONのdurationの丸めに依存しない。
- 全10枚について、QCのsourceCompareFiltersで同じ構図を作り、新しいセリフ範囲を外した領域を比較したpHash距離は0〜2（閾値12以下）。
- やられ・侍の全98クリップでL0のテロップ検査を実行し、はみ出し・衝突・行数・禁則の指摘0件。
- 本番のfilter_complex（blur＋whip＋SE＋ASS）を0.5秒だけ描画する確認も成功。全パートは今回生成していない。

PNGはすべて`output/shorts/stills-v3/`配下。`results.json`に各計画と矩形、`contact.png`に一覧を保存した。`verification.txt`にpHash/L0/短い本番経路の確認結果を保存した。

| 目的 | クリップ（ファイル名はこのbase＋末尾のfill＋.png） | fill |
|---|---|---|
| 未検出・右端Detroit | 2025-07-10-h6Ebm2VZ9lY-012286-012346 | -blur |
| コラボ | 2025-10-10-PGjM6A03HoE-004877-004937 | -blur |
| コラボ | 2025-11-12-VoaoEtb_p6U-006719-006779 | -blur |
| 小さい顔 | 2026-09-12-AwfTU_vrJS4-006625-006685 | -blur |
| 小さい顔 | 2026-01-06-u96Q3raITek-002224-002284 | -blur |
| 小さい顔 | 2025-04-16-ntWxZGT-YnY-007924-007984 | -blur |
| 小さい顔 | 2025-06-27-uQBWUjUzJBw-009327-009387 | -blur |
| 普通 | 2024-07-13-gr9WJDYS_u0-000104-000106 | -blur |
| 普通 | 2024-08-09-K5bbHciRSBM-008188-008248 | -blur |
| 4行セリフ | 2026-07-22-n5QHz9H5Rq0-004823-004830 | -blur |

再現例:

```
PATH=/opt/homebrew/bin:$PATH npm run still -- --config scripts/create-video/config-shorts.json --files 2025-10-10-PGjM6A03HoE-004877-004937 --still '#1' --at 4.383 --out output/shorts/stills-v3/2025-10-10-PGjM6A03HoE-004877-004937-blur.png
```

## 制限・残件

この実行環境はMetalが利用できず、Anime4Kは既知のLanczosフォールバック。今回の配置とフィルタ共有は確認できたが、新しい部分前景に対するCNNの実画質はここでは未検証。ユーザー環境では従来のAnime4Kが動くことを確認済み。シェーダの選択と前景の拡大先サイズ・適用順は単体テストで確認している。

全パートの再生成とフルQCは依頼どおりユーザー側で行う。初版の音量・フリーズのwarnを修正する作業は今回の対象外。設定フォームは既存のenum / number / objectで新項目を扱い、schema-walk分類テストを通した。ブラウザ画面の目視確認は今回行っていない。

## 今回の変更ファイル

- 描画: `scripts/create-video/serif-range.js`（新規）, `clip.js`, `ass.js`, `preview.js`
- 設定: `scripts/create-video/config.js`, `config.schema.json`, `config-shorts.json`
- QC: `scripts/create-video/qc/checks/sync.js`, `scripts/create-video/qc/manifest.js`
- テスト: `scripts/create-video/serif-range.test.js`（新規）, `shorts-telops.test.js`, `config.test.js`, `qc/manifest.test.js`, `scripts/dev-server/lib/schema-walk.test.js`
- 文書: `CLAUDE.md`, 本書

