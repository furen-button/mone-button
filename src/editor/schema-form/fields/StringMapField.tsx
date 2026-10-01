import { useMemo, useState } from 'react'
import { useFieldSetter, useFieldValue } from './fieldUtils'

type StringMapFieldProps = {
  path: string[]
}

type StringMapRows = Array<[string, string]>

export function StringMapField({ path }: StringMapFieldProps) {
  const value = useFieldValue(path)
  const setValue = useFieldSetter(path)
  const sourceRows = useMemo(() => objectEntries(value), [value])
  const source = useMemo(() => rowsKey(sourceRows), [sourceRows])
  const [edit, setEdit] = useState({ source, rows: sourceRows })
  const rows = edit.source === source ? edit.rows : sourceRows
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const note = path.join('.') === 'summary.chapters.labels' ? 'videoId#2 も指定できます。' : ''

  const setRows = (nextRows: StringMapRows) => {
    const nextValue = rowsToObject(nextRows)
    setValue(nextValue)
    setEdit({ source: rowsKey(objectEntries(nextValue)), rows: nextRows })
  }

  return (
    <div className="cv-mapControl">
      {note ? <p className="cv-controlNote">{note}</p> : null}
      {rows.map(([key, itemValue], index) => (
        // key を index だけにする。キー文字列を含めると入力中に行が再マウントされてフォーカスが飛ぶ。
        <div className="cv-mapRow" key={index}>
          <input
            className="cv-input"
            type="text"
            value={key}
            onChange={(event) => {
              const next = [...rows]
              next[index] = [event.target.value, itemValue]
              setRows(next)
            }}
          />
          <textarea
            className="cv-textarea"
            value={itemValue}
            rows={2}
            onChange={(event) => {
              const next = [...rows]
              next[index] = [key, event.target.value]
              setRows(next)
            }}
          />
          <button type="button" className="cv-iconButton" aria-label={`${key} を削除`} onClick={() => setRows(rows.filter((_, rowIndex) => rowIndex !== index))}>
            ×
          </button>
        </div>
      ))}
      <div className="cv-mapRow">
        <input className="cv-input" type="text" value={newKey} onChange={(event) => setNewKey(event.target.value)} />
        <textarea className="cv-textarea" value={newValue} rows={2} onChange={(event) => setNewValue(event.target.value)} />
        <button
          type="button"
          className="cv-button"
          onClick={() => {
            const trimmedKey = newKey.trim()
            if (trimmedKey) {
              setRows([...rows, [trimmedKey, newValue]])
              setNewKey('')
              setNewValue('')
            }
          }}
        >
          追加
        </button>
      </div>
    </div>
  )
}

// 並び替えはしない。JSON の挿入順を保つことで、キーを編集中に行が入れ替わってフォーカスを失うのを避ける。
function objectEntries(value: unknown): StringMapRows {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return []
  }
  return Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
}

function rowsToObject(rows: StringMapRows): Record<string, string> {
  return Object.fromEntries(rows.filter(([key]) => key.trim()).map(([key, itemValue]) => [key.trim(), itemValue]))
}

function rowsKey(rows: StringMapRows): string {
  return JSON.stringify(rows)
}
