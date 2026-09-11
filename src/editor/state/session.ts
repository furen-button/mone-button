import type { Patch } from '../types'

const SESSION_KEY = 'cv-editor:session'

export type EditorSession = {
  name?: string
  patch?: Patch
  tab?: string
}

export function loadSession(): EditorSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    return raw ? normalizeSession(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveSession(session: EditorSession): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // ブラウザ設定や容量制限で失敗しても、編集本体は継続できる。
  }
}

function normalizeSession(value: unknown): EditorSession | null {
  if (value === null || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  return {
    name: typeof record.name === 'string' ? record.name : undefined,
    tab: typeof record.tab === 'string' ? record.tab : undefined,
    patch: isPatch(record.patch) ? record.patch : undefined,
  }
}

function isPatch(value: unknown): value is Patch {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return Array.isArray(record.set) && Array.isArray(record.unset)
}
