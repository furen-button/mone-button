import { t } from '../i18n'
import { useLocale } from '../i18n'

type AnalyticsConsentBannerProps = {
  onAccept: () => void
  onDecline: () => void
}

export function AnalyticsConsentBanner({ onAccept, onDecline }: AnalyticsConsentBannerProps) {
  const locale = useLocale()

  return (
    <section className="analytics-consent" role="dialog" aria-modal="false" aria-label={t('analyticsConsent.title', {}, locale)}>
      <p className="analytics-consent-title">{t('analyticsConsent.title', {}, locale)}</p>
      <p className="analytics-consent-text">{t('analyticsConsent.message', {}, locale)}</p>
      <div className="analytics-consent-actions">
        <button type="button" className="analytics-consent-accept" onClick={onAccept}>
          {t('analyticsConsent.accept', {}, locale)}
        </button>
        <button type="button" className="analytics-consent-decline" onClick={onDecline}>
          {t('analyticsConsent.decline', {}, locale)}
        </button>
      </div>
    </section>
  )
}
