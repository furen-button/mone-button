import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { dataEditorPlugin } from './plugins/vite-plugin-data-editor'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    dataEditorPlugin(),
  ],
  base: '/mone-button/',
})
