import { useState } from 'react'
import { useFieldSetter, useFieldValue } from './fieldUtils'

type ColorFieldProps = {
  path: string[]
}

export function ColorField({ path }: ColorFieldProps) {
  const value = useFieldValue(path)
  const setValue = useFieldSetter(path)
  const normalized = normalizeHex(value)
  const sourceText = normalized ?? ''
  const [edit, setEdit] = useState({ source: sourceText, text: sourceText })
  const text = edit.source === sourceText ? edit.text : sourceText
  const validText = normalizeHex(text)

  return (
    <div className="cv-colorControl">
      <input
        type="color"
        value={`#${validText ?? '000000'}`}
        onChange={(event) => {
          const next = event.target.value.slice(1).toUpperCase()
          setEdit({ source: sourceText, text: next })
          setValue(next)
        }}
      />
      <input
        className={validText ? 'cv-input cv-hexInput' : 'cv-input cv-hexInput is-invalid'}
        type="text"
        value={text}
        spellCheck={false}
        onChange={(event) => {
          const next = event.target.value.replace(/^#/u, '').toUpperCase()
          setEdit({ source: sourceText, text: next })
          const normalizedNext = normalizeHex(next)
          if (normalizedNext) {
            setValue(normalizedNext)
          }
        }}
      />
    </div>
  )
}

function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const text = value.replace(/^#/u, '').toUpperCase()
  return /^[0-9A-F]{6}$/u.test(text) ? text : null
}
