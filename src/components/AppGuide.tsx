import { t, useLocale } from '../i18n'
import { trackYoutubeLinkClick } from '../lib/analytics'

// アプリ下部のガイド／リンク集。LocaleProvider 内で描画されるため useLocale() を使う。
export function AppGuide() {
  const locale = useLocale()

  const handleChannelClick = () => {
    trackYoutubeLinkClick('channel', 'app_guide', 'https://www.youtube.com/@KozueMone')
  }

  return (
    <section className="app-guide" aria-label={t('app.guide.section', {}, locale)}>
      <p className="app-guide-line">
        <a
          className="app-guide-link"
          href="https://www.youtube.com/@KozueMone"
          target="_blank"
          rel="noreferrer"
          onClick={handleChannelClick}
        >
          {t('app.guide.channel', {}, locale)}
        </a>
      </p>
      <p className="app-guide-line">{t('app.guide.infoHint', {}, locale)}</p>
      <p className="app-guide-line">
        {t('app.guide.homageLead', {}, locale)}
        <a
          className="app-guide-link"
          href="http://ushiumi.ichiya-boshi.net"
          target="_blank"
          rel="noreferrer"
        >
          {t('app.guide.ushiumiButton', {}, locale)}
        </a>
        {t('app.guide.homageMiddle', {}, locale)}
        <a
          className="app-guide-link"
          href="https://wikiwiki.jp/nijisanji/%E2%97%8B%E2%97%8B%E3%83%9C%E3%82%BF%E3%83%B3"
          target="_blank"
          rel="noreferrer"
        >
          {t('app.guide.variousButtons', {}, locale)}
        </a>
        {t('app.guide.homageTrail', {}, locale)}
      </p>
      <p className="app-guide-line">
        <a
          className="app-guide-link"
          href="https://www.anycolor.co.jp/guidelines/"
          target="_blank"
          rel="noreferrer"
        >
          {t('app.guide.anycolorGuideline', {}, locale)}
        </a>
        {t('app.guide.guidelineNote', {}, locale)}
      </p>
      <p className="app-guide-line">
        {t('app.guide.relatedLead', {}, locale)}
        <a className="app-guide-link" href="https://www.youtube.com/@master-j-abc" target="_blank" rel="noreferrer">
          YouTube
        </a>
        ,{' '}
        <a className="app-guide-link" href="https://twitter.com/hero_master_j" target="_blank" rel="noreferrer">
          Twitter(X)
        </a>
        {t('app.guide.relatedTrail', {}, locale)}
      </p>
    </section>
  )
}
