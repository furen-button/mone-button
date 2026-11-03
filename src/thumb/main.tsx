import { createRoot } from 'react-dom/client'
import { ThumbApp } from './ThumbApp'
import './thumb.css'
if (!import.meta.env.DEV) {
  throw new Error('サムネイル工房は開発サーバ専用です')
}
createRoot(document.getElementById('thumb-root')!).render(<ThumbApp />)
