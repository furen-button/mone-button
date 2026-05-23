type PlaybackControlsProps = {
  sparkKey: number
  garageyaKey: number
  isSequentialMode: boolean
  onPlayRandom: () => void
  onPlayGarageya: () => void
  onStop: () => void
  onToggleSequentialMode: () => void
}

export function PlaybackControls({
  sparkKey,
  garageyaKey,
  isSequentialMode,
  onPlayRandom,
  onPlayGarageya,
  onStop,
  onToggleSequentialMode,
}: PlaybackControlsProps) {
  return (
    <section className="control-panel" aria-label="ボイス再生コントロール">
      <button type="button" className="voice-launch" onClick={onPlayRandom}>
        <span className="voice-launch-icon" key={sparkKey} aria-hidden="true">
          ドドーン♪
        </span>
        ランダム再生
      </button>
      <button type="button" className="voice-garageya" onClick={onPlayGarageya}>
        <span className="voice-launch-icon" key={garageyaKey} aria-hidden="true">
          わいわい
        </span>
        ガヤガヤ再生
      </button>
      <button type="button" className="voice-stop" onClick={onStop} aria-label="再生を停止">
        <span className="voice-stop-icon" aria-hidden="true">
          ■
        </span>
        停止
      </button>
      <button
        type="button"
        className={`voice-sequential ${isSequentialMode ? 'is-active' : ''}`}
        aria-pressed={isSequentialMode}
        onClick={onToggleSequentialMode}
      >
        ⇄ 連続再生 {isSequentialMode ? 'ON' : 'OFF'}
      </button>
    </section>
  )
}