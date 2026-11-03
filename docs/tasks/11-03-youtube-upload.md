# YouTube への自動アップロード（npm run upload）

## 目的

createVideo の出力（mp4・概要欄・固定コメント・サムネイル）を、YouTube へ**非公開で上げるところまで**自動にする。公開への切り替えは Studio で手作業にし、そのたびに権利を最終確認する。

## 08-16 の方針から変えた理由

`docs/tasks/08-16-youtube-upload.md` は「手動アップロード + メタデータ自動生成」を方針にしていた。根拠にしていた 2 つの制約は、2026-11-03 に公式リファレンスを確認した時点でどちらも無くなっていた。

| 08-16 の根拠 | 2026-11-03 の公式リファレンス |
|---|---|
| 未監査の API プロジェクトから上げると private 固定 | videos.insert のリファレンスに "Videos uploaded from unverified API projects are not restricted to private viewing mode." とある（解除を告知する Revision History のエントリは見つけていない） |
| 1 本 1,600 units = 1 日 6 本 | 2025-12-04 に約 100 units へ下がり、2026-06-01 からはアップロード専用の bucket（1 日 100 回）になった |

一方で、Shorts を分割すると本数が多くなる（2026-11-01 のデータで、やられが 7 本、侍が 23 本）。これを手で上げるのは手間なので、自動化に切り替える。

## 決めたこと（2026-11-03）

| 項目 | 決定 |
|---|---|
| 自動にする範囲 | アップロード・サムネイル・コメント投稿まで。公開への切り替えは Studio で手作業 |
| 上げた直後の公開状態 | 非公開（`private`）。設定では変えられないようにする |
| ライブラリ | Google 公式の `@googleapis/youtube`。`googleapis` 本体は展開後 247MB あるので、API 単体のパッケージ（1.8MB）を使う |
| タイトル | プリセットにひな形を書き、createVideo が meta.json に解決済みのタイトルを書く |
| 権利 | 基本は確認済み。公開へ切り替えるたびに最終確認する（upload の最後に確認項目を出す） |

## 流れ

```
createVideo --qc → 目視して output/0_reviewed/ へ移す → thumb.html でサムネイル
        ↓
npm run upload -- --video <mp4> --dry-run   … 事前検査と送信内容の表示だけ
npm run upload -- --video <mp4>
  1. 事前検査（通信しない）
  2. channels.list(mine) で上げ先チャンネルを確かめる
  3. videos.insert（private）
  4. thumbnails.set
  5. commentThreads.insert（+ 分割分は comments.insert で返信）
  6. <name>.upload.json に結果を書く
        ↓
Studio: 権利の最終確認 → コメントのピン留め → 終了画面 → 公開
```

## アカウントと認証情報（.env.local）

YouTube Data API は ID・パスワードでのログインを受け付けない。OAuth でブラウザから一度認可し、そのとき得た **refresh token が「どのチャンネルに上げるか」を表す**。ブランドアカウントのチャンネルは、同意画面のアカウント選択で選ぶ。

`.env` は git 管理の対象になる（`.gitignore` が除外するのは `*.local` だけ）ため、認証情報は **`.env.local` に書く**。`.env.example` にはキー名だけを追加する。`VITE_` を付けるとフロントのバンドルに入るので付けない。

```
# YouTube へのアップロード（npm run upload 専用。VITE_ 接頭辞を付けない）
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
# npm run upload -- --login が書き込む。端末には出さない
YOUTUBE_REFRESH_TOKEN=
# 上げ先チャンネル（UC...）。トークンのチャンネルと違えば止める。空なら --login が書き込む
YOUTUBE_CHANNEL_ID=
```

