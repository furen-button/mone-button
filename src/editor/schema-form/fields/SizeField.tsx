import { useMemo, useState } from 'react'
import { resolutionHeight, useFieldSetter, useFieldValue } from './fieldUtils'
import { useEditorContext } from '../EditorContext'

type SizeFieldProps = {
  path: string[]
}

type SizeMode = 'percent' | 'px'

export function SizeField({ path }: SizeFieldProps) {
  const context = useEditorContext()
  const value = useFieldValue(path)
  const setValue = useFieldSetter(path)
  const height = resolutionHeight(context.resolved)
  const numberValue = typeof value === 'number' ? value : 0
  const initialMode: SizeMode = numberValue > 1 ? 'px' : 'percent'
  const sourceKey = `${height}:${numberValue}`
  const [edit, setEdit] = useState(() => ({
    source: sourceKey,
    mode: initialMode,
    text: String(initialMode === 'percent' ? ratioToPercent(numberValue) : sizeToPx(numberValue, height)),
  }))
  const mode = edit.source === sourceKey ? edit.mode : initialMode
  const displayValue = useMemo(() => (mode === 'percent' ? ratioToPercent(numberValue) : sizeToPx(numberValue, height)), [height, mode, numberValue])
  const text = edit.source === sourceKey ? edit.text : String(displayValue)
  const pixelValue = mode === 'percent' ? Math.round(height * (Number(text) / 100)) : Math.round(Number(text))

  const switchMode = (nextMode: SizeMode) => {
    const currentPixels = sizeToPx(numberValue, height)
    if (nextMode === 'percent') {
      const next = height > 0 ? currentPixels / height : 0
      setValue(next)
      setEdit({ source: `${height}:${next}`, mode: nextMode, text: String(ratioToPercent(next)) })
    } else {
      setValue(currentPixels)
      setEdit({ source: `${height}:${currentPixels}`, mode: nextMode, text: String(currentPixels) })
    }
  }

  return (
    <div className="cv-sizeControl">
      <input
        className="cv-input"
        type="number"
        step="any"
        value={text}
        onChange={(event) => {
          const nextText = event.target.value
          setEdit({ source: sourceKey, mode, text: nextText })
          if (nextText === '') {
            return
          }
          const next = Number(nextText)
          if (!Number.isFinite(next)) {
            return
          }
          setValue(mode === 'percent' ? next / 100 : next)
        }}
      />
      <div className="cv-segmented is-compact" role="radiogroup">
        <button type="button" className={mode === 'percent' ? 'cv-segment is-active' : 'cv-segment'} onClick={() => switchMode('percent')}>
          %
        </button>
        <button type="button" className={mode === 'px' ? 'cv-segment is-active' : 'cv-segment'} onClick={() => switchMode('px')}>
          px
        </button>
      </div>
      <span className="cv-pxPreview">= {Number.isFinite(pixelValue) ? pixelValue : 0}px</span>
    </div>
  )
}

function ratioToPercent(value: number): number {
  return Math.round(value * 10000) / 100
}

function sizeToPx(value: number, height: number): number {
  return value <= 1 ? Math.round(height * value) : Math.round(value)
}
