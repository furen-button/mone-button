import type { Layer } from '../../scripts/create-video/thumbnail.js'
import { FONT_WEIGHTS } from '../../scripts/create-video/thumbnail.js'
import { FONTS } from './fonts'
import type { Edit } from './Stage'
export function PropertiesPanel({ layer, onEdit, onRemove }: { layer?: Layer; onEdit: Edit; onRemove: () => void }) {
  if (!layer) {
    return (
      <section>
        <h2>プロパティ</h2>
        <p>レイヤーを選んでください。</p>
      </section>
    )
  }
  const l = layer
  const edit = (patch: Partial<Layer>) => onEdit(l.id, patch)
  function numeric(label: string, value: number, change: (value: number) => void, min: number, max: number, step = 1) {
    return (
      <label>
        {label}
        <input
          type="number"
          value={Math.round(value * 1000) / 1000}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = e.target.valueAsNumber
            if (Number.isFinite(n) && n >= min && n <= max) {
              change(n)
            }
          }}
        />
      </label>
    )
  }
  function color(label: string, value: string, change: (value: string) => void) {
    return (
      <label>
        {label}
        <input
          aria-label={label}
          value={value}
          maxLength={9}
          onChange={(e) => {
            if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/iu.test(e.target.value)) {
              change(e.target.value)
            }
          }}
        />
        <input
          aria-label={`${label}を選ぶ`}
          type="color"
          value={value.slice(0, 7)}
          onChange={(e) => change(e.target.value)}
        />
      </label>
    )
  }
  return (
    <section className="th-properties">
      <h2>プロパティ</h2>
      <fieldset disabled={l.locked}>
        <div className="th-pair">
          {numeric('X', l.x, (x) => edit({ x }), -10000, 10000)}
          {numeric('Y', l.y, (y) => edit({ y }), -10000, 10000)}
        </div>
        {numeric('回転', l.rotation, (rotation) => edit({ rotation }), -3600, 3600)}
        {numeric('不透明度', l.opacity, (opacity) => edit({ opacity }), 0, 1, 0.05)}
        {l.type === 'text' && (
          <>
            <label>
              文字（改行・{'{強調}'}・{'{色|FF0000}'}）
              <textarea maxLength={2000} value={l.text} onChange={(e) => edit({ text: e.target.value })} />
            </label>
            <label>
              フォント
              <select value={l.font} onChange={(e) => edit({ font: e.target.value, weight: 400 })}>
                {FONTS.map((font) => (
                  <option key={font.family}>{font.family}</option>
                ))}
              </select>
            </label>
            <label>
              太さ
              <select value={l.weight} onChange={(e) => edit({ weight: Number(e.target.value) })}>
                {FONT_WEIGHTS[l.font].map((weight) => (
                  <option key={weight}>{weight}</option>
                ))}
              </select>
            </label>
            {numeric('文字サイズ', l.size, (size) => edit({ size }), 1, 600)}
            {color('文字色', l.color, (value) => edit({ color: value }))}
            {color('強調色', l.emphasisColor, (emphasisColor) => edit({ emphasisColor }))}
            {numeric('行送り', l.lineHeight, (lineHeight) => edit({ lineHeight }), 0.5, 3, 0.05)}
            {numeric('字間', l.letterSpacing, (letterSpacing) => edit({ letterSpacing }), -50, 100)}
            <label>
              揃え
              <select value={l.align} onChange={(e) => edit({ align: e.target.value as 'left' | 'center' | 'right' })}>
                <option value="left">左</option>
                <option value="center">中央</option>
                <option value="right">右</option>
              </select>
            </label>
            <h3>縁取り（内側→外側）</h3>
            {l.outlines.map((o, i) => (
              <div className="th-outline" key={i}>
                {numeric(
                  '幅',
                  o.width,
                  (width) => edit({ outlines: l.outlines.map((v, j) => (j === i ? { ...v, width } : v)) }),
                  0,
                  100,
                )}
                {color('色', o.color, (value) =>
                  edit({ outlines: l.outlines.map((v, j) => (j === i ? { ...v, color: value } : v)) }),
                )}
                <button onClick={() => edit({ outlines: l.outlines.filter((_, j) => i !== j) })}>削除</button>
              </div>
            ))}
            <button
              disabled={l.outlines.length >= 8}
              onClick={() => edit({ outlines: [...l.outlines, { width: 8, color: '#FFFFFF' }] })}
            >
              縁取りを追加
            </button>
          </>
        )}
        {l.type === 'image' && (
          <>
            <p className="th-hint">素材パネルの画像を押すとこの画像を差し替えます。</p>
            {numeric('倍率', l.scale, (scale) => edit({ scale }), 0.01, 20, 0.01)}
            <label>
              配置
              <select value={l.fit} onChange={(e) => edit({ fit: e.target.value as 'free' | 'cover' })}>
                <option value="free">自由配置</option>
                <option value="cover">画面を覆う</option>
              </select>
            </label>
            <label>
              <input type="checkbox" checked={l.flipX} onChange={(e) => edit({ flipX: e.target.checked })} />
              左右反転
            </label>
            {numeric('ぼかし', l.filter.blur, (blur) => edit({ filter: { ...l.filter, blur } }), 0, 100)}
            {numeric(
              '明るさ',
              l.filter.brightness,
              (brightness) => edit({ filter: { ...l.filter, brightness } }),
              0,
              3,
              0.05,
            )}
            {numeric(
              '白フチの幅',
              l.outline?.width || 0,
              (width) => edit({ outline: { width, color: l.outline?.color || '#FFFFFF' } }),
              0,
              100,
            )}
            {color('フチの色', l.outline?.color || '#FFFFFF', (value) =>
              edit({ outline: { width: l.outline?.width || 10, color: value } }),
            )}
            {numeric(
              '影のぼかし',
              l.shadow?.blur || 0,
              (blur) => edit({ shadow: { x: 0, y: 8, color: '#00000080', ...l.shadow, blur } }),
              0,
              100,
            )}
            {numeric(
              '影 X',
              l.shadow?.x || 0,
              (x) => edit({ shadow: { blur: 18, y: 8, color: '#00000080', ...l.shadow, x } }),
              -100,
              100,
            )}
            {numeric(
              '影 Y',
              l.shadow?.y || 0,
              (y) => edit({ shadow: { blur: 18, x: 0, color: '#00000080', ...l.shadow, y } }),
              -100,
              100,
            )}
            {color('影の色', l.shadow?.color || '#00000080', (value) =>
              edit({ shadow: { blur: 18, x: 0, y: 8, ...l.shadow, color: value } }),
            )}
          </>
        )}
        {l.type === 'rect' && (
          <>
            {numeric('幅', l.w, (w) => edit({ w }), 1, 10000)}
            {numeric('高さ', l.h, (h) => edit({ h }), 1, 10000)}
            {numeric('角丸', l.radius, (radius) => edit({ radius }), 0, 1000)}
            <label>
              <input
                type="checkbox"
                checked={typeof l.fill !== 'string'}
                onChange={(e) =>
                  edit({
                    fill: e.target.checked ? { type: 'linear', from: '#6B3FA0', to: '#FF4FA0', angle: 90 } : '#6B3FA0',
                  })
                }
              />
              グラデーション
            </label>
            {typeof l.fill === 'string'
              ? color('塗り', l.fill, (fill) => edit({ fill }))
              : (() => {
                  const fill = l.fill
                  return (
                    <>
                      {color('開始色', fill.from, (from) => edit({ fill: { ...fill, from } }))}
                      {color('終了色', fill.to, (to) => edit({ fill: { ...fill, to } }))}
                      {numeric('角度', fill.angle, (angle) => edit({ fill: { ...fill, angle } }), -360, 360)}
                    </>
                  )
                })()}
          </>
        )}
        <button className="th-danger" onClick={onRemove}>
          レイヤーを削除
        </button>
      </fieldset>
    </section>
  )
}
