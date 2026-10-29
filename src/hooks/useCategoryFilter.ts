import { useCallback, useState } from 'react'
import { trackCategoryToggle } from '../lib/analytics'
import { categoryOptions } from '../voiceData'

// 初期表示で外しておくカテゴリ。「あいさつ」は全クリップの 7 割を占め、ほかのボタンが埋もれるため。
const INITIALLY_UNSELECTED_CATEGORIES = ['あいさつ']

// カテゴリ絞り込み（選択状態・トグル・全選択・全解除）をまとめたフック。
export function useCategoryFilter() {
  const [selectedCategories, setSelectedCategories] = useState<string[]>(() =>
    categoryOptions.filter((category) => !INITIALLY_UNSELECTED_CATEGORIES.includes(category)),
  )

  const toggleCategory = useCallback((category: string) => {
    setSelectedCategories((current) => {
      if (current.includes(category)) {
        trackCategoryToggle(category, false)
        return current.filter((item) => item !== category)
      }

      trackCategoryToggle(category, true)
      return [...current, category].sort((a, b) => a.localeCompare(b, 'ja'))
    })
  }, [])

  const selectAllCategories = useCallback(() => {
    setSelectedCategories(categoryOptions)
  }, [])

  const clearAllCategories = useCallback(() => {
    setSelectedCategories([])
  }, [])

  return { selectedCategories, toggleCategory, selectAllCategories, clearAllCategories }
}
