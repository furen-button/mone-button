import { createContext, useContext } from 'react'
import type { PreflightState, JsonObject } from '../types'

export type EditorContextValue = {
  schema: JsonObject
  defaults: JsonObject
  raw: JsonObject
  draft: JsonObject
  resolved: JsonObject
  patch: Set<string>
  unsetKeys: Set<string>
  setValue(path: string[], value: unknown): void
  unsetValue(path: string[]): void
  hideInherited: boolean
  preflight: PreflightState
}

const EditorContext = createContext<EditorContextValue | null>(null)

export const EditorContextProvider = EditorContext.Provider

export function useEditorContext(): EditorContextValue {
  const context = useContext(EditorContext)
  if (!context) {
    throw new Error('EditorContextProvider is missing')
  }
  return context
}
