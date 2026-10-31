import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative paths, so the build works at a GitHub Pages sub-path such as /trading-sim/.
  base: './',
  plugins: [react()],
})
