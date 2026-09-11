import { useState } from 'react'
import { isIntegerSchema, useFieldSetter, useFieldValue } from './fieldUtils'
import type { SchemaNode } from '../resolveSchema'

type NumberFieldProps = {
  path: string[]
  schema: SchemaNode
}

export function NumberField({ path, schema }: NumberFieldProps) {
  const value = useFieldValue(path)
  const setValue = useFieldSetter(path)
  const sourceText = typeof value === 'number' ? String(value) : ''
  const [edit, setEdit] = useState({ source: sourceText, text: sourceText })
  const text = edit.source === sourceText ? edit.text : sourceText

  return (
    <input
      className="cv-input"
      type="number"
      value={text}
      min={numberAttr(schema.minimum ?? schema.exclusiveMinimum)}
      max={numberAttr(schema.maximum)}
      step={isIntegerSchema(schema) ? 1 : 'any'}
      onChange={(event) => {
        const nextText = event.target.value
        setEdit({ source: sourceText, text: nextText })
        if (nextText === '') {
          return
        }
        const next = Number(nextText)
        if (Number.isFinite(next)) {
          setValue(isIntegerSchema(schema) ? Math.trunc(next) : next)
        }
      }}
    />
  )
}

function numberAttr(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}
