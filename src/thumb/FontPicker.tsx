import { useLayoutEffect, useRef, useState } from 'react'
import { parseEmphasis } from '../../scripts/create-video/emphasis.js'
import type { TextLayer } from '../../scripts/create-video/thumbnail.js'
import { FONTS } from './fonts'
import type { Edit } from './Stage'

type Selection = { font: string; weight: number }
type Preview = { id: string; original: Selection; edit: Edit }

const groups = [...new Set(['ゴシック', '丸ゴシック', '太字・見出し', '手書き・筆', '明朝', ...FONTS.map((font) => font.group)])]

function nearestWeight(weights: number[], current: number) {
  return weights.reduce((best, weight) => {
    const distance = Math.abs(weight - current) - Math.abs(best - current)
    return distance < 0 || (distance === 0 && weight < best) ? weight : best
  })
}

export function FontPicker({ layer, onEdit }: { layer: TextLayer; onEdit: Edit }) {
  const list = useRef<HTMLDivElement>(null)
  const preview = useRef<Preview | null>(null)
  const [original, setOriginal] = useState<Selection | null>(null)
  const committed = original || { font: layer.font, weight: layer.weight }
  const plain = parseEmphasis(layer.text).plain.replace(/[\r\n]+/g, ' ').trim()
  const sample = [...plain].slice(0, 12).join('') || '梢桃音 ガハハ 204'

  useLayoutEffect(() => {
    const container = list.current
    const selected = container?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    if (container && selected) {
      // パネルやページ全体を動かさず、一覧の中だけをスクロールする。
      container.scrollTop = Math.max(0, selected.offsetTop - 30)
    }
  }, [])

  useLayoutEffect(() => {
    return () => {
      const session = preview.current
      if (session) {
        preview.current = null
        session.edit(session.id, session.original, 'move')
        session.edit(session.id, {}, 'end')
        setOriginal(null)
      }
    }
  }, [layer.id, layer.locked])

  function cancel() {
    const session = preview.current
    if (!session) {
      return
    }
    preview.current = null
    session.edit(session.id, session.original, 'move')
    session.edit(session.id, {}, 'end')
    setOriginal(null)
  }

  // マウスで乗せただけのときはフォーカスが一覧に無いので、Esc はページ全体で受ける。
  // cancel は ref と state の setter しか使わないので、最初の描画のものを登録しておけばよい。
  useLayoutEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && preview.current) {
        e.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])

  function choose(font: (typeof FONTS)[number], confirm = false) {
    if (layer.locked) {
      return
    }
    let session = preview.current
    if (!session) {
      session = { id: layer.id, original: { font: layer.font, weight: layer.weight }, edit: onEdit }
      preview.current = session
      setOriginal(session.original)
      session.edit(session.id, {}, 'start')
    }
    const selection = { font: font.family, weight: nearestWeight(font.weights, session.original.weight) }
    session.edit(session.id, selection, 'move')
    if (confirm) {
      preview.current = null
      session.edit(session.id, {}, 'end')
      setOriginal(null)
    }
  }

  return (
    <div className="th-fontPicker">
      <h3>フォント</h3>
      <div
        ref={list}
        className="th-fontList"
        role="group"
        aria-label="フォントの見本"
        onMouseLeave={cancel}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            cancel()
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            cancel()
          }
        }}
      >
        {groups.map((group) => (
          <div key={group}>
            <h4>{group}</h4>
            {FONTS.filter((font) => font.group === group).map((font) => (
              <button
                key={font.family}
                type="button"
                disabled={layer.locked}
                aria-pressed={committed.font === font.family}
                onMouseEnter={() => choose(font)}
                onFocus={() => choose(font)}
                onClick={() => choose(font, true)}
              >
                <span
                  className="th-fontSample"
                  style={{ fontFamily: `"${font.family}"`, fontWeight: nearestWeight(font.weights, committed.weight) }}
                >
                  {sample}
                </span>
                <small>{font.family}</small>
                {font.note && <small className="th-fontNote">{font.note}</small>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
