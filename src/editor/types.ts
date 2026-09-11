export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }

export type SchemaResponse = {
  schema: JsonObject
  defaults: JsonObject
  align: string[]
  presetsDir: string
}

export type PresetSummary = {
  name: string
  mtimeMs: number
  size: number
  summary: {
    mode: string | null
    count: number | null
    outputName: string | null
    resolution: string | null
  } | null
}

export type ValidationResult = {
  ok: boolean
  errors: string[]
}

export type PresetFile = {
  name: string
  raw: JsonObject
  text: string
  hash: string
  mtimeMs: number
  resolved: JsonObject
  validation: ValidationResult
}

export type PatchOp = {
  path: string[]
  value: unknown
}

export type Patch = {
  set: PatchOp[]
  unset: string[][]
}

export type SavePresetBody =
  | {
      mode: 'update'
      name: string
      ifMatch?: string
      patch: Patch
    }
  | {
      mode: 'create'
      name: string
      base: string | null
      overwrite?: boolean
      patch: Patch
    }

export type SavePresetResponse = PresetFile & {
  created?: boolean
}

export type ConflictPreset = {
  raw: JsonObject
  text: string
  hash: string
}

export type QcResult = {
  level: 'error' | 'warn' | 'info'
  code: string
  message: string
  detail?: unknown
}

export type PreflightClip = {
  base: string
  videoId: string
  duration: number
  serif: string
}

export type PreflightResult = {
  clips: PreflightClip[]
  results: QcResult[]
  summary: {
    error: number
    warn: number
    info: number
  }
  exitCode: number
}

export type ValidateDraftBody = {
  name: string
  draft: JsonObject
}

export type ValidateResponse = {
  validation: ValidationResult
  resolved: JsonObject
  preflight: PreflightResult | null
  selectError?: string
  scratch: string
  ms: number
}

export type PreflightState = {
  state: 'idle' | 'pending' | 'ok' | 'error'
  response: ValidateResponse | null
  error: string
}

export type Rect = { x: number; y: number; w: number; h: number }

export type ClipInfo = {
  base: string
  videoId: string
  serif: string
  ruby: string
  memo: string
  categories: string[]
  startTime: number
  endTime: number
  duration: number
  uploadDate: string | null
  title: string
  source: { existing: boolean; cache: boolean }
}

export type ClipsResponse = {
  clips: ClipInfo[]
  warning?: string
  error?: string
  catalog: {
    clips: ClipInfo[]
    categories: Array<{ name: string; count: number }>
    videoIds: Array<{ videoId: string; title: string; uploadDate: string | null; count: number }>
  }
}

export type StillElement = {
  name: string
  text: string
  lines: string[]
  fontSize: number
  rect: Rect
  textRect: Rect
  lineRects: Rect[]
}

export type StillWarning = { code: string; message: string }

export type StillMeta = {
  at: number
  requestedAt: number
  index: number
  total: number
  clip: { base: string; videoId: string; file: string }
  size: { width: number; height: number; fps: number }
  source: { path: string; kind: string; width: number; height: number; fps: number; duration: number }
  zoom: unknown
  avoidFace: unknown
  enhance: unknown
  elements: StillElement[]
  overlays: { face?: Rect; crop?: { cropX: number; cropY: number; cropWidth: number; cropHeight: number } }
  warnings: StillWarning[]
  ms: number
  out: string
  cached: boolean
  key: string
}

export type StillRequest = {
  name: string
  draft: JsonObject
  clipBase: string
  at?: number
  title?: string
  serifOverride?: string
  zoom?: boolean
}

export type SheetMeta = {
  columns: number
  rows: number
  cellWidth: number
  cells: Array<{ index: number; base: string; at: number | null; ok: boolean; warnings: StillWarning[] }>
  failed: string[]
  ms: number
  cached: boolean
  key: string
}

export type BuildOptions = {
  limit?: number
  qc?: boolean
  contact?: boolean
  source?: 'existing' | 'cache'
  cards?: boolean
  bgm?: boolean
  zoom?: boolean
  enhance?: boolean
  avoidFace?: boolean
  title?: boolean
  date?: boolean
  serif?: boolean
  time?: boolean
  progress?: boolean
  opening?: boolean
  ending?: boolean
  titleText?: string
  resolution?: string
  out?: string
}

export type Sidecars = {
  mp4?: boolean
  render: boolean
  qcJson: boolean
  qcMd: boolean
  contact: boolean
  youtube: boolean
  meta: boolean
  comments: string[]
}

export type JobState = 'running' | 'done' | 'error' | 'cancelled'

export type JobSummary = {
  id: string
  kind: 'build' | 'qc'
  name: string
  state: JobState
  command: string
  argv: string[]
  logPath: string
  startedAt: number
  endedAt: number | null
  ms: number
  exitCode: number | null
  progress: { i: number; n: number; base: string } | null
  stage: string | null
  outPath: string | null
  outBase: string | null
  concat: string | null
  sidecars: Sidecars | null
  qc: { error: number; warn: number; info: number } | null
  error: string | null
}

export type LogEvent = { n: number; stream: 'out' | 'err'; text: string }

export type OutputEntry = { base: string; mtimeMs: number; size: number; sidecars: Sidecars }

export type QcReport = {
  version?: number
  generatedAt?: string
  summary: { error: number; warn: number; info: number }
  results: QcResult[]
}

export type ResultResponse = {
  base: string
  mp4: { size: number; mtimeMs: number } | null
  sidecars: Sidecars
  qc: QcReport | null
  qcMd: string | null
  youtube: string | null
  comments: string[]
  meta: JsonObject | null
  render: {
    clipCount: number | null
    totalSec: number | null
    concatMethod: string | null
    configPath: string | null
    generatedAt: string | null
  } | null
}

export type ClipDataSave = {
  fileBaseName: string
  serif?: string
  ruby?: string
  memo?: string
  categories?: string[]
}
