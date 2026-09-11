import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { EditorApiError, getPreset, getSchema, listPresets, savePreset } from './api'
import { usePreflight } from './hooks/usePreflight'
import { SettingsPanel } from './panels/SettingsPanel'
import { isSettingsTabId, type SettingsTabId } from './panels/settingsTabs'
import { EditorContextProvider } from './schema-form/EditorContext'
import { collectSchemaPathKeys, errorPathFromMessage, pathKey } from './schema-form/resolveSchema'
import {
  applyPatch,
  deepMerge,
  dirtyCount,
  initialPresetStore,
  patchPayloadFromState,
  presetStoreReducer,
} from './state/presetStore'
import { loadSession, saveSession } from './state/session'
import type { ConflictPreset, JsonObject, Patch, PresetFile, PresetSummary, SchemaResponse, ValidationResult } from './types'

type LoadOptions = {
  patch?: Patch
}

type Status = 'idle' | 'loading' | 'saving' | 'saved' | 'error'
type TabId = 'clips' | 'preview' | 'settings' | 'build' | 'summary'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'clips', label: 'クリップ' },
  { id: 'preview', label: 'プレビュー' },
  { id: 'settings', label: '設定' },
  { id: 'build', label: 'ビルド' },
  { id: 'summary', label: '概要欄' },
]

