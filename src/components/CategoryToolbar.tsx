import type { ChangeEventHandler } from 'react'

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
  const handleChange = (category: string): ChangeEventHandler<HTMLInputElement> => {
    return () => onToggleCategory(category)
  }

  return (
    <section className="category-toolbar" aria-label="カテゴリフィルター">
      <button type="button" className="category-filter-action" onClick={onSelectAll}>
        ⊕ 全選択
      </button>
      <button type="button" className="category-filter-action" onClick={onClearAll}>
        ⊖ 全解除
      </button>
      <div className="category-filter-list">
        {categoryOptions.map((category) => {
          const checked = selectedCategories.includes(category)

          return (
            <label className="category-chip" key={category}>
              <input type="checkbox" checked={checked} onChange={handleChange(category)} />
              <span className="category-chip-icon" aria-hidden="true">
                {checked ? '◉' : '○'}
              </span>
              <span className="category-chip-name">{category}</span>
              <span className="category-chip-count" aria-label={`${category} の件数`}>
                {categoryCounts[category] ?? 0}
              </span>
            </label>
          )
        })}
      </div>
    </section>
  )
}