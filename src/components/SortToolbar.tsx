import type { SortType } from '../voiceData'
import { t } from '../i18n'
import { useLocale } from '../i18n'

type SortToolbarProps = {
  sortType: SortType
  onChangeSortType: (sortType: SortType) => void
}

export function SortToolbar({ sortType, onChangeSortType }: SortToolbarProps) {
  const locale = useLocale()

  return (
    <section className="sort-toolbar" aria-label={t('sort.toolbar', {}, locale)}>
      <span className="sort-toolbar-label">{t('sort.label', {}, locale)}</span>
      <div className="sort-controls" role="group" aria-label={t('sort.toolbar', {}, locale)}>
        <button
          type="button"
          className={`sort-chip ${sortType === 'reading' ? 'is-active' : ''}`}
          onClick={() => onChangeSortType('reading')}
          aria-pressed={sortType === 'reading'}
        >
          {t('sort.readingPrefix', {}, locale)} {t('sort.reading', {}, locale)}
        </button>
        <button
          type="button"
          className={`sort-chip ${sortType === 'stream-desc' ? 'is-active' : ''}`}
          onClick={() => onChangeSortType('stream-desc')}
          aria-pressed={sortType === 'stream-desc'}
        >
          ↓ {t('sort.streamDesc', {}, locale)}
        </button>
        <button
          type="button"
          className={`sort-chip ${sortType === 'stream-asc' ? 'is-active' : ''}`}
          onClick={() => onChangeSortType('stream-asc')}
          aria-pressed={sortType === 'stream-asc'}
        >
          ↑ {t('sort.streamAsc', {}, locale)}
        </button>
        <button
          type="button"
          className={`sort-chip ${sortType === 'play-count' ? 'is-active' : ''}`}
          onClick={() => onChangeSortType('play-count')}
          aria-pressed={sortType === 'play-count'}
        >
          ↓ {t('sort.playCount', {}, locale)}
        </button>
      </div>
    </section>
  )
}