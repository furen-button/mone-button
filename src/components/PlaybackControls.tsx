import { t } from '../i18n'
import { useLocale } from '../i18n'

type PlaybackControlsProps = {
  sparkKey: number
  waiwaiKey: number
  isSequentialMode: boolean
  onPlayRandom: () => void
  onPlayWaiwai: () => void
  onStop: () => void
  onToggleSequentialMode: () => void
}

export function PlaybackControls({
  sparkKey,
  waiwaiKey,
  isSequentialMode,
  onPlayRandom,
  onPlayWaiwai,
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
      <button type="button" className="voice-waiwai" onClick={onPlayWaiwai}>
        <span className="voice-launch-icon" key={waiwaiKey} aria-hidden="true">
          {t('playback.waiwai.icon', {}, locale)}
        </span>
        {t('playback.waiwai.label', {}, locale)}
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