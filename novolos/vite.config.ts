import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the site from /NovolosOs/
  base: '/NovolosOs/',
  plugins: [react()],
})
