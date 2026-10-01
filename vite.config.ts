import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { dataEditorPlugin } from './plugins/vite-plugin-data-editor'
import { createVideoEditorPlugin } from './plugins/vite-plugin-create-video'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    dataEditorPlugin(),
    createVideoEditorPlugin(),
  ],
  base: '/mone-button/',
})
