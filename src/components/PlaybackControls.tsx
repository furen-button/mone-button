import { t } from '../i18n'
import { useLocale } from '../i18n'

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
  const locale = useLocale()

  return (
    <section className="control-panel" aria-label={t('playback.controls', {}, locale)}>
      <button type="button" className="voice-launch" onClick={onPlayRandom}>
        <span className="voice-launch-icon" key={sparkKey} aria-hidden="true">
          {t('playback.random.icon', {}, locale)}
        </span>
        {t('playback.random.label', {}, locale)}
      </button>
      <button type="button" className="voice-garageya" onClick={onPlayGarageya}>
        <span className="voice-launch-icon" key={garageyaKey} aria-hidden="true">
          {t('playback.garageya.icon', {}, locale)}
        </span>
        {t('playback.garageya.label', {}, locale)}
      </button>
      <button type="button" className="voice-stop" onClick={onStop} aria-label={t('playback.stop.ariaLabel', {}, locale)}>
        <span className="voice-stop-icon" aria-hidden="true">
          ■
        </span>
        {t('playback.stop.label', {}, locale)}
      </button>
      <button
        type="button"
        className={`voice-sequential ${isSequentialMode ? 'is-active' : ''}`}
        aria-pressed={isSequentialMode}
        onClick={onToggleSequentialMode}
      >
        ⇄ {t('playback.sequential.label', { state: isSequentialMode ? t('playback.sequential.on', {}, locale) : t('playback.sequential.off', {}, locale) }, locale)}
      </button>
    </section>
  )
}