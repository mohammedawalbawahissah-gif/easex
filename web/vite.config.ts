import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // In a workspace monorepo, a linked package can pull in its own
    // copy of React, which causes "Invalid hook call" errors. Forcing
    // dedupe makes Vite always resolve to a single React instance.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // @easex/shared is a linked workspace package, not a published dep —
    // excluding it means Vite picks up changes without a cache clear.
    exclude: ['@easex/shared'],
  },
})
