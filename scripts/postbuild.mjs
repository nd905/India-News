import { cpSync, existsSync, mkdirSync } from 'node:fs'

// Copy public/static → dist/static so Cloudflare Pages can serve them
const src = 'public/static'
const dest = 'dist/static'

if (existsSync(src)) {
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true })
  console.log('✅ Copied public/static → dist/static')
} else {
  console.log('⚠️  No public/static directory found, skipping copy')
}
