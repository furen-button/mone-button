import type { ReactNode } from 'react'
import { useFieldSetter, useFieldValue } from './fieldUtils'
import type { FieldKind, SchemaNode } from '../resolveSchema'

type NullableFieldProps = {
  path: string[]
  innerKind: FieldKind
  innerSchema: SchemaNode
  children: ReactNode
}

export function NullableField({ path, innerKind, innerSchema, children }: NullableFieldProps) {
  const value = useFieldValue(path)
  const setValue = useFieldSetter(path)
  const isNull = value === null

  return (
    <div className="cv-nullableControl">
      <label className="cv-checkboxControl">
        <input
          type="checkbox"
          checked={isNull}
          onChange={(event) => setValue(event.target.checked ? null : defaultValueFor(innerKind, innerSchema))}
        />
        <span>null にする</span>
      </label>
      {isNull ? <p className="cv-controlNote">現在値は null です。</p> : children}
    </div>
  )
}

function defaultValueFor(kind: FieldKind, schema: SchemaNode): unknown {
  if (kind === 'number' || kind === 'size') {
    return 0
  }
  if (kind === 'boolean') {
    return false
  }
  if (kind === 'stringList' || kind === 'fade') {
    return []
  }
  if (kind === 'stringMap' || kind === 'object' || kind === 'box') {
    return {}
  }
  if (kind === 'enum' && Array.isArray(schema.enum)) {
    return schema.enum.find((item) => typeof item === 'string') ?? ''
  }
  return ''
}
