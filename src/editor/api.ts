import type {
  ConflictPreset,
  PresetFile,
  PresetSummary,
  SavePresetBody,
  SavePresetResponse,
  SchemaResponse,
  ValidateDraftBody,
  ValidateResponse,
} from './types'

const API_BASE = '/__cv'

type ErrorPayload = {
  error?: string
  detail?: unknown
  current?: ConflictPreset
}

export class EditorApiError extends Error {
  readonly status: number
  readonly error: string
  readonly detail?: unknown
  readonly current?: ConflictPreset

  constructor(status: number, payload: ErrorPayload) {
    super(payload.error ?? `API error (${status})`)
    this.name = 'EditorApiError'
    this.status = status
    this.error = payload.error ?? 'api_error'
    this.detail = payload.detail
    this.current = payload.current
  }
}

export async function getSchema(): Promise<SchemaResponse> {
  return requestJson<SchemaResponse>('/schema')
}

export async function listPresets(): Promise<PresetSummary[]> {
  return requestJson<PresetSummary[]>('/presets')
}

export async function getPreset(name: string): Promise<PresetFile> {
  return requestJson<PresetFile>(`/preset?name=${encodeURIComponent(name)}`)
}

export async function savePreset(body: SavePresetBody): Promise<SavePresetResponse> {
  return requestJson<SavePresetResponse>('/preset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function validateDraft(body: ValidateDraftBody, signal?: AbortSignal): Promise<ValidateResponse> {
  return requestJson<ValidateResponse>('/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init)
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new EditorApiError(response.status, isErrorPayload(payload) ? payload : { error: response.statusText })
  }

  return payload as T
}

function isErrorPayload(value: unknown): value is ErrorPayload {
  return value !== null && typeof value === 'object'
}
