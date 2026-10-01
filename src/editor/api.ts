import type {
  BuildOptions,
  ClipDataSave,
  ClipsResponse,
  ConflictPreset,
  JobSummary,
  JsonObject,
  OutputEntry,
  PresetFile,
  PresetSummary,
  ResultResponse,
  SavePresetBody,
  SavePresetResponse,
  SchemaResponse,
  SheetMeta,
  StillMeta,
  StillRequest,
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

export async function fetchClips(draft: JsonObject, signal?: AbortSignal): Promise<ClipsResponse> {
  return requestJson<ClipsResponse>('/clips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft }),
    signal,
  })
}

// PNG バイト列 + X-Still-Meta（URL エンコード JSON）を 1 往復で受ける。
export async function renderStillImage(body: StillRequest, signal?: AbortSignal): Promise<{ blob: Blob; meta: StillMeta }> {
  return requestImage<StillMeta>('/still', body, 'X-Still-Meta', signal)
}

export async function renderSheetImage(
  body: { name: string; draft: JsonObject; columns?: number },
  signal?: AbortSignal,
): Promise<{ blob: Blob; meta: SheetMeta }> {
  return requestImage<SheetMeta>('/sheet', body, 'X-Sheet-Meta', signal)
}

export async function startBuild(name: string, options: BuildOptions): Promise<JobSummary> {
  const { job } = await requestJson<{ job: JobSummary }>('/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, options }),
  })
  return job
}

export async function startQc(name: string, video: string, contact: boolean): Promise<JobSummary> {
  const { job } = await requestJson<{ job: JobSummary }>('/qc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, video, contact }),
  })
  return job
}

export async function getJobs(): Promise<{ current: JobSummary | null; last: JobSummary | null }> {
  return requestJson('/jobs')
}

export async function getJob(id: string): Promise<JobSummary> {
  const { job } = await requestJson<{ job: JobSummary }>(`/jobs/${encodeURIComponent(id)}`)
  return job
}

export async function cancelJob(id: string): Promise<{ state: string }> {
  return requestJson(`/build/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
}

export function jobLogUrl(id: string, since = 0): string {
  return `${API_BASE}/build/${encodeURIComponent(id)}/log?since=${since}`
}

export async function listOutputs(): Promise<OutputEntry[]> {
  return requestJson<OutputEntry[]>('/outputs')
}

export async function getResult(base: string): Promise<ResultResponse> {
  return requestJson<ResultResponse>(`/result?name=${encodeURIComponent(base)}`)
}

export function fileUrl(kind: string, name: string, index?: number): string {
  const suffix = index ? `&index=${index}` : ''
  return `${API_BASE}/file?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}${suffix}`
}

// 既存の dev エディタ API。public/data/<base>.json の serif / ruby / memo / categories だけを書き戻す。
export async function saveClipData(body: ClipDataSave): Promise<JsonObject> {
  const response = await fetch('/__data/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => null)) as JsonObject | null
  if (!response.ok) {
    throw new EditorApiError(response.status, isErrorPayload(payload) ? payload : { error: response.statusText })
  }
  return payload ?? {}
}

async function requestImage<TMeta>(path: string, body: unknown, header: string, signal?: AbortSignal): Promise<{ blob: Blob; meta: TMeta }> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new EditorApiError(response.status, isErrorPayload(payload) ? payload : { error: response.statusText })
  }
  const encoded = response.headers.get(header)
  if (!encoded) {
    throw new EditorApiError(500, { error: `${header} header is missing` })
  }
  const meta = JSON.parse(decodeURIComponent(encoded)) as TMeta
  return { blob: await response.blob(), meta }
}
