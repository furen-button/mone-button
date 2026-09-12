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
  const sourceText = items.join('\n')
  const [edit, setEdit] = useState({ source: sourceText, text: sourceText })
  const text = edit.source === sourceText ? edit.text : sourceText
  // 表示は確定値ではなく生テキスト。空行を消さずに改行を打てるようにするため。
  const commitItems = (nextItems: string[]) => {
    const committedText = nextItems.join('\n')
    setValue(nextItems)
    setEdit({ source: committedText, text: committedText })
  }
  // 入力のたびに確定する。blur まで待つと、textarea にフォーカスしたまま ⌘S を押したときに
  // window の keydown では blur が起きず、打った内容が保存されない。
  // source を確定後の items から作るテキストに合わせることで、生テキストの表示だけを残す。
  const commitList = (nextText: string) => {
    const nextItems = nextText.split('\n').map((line) => line.trim()).filter(Boolean)
    setValue(nextItems)
    setEdit({ source: nextItems.join('\n'), text: nextText })
  }

  if (path.join('.') === 'select.files') {
    return (
      <div className="cv-noteControl">
        <strong>{items.length} 件</strong>
        <span>クリップタブで並べ替え</span>
      </div>
    )
  }

  return (
    <div className="cv-listControl">
      <div className="cv-chipList">
        {items.map((item) => (
          <button
            type="button"
            key={item}
            className="cv-chip"
            onClick={() => commitItems(items.filter((candidate) => candidate !== item))}
          >
            {item} ×
          </button>
        ))}
      </div>
      <textarea
        className="cv-textarea"
        value={text}
        rows={Math.max(3, Math.min(8, text.split('\n').length + 1))}
        onChange={(event) => commitList(event.target.value)}
        onBlur={() => commitItems(items)}
      />
      <div className="cv-inlineEdit">
        <input className="cv-input" type="text" value={newItem} onChange={(event) => setNewItem(event.target.value)} />
        <button
          type="button"
          className="cv-button"
          onClick={() => {
            const trimmed = newItem.trim()
            if (trimmed) {
              commitItems([...items, trimmed])
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
