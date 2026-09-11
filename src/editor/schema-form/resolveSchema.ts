import type { JsonObject } from '../types'

export type FieldKind =
  | 'nullable'
  | 'color'
  | 'align'
  | 'size'
  | 'font'
  | 'box'
  | 'fade'
  | 'enum'
  | 'boolean'
  | 'number'
  | 'string'
  | 'stringList'
  | 'stringMap'
  | 'object'
  | 'unknown'

export type SchemaNode = Record<string, unknown>

type DerefResult = {
  node: SchemaNode
  defName: string | null
}

const SPECIAL_DEFS = new Map<string, FieldKind>([
  ['color', 'color'],
  ['align', 'align'],
  ['size', 'size'],
  ['font', 'font'],
  ['box', 'box'],
  ['fadeMs', 'fade'],
  ['fadeSec', 'fade'],
])

export function derefSchema(node: unknown, root: unknown): DerefResult {
  const record = asRecord(node)
  if (!record) {
    return { node: {}, defName: null }
  }

  if (typeof record.__cvDefName === 'string') {
    return { node: record, defName: record.__cvDefName }
  }
  if (typeof record.$ref === 'string') {
    return resolveRef(record.$ref, root)
  }

  const allOf = record.allOf
  if (
    Array.isArray(allOf)
    && allOf.length === 1
    && asRecord(allOf[0])
    && typeof asRecord(allOf[0])?.$ref === 'string'
  ) {
    return resolveRef(asRecord(allOf[0])?.$ref as string, root)
  }

  return { node: record, defName: null }
}

export function classify(node: unknown, _path: string[], root: unknown): FieldKind {
  const derefed = derefSchema(node, root)
  const schema = derefed.node
  const type = schema.type

  if (Array.isArray(type) && type.includes('null')) {
    return 'nullable'
  }

  const special = derefed.defName ? SPECIAL_DEFS.get(derefed.defName) : undefined
  if (special) {
    return special
  }

  if (Array.isArray(schema.enum)) {
    return 'enum'
  }
  if (type === 'boolean') {
    return 'boolean'
  }
  if (type === 'number' || type === 'integer') {
    return 'number'
  }
  if (type === 'array' && asRecord(schema.items)?.type === 'string') {
    return 'stringList'
  }
  if (
    type === 'object'
    && asRecord(schema.additionalProperties)?.type === 'string'
    && !asRecord(schema.properties)
  ) {
    return 'stringMap'
  }
  if (type === 'object' && asRecord(schema.properties)) {
    return 'object'
  }
  if (type === 'string') {
    return 'string'
  }

  return 'unknown'
}

export function nullableInnerSchema(node: unknown, root: unknown): SchemaNode {
  const derefed = derefSchema(node, root)
  const type = derefed.node.type
  const innerType = Array.isArray(type) ? type.filter((item) => item !== 'null') : type
  return {
    ...derefed.node,
    type: Array.isArray(innerType) && innerType.length === 1 ? innerType[0] : innerType,
    ...(derefed.defName ? { __cvDefName: derefed.defName } : {}),
  }
}

export function firstSentence(description: unknown): string {
  if (typeof description !== 'string') {
    return ''
  }
  const index = description.indexOf('。')
  return index >= 0 ? description.slice(0, index + 1) : description
}

export function inheritedValuePathFor(path: string[]): string[] {
  if (path[0] === 'cards' && path[1] === 'serif') {
    return ['telops', 'serif', ...path.slice(2)]
  }
  return path
}

export function fontInheritPath(path: string[]): string[] {
  if (path[0] === 'cards') {
    return ['cards', 'font']
  }
  return ['font']
}

export function getAtPath(obj: unknown, path: string[]): unknown {
  let current = obj
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined
    }
    current = current[key]
  }
  return current
}

export function hasAtPath(obj: unknown, path: string[]): boolean {
  if (path.length === 0) {
    return true
  }

  let current = obj
  for (const [index, key] of path.entries()) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) {
      return false
    }
    if (index === path.length - 1) {
      return true
    }
    current = current[key]
  }
  return false
}

export function pathKey(path: string[]): string {
  return JSON.stringify(path)
}

export function collectSchemaPathKeys(schema: JsonObject): Set<string> {
  const keys = new Set<string>()
  walkSchema(schema, schema, [], keys)
  return keys
}

export function errorPathFromMessage(message: string): string[] | null {
  const match = /^([A-Za-z_][\w.-]*)/u.exec(message)
  if (!match) {
    return null
  }
  return match[1].split('.').map((part) => part.split('=')[0] ?? part)
}

function walkSchema(root: JsonObject, node: unknown, basePath: string[], keys: Set<string>): void {
  const { node: schema } = derefSchema(node, root)
  const properties = asRecord(schema.properties)
  if (!properties) {
    return
  }

  for (const [key, child] of Object.entries(properties)) {
    if (key === '$schema') {
      continue
    }
    const childPath = [...basePath, key]
    keys.add(pathKey(childPath))
    const kind = classify(child, childPath, root)
    if (kind === 'object' || kind === 'box') {
      walkSchema(root, child, childPath, keys)
    }
  }
}

function resolveRef(ref: string, root: unknown): DerefResult {
  const prefix = '#/$defs/'
  const rootRecord = asRecord(root)
  const defs = asRecord(rootRecord?.$defs)
  if (!ref.startsWith(prefix) || !defs) {
    return { node: {}, defName: null }
  }

  const defName = ref.slice(prefix.length)
  const node = asRecord(defs[defName]) ?? {}
  return { node, defName }
}

function asRecord(value: unknown): SchemaNode | null {
  return value !== null && typeof value === 'object' ? (value as SchemaNode) : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}
