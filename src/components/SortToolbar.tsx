import type { SortType } from '../voiceData'

type SortToolbarProps = {
  sortType: SortType
  onChangeSortType: (sortType: SortType) => void
}

export function SortToolbar({ sortType, onChangeSortType }: SortToolbarProps) {
  return (
    <section className="sort-toolbar" aria-label="ソートコントロール">
      <span className="sort-toolbar-label">並び順</span>
      <div className="sort-controls" role="group" aria-label="ソートコントロール">
        <button
          type="button"
          className={`sort-chip ${sortType === 'reading' ? 'is-active' : ''}`}
          onClick={() => onChangeSortType('reading')}
          aria-pressed={sortType === 'reading'}
        >
          あ 読み順
        </button>
        <button
          type="button"
          className={`sort-chip ${sortType === 'stream-desc' ? 'is-active' : ''}`}
          onClick={() => onChangeSortType('stream-desc')}
          aria-pressed={sortType === 'stream-desc'}
        >
          ↓ 配信日(新しい順)
        </button>
        <button
          type="button"
          className={`sort-chip ${sortType === 'stream-asc' ? 'is-active' : ''}`}
          onClick={() => onChangeSortType('stream-asc')}
          aria-pressed={sortType === 'stream-asc'}
        >
          ↑ 配信日(古い順)
        </button>
      </div>
    </section>
  )
}