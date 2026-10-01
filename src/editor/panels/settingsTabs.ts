export type SettingsTabId =
  | 'select'
  | 'io'
  | 'telops'
  | 'cards'
  | 'effects'
  | 'summary'
  | 'qc'
  | 'json'

export const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string; rootKeys: string[] | null }> = [
  { id: 'select', label: '選択', rootKeys: ['select'] },
  { id: 'io', label: '出力・ソース', rootKeys: ['output', 'source', 'normalizeCache', 'font', 'fontsDir'] },
  { id: 'telops', label: 'テロップ', rootKeys: ['telops'] },
  { id: 'cards', label: 'カード・OP/ED', rootKeys: ['cards', 'endcaps', 'bgm'] },
  { id: 'effects', label: '効果', rootKeys: ['effects'] },
  { id: 'summary', label: '概要欄', rootKeys: ['summary'] },
  { id: 'qc', label: 'QC', rootKeys: ['qc'] },
  { id: 'json', label: 'JSON', rootKeys: null },
]

export function isSettingsTabId(value: unknown): value is SettingsTabId {
  return typeof value === 'string' && SETTINGS_TABS.some((tab) => tab.id === value)
}
