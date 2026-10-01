import { useId } from 'react'
import { useFieldSetter, useFieldValue, useInheritedFontLabel } from './fieldUtils'
import { useEditorContext } from '../EditorContext'
import { getAtPath } from '../resolveSchema'

type FontFieldProps = {
  path: string[]
}

const FONT_CANDIDATES = ['Hiragino Sans', 'Hiragino Maru Gothic ProN', 'Hiragino Mincho ProN']

export function FontField({ path }: FontFieldProps) {
  const context = useEditorContext()
  const value = useFieldValue(path)
  const setValue = useFieldSetter(path)
  const listId = useId()
  const inherited = useInheritedFontLabel(path)
  const globalFont = getAtPath(context.resolved, ['font'])
  const candidates = uniqueStrings([...FONT_CANDIDATES, typeof globalFont === 'string' ? globalFont : '', inherited])
  const text = typeof value === 'string' ? value : ''

  return (
    <div className="cv-fontControl">
      <input
        className="cv-input"
        type="text"
        list={listId}
        value={text}
        placeholder={inherited ? `継承: ${inherited}` : '継承'}
        onChange={(event) => setValue(event.target.value)}
      />
      <datalist id={listId}>
        {candidates.map((candidate) => (
          <option key={candidate} value={candidate} />
        ))}
      </datalist>
      <button type="button" className="cv-button" onClick={() => setValue(null)}>
        継承 (null)
      </button>
    </div>
  )
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
