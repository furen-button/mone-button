import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { FieldFrame } from '../FieldFrame'
import { useEditorContext } from '../EditorContext'
import { hasAtPath, type SchemaNode } from '../resolveSchema'

export type FormExpansion = {
  mode: 'none' | 'expand' | 'collapse'
  token: number
}

type ObjectFieldsetProps = {
  path: string[]
  schema: SchemaNode
  rootPath: string[]
  expansion: FormExpansion
  children: ReactNode
}

const COLLAPSED_PATHS = new Set([
  'qc.thresholds',
  'qc.signature',
  'qc.review',
  'qc.contact',
  'effects.zoom.analysis',
  'effects.zoom.focus',
  'effects.enhance',
  'telops.serif.avoidFace',
  'cards.background.gradient',
])

export function ObjectFieldset({ path, schema, rootPath, expansion, children }: ObjectFieldsetProps) {
  const context = useEditorContext()
  const defaultOpen = useMemo(() => !shouldCollapse(path, rootPath, context.raw), [context.raw, path, rootPath])
  const effectiveOpen = expansion.mode === 'expand' ? true : expansion.mode === 'collapse' ? false : defaultOpen
  const configured = configuredCount(schema, path, context.draft)

  return (
    <FieldFrame path={path} schema={schema}>
      <details className="cv-objectDetails" key={`${path.join('.')}:${expansion.token}:${effectiveOpen}`} open={effectiveOpen}>
        <summary>
          <span>{configured} 項目設定済み</span>
        </summary>
        <div className="cv-fieldGrid">{children}</div>
      </details>
    </FieldFrame>
  )
}

function shouldCollapse(path: string[], rootPath: string[], raw: unknown): boolean {
  if (COLLAPSED_PATHS.has(path.join('.'))) {
    return true
  }
  const depthFromRoot = path.length - rootPath.length
  return depthFromRoot >= 2 && !hasAtPath(raw, path)
}

function configuredCount(schema: SchemaNode, path: string[], draft: unknown): number {
  const properties = schema.properties
  if (properties === null || typeof properties !== 'object') {
    return 0
  }
  return Object.keys(properties).filter((key) => hasAtPath(draft, [...path, key])).length
}
