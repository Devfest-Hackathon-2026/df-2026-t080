import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { astryxCssPrune } from './astryxCssPrune'

// base を相対パスにして、GitHub Pages のようなサブパスの公開でも、サーバー直下でも動くようにする
// npm run dev のときは /api を試作サーバー（server/app.py・8124）に流す
export default defineConfig({
  base: './',
  plugins: [react(), astryxCssPrune()],
  server: { proxy: { '/api': 'http://127.0.0.1:8124' } },
})
