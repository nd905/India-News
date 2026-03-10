# 🇮🇳 India NewsShorts

A live India news app with topic filters — built with Hono + Cloudflare Pages.

## 🌐 Live URLs
- **Production**: https://india-newshorts.pages.dev
- **GitHub**: https://github.com/nd905/India-News

## 📰 Features
### Completed
- 🏠 **Following Feed** — Live Twitter/X syndication feed from curated Indian accounts
- 🇮🇳 **Topic Filters** — India, Politics, Finance, Cricket, Tech
- 📰 **News Section** — All India, Economy, Critical news from NewsAPI
- ⏰ Auto-refreshes every 15 minutes
- 🔖 Save favourite articles to localStorage
- ↗ Read full articles (opens source)
- ⌨️ Keyboard navigation (← →) for news cards
- 📱 PWA support (installable, offline-capable)
- 📲 Touch swipe for news navigation
- 🌙 Dark mode UI

### API Endpoints
| Path | Method | Description | Parameters |
|------|--------|-------------|------------|
| `/` | GET | Main HTML page | — |
| `/api/timeline` | GET | Following feed tweets | `?filter=all\|india\|politics\|finance\|cricket\|tech` |
| `/api/twitter` | GET | Single account tweets | `?username=Portfolio_Bull` |
| `/api/news` | GET | News articles | `?topic=all\|critical\|politics\|social\|economy` |
| `/static/*` | GET | Static assets (icons, manifest, SW) | — |

## 🛠 Tech Stack
- **Backend**: Hono framework (Cloudflare Pages Functions)
- **Frontend**: Vanilla JS + CSS (dark theme, no external CSS framework)
- **Hosting**: Cloudflare Pages (FREE)
- **News Data**: NewsAPI.org (server-side API key)
- **Twitter Data**: Twitter/X Syndication API (no API key needed)
- **PWA**: Service Worker + Web App Manifest

## 📁 Project Structure
```
webapp/
├── src/
│   ├── index.tsx        # Main Hono app (API routes + HTML)
│   └── renderer.tsx     # JSX renderer (unused)
├── public/
│   └── static/          # Static assets
│       ├── icon-192.png
│       ├── icon-512.png
│       ├── manifest.json
│       ├── style.css
│       └── sw.js
├── scripts/
│   └── postbuild.mjs    # Copies static assets to dist/
├── dist/                 # Build output (auto-generated)
│   ├── _worker.js        # Compiled Hono app
│   ├── _routes.json      # Route config
│   └── static/           # Static assets copy
├── ecosystem.config.cjs  # PM2 config for dev server
├── wrangler.jsonc        # Cloudflare Pages config
├── vite.config.ts        # Vite build config
├── package.json          # Dependencies & scripts
└── deploy.sh             # One-click deploy script
```

## 🚀 Deployment

### Local Development
```bash
npm install
npm run build
pm2 start ecosystem.config.cjs
# Visit http://localhost:3000
```

### Deploy to Cloudflare Pages
```bash
npm run deploy
# Or manually:
npm run build
npx wrangler pages deploy dist --project-name india-newshorts
```

### Configuration
- **Platform**: Cloudflare Pages
- **Status**: ✅ Active
- **Build**: Vite + @hono/vite-cloudflare-pages
- **Last Updated**: 2026-03-10
