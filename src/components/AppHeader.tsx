import { useMemo } from 'react'
import { localeOptions, t, type Locale } from '../i18n'

type AppHeaderProps = {
  locale: Locale
  onChangeLocale: (locale: Locale) => void
  totalPlays: number | null
}

// アプリヘッダ（サイト名・言語切替・タイトル・総再生数）。
// LocaleProvider の外側で描画されるため locale はコンテキストではなく props で受ける。
export function AppHeader({ locale, onChangeLocale, totalPlays }: AppHeaderProps) {
  const totalPlaysParts = useMemo(() => {
    if (totalPlays === null) {
      return null
    }

    const countText = totalPlays.toLocaleString()
    const [before = '', after = ''] = t('app.totalPlays', { count: countText }, locale).split(countText)
    return { countText, before, after }
  }, [totalPlays, locale])

  return (
    <header className="app-header">
      <div className="app-header-top">
        <p className="app-kicker">{t('app.siteName', {}, locale)}</p>
        <div className="language-switch" role="group" aria-label={t('app.language.label', {}, locale)}>
          {localeOptions.map((option) => (
            <button
              key={option}
              type="button"
              className={`language-chip ${locale === option ? 'is-active' : ''}`}
              onClick={() => onChangeLocale(option)}
              aria-pressed={locale === option}
            >
              {t(`app.language.${option}`, {}, locale)}
            </button>
          ))}
        </div>
      </div>
      <h1>{t('app.title', {}, locale)}</h1>
      <p className="app-copy">{t('app.copy', {}, locale)}</p>
      {totalPlaysParts ? (
        <p className="app-total-plays">
          {totalPlaysParts.before}
          <span className="app-total-plays-count" key={totalPlaysParts.countText}>
            {totalPlaysParts.countText}
          </span>
          {totalPlaysParts.after}
        </p>
      ) : null}
    </header>
  )
}
