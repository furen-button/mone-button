import { useState } from 'react'
import { useEditorContext } from '../schema-form/EditorContext'
import { SchemaForm } from '../schema-form/SchemaForm'
import type { FormExpansion } from '../schema-form/fields/ObjectFieldset'
import { SETTINGS_TABS, type SettingsTabId } from './settingsTabs'

type SettingsPanelProps = {
  activeTab: SettingsTabId
  onTabChange(tab: SettingsTabId): void
  showResolved: boolean
  onShowResolvedChange(value: boolean): void
  hideInherited: boolean
  onHideInheritedChange(value: boolean): void
  jsonText: string
  hasPreset: boolean
}

export function SettingsPanel({
  activeTab,
  onTabChange,
  showResolved,
  onShowResolvedChange,
  hideInherited,
  onHideInheritedChange,
  jsonText,
  hasPreset,
}: SettingsPanelProps) {
  const context = useEditorContext()
  const [expansion, setExpansion] = useState<FormExpansion>({ mode: 'none', token: 0 })
  const selectedTab = SETTINGS_TABS.find((tab) => tab.id === activeTab) ?? SETTINGS_TABS[0]
  const preflightResults = context.preflight.response?.preflight?.results ?? []

  return (
    <div className="cv-settings">
      <div className="cv-sectionHeader">
        <h2>設定</h2>
        <div className="cv-settingsTools">
          <label className="cv-toggle">
            <input type="checkbox" checked={hideInherited} onChange={(event) => onHideInheritedChange(event.target.checked)} />
            <span>継承項目を隠す</span>
          </label>
          <button type="button" className="cv-button" onClick={() => setExpansion((current) => ({ mode: 'expand', token: current.token + 1 }))}>
            すべて展開
          </button>
          <button type="button" className="cv-button" onClick={() => setExpansion((current) => ({ mode: 'collapse', token: current.token + 1 }))}>
            折りたたむ
          </button>
        </div>
      </div>

      <nav className="cv-subtabs" aria-label="設定カテゴリ">
        {SETTINGS_TABS.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={selectedTab.id === tab.id ? 'cv-subtab is-active' : 'cv-subtab'}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {preflightResults.length > 0 ? (
        <details className="cv-preflightList">
          <summary>preflight 結果 {preflightResults.length} 件</summary>
          <ul>
            {preflightResults.map((result, index) => (
              <li key={`${result.code}:${index}`} className={`is-${result.level}`}>
                <strong>{result.level}</strong> {result.code}: {result.message}
                {result.detail ? <span className="cv-resultDetail"> {String(result.detail)}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {selectedTab.rootKeys ? (
        <SchemaForm rootKeys={selectedTab.rootKeys} expansion={expansion} />
      ) : (
        <div className="cv-jsonPanel">
          <label className="cv-toggle">
            <input type="checkbox" checked={showResolved} onChange={(event) => onShowResolvedChange(event.target.checked)} />
            <span>解決済み（DEFAULTS を含む）を表示</span>
          </label>
          <pre className="cv-json" aria-label="preset json">
            {hasPreset ? jsonText : 'プリセットを選択してください'}
          </pre>
        </div>
      )}
    </div>
  )
}
