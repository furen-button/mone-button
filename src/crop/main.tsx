import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CropApp } from './CropApp'
import '../index.css'
import './crop.css'

if (!import.meta.env.DEV) {
  throw new Error('切り出しツールは開発サーバ専用です')
}

createRoot(document.getElementById('crop-root')!).render(
  <StrictMode>
    <CropApp />
  </StrictMode>,
)
