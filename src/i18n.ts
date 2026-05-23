type TranslationTree = {
  [key: string]: string | TranslationTree
}

import { createContext, useContext } from 'react'

export type Locale = 'ja' | 'en'

const ja: TranslationTree = {
  app: {
    title: 'ボイスカード',
    copy: 'ボタンを押すと、ランダムな名言クリップを再生します。',
    language: {
      label: '言語',
      ja: '日本語',
      en: 'English',
    },
  },
  playback: {
    controls: 'ボイス再生コントロール',
    random: {
      icon: 'ドドーン♪',
      label: 'ランダム再生',
    },
    garageya: {
      icon: 'わいわい',
      label: 'ガヤガヤ再生',
    },
    stop: {
      label: '停止',
      ariaLabel: '再生を停止',
    },
    sequential: {
      on: 'ON',
      off: 'OFF',
      label: '連続再生 {{state}}',
    },
  },
  category: {
    toolbar: 'カテゴリフィルター',
    selectAll: '全選択',
    clearAll: '全解除',
    countAria: '{{category}} の件数',
  },
  sort: {
    toolbar: 'ソートコントロール',
    label: '並び順',
    readingPrefix: 'あ',
    reading: '読み順',
    streamDesc: '配信日(新しい順)',
    streamAsc: '配信日(古い順)',
  },
  video: {
    placeholder: 'カードを押すとここに動画がランダム表示されます',
  },
  voiceList: {
    cardsAria: 'ボイスカード一覧',
    streamGroupsAria: '配信別ボイスカード一覧',
    emptyClips: '選択中のカテゴリに該当するボイスがありません。',
    emptyGroups: '選択中のカテゴリに該当する配信がありません。',
  },
  voiceCard: {
    infoAria: '元動画情報を表示',
  },
  streamGroup: {
    dateLabel: '配信日',
  },
  infoModal: {
    title: '元動画情報',
    uploadDate: '配信日: {{date}}',
    serif: 'セリフ',
    ruby: 'ルビ',
    category: 'カテゴリー',
    openClip: 'このボイスの開始位置を開く',
    openVideo: '元動画ページを開く',
    close: '閉じる',
  },
  volume: {
    section: '音量調整',
    label: '再生音量',
  },
}

const en: TranslationTree = {
  app: {
    title: 'Voice Cards',
    copy: 'Press a button to play a random quote clip.',
    language: {
      label: 'Language',
      ja: 'Japanese',
      en: 'English',
    },
  },
  playback: {
    controls: 'Playback controls',
    random: {
      icon: 'Boom!',
      label: 'Play Random',
    },
    garageya: {
      icon: 'Hype',
      label: 'Play Multi',
    },
    stop: {
      label: 'Stop',
      ariaLabel: 'Stop playback',
    },
    sequential: {
      on: 'ON',
      off: 'OFF',
      label: 'Sequential {{state}}',
    },
  },
  category: {
    toolbar: 'Category filter',
    selectAll: 'Select all',
    clearAll: 'Clear all',
    countAria: '{{category}} count',
  },
  sort: {
    toolbar: 'Sort controls',
    label: 'Order',
    readingPrefix: 'A-Z',
    reading: 'Reading',
    streamDesc: 'Stream date (newest)',
    streamAsc: 'Stream date (oldest)',
  },
  video: {
    placeholder: 'Press a card and a random clip will appear here.',
  },
  voiceList: {
    cardsAria: 'Voice card list',
    streamGroupsAria: 'Stream-grouped voice card list',
    emptyClips: 'No voice clips match the selected categories.',
    emptyGroups: 'No streams match the selected categories.',
  },
  voiceCard: {
    infoAria: 'Show source video details',
  },
  streamGroup: {
    dateLabel: 'Date',
  },
  infoModal: {
    title: 'Source Video Info',
    uploadDate: 'Date: {{date}}',
    serif: 'Line',
    ruby: 'Reading',
    category: 'Category',
    openClip: 'Open this clip at start time',
    openVideo: 'Open source video page',
    close: 'Close',
  },
  volume: {
    section: 'Volume control',
    label: 'Playback volume',
  },
}

const dictionaries: Record<Locale, TranslationTree> = {
  ja,
  en,
}

const LocaleContext = createContext<Locale>('ja')

export const LocaleProvider = LocaleContext.Provider

export function useLocale(): Locale {
  return useContext(LocaleContext)
}

export const localeOptions: Locale[] = ['ja', 'en']

function resolveTranslation(tree: TranslationTree, key: string): string | undefined {
  return key.split('.').reduce<string | TranslationTree | undefined>((current, segment) => {
    if (!current || typeof current === 'string') {
      return undefined
    }

    return current[segment]
  }, tree) as string | undefined
}

export function t(key: string, values: Record<string, string | number> = {}, locale: Locale = 'ja'): string {
  const current = dictionaries[locale]
  const template = resolveTranslation(current, key) ?? resolveTranslation(ja, key)

  if (!template) {
    return key
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_match, placeholder: string) => {
    const value = values[placeholder]
    return value === undefined ? '' : String(value)
  })
}