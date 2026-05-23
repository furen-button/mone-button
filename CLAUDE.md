# CLAUDE.md

## プロジェクト概要
「もねボタン」は、にじさんじ所属の VTuber「梢桃音」のボイスをボタンクリックで再生できる Web アプリケーション。

## テクニカルスタック
- **フレームワーク**: Vite + React + TypeScript
- **動画再生**: HTML5 Video API
- **データ管理**: JSON API 層
- **ファイル管理**: local file system

## プロジェクト構造
```
mone-button/
├── public/              # 静的リソース
├── src/
│   ├── api/            # データ API
│   ├── components/     # React コンポーネント
│   ├── hooks/          # カスタムフック
│   └── styles/         # グローバルスタイル
├── data/               # JSON 加工データ（コミット）
├── docs/               # ドキュメント
├── videos/             # 動画ファイル（コミット）
└── raw/                # 元データ
```

## データ管理

### ファイル方針
- **raw/** = 元 JSON（ダウンロード直後、gitignore）
- **data/** = 加工済み JSON、コミット対象
- **videos/** = 動画を圧縮して保存、コミット対象

### 加工ルール
1. raw/*.json から各ボイスの情報を抽出
2. videos/ に動画ファイルを保存
3. data/voices.json に必要な情報のみ記録
   - id, title, subtitle, category[], videoFileId
   - originalUrl, startTime, endTime

### API 層
src/api/data.ts が提供：
- getVoices() - 全ボイスリスト
- getVoicesByCategory() - カテゴリ別

## アーキテクチャ

### データフロー
raw/*.json → API 抽出 → data/voices.json
raw/*.json → yt-dlp → videos/*.mp4

### API 実装
src/api/data.ts は data/voices.json を読み込んで：
- カテゴリでフィルタ
- 動画ファイルパスを返す

## コーディングルール

### TypeScript
- strict モード
- interface VoiceData を明示定義

### React Hook
- useMemo でデータ計算
- useCallback でイベント

### ファイル命名
- コンポーネント：PascalCase
- 関数：camelCase

## Git 管理方針

### gitignore
raw/

### コミット対象
- src/ - ソースコード
- data/voices.json - 加工データ
- videos/*.mp4 - 動画ファイル
- public/ - 静的ファイル
- docs/ - ドキュメント

## ドキュメント管理

- docs/draft.md - 仕様元
- docs/design-concept.md - デザイン
- docs/feature/* - 機能要件
- docs/tasks/* - 開発タスク

## 開発ワークフロー
1. ドキュメント確認
2. 機能要件作成
3. data/voices.json 生成
4. 動画ダウンロード
5. コーディング