- 優先順位は Whisper の設定と同じ「プロセス環境変数 > `.env.local` > `.env`」。CLI は Vite を通らないので、Node 組み込みの `util.parseEnv` で読む。
- `--login` は `127.0.0.1` の空きポートで待ち受けてブラウザで認可させ、`channels.list(mine)` で認可されたチャンネルを表示する。`YOUTUBE_CHANNEL_ID` が空ならその値を書き、設定済みで値が違えば token を保存せずに止める（別アカウントを選んだ事故を防ぐ）。`.env.local` の `YOUTUBE_REFRESH_TOKEN` 行だけを書き換え、ほかの行は変えない。
- スコープは `youtube.upload`（動画・サムネイル）と `youtube.force-ssl`（コメント）。`force-ssl` はチャンネルの動画を削除できる権限なので、token が漏れたら Google アカウントの「サードパーティのアクセス」から取り消す。
- 複数チャンネルの切り替えは今回やらない。1 つの `.env.local` で 1 チャンネルを扱う。

## Google Cloud の準備（初回だけ・手作業）

1. Google Cloud でプロジェクトを作り、YouTube Data API v3 を有効にする。
2. OAuth 同意画面を「外部」で作る。公開ステータスは **「本番」** にする。「テスト」のままだと refresh token が 7 日で切れる（Google の OAuth 2.0 ドキュメントに記載）。本番にしても審査を通していないアプリとして警告が出るが、自分のアカウントだけで使うなら進められる見込み。実際の表示は初回の設定時に確かめる。
3. 「デスクトップアプリ」の OAuth クライアントを作り、ID と secret を `.env.local` に書く。
4. `npm run upload -- --login` を実行する。

## コマンド

```
npm run upload -- --login
npm run upload -- --video output/0_reviewed/<name>.mp4 --dry-run
npm run upload -- --video output/0_reviewed/<name>.mp4
npm run upload -- --video 'output/shorts/2024-08-09-category-侍-shorts-*.mp4'
```

| オプション | 説明 |
|---|---|
| `--login` | ブラウザで認可し、`.env.local` に refresh token を書く |
| `--video <path>` | 上げる mp4。複数指定と glob に対応し、1 本ずつ順に上げる。失敗したらそこで止める |
| `--dry-run` | 事前検査と送信内容の表示だけ行い、何も送らない |
| `--title <text>` | meta.json のタイトルを上書きする |
| `--no-thumbnail` / `--no-comment` | その段を飛ばす |
| `--retry-video` | 前回の動画送信が失敗した状態から送り直す（後述） |
| `--allow-qc-error` | qc.json の error を警告に下げて上げる。目視で誤検出と確かめたときだけ使う。upload.json に `qcErrorAllowed: true` を残す。形式不正の qc.json は下げない |

## 付随ファイルの探し方

mp4 の隣 → `output/` → `output/0_reviewed/` の順に探す（`scripts/dev-server/lib/thumbnail-paths.js` と同じ順）。実際に `0_reviewed/` には mp4・meta.json・youtube.txt・サムネイルだけを移していて、comment・render・qc は `output/` 直下に残っている例がある。

| ファイル | 用途 | 無いとき |
|---|---|---|
| `<name>.meta.json` | タイトル・タグ・カテゴリ | 止める |
| `<name>.youtube.txt` | 概要欄 | 止める |
| `<name>.thumbnail.jpg` / `.png` | サムネイル | 飛ばす |
| `<name>.comment.txt` / `.comment-N.txt` | コメント | 飛ばす |
| `<name>.render.json` | mp4 の SHA-256 の照合 | 警告して続ける |
| `<name>.qc.json` | error の有無 | 警告して続ける。render.json と同じ場所にあり、その SHA-256 が一致したときだけ信じる |

## 事前検査（通信しない。--dry-run でも走る）

全候補を先に検査し、error が 1 件でもあれば何も送らずに止める。

- タイトルが 1〜100 文字で、`<` `>` を含まない
- 概要欄が **5,000 バイト**以内で、`<` `>` を含まない（API の上限はバイト数。日本語は 1 文字 3 バイトなので約 1,666 字）
- タグが合計 500 文字以内（区切りのカンマを数え、空白を含むタグは引用符 2 文字も数える）
- サムネイルが 50MB 以内の jpeg / png
- render.json の SHA-256 が mp4 と一致する
- qc.json に error が無い
- upload.json を見て、同じ mp4 を上げ済みでない

