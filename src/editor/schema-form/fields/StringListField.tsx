import { useMemo, useState } from 'react'
import { useFieldSetter, useFieldValue } from './fieldUtils'

type StringListFieldProps = {
  path: string[]
}

export function StringListField({ path }: StringListFieldProps) {
  const value = useFieldValue(path)
  const setValue = useFieldSetter(path)
  const items = useMemo(() => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []), [value])
  const [newItem, setNewItem] = useState('')

  if (path.join('.') === 'select.files') {
    return (
      <div className="cv-noteControl">
        <strong>{items.length} 件</strong>
        <span>クリップタブで並べ替え</span>
      </div>
    )
  }

  const text = items.join('\n')
  const commitList = (nextText: string) => {
    setValue(nextText.split('\n').map((line) => line.trim()).filter(Boolean))
  }

  return (
    <div className="cv-listControl">
      <div className="cv-chipList">
        {items.map((item) => (
          <button
            type="button"
            key={item}
            className="cv-chip"
            onClick={() => setValue(items.filter((candidate) => candidate !== item))}
          >
            {item} ×
          </button>
        ))}
      </div>
      <textarea className="cv-textarea" value={text} rows={Math.max(3, Math.min(8, items.length + 1))} onChange={(event) => commitList(event.target.value)} />
      <div className="cv-inlineEdit">
        <input className="cv-input" type="text" value={newItem} onChange={(event) => setNewItem(event.target.value)} />
        <button
          type="button"
          className="cv-button"
          onClick={() => {
            const trimmed = newItem.trim()
            if (trimmed) {
              setValue([...items, trimmed])
              setNewItem('')
            }
          }}
        >
          追加
        </button>
      </div>
    </div>
  )
}
