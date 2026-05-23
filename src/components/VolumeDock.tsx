import { t } from '../i18n'
import { useLocale } from '../i18n'

type VolumeDockProps = {
  volume: number
  onChangeVolume: (volume: number) => void
}

export function VolumeDock({ volume, onChangeVolume }: VolumeDockProps) {
  const locale = useLocale()

  return (
    <section className="volume-dock" aria-label={t('volume.section', {}, locale)}>
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
        aria-label={t('volume.label', {}, locale)}
      />
      <span className="volume-value">{Math.round(volume * 100)}%</span>
    </section>
  )
}