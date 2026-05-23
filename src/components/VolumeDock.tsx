type VolumeDockProps = {
  volume: number
  onChangeVolume: (volume: number) => void
}

export function VolumeDock({ volume, onChangeVolume }: VolumeDockProps) {
  return (
    <section className="volume-dock" aria-label="音量調整">
      <span className="volume-icon" aria-hidden="true">
        🔊
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onChange={(event) => onChangeVolume(Number(event.target.value) / 100)}
        className="volume-slider"
        aria-label="再生音量"
      />
      <span className="volume-value">{Math.round(volume * 100)}%</span>
    </section>
  )
}