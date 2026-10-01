import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorApp } from './EditorApp'
import '../index.css'
import './editor.css'

if (!import.meta.env.DEV) {
  throw new Error('createVideo エディタは開発サーバ専用です')
}

createRoot(document.getElementById('editor-root')!).render(
  <StrictMode>
    <EditorApp />
  </StrictMode>,
)