## API の呼び出しと quota

| 順 | API | quota | 内容 |
|---|---|---|---|
| 1 | `channels.list`（mine） | 1 | token のチャンネルが `YOUTUBE_CHANNEL_ID` と一致するか確かめる |
| 2 | `videos.insert` | アップロード bucket 1 回（1 日 100 回） | 動画とメタデータ |
| 3 | `thumbnails.set` | 50 | サムネイルがあれば |
| 4 | `commentThreads.insert` | 50 | comment.txt（分割時は comment-1.txt） |
| 5 | `comments.insert` | 50 × (分割数 − 1) | 2 個目以降を 1 個目への返信にして、ピン留めする 1 個目の下にまとめる |

1 本あたり通常の bucket で約 100〜150 units。既定の 1 日 10,000 units に対して十分に小さい。

videos.insert の本文:

- `snippet`: `title` / `description` / `tags` / `categoryId`（既定 `24` = エンターテイメント）/ `defaultLanguage: ja` / `defaultAudioLanguage: ja`
- `status`: `privacyStatus: private`（固定）/ `selfDeclaredMadeForKids: false` / `containsSyntheticMedia`（既定 `false`）

`containsSyntheticMedia` は改変・合成コンテンツの申告。Anime4K による線の補正は既存映像の画質補正で、実在の人物や出来事を作り出すものではないため既定を `false` にする。プリセットで変えられるようにする。

## 送信と失敗時の扱い

- 公式ライブラリの動画送信は 1 回のリクエストで送る（`uploadType=multipart`）。途中から再開する仕組み（resumable）は持っていない（`googleapis-common` 9 の `build/src/apirequest.js` で確認）。現在の mp4 は 7〜128MB なので、一括送信で足りる。
- 動画の送信中に失敗しても**自動では送り直さない**。サーバ側では受け取れていて、送り直すと同じ動画が 2 本できることがあるため。upload.json の `steps.video` に `"failed"` を残して止める。送信前にこの状態を書き込むので、送信中のプロセス終了でも再送には明示指定が必要になる。Studio で動画ができていないことを確かめてから `--retry-video` で送り直す。
- サムネイルとコメントの段で失敗した場合は videoId が upload.json に残る。再実行すると、終わっていない段から続ける。
- mp4 を作り直して SHA-256 が変わった場合は、upload.json があれば止める。古い動画を Studio で消してから upload.json を消して上げ直す。

## upload.json

mp4 と同じ場所に `<name>.upload.json` を書く（git 管理外の `output/` の中）。

```json
{
  "version": 1,
  "video": "2024-07-13-category-やられ-kirinuki.mp4",
  "sha256": "…",
  "channelId": "UC…",
  "videoId": "…",
  "url": "https://youtu.be/…",
  "privacyStatus": "private",
  "uploadedAt": "2026-11-03T12:00:00+09:00",
  "title": "…",
  "steps": {
    "video": "done",
    "thumbnail": "done",
    "comment": "done"
  },
  "commentIds": ["…"]
}
```

## タイトルのひな形

プリセットに `upload.title` を書き、createVideo の `writeSummary` が解決して meta.json の `upload.title` に入れる。upload は meta.json だけを読む。ひな形が未指定なら空のタイトルを書き、アップロード時に `--title` が必要になる。既存プリセットにはひな形を追加しない。

| 置き換え | 中身 |
|---|---|
| `{category}` | 選択したカテゴリ名（複数なら「・」でつなぐ） |
| `{title}` | 先頭クリップの配信タイトル（`chapterLabelFor` と同じ整形） |
| `{date}` | 先頭クリップの配信日（YYYY/MM/DD） |
| `{serif}` | 先頭クリップのセリフ（強調記法と改行を落とす） |
| `{n}` | クリップ数 |
| `{part}` / `{parts}` | 分割（`output.split`）時のパート番号と総数 |

