import pages from '@hono/vite-cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    pages(),
    devServer({ adapter, entry: 'src/index.tsx' })
  ],
  build: {
    outDir: 'dist'
  }
})
