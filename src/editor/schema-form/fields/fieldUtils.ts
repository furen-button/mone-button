import { useEditorContext } from '../EditorContext'
import { fontInheritPath, getAtPath, hasAtPath, inheritedValuePathFor, type SchemaNode } from '../resolveSchema'

export function useFieldValue(path: string[]): unknown {
  const context = useEditorContext()
  if (hasAtPath(context.draft, path)) {
    return getAtPath(context.draft, path)
  }
  return getAtPath(context.resolved, inheritedValuePathFor(path))
}

export function useFieldSetter(path: string[]): (value: unknown) => void {
  const context = useEditorContext()
  return (value: unknown) => context.setValue(path, value)
}

export function enumValues(schema: SchemaNode): string[] {
  return Array.isArray(schema.enum) ? schema.enum.filter((item): item is string => typeof item === 'string') : []
}

export function schemaDescription(schema: SchemaNode): string {
  return typeof schema.description === 'string' ? schema.description : ''
}

export function resolutionHeight(resolved: unknown): number {
  const value = getAtPath(resolved, ['output', 'resolution'])
  if (typeof value !== 'string') {
    return 1080
  }
  const match = /^\d+x(\d+)$/u.exec(value)
  return match ? Number(match[1]) : 1080
}

export function useInheritedFontLabel(path: string[]): string {
  const context = useEditorContext()
  const primaryPath = fontInheritPath(path)
  const primary = getAtPath(context.resolved, primaryPath)
  if (path[0] === 'cards' && primary === null) {
    const fallback = getAtPath(context.resolved, ['font'])
    return typeof fallback === 'string' ? fallback : ''
  }
  return typeof primary === 'string' ? primary : ''
}

export function isIntegerSchema(schema: SchemaNode): boolean {
  return schema.type === 'integer'
}
