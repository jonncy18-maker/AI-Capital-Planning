import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/AI-Capital-Planning/',
  build: {
    rollupOptions: {
      treeshake: false,
    },
  },
})
