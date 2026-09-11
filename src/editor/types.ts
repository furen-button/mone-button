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