100 文字を超えたら `{serif}` → `{title}` の順に末尾を「…」で詰める。それでも超える場合と、`<` `>` を含む場合は警告する（upload の事前検査で止まる）。

例（文言は公開前に決める）:

- `config-kirinuki.json`: `【梢桃音】{category}まとめ【にじさんじ/切り抜き】`
- `config-shorts.json`: `{serif}【梢桃音/にじさんじ】#shorts`

`upload` の他の項目は `categoryId` と `containsSyntheticMedia`。どちらも meta.json の `upload` に書き写す。

## 概要欄のバイト数

`summary.js` の `maxChars` は文字数で数えているため、API の 5,000 バイト超過を検知できない。createVideo の時点で気づけるよう、`summary.maxBytes`（既定 5000）で警告を出す。

2026-11-03 の実測:

| 出力 | 文字数 | バイト数 |
|---|---:|---:|
| `0_reviewed/2024-07-13-category-やられ-kirinuki.youtube.txt` | 2,241 | 3,859 |
| `0_reviewed/2024-08-09-category-侍-kirinuki.youtube.txt` | 5,166 | **7,360** |
| `2024-06-22-files-matome.youtube.txt` | 2,243 | 4,793 |

侍 kirinuki はこのままでは上げられない。出典を削る、`summary.chapters.by: stream` にする、などの対処を別途決める。

## Studio で手作業すること

upload は終わりに次の確認項目を出す。

1. 公開前の最終確認: 二次創作ガイドライン、コラボ相手の条件、出典と非公式表記
2. コメントのピン留め（API にピン留めの操作は無い）
3. 終了画面の要素（API では設定できない）
4. 公開に切り替える

## 実装

- `scripts/youtube-upload/`
  - `index.js`: CLI
  - `env.js`: `.env` / `.env.local` の読み込みと `.env.local` の 1 行書き換え
  - `auth.js`: OAuth（loopback、`--login`）と OAuth2 クライアントの生成
  - `plan.js`: 付随ファイル・meta.json から送信内容を作り、事前検査する（通信しない純粋関数）
  - `api.js`: channels / videos / thumbnails / comments の呼び出し。テストではクライアントを差し替える
  - `record.js`: upload.json の読み書き
- `scripts/create-video/summary.js`: `upload` の解決と meta.json への書き出し、`maxBytes` の警告
- `scripts/create-video/config.js`: upload と summary.maxBytes の既定値
- 設定エディタの「概要欄」: upload も編集対象にする
- `scripts/create-video/config.schema.json`: `upload`（`title` / `categoryId` / `containsSyntheticMedia`）と `summary.maxBytes`
- `package.json`: `@googleapis/youtube` を追加し、`upload` スクリプトを足す
- `.env.example`: `YOUTUBE_*` のキー
- テスト: `plan.test.js`（バイト数・タグの数え方・`<>`・SHA 照合・付随ファイルの探索）、`env.test.js`（優先順位・1 行書き換え）、`record.test.js`（段ごとの再開・`--retry-video`）、`api.test.js`（偽クライアントで呼び出し順と本文）。`npm test` に含める

## 今回やらないこと

- 予約公開（`status.publishAt`）
- 再生リストへの追加
- 設定エディタの概要欄タブからのアップロード
- 複数チャンネルの切り替え
- resumable upload（大きな動画で一括送信が失敗するようになったら検討する）

## 残件

- 侍 kirinuki の概要欄が 7,360 バイトで上限を超えている。対処を決める。
- OAuth 同意画面を本番にしたときの警告の出方を、初回設定時に確かめる。
- Shorts に `thumbnails.set` が効くかは未確認。Shorts のサムネイルは今は作っていないので、当面は影響しない。

## 関連

- `docs/tasks/08-16-youtube-upload.md` - 公開計画（ラインナップ・権利の pre-flight）
- `docs/tasks/11-02-thumbnail.md` - サムネイル
- `docs/tasks/11-01-create-video-shorts.md` - Shorts の分割
- `scripts/create-video/summary.js` - 概要欄・固定コメント・meta.json
