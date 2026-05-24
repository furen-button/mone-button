import type { ChangeEventHandler } from 'react'
import { t } from '../i18n'
import { useLocale } from '../i18n'

type CategoryToolbarProps = {
  categoryOptions: string[]
  categoryCounts: Record<string, number>
  selectedCategories: string[]
  onSelectAll: () => void
  onClearAll: () => void
  onToggleCategory: (category: string) => void
}

export function CategoryToolbar({
  categoryOptions,
  categoryCounts,
  selectedCategories,
  onSelectAll,
  onClearAll,
  onToggleCategory,
}: CategoryToolbarProps) {
  const locale = useLocale()

  const handleChange = (category: string): ChangeEventHandler<HTMLInputElement> => {
    return () => onToggleCategory(category)
  }

  return (
    <section className="category-toolbar" aria-label={t('category.toolbar', {}, locale)}>
      <button type="button" className="category-filter-action" onClick={onSelectAll}>
        ⊕ {t('category.selectAll', {}, locale)}
      </button>
      <button type="button" className="category-filter-action" onClick={onClearAll}>
        ⊖ {t('category.clearAll', {}, locale)}
      </button>
      <div className="category-filter-list">
        {categoryOptions.map((category) => {
          const checked = selectedCategories.includes(category)

          return (
            <label className={`category-chip ${checked ? 'is-checked' : ''}`} key={category}>
              <input type="checkbox" checked={checked} onChange={handleChange(category)} />
              <span className="category-chip-icon" aria-hidden="true" />
              <span className="category-chip-name">{category}</span>
              <span className="category-chip-count" aria-label={t('category.countAria', { category }, locale)}>
                {categoryCounts[category] ?? 0}
              </span>
            </label>
          )
        })}
      </div>
    </section>
  )
}