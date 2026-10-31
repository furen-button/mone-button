# クリップ編集モーダルのローカル文字起こし

## 仕様

- 対象は dev サイトの `ClipEditModal` のみ。`editor.html` には追加しない。
- 「🎤 文字起こし」で `public/videos/<fileBaseName>.mp4` 全体（トリム保存済みの最新状態）を起こし、serif / ruby の React state を上書きする。
- 「serif から読みを作る」で手修正した serif から ruby だけを再生成する。
- 結果は未保存として表示し、JSON への書き込みは従来の「保存」(`/__data/save`) のみ。
- 実行中は両生成ボタン・serif / ruby 入力・保存を無効化。モーダルを閉じると AbortController で通信を中断し、結果を捨てる。サーバで開始済みの処理は完了またはタイムアウトまで継続する。

## サーバ処理と設定

`/__data/transcribe` と `/__data/ruby` は Vite serve 専用。既存のローカルリクエストガードを使用する。

- `POST /__data/transcribe { fileBaseName }` → `{ serif, ruby, raw, ms }`。既存 JSON を検証し、mp4 がなければ404。
- `POST /__data/ruby { text }` → `{ ruby }`。text は2000文字以内の文字列（空文字は可）。
- `scripts/dev-server/lib/transcribe.js` に処理を配置。文字起こしはプロセス内の Promise チェーンで1本ずつ実行する。
- ffmpeg は既存の `resolveFfmpeg()` で解決し、16kHz / mono / pcm_s16le WAV を一時ディレクトリに作る。
- whisper-cli をシェルを通さず実行する。引数は `-m <model> -l ja -nt -np -mc 0 -otxt -of <prefix> -f <wav>`。言語は設定可能。子プロセスは120秒で強制終了し、一時ディレクトリは finally で削除する。
- txt の `[_TT_123]` などの特殊トークンを除き、改行・連続空白を半角スペース1つにする。
- ruby は npm devDependency の kuromoji を遅延初期化してキャッシュ。半角カナ（U+FF61〜U+FF9F）の区間はトークナイズ前に NFKC で全角カタカナへ揃える（kuromoji は半角カナを未知語として表層形のまま返すため。全文には掛けない）。カタカナ読みをひらがなにし、未知語は表層形を使う。句読点・空白・記号・括弧を除去し、数字・英字・長音・小書き仮名を保持する。読みは辞書によるため、必要に応じて手修正する。

必要なものは ffmpeg、PATH 上の `whisper-cli`、Whisper モデル（ggml-*.bin）。
`.env` / `.env.local` に下記を設定できる（変更後は dev サーバを再起動）。Vite `loadEnv` で `WHISPER_` だけを読み、プロセス環境変数を優先する。クライアントには公開しない。

```dotenv
WHISPER_CLI=whisper-cli
WHISPER_MODEL_PATH=<Whisper モデルの絶対パス>
WHISPER_LANGUAGE=ja
```

`WHISPER_MODEL_PATH` は必須で、既定値は持たない。モデルの置き場所はマシンごとに違うため、リポジトリにはパスを書かず、git 管理外の `.env.local` に絶対パスで書く。未設定のときは、設定方法を示すエラーを返す。

## 確認手順

1. `npm test`、`npm run lint`、`npx tsc -b` を実行する。ライブラリテストは実 kuromoji 辞書を使用し、whisper 本体は呼ばない。
2. `npm run dev -- --host 127.0.0.1` を起動し、表示されたポートを使って API を確認する。

```sh
curl -sS http://127.0.0.1:5173/__data/ruby \
  -H 'Origin: http://127.0.0.1:5173' -H 'Content-Type: application/json' \
  -d '{"text":"1000年以上生きた 魔法使いなんですね"}'
curl -sS http://127.0.0.1:5173/__data/transcribe \
  -H 'Origin: http://127.0.0.1:5173' -H 'Content-Type: application/json' \
  -d '{"fileBaseName":"<public/data と public/videos に存在するクリップ名（拡張子なし）>"}'
```

3. ruby API が `1000ねんいじょういきたまほうつかいなんですね` を返すこと、transcribe API が serif / ruby / raw / ms を返すことを確認する。不正な text は400、動画なしは404、Origin 不一致は403になることも確認する。
4. dev サイトのクリップ編集で文字起こしし、両欄と未保存表示が更新されること、serif 手修正後に ruby だけ再生成できることを確認する。「保存」前には元 JSON が変化しないことを確認する。
5. 処理中に閉じて再度開き、以前の結果が反映されないことを確認する。失敗時のメッセージと再実行も確認する。
6. 確認に使った dev サーバを停止する。

## 検証結果（2026-10-17、M3 Pro、brew の whisper-cli + ggml-large-v3）

- `scripts/dev-server/lib/transcribe.test.js` の 4 件、`npm run lint`、`npx tsc -b` が成功。
- `npm test` は 175 件中 174 件成功。失敗した 1 件は ASS golden で、fixture に無い未追跡の `public/data/*.json` が作業ツリーにあるため。今回の変更とは関係しない。
- kuromoji の依存（async → lodash 4.17.21）で npm audit の high が 1 件増えたため、`npm audit fix` で lodash を 4.18.1 に上げた（async の許容範囲 `^4.17.14` の中）。残る 4 件は firebase / @grpc/grpc-js の既存分。
- dev サーバ上で curl を使って確認した結果:
  - `/__data/ruby` に「1000年以上生きた 魔法使いなんですね」を渡すと `1000ねんいじょういきたまほうつかいなんですね` が返る。text が文字列でなければ 400、Origin が違えば 403、fileBaseName が不正なら 400
  - `/__data/transcribe` で 5 クリップを起こし、1 本 3.3〜8.2 秒で serif / ruby / raw / ms が返った。固有名詞はほぼ当て字になる（例: 梢桃音 → 小瀬尾根 / 梢江萌音 / 小勢萌音）。叫び声は「こだちがうううう…」のように長音が伸びる
- headless Chrome でクリップ編集モーダルを開き、実行中はボタンが「文字起こし中…」で無効になること、完了後に serif / ruby と「文字起こし結果を入れました（未保存）」が出ること、serif を「梢桃音です」に直して「serif から読みを作る」を押すと ruby が `こずえももおんです` になることを確認した（kuromoji の辞書読みなので、固有名詞は手で直す）。確認後も `public/data` の JSON は変わっていない。
