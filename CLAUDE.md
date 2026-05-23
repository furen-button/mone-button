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
│   ├── videos/          # 動画ファイル
│   └── data/            # JSON 加工データ
├── src/
│   ├── App.tsx         # 状態管理と画面全体の組み立て
│   ├── voiceData.ts    # ボイスデータ型とデータ読み込み
│   ├── components/     # UI コンポーネント群
│   │   ├── CategoryToolbar.tsx
│   │   ├── InfoModal.tsx
│   │   ├── PlaybackControls.tsx
│   │   ├── SortToolbar.tsx
│   │   ├── VideoStage.tsx
│   │   ├── VoiceList.tsx
│   │   └── VolumeDock.tsx
│   └── App.css         # 画面全体のスタイル
├── docs/               # ドキュメント
└── raw/                # 元データ
```

## コーディングルール

### TypeScript
- strict モード
- interface VoiceData を明示定義

### React Hook
- useMemo でデータ計算
- useCallback でイベント
- UI は責務ごとにコンポーネントへ分割する
- データ定義と読み込みは `src/voiceData.ts` にまとめる

### ファイル命名
- コンポーネント：PascalCase
- 関数：camelCase

## ドキュメント管理

- docs/draft.md - 仕様元
- docs/design-concept.md - デザイン
- docs/feature/* - 機能要件
- docs/tasks/* - 開発タスク
