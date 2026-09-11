import { useFieldSetter, useFieldValue } from './fieldUtils'
import type { SchemaNode } from '../resolveSchema'

type FadeFieldProps = {
  path: string[]
  schema: SchemaNode
}

export function FadeField({ path, schema }: FadeFieldProps) {
  const value = useFieldValue(path)
  const setValue = useFieldSetter(path)
  const items = Array.isArray(value) ? [numberAt(value, 0), numberAt(value, 1)] : [0, 0]
  const unit = schema.__cvDefName === 'fadeSec' ? '秒' : 'ms'

  const setItem = (index: number, nextValue: number) => {
    const next = [...items]
    next[index] = nextValue
    setValue(next)
  }

  return (
    <div className="cv-fadeControl">
      {items.map((item, index) => (
        <label className="cv-unitInput" key={index === 0 ? 'in' : 'out'}>
          <span>{index === 0 ? 'in' : 'out'}</span>
          <input
            className="cv-input"
            type="number"
            step="any"
            value={item}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) {
                setItem(index, next)
              }
            }}
          />
          <span>{unit}</span>
        </label>
      ))}
    </div>
  )
}

function numberAt(value: unknown[], index: number): number {
  return typeof value[index] === 'number' ? value[index] : 0
}