export function EditorApp() {
  const [schemaResponse, setSchemaResponse] = useState<SchemaResponse | null>(null)
  const [presets, setPresets] = useState<PresetSummary[]>([])
  const [currentPreset, setCurrentPreset] = useState<PresetFile | null>(null)
  const [store, dispatch] = useReducer(presetStoreReducer, initialPresetStore)
  const [activeTab, setActiveTab] = useState<TabId>('settings')
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTabId>('select')
  const [showResolved, setShowResolved] = useState(false)
  const [hideInherited, setHideInherited] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [conflict, setConflict] = useState<ConflictPreset | null>(null)

  const patch = useMemo(() => patchPayloadFromState(store.patch), [store.patch])
  const dirty = dirtyCount(store)
  const draft = useMemo(() => applyPatch(store.raw, patch), [store.raw, patch])
  const resolved = useMemo(() => {
    if (!schemaResponse) {
      return draft
    }
    return deepMerge(schemaResponse.defaults, draft) as JsonObject
  }, [draft, schemaResponse])
  const preflight = usePreflight(store.name, draft)
  const jsonText = useMemo(() => JSON.stringify(showResolved ? resolved : draft, null, 2), [draft, resolved, showResolved])
  const validation = preflight.response?.validation ?? currentPreset?.validation ?? VALIDATION_OK
  const schemaPathKeys = useMemo(() => (schemaResponse ? collectSchemaPathKeys(schemaResponse.schema) : new Set<string>()), [schemaResponse])
  const unmatchedValidationErrors = useMemo(
    () => validation.errors.filter((error) => {
      const errorPath = errorPathFromMessage(error)
      return !errorPath || !schemaPathKeys.has(pathKey(errorPath))
    }),
    [schemaPathKeys, validation.errors],
  )
  const preflightSummary = preflight.response?.preflight?.summary ?? { error: 0, warn: 0, info: 0 }
  const selectError = preflight.response?.selectError ?? ''
  const selectedSummary = presets.find((preset) => preset.name === store.name)?.summary ?? null
  const patchKeys = useMemo(() => new Set(store.patch.set.keys()), [store.patch.set])
  const unsetKeys = useMemo(() => new Set(store.patch.unset), [store.patch.unset])
  const setValue = useCallback((path: string[], value: unknown) => {
    dispatch({ type: 'setValue', path, value })
  }, [])
  const unsetValue = useCallback((path: string[]) => {
    dispatch({ type: 'unsetValue', path })
  }, [])
  const editorContext = useMemo(() => ({
    schema: schemaResponse?.schema ?? {},
    defaults: schemaResponse?.defaults ?? {},
    raw: store.raw,
    draft,
    resolved,
    patch: patchKeys,
    unsetKeys,
    setValue,
    unsetValue,
    hideInherited,
    preflight,
  }), [draft, hideInherited, patchKeys, preflight, resolved, schemaResponse, setValue, store.raw, unsetKeys, unsetValue])

  const loadPresetByName = useCallback(async (name: string, options: LoadOptions = {}) => {
    setStatus('loading')
    setErrorMessage('')
    try {
      const preset = await getPreset(name)
      dispatch({ type: 'load', preset, patch: options.patch })
      setCurrentPreset(preset)
      setConflict(null)
      setStatus('idle')
    } catch (error) {
      setStatus('error')
      setErrorMessage(messageFromError(error))
    }
  }, [])

  useEffect(() => {
    let ignore = false

    async function boot() {
      setStatus('loading')
      setErrorMessage('')
      const session = loadSession()
      if (isTabId(session?.tab)) {
        setActiveTab(session.tab)
      }
      if (isSettingsTabId(session?.settingsTab)) {
        setActiveSettingsTab(session.settingsTab)
      }

      try {
        const schema = await getSchema()
        if (ignore) {
          return
        }
        setSchemaResponse(schema)

        const presetList = await listPresets()
        if (ignore) {
          return
        }
        setPresets(presetList)

        const firstName = session?.name && presetList.some((preset) => preset.name === session.name)
          ? session.name
          : presetList[0]?.name
        if (!firstName) {
          setStatus('idle')
          return
        }

        const preset = await getPreset(firstName)
        if (ignore) {
          return
        }
        dispatch({ type: 'load', preset, patch: session?.name === firstName ? session.patch : undefined })
        setCurrentPreset(preset)
        setStatus('idle')
      } catch (error) {
        if (!ignore) {
          setStatus('error')
          setErrorMessage(messageFromError(error))
        }
      }
    }

    void boot()
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (store.name) {
      saveSession({ name: store.name, patch, tab: activeTab, settingsTab: activeSettingsTab })
    }
  }, [activeSettingsTab, activeTab, patch, store.name])

  const handleSave = useCallback(async () => {
    if (!store.name) {
      return
    }

    setStatus('saving')
    setErrorMessage('')
    try {
      const saved = await savePreset({ mode: 'update', name: store.name, ifMatch: store.hash, patch })
      dispatch({ type: 'saved', preset: saved })
      setCurrentPreset(saved)
      setConflict(null)
      setStatus('saved')
      void listPresets().then(setPresets).catch(() => undefined)
    } catch (error) {
      setStatus('error')
      setErrorMessage(messageFromError(error))
      if (error instanceof EditorApiError && error.status === 412) {
        setConflict(error.current ?? null)
      }
    }
  }, [patch, store.hash, store.name])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  const handlePresetChange = useCallback(
    (name: string) => {
      if (!name || name === store.name) {
        return
      }
      if (dirty > 0 && !window.confirm('未保存の変更を破棄してプリセットを切り替えますか？')) {
        return
      }
      void loadPresetByName(name)
    },
    [dirty, loadPresetByName, store.name],
  )

  const handleReload = useCallback(() => {
    if (!store.name) {
      return
    }
    if (dirty > 0 && !window.confirm('未保存の変更を破棄して再読込しますか？')) {
      return
    }
    void loadPresetByName(store.name)
  }, [dirty, loadPresetByName, store.name])

  const handleMergeConflict = useCallback(() => {
    if (store.name) {
      void loadPresetByName(store.name, { patch })
    }
  }, [loadPresetByName, patch, store.name])

  const handleDiscardConflict = useCallback(() => {
    if (store.name) {
      void loadPresetByName(store.name)
    }
  }, [loadPresetByName, store.name])

  return (
    <EditorContextProvider value={editorContext}>
      <main className="cv-shell">
      <header className="cv-topbar">
        <div className="cv-titleBlock">
          <span className="cv-devBadge">DEV</span>
          <h1>createVideo エディタ</h1>
          {selectedSummary ? (
            <p className="cv-summaryLine">
              {selectedSummary.mode ?? 'unknown'} / {selectedSummary.count ?? '-'} 件 /{' '}
              {selectedSummary.resolution ?? '-'}
            </p>
          ) : null}
        </div>

        <div className="cv-actions">
          <select
            className="cv-select"
            value={store.name}
            onChange={(event) => handlePresetChange(event.target.value)}
            disabled={status === 'loading' || presets.length === 0}
          >
            {presets.length === 0 ? <option value="">プリセットなし</option> : null}
            {presets.map((preset) => (
              <option key={preset.name} value={preset.name}>
                {preset.name}
              </option>
            ))}
          </select>
          <button type="button" className="cv-button" onClick={handleReload} disabled={!store.name || status === 'loading'}>
            再読込
          </button>
          <button
            type="button"
            className="cv-button cv-buttonPrimary"
            onClick={() => void handleSave()}
            disabled={!store.name || status === 'loading' || status === 'saving'}
          >
            {status === 'saving' ? '保存中' : '保存 ⌘S'}
          </button>
          <span className={dirty > 0 ? 'cv-dirtyBadge is-dirty' : 'cv-dirtyBadge'}>{dirty} 件</span>
          <button
            type="button"
            className={validation.ok ? 'cv-statusBadge is-ok' : 'cv-statusBadge is-error'}
            onClick={() => setActiveTab('settings')}
          >
            検証 {validation.ok ? 'OK' : `${validation.errors.length} 件`}
          </button>
          <button
            type="button"
            className={preflightSummary.error > 0 ? 'cv-statusBadge is-error' : 'cv-statusBadge is-muted'}
            onClick={() => setActiveTab('settings')}
          >
            error {preflightSummary.error}
          </button>
          <button
            type="button"
            className={preflightSummary.warn > 0 ? 'cv-statusBadge is-warn' : 'cv-statusBadge is-muted'}
            onClick={() => setActiveTab('settings')}
          >
            warn {preflightSummary.warn}
          </button>
          {preflight.state === 'pending' ? <span className="cv-spinnerText">検証中...</span> : null}
        </div>
      </header>

      {status === 'error' && errorMessage ? <p className="cv-alert is-error">{errorMessage}</p> : null}
      {status === 'saved' ? <p className="cv-alert is-saved">保存しました</p> : null}
      {selectError ? <p className="cv-alert is-warning">{selectError}</p> : null}
      {preflight.state === 'error' ? <p className="cv-alert is-error">検証リクエストに失敗しました: {preflight.error}</p> : null}

      {conflict ? (
        <section className="cv-conflict" aria-live="polite">
          <p>プリセットが他で更新されています。</p>
          <div className="cv-conflictActions">
            <button type="button" className="cv-button cv-buttonPrimary" onClick={handleMergeConflict}>
              読み直してマージ
            </button>
            <button type="button" className="cv-button" onClick={handleDiscardConflict}>
              破棄
            </button>
          </div>
        </section>
      ) : null}

      {unmatchedValidationErrors.length > 0 ? (
        <section className="cv-validation" aria-live="polite">
          <strong>validation errors</strong>
          <ul>
            {unmatchedValidationErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav className="cv-tabs" aria-label="createVideo editor tabs">
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={activeTab === tab.id ? 'cv-tab is-active' : 'cv-tab'}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="cv-content">
        {activeTab === 'settings' ? (
          <SettingsPanel
            activeTab={activeSettingsTab}
            onTabChange={setActiveSettingsTab}
            showResolved={showResolved}
            onShowResolvedChange={setShowResolved}
            hideInherited={hideInherited}
            onHideInheritedChange={setHideInherited}
            jsonText={jsonText}
            hasPreset={Boolean(store.name)}
          />
        ) : (
          <p className="cv-empty">Phase 4b 以降で実装</p>
        )}
      </section>
      </main>
    </EditorContextProvider>
  )
}

const VALIDATION_OK: ValidationResult = { ok: true, errors: [] }

function messageFromError(error: unknown): string {
  if (error instanceof EditorApiError) {
    return `${error.error} (${error.status})`
  }
  return error instanceof Error ? error.message : String(error)
}

function isTabId(value: unknown): value is TabId {
  return typeof value === 'string' && TABS.some((tab) => tab.id === value)
}
