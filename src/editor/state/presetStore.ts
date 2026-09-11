import type { JsonObject, Patch, PatchOp, PresetFile } from '../types'

export type PatchState = {
  set: Map<string, PatchOp>
  unset: Set<string>
}

export type PresetStoreState = {
  name: string
  raw: JsonObject
  hash: string
  patch: PatchState
}

export type PresetStoreAction =
  | { type: 'load'; preset: PresetFile; patch?: Patch }
  | { type: 'setValue'; path: string[]; value: unknown }
  | { type: 'unsetValue'; path: string[] }
  | { type: 'discard' }
  | { type: 'saved'; preset: PresetFile }

export const initialPresetStore: PresetStoreState = {
  name: '',
  raw: {},
  hash: '',
  patch: emptyPatchState(),
}

export function presetStoreReducer(state: PresetStoreState, action: PresetStoreAction): PresetStoreState {
  switch (action.type) {
    case 'load':
      return {
        name: action.preset.name,
        raw: action.preset.raw,
        hash: action.preset.hash,
        patch: action.patch ? patchStateFromPayload(action.patch) : emptyPatchState(),
      }

    case 'setValue':
      return setValue(state, action.path, action.value)

    case 'unsetValue':
      return unsetValue(state, action.path)

    case 'discard':
      return { ...state, patch: emptyPatchState() }

    case 'saved':
      return {
        name: action.preset.name,
        raw: action.preset.raw,
        hash: action.preset.hash,
        patch: emptyPatchState(),
      }
  }
}

export function patchPayloadFromState(patch: PatchState): Patch {
  return {
    set: Array.from(patch.set.values()).map((entry) => ({ path: [...entry.path], value: clone(entry.value) })),
    unset: Array.from(patch.unset.values()).map((pathKey) => JSON.parse(pathKey) as string[]),
  }
}

export function dirtyCount(state: PresetStoreState): number {
  return state.patch.set.size + state.patch.unset.size
}

export function applyPatch(raw: JsonObject, patch: Patch): JsonObject {
  const next = clone(raw) as JsonObject

  for (const entry of patch.set) {
    setPath(next, entry.path, entry.value)
  }
  for (const path of patch.unset) {
    unsetPath(next, path)
  }

  return next
}

export function deepMerge(base: unknown, override: unknown): unknown {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? clone(base) : clone(override)
  }
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? clone(base) : clone(override)
  }

  const out = clone(base) as JsonObject
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in out ? (deepMerge(out[key], value) as JsonObject[string]) : (clone(value) as JsonObject[string])
  }
  return out
}

function setValue(state: PresetStoreState, path: string[], value: unknown): PresetStoreState {
  const patch = clonePatchState(state.patch)
  const key = pathKey(path)
  removeDescendants(patch.set, path)
  removeDescendants(patch.unset, path)
  removeAncestors(patch.unset, path)

  if (hasPath(state.raw, path) && jsonEqual(readPath(state.raw, path), value)) {
    patch.set.delete(key)
    patch.unset.delete(key)
  } else {
    patch.set.set(key, { path: [...path], value: clone(value) })
    patch.unset.delete(key)
  }

  return { ...state, patch }
}

function unsetValue(state: PresetStoreState, path: string[]): PresetStoreState {
  const patch = clonePatchState(state.patch)
  removeDescendants(patch.set, path)
  patch.set.delete(pathKey(path))

  if (hasPath(state.raw, path)) {
    patch.unset.add(pathKey(path))
  } else {
    patch.unset.delete(pathKey(path))
  }

  return { ...state, patch }
}

function patchStateFromPayload(patch: Patch): PatchState {
  return {
    set: new Map(patch.set.map((entry) => [pathKey(entry.path), { path: [...entry.path], value: clone(entry.value) }])),
    unset: new Set(patch.unset.map(pathKey)),
  }
}

function emptyPatchState(): PatchState {
  return { set: new Map(), unset: new Set() }
}

function clonePatchState(patch: PatchState): PatchState {
  return {
    set: new Map(Array.from(patch.set.entries()).map(([key, entry]) => [key, { path: [...entry.path], value: clone(entry.value) }])),
    unset: new Set(patch.unset),
  }
}

function setPath(target: JsonObject, path: string[], value: unknown): void {
  if (path.length === 0) {
    return
  }

  let parent = target
  for (const key of path.slice(0, -1)) {
    if (!isPlainObject(parent[key])) {
      parent[key] = {}
    }
    parent = parent[key] as JsonObject
  }
  parent[path.at(-1) ?? ''] = clone(value) as JsonObject[string]
}

function unsetPath(target: JsonObject, path: string[]): void {
  if (path.length === 0) {
    return
  }

  let parent: unknown = target
  for (const key of path.slice(0, -1)) {
    if (!isPlainObject(parent) || !isPlainObject(parent[key])) {
      return
    }
    parent = parent[key]
  }

  if (isPlainObject(parent)) {
    delete parent[path.at(-1) ?? '']
  }
}

function hasPath(source: JsonObject, path: string[]): boolean {
  if (path.length === 0) {
    return true
  }

  let current: unknown = source
  for (const [index, key] of path.entries()) {
    if (!isPlainObject(current) || !(key in current)) {
      return false
    }
    if (index === path.length - 1) {
      return true
    }
    current = current[key]
  }
  return false
}

function readPath(source: JsonObject, path: string[]): unknown {
  let current: unknown = source
  for (const key of path) {
    if (!isPlainObject(current)) {
      return undefined
    }
    current = current[key]
  }
  return current
}

function removeDescendants<T>(map: Map<string, T> | Set<string>, path: string[]): void {
  for (const key of Array.from(map.keys())) {
    if (isSameOrDescendant(JSON.parse(key) as string[], path)) {
      map.delete(key)
    }
  }
}

function removeAncestors(set: Set<string>, path: string[]): void {
  for (const key of Array.from(set.keys())) {
    if (isSameOrDescendant(path, JSON.parse(key) as string[])) {
      set.delete(key)
    }
  }
}

function isSameOrDescendant(candidate: string[], base: string[]): boolean {
  return candidate.length >= base.length && base.every((part, index) => candidate[index] === part)
}

function pathKey(path: string[]): string {
  return JSON.stringify(path)
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
}
