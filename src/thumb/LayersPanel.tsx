import type { Layer, Project } from '../../scripts/create-video/thumbnail.js'
import type { Edit } from './Stage'
const SLOT_LABELS: Record<string, string> = {
  frame: '背景のコマ',
  face: 'もね',
  title: 'タイトル',
  subtitle: 'サブタイトル',
}
const TYPE_LABELS: Record<Layer['type'], string> = { image: '画像', text: '文字', rect: '図形' }

// 一覧での名前。文字は本文の先頭、それ以外はテンプレートの役割（slot）か種類。
function layerLabel(l: Layer): string {
  if (l.type === 'text') {
    return l.text.replace(/\n/g, ' ').slice(0, 16) || TYPE_LABELS.text
  }
  return (l.slot && SLOT_LABELS[l.slot]) || TYPE_LABELS[l.type]
}

export function LayersPanel({
  project,
  selected,
  onSelect,
  onEdit,
  onChange,
}: {
  project: Project
  selected: string | null
  onSelect: (id: string) => void
  onEdit: Edit
  onChange: (project: Project) => void
}) {
  function reorder(index: number, delta: number) {
    const layers = [...project.layers]
    const next = index + delta
    if (next < 0 || next >= layers.length) {
      return
    }
    ;[layers[index], layers[next]] = [layers[next], layers[index]]
    onChange({ ...project, layers })
  }
  function duplicate(l: Layer) {
    onChange({
      ...project,
      layers: [...project.layers, { ...structuredClone(l), id: crypto.randomUUID(), x: l.x + 20, y: l.y + 20 }],
    })
  }
  return (
    <section>
      <h2>レイヤー</h2>
      <p className="th-hint">上が手前。四隅で拡大、上の丸で回転。</p>
      {[...project.layers].reverse().map((l, reversed) => {
        const index = project.layers.length - 1 - reversed
        return (
          <div key={l.id} className={`th-layer ${selected === l.id ? 'selected' : ''}`}>
            <button className="th-layerName" onClick={() => onSelect(l.id)}>
              {layerLabel(l)}
            </button>
            <button title="表示切替" onClick={() => onEdit(l.id, { hidden: !l.hidden })}>
              {l.hidden ? '非表示' : '表示'}
            </button>
            <button title="ロック" onClick={() => onEdit(l.id, { locked: !l.locked })}>
              {l.locked ? '🔒' : '🔓'}
            </button>
            <button title="前へ" onClick={() => reorder(index, 1)}>
              ↑
            </button>
            <button title="後ろへ" onClick={() => reorder(index, -1)}>
              ↓
            </button>
            <button title="複製" onClick={() => duplicate(l)}>
              複製
            </button>
          </div>
        )
      })}
    </section>
  )
}
