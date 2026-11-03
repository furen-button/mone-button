import { MAX_ZOOM, MIN_ZOOM } from './geometry'
import { EASE_LABELS } from './types'
import type { CameraFrame, Ease } from './types'

type Props = {
  // 再生位置の枠。キーフレームの上ならそのキーフレーム、間なら補間した値。
  frame: CameraFrame
  isKeyframe: boolean
  fps: number
  onChange: (patch: { t?: number; x?: number; y?: number; zoom?: number; ease?: Ease }) => void
}

// 数値での微調整。キーフレームの間で値を変えると、その時刻に新しいキーフレームを作る。
export function KeyframeFields({ frame, isKeyframe, fps, onChange }: Props) {
  function numberField(label: string, key: 't' | 'x' | 'y' | 'zoom', min: number, max: number, step: number, disabled = false) {
    return (
      <label className="cr-field">
        <span>{label}</span>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={Number(frame[key].toFixed(key === 't' ? 3 : 4))}
          onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isFinite(value)) {
              onChange({ [key]: Math.min(max, Math.max(min, value)) })
            }
          }}
        />
      </label>
    )
  }

  return (
    <section className="cr-panel" aria-label="枠の数値">
      <h2>{isKeyframe ? 'キーフレーム' : '再生位置の枠（補間）'}</h2>
      <div className="cr-fieldGrid">
        {numberField('時刻 t（秒）', 't', 0, 36000, 1 / (fps || 30), !isKeyframe)}
        {numberField('中心 x', 'x', 0, 1, 0.001)}
        {numberField('中心 y', 'y', 0, 1, 0.001)}
        {numberField('倍率', 'zoom', MIN_ZOOM, MAX_ZOOM, 0.01)}
        <label className="cr-field">
          <span>次までの動き</span>
          <select value={frame.ease ?? 'smooth'} onChange={(event) => onChange({ ease: event.target.value as Ease })}>
            {(Object.keys(EASE_LABELS) as Ease[]).map((ease) => (
              <option key={ease} value={ease}>{EASE_LABELS[ease]}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="cr-note">
        x / y は元映像の幅・高さに対する枠の中心、倍率はこの縦横比で元映像に収まる最大の枠を 1 とした値。
        {isKeyframe ? '' : ' 値を変えるとこの時刻にキーフレームを作ります。'}
      </p>
    </section>
  )
}
