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
