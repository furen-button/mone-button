import { schemaDescription, useFieldSetter, useFieldValue } from './fieldUtils'
import type { SchemaNode } from '../resolveSchema'

type StringFieldProps = {
  path: string[]
  schema: SchemaNode
}

const TEXTAREA_KEYS = new Set(['text', 'intro', 'notice', 'subtitle'])

export function StringField({ path, schema }: StringFieldProps) {
  const value = useFieldValue(path)
  const setValue = useFieldSetter(path)
  const text = typeof value === 'string' ? value : ''
  const key = path.at(-1) ?? ''
  const multiline = schemaDescription(schema).includes('改行') || TEXTAREA_KEYS.has(key)

  if (multiline) {
    return (
      <textarea
        className="cv-textarea"
        value={text}
        rows={4}
        onChange={(event) => setValue(event.target.value)}
      />
    )
  }

  return <input className="cv-input" type="text" value={text} onChange={(event) => setValue(event.target.value)} />
}
