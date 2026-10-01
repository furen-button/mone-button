import { enumValues, useFieldSetter, useFieldValue } from './fieldUtils'
import type { SchemaNode } from '../resolveSchema'

type EnumFieldProps = {
  path: string[]
  schema: SchemaNode
}

export function EnumField({ path, schema }: EnumFieldProps) {
  const options = enumValues(schema)
  const value = useFieldValue(path)
  const setValue = useFieldSetter(path)
  const text = typeof value === 'string' ? value : options[0] ?? ''

  if (options.length <= 3) {
    return (
      <div className="cv-segmented" role="radiogroup">
        {options.map((option) => (
          <button
            type="button"
            key={option}
            className={text === option ? 'cv-segment is-active' : 'cv-segment'}
            aria-pressed={text === option}
            onClick={() => setValue(option)}
          >
            {option}
          </button>
        ))}
      </div>
    )
  }

  return (
    <select className="cv-select cv-fieldSelect" value={text} onChange={(event) => setValue(event.target.value)}>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}
