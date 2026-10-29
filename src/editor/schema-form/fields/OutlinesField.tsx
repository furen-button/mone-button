import { useFieldSetter, useFieldValue } from './fieldUtils'

type OutlinesFieldProps = {
  path: string[]
}

type Outline = {
  width: number
  color: string
}

// テロップの縁取り（内側→外側）。1 行が 1 層で、太さ(px)と色を持つ。配列ごと書き換える。
export function OutlinesField({ path }: OutlinesFieldProps) {
  const value = useFieldValue(path)
  const setValue = useFieldSetter(path)
  const items = toOutlines(value)

  const update = (index: number, patch: Partial<Outline>) => {
    setValue(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  return (
    <div className="cv-outlinesControl">
      {items.map((item, index) => (
        <div className="cv-outlineRow" key={index}>
          <span className="cv-controlNote">{index === 0 ? '内側' : `外側 ${index}`}</span>
          <label className="cv-unitInput">
            <input
              className="cv-input"
              type="number"
              min={0}
              step="any"
              value={item.width}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (Number.isFinite(next) && next >= 0) {
                  update(index, { width: next })
                }
              }}
            />
            <span>px</span>
          </label>
          <div className="cv-colorControl">
            <input
              type="color"
              value={`#${item.color}`}
              onChange={(event) => update(index, { color: event.target.value.slice(1).toUpperCase() })}
            />
          </div>
          <button
            type="button"
            className="cv-iconButton"
            aria-label="この縁取りを外す"
            onClick={() => setValue(items.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="cv-button" onClick={() => setValue([...items, { width: 4, color: '000000' }])}>
        ＋ 縁取りを足す
      </button>
    </div>
  )
}

function toOutlines(value: unknown): Outline[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => {
    const record = item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const width = typeof record.width === 'number' ? record.width : 0
    const color = typeof record.color === 'string' && /^[0-9A-Fa-f]{6}$/u.test(record.color) ? record.color.toUpperCase() : '000000'
    return { width, color }
  })
}
