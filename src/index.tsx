import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  NEWS_API_KEY: string
  CONSUMER_KEY: string
  CONSUMER_SECRET: string
  ACCESS_TOKEN: string
  ACCESS_TOKEN_SECRET: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

// ── HELPERS: OAuth 1.0a ──────────────────────────────────────────────────────
function percentEncode(str: string): string {
  return encodeURIComponent(String(str))
    .replace(/!/g, '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A')
}

function generateNonce(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}

async function generateOAuthSignature(
  method: string, url: string, params: Record<string, string>,
  consumerSecret: string, tokenSecret: string
): Promise<string> {
  const sortedParams = Object.keys(params)
    .sort()
    .map(k => `${percentEncode(k)}=${percentEncode(String(params[k]))}`)
    .join('&')

  const signatureBase = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(sortedParams),
  ].join('&')

  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )

  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signatureBase))
  return btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
}

async function buildOAuthHeader(
  method: string, baseUrl: string,
  queryParams: Record<string, string>,
  creds: { consumerKey: string; consumerSecret: string; accessToken: string; accessTokenSecret: string }
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = generateNonce()

  const oauthParams: Record<string, string> = {
    oauth_consumer_key:     creds.consumerKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        timestamp,
    oauth_token:            creds.accessToken,
    oauth_version:          '1.0',
  }

  const allParams = { ...oauthParams, ...queryParams }
  const signature = await generateOAuthSignature(
    method, baseUrl, allParams, creds.consumerSecret, creds.accessTokenSecret
  )

  const headerObj = { ...oauthParams, oauth_signature: signature }
  const headerParts = Object.keys(headerObj)
    .sort()
    .map(k => `${percentEncode(k)}="${percentEncode(headerObj[k])}"`)

  return `OAuth ${headerParts.join(', ')}`
}

// ── 1. TWITTER FOLLOWING TIMELINE (v2 API with OAuth 1.0a) ──────────────────
app.get('/api/timeline', async (c) => {
  const paginationToken = c.req.query('pagination_token') || null

  const consumerKey       = c.env?.CONSUMER_KEY       || ''
  const consumerSecret    = c.env?.CONSUMER_SECRET    || ''
  const accessToken       = c.env?.ACCESS_TOKEN       || ''
  const accessTokenSecret = c.env?.ACCESS_TOKEN_SECRET || ''

  if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
    return c.json({ error: 'Missing Twitter API credentials. Set CONSUMER_KEY, CONSUMER_SECRET, ACCESS_TOKEN, ACCESS_TOKEN_SECRET in Cloudflare Pages secrets.' }, 500)
  }

  const USER_ID = '596210221' // @Sj89Jain
  const BASE_URL = `https://api.twitter.com/2/users/${USER_ID}/timelines/reverse_chronological`

  const queryParams: Record<string, string> = {
    'max_results': '20',
    'tweet.fields': 'created_at,author_id,text,attachments,public_metrics,entities,possibly_sensitive',
    'expansions': 'author_id,attachments.media_keys',
    'media.fields': 'url,preview_image_url,type,width,height,alt_text',
    'user.fields': 'name,username,profile_image_url,verified,public_metrics,description',
  }

  if (paginationToken) {
    queryParams['pagination_token'] = paginationToken
  }

  const apiUrl = new URL(BASE_URL)
  Object.entries(queryParams).forEach(([k, v]) => apiUrl.searchParams.set(k, v))

  try {
    const authHeader = await buildOAuthHeader('GET', BASE_URL, queryParams, {
      consumerKey, consumerSecret, accessToken, accessTokenSecret
    })

    const apiResponse = await fetch(apiUrl.toString(), {
      headers: {
        'Authorization': authHeader,
        'User-Agent': 'IndiaNewsShorts/1.0',
      },
    })

    const data = await apiResponse.json() as any

    return c.json(data, apiResponse.status as any)
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to fetch timeline' }, 500)
  }
})

// ── 2. NEWS API ───────────────────────────────────────────────────────────────
app.get('/api/news', async (c) => {
  const topic  = c.req.query('topic') || 'all'
  const apiKey = c.env?.NEWS_API_KEY || '0f761fbbe8cb45dab9bac756f369ba88'

  const topicUrls: Record<string, string> = {
    all:      `https://newsapi.org/v2/everything?q=india+latest+news&language=en&sortBy=publishedAt&pageSize=20&apiKey=${apiKey}`,
    critical: `https://newsapi.org/v2/everything?q=india+(criticism+OR+scandal+OR+controversy+OR+protest+OR+allegation)&language=en&sortBy=popularity&pageSize=20&apiKey=${apiKey}`,
    politics: `https://newsapi.org/v2/everything?q=india+politics+(criticism+OR+allegation+OR+scandal+OR+opposition)&language=en&sortBy=popularity&pageSize=20&apiKey=${apiKey}`,
    social:   `https://newsapi.org/v2/everything?q=india+(inequality+OR+discrimination+OR+protest+OR+rights+OR+social)&language=en&sortBy=popularity&pageSize=20&apiKey=${apiKey}`,
    economy:  `https://newsapi.org/v2/everything?q=india+economy+(criticism+OR+crisis+OR+unemployment+OR+inflation)&language=en&sortBy=popularity&pageSize=20&apiKey=${apiKey}`,
  }

  try {
    const res  = await fetch(topicUrls[topic] || topicUrls.all, {
      headers: { 'User-Agent': 'India-NewsShorts/1.0' }
    })
    const data = await res.json() as any

    if (data.status === 'ok' && data.articles) {
      const articles = data.articles
        .filter((a: any) => a.title !== '[Removed]' && a.urlToImage)
        .map((a: any, i: number) => ({
          id: `news-${i}`,
          type: 'news',
          category: a.source?.name || 'News',
          headline: a.title,
          summary: a.description || (a.content?.substring(0, 200) + '...') || 'No description.',
          image: a.urlToImage,
          source: a.source?.name,
          time: new Date(a.publishedAt).toLocaleString('en-IN', {
            hour: 'numeric', minute: 'numeric', hour12: true, month: 'short', day: 'numeric',
          }),
          url: a.url,
        }))
      return c.json({ success: true, articles })
    }
    return c.json({ success: false, error: data.message || 'Failed to fetch news' }, 500)
  } catch {
    return c.json({ success: false, error: 'Server error fetching news' }, 500)
  }
})

// ── STATIC FILES ──────────────────────────────────────────────────────────────
app.use('/static/*', serveStatic({ root: './' }))

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>India NewsShorts 🇮🇳</title>

  <!-- PWA META -->
  <meta name="application-name" content="India NewsShorts"/>
  <meta name="apple-mobile-web-app-title" content="NewsShorts"/>
  <meta name="apple-mobile-web-app-capable" content="yes"/>
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
  <meta name="mobile-web-app-capable" content="yes"/>
  <meta name="theme-color" content="#0f0f0f"/>
  <meta name="description" content="Live India news + @Sj89Jain Twitter following feed"/>

  <!-- PWA MANIFEST + ICONS -->
  <link rel="manifest" href="/static/manifest.json"/>
  <link rel="icon" href="/static/icon-192.png"/>
  <link rel="apple-touch-icon" href="/static/icon-192.png"/>

  <style>
    :root {
      --saffron: #FF9933;
      --white:   #FFFFFF;
      --green:   #138808;
      --navy:    #000080;
      --bg:      #0f0f0f;
      --card-bg: #1a1a1a;
      --card-hover: #222222;
      --border:  #2a2a2a;
      --text:    #e8e8e8;
      --muted:   #777;
      --link:    #1d9bf0;
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      background: var(--bg); color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh; overscroll-behavior-y: contain;
    }
    /* ── Header ── */
    header {
      position: sticky; top: 0; z-index: 100;
      background: rgba(15,15,15,0.95);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
    }
    .header-inner {
      max-width: 680px; margin: 0 auto; padding: 0 1rem;
      display: flex; align-items: center; justify-content: space-between;
      height: 56px;
    }
    .logo { display: flex; align-items: center; gap: 10px; font-size: 1.1rem; font-weight: 700; }
    .logo-flag { font-size: 1.5rem; }
    .logo-text span { color: var(--saffron); }
    .header-actions { display: flex; align-items: center; gap: 12px; }
    .refresh-btn {
      background: var(--saffron); color: #000;
      border: none; border-radius: 20px;
      padding: 7px 16px; font-size: 0.82rem; font-weight: 700;
      cursor: pointer; transition: opacity 0.2s;
      display: flex; align-items: center; gap: 6px;
    }
    .refresh-btn:hover { opacity: 0.85; }
    .refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .refresh-btn svg { width: 14px; height: 14px; }
    /* ── PWA install banner ── */
    #installBanner {
      display: none; position: fixed; top: 0; inset-inline: 0; z-index: 200;
      background: linear-gradient(90deg, var(--saffron), var(--green));
      padding: 10px 16px;
      align-items: center; justify-content: space-between;
    }
    #installBanner .install-text { color: #fff; font-size: 0.85rem; font-weight: 600; }
    #installBanner .install-actions { display: flex; gap: 8px; }
    .install-yes { background: #fff; color: #000; border: none; border-radius: 16px; padding: 5px 14px; font-size: 0.8rem; font-weight: 700; cursor: pointer; }
    .install-no  { background: none; color: rgba(255,255,255,0.7); border: none; font-size: 0.8rem; cursor: pointer; }
    /* ── Tricolor bar ── */
    .tricolor-bar {
      height: 3px;
      background: linear-gradient(90deg, var(--saffron) 33.3%, var(--white) 33.3% 66.6%, var(--green) 66.6%);
    }
    /* ── Main layout ── */
    main { max-width: 680px; margin: 0 auto; }
    /* ── Tabs ── */
    .tabs {
      display: flex; gap: 0;
      border-bottom: 1px solid var(--border);
      overflow-x: auto; scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar { display: none; }
    .tab {
      padding: 14px 18px;
      background: none; border: none;
      color: var(--muted); font-size: 0.9rem; font-weight: 500;
      cursor: pointer; white-space: nowrap;
      border-bottom: 3px solid transparent;
      transition: all 0.15s;
    }
    .tab:hover { color: var(--text); background: rgba(255,255,255,0.04); }
    .tab.active { color: var(--saffron); border-bottom-color: var(--saffron); font-weight: 700; }
    /* ── Feed ── */
    #feed { min-height: 60vh; }
    /* ── Tweet card ── */
    .tweet-card {
      display: flex; gap: 12px;
      padding: 16px;
      border-bottom: 1px solid var(--border);
      transition: background 0.15s;
      cursor: pointer;
      text-decoration: none; color: inherit;
    }
    .tweet-card:hover { background: var(--card-hover); }
    .avatar {
      width: 44px; height: 44px; min-width: 44px;
      border-radius: 50%; object-fit: cover; background: var(--border);
    }
    .avatar-placeholder {
      width: 44px; height: 44px; min-width: 44px; border-radius: 50%;
      background: linear-gradient(135deg, var(--saffron), var(--green));
      display: flex; align-items: center; justify-content: center;
      font-size: 1.1rem; font-weight: 700; color: #fff;
    }
    .tweet-body { flex: 1; min-width: 0; }
    .tweet-header {
      display: flex; align-items: baseline; gap: 6px;
      flex-wrap: wrap; margin-bottom: 4px;
    }
    .tweet-name { font-weight: 700; font-size: 0.95rem; }
    .tweet-handle { color: var(--muted); font-size: 0.87rem; }
    .tweet-dot { color: var(--muted); font-size: 0.87rem; }
    .tweet-time { color: var(--muted); font-size: 0.87rem; }
    .verified-badge { color: var(--link); font-size: 0.85rem; }
    .tweet-text {
      font-size: 0.97rem; line-height: 1.55;
      word-break: break-word; margin-bottom: 10px;
    }
    .tweet-text a { color: var(--link); text-decoration: none; }
    .tweet-text a:hover { text-decoration: underline; }
    .hashtag { color: var(--link); }
    .mention { color: var(--link); }
    /* ── Media ── */
    .tweet-media {
      margin-bottom: 10px;
      border-radius: 12px; overflow: hidden;
      border: 1px solid var(--border);
    }
    .tweet-media img { width: 100%; max-height: 300px; object-fit: cover; display: block; }
    /* ── Metrics ── */
    .tweet-metrics { display: flex; gap: 20px; color: var(--muted); font-size: 0.83rem; }
    .metric { display: flex; align-items: center; gap: 5px; transition: color 0.15s; }
    .metric:hover { color: var(--link); }
    .metric svg { width: 15px; height: 15px; }
    /* ── India badge ── */
    .india-badge {
      display: inline-flex; align-items: center; gap: 4px;
      background: rgba(255,153,51,0.15); color: var(--saffron);
      font-size: 0.72rem; font-weight: 700; padding: 2px 8px;
      border-radius: 20px; margin-bottom: 6px;
      border: 1px solid rgba(255,153,51,0.3);
    }
    /* ── Load More ── */
    .load-more-wrap { padding: 24px; text-align: center; }
    .load-more-btn {
      background: transparent; border: 1px solid var(--saffron);
      color: var(--saffron); padding: 10px 32px; border-radius: 24px;
      font-size: 0.92rem; font-weight: 700; cursor: pointer; transition: all 0.2s;
    }
    .load-more-btn:hover { background: var(--saffron); color: #000; }
    .load-more-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    /* ── States ── */
    .state-container {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 60px 20px; gap: 12px;
      color: var(--muted); text-align: center;
    }
    .state-icon { font-size: 3rem; }
    .state-title { font-size: 1.1rem; font-weight: 600; color: var(--text); }
    .state-sub { font-size: 0.9rem; max-width: 300px; line-height: 1.5; }
    .retry-btn {
      margin-top: 8px;
      background: var(--saffron); color: #000;
      border: none; border-radius: 20px;
      padding: 9px 24px; font-weight: 700; font-size: 0.9rem; cursor: pointer;
    }
    /* ── Skeleton ── */
    .skeleton-card { padding: 16px; border-bottom: 1px solid var(--border); display: flex; gap: 12px; }
    .skel {
      background: linear-gradient(90deg, var(--border) 25%, #2f2f2f 50%, var(--border) 75%);
      background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 4px;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }
    .skel-avatar { width:44px; height:44px; border-radius:50%; min-width:44px; }
    .skel-lines { flex:1; display:flex; flex-direction:column; gap:10px; }
    .skel-line { height: 12px; }
    .skel-line.w60 { width:60%; } .skel-line.w40 { width:40%; }
    .skel-line.w90 { width:90%; } .skel-line.w75 { width:75%; }
    /* ── Stats bar ── */
    .stats-bar {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px;
      background: rgba(255,153,51,0.06);
      border-bottom: 1px solid var(--border);
      font-size: 0.82rem; color: var(--muted);
    }
    .stats-bar .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
    .stats-bar strong { color: var(--text); }
    /* ── News card section ── */
    #newsSection { display: none; }
    .news-card-wrap {
      max-width: 480px; margin: 20px auto; padding: 0 16px;
    }
    .news-card {
      background: var(--card-bg); border-radius: 16px;
      overflow: hidden; border: 1px solid var(--border);
      transition: background 0.15s;
    }
    .news-card img { width: 100%; height: 200px; object-fit: cover; display: block; }
    .news-card-body { padding: 16px; }
    .news-cat {
      display: inline-block; background: rgba(255,153,51,0.15);
      color: var(--saffron); font-size: 0.72rem; font-weight: 700;
      padding: 3px 10px; border-radius: 20px; margin-bottom: 10px;
    }
    .news-headline { font-size: 1.05rem; font-weight: 700; line-height: 1.4; margin-bottom: 8px; }
    .news-summary { font-size: 0.88rem; color: #aaa; line-height: 1.5; margin-bottom: 12px; }
    .news-meta { display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--muted); margin-bottom: 14px; }
    .news-actions { display: flex; gap: 10px; }
    .news-btn {
      flex: 1; padding: 10px; border-radius: 10px; border: 1px solid var(--border);
      background: transparent; color: var(--text);
      font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: all 0.15s;
      display: flex; align-items: center; justify-content: center; gap: 6px;
    }
    .news-btn:hover { background: var(--card-hover); }
    .news-btn.saved { background: rgba(255,153,51,0.2); border-color: var(--saffron); color: var(--saffron); }
    .news-nav {
      display: flex; align-items: center; justify-content: center; gap: 20px;
      padding: 16px 0 8px;
    }
    .news-nav-btn {
      width: 44px; height: 44px; border-radius: 50%;
      background: var(--card-bg); border: 1px solid var(--border);
      color: var(--text); font-size: 1.1rem; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.15s;
    }
    .news-nav-btn:hover { background: var(--card-hover); }
    .news-counter { color: var(--muted); font-size: 0.85rem; }
    .news-dots { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 0 16px; flex-wrap: wrap; }
    .news-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); cursor: pointer; transition: all 0.15s; }
    .news-dot.active { background: var(--saffron); width: 22px; border-radius: 4px; }
    /* ── Responsive ── */
    @media (max-width: 600px) {
      .tweet-card { padding: 13px; }
      .tab { padding: 12px 13px; font-size: 0.85rem; }
    }
  </style>
</head>
<body>

<!-- PWA install banner -->
<div id="installBanner">
  <span class="install-text">📲 Install India NewsShorts as App!</span>
  <div class="install-actions">
    <button class="install-yes" onclick="installApp()">Install</button>
    <button class="install-no"  onclick="dismissInstall()">✕</button>
  </div>
</div>

<header>
  <div class="header-inner">
    <div class="logo">
      <span class="logo-flag">🇮🇳</span>
      <div class="logo-text">India<span>NewsShorts</span></div>
    </div>
    <div class="header-actions">
      <button class="refresh-btn" id="refreshBtn" onclick="handleRefresh()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M23 4v6h-6M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
        Refresh
      </button>
    </div>
  </div>
</header>
<div class="tricolor-bar"></div>

<main>
  <div class="tabs" id="tabsContainer">
    <button class="tab active" data-mode="twitter" data-filter="all"      onclick="setTab(this,'twitter','all')">🏠 Following</button>
    <button class="tab"        data-mode="twitter" data-filter="india"    onclick="setTab(this,'twitter','india')">🇮🇳 India</button>
    <button class="tab"        data-mode="twitter" data-filter="politics" onclick="setTab(this,'twitter','politics')">🏛 Politics</button>
    <button class="tab"        data-mode="twitter" data-filter="business" onclick="setTab(this,'twitter','business')">📈 Business</button>
    <button class="tab"        data-mode="twitter" data-filter="cricket"  onclick="setTab(this,'twitter','cricket')">🏏 Cricket</button>
    <button class="tab"        data-mode="twitter" data-filter="tech"     onclick="setTab(this,'twitter','tech')">💻 Tech</button>
    <button class="tab"        data-mode="news"    data-filter="all"      onclick="setTab(this,'news','all')">📰 All News</button>
    <button class="tab"        data-mode="news"    data-filter="critical" onclick="setTab(this,'news','critical')">⚠️ Critical</button>
    <button class="tab"        data-mode="news"    data-filter="economy"  onclick="setTab(this,'news','economy')">💰 Economy</button>
  </div>

  <!-- Stats bar (Twitter mode) -->
  <div id="statsBar" class="stats-bar" style="display:none">
    <div class="dot"></div>
    <span>Showing <strong id="tweetCount">0</strong> tweets &nbsp;·&nbsp; Updated: <strong id="lastUpdated">—</strong></span>
  </div>

  <!-- Twitter feed -->
  <div id="twitterSection">
    <div id="feed"></div>
    <div class="load-more-wrap" id="loadMoreWrap" style="display:none">
      <button class="load-more-btn" id="loadMoreBtn" onclick="loadMore()">Load More</button>
    </div>
  </div>

  <!-- News card section -->
  <div id="newsSection">
    <div class="news-card-wrap">
      <div id="newsLoadingState" class="state-container">
        <div class="state-icon">⏳</div>
        <div class="state-title">Loading news…</div>
      </div>
      <div id="newsErrorState" class="state-container" style="display:none">
        <div class="state-icon">⚠️</div>
        <div class="state-title">Could not load news</div>
        <div class="state-sub" id="newsErrMsg"></div>
        <button class="retry-btn" onclick="fetchCurrentNews()">Try Again</button>
      </div>
      <div id="newsCardWrap" style="display:none">
        <div class="news-card" id="newsCard">
          <img id="newsImg" src="" alt=""/>
          <div class="news-card-body">
            <span class="news-cat" id="newsCat"></span>
            <div class="news-headline" id="newsHeadline"></div>
            <div class="news-summary" id="newsSummary"></div>
            <div class="news-meta">
              <span id="newsSource"></span>
              <span id="newsTime"></span>
            </div>
            <div class="news-actions">
              <button class="news-btn" id="newsSaveBtn" onclick="toggleSave()">🔖 Save</button>
              <button class="news-btn" onclick="openArticle()">↗ Read Full</button>
            </div>
          </div>
        </div>
        <div class="news-nav">
          <button class="news-nav-btn" onclick="prevArticle()">‹</button>
          <span class="news-counter" id="newsCounter">– / –</span>
          <button class="news-nav-btn" onclick="nextArticle()">›</button>
        </div>
        <div class="news-dots" id="newsDots"></div>
      </div>
    </div>
  </div>
</main>

<script>
// ── Constants & State ─────────────────────────────────────────────────────────
const INDIA_FILTER = /india|bharat|modi|dilli|delhi|mumbai|chennai|bengaluru|kolkata|hyderabad|bjp|congress|ipl|lok sabha|rajya sabha|rupee|rbi|sensex|nifty/i;
const FILTERS = {
  india:    INDIA_FILTER,
  politics: /modi|bjp|congress|aap|shiv sena|parliament|lok sabha|rajya sabha|election|cm |chief minister|minister|governor|pm |prime minister/i,
  business: /sensex|nifty|bse|nse|rupee|rbi|gdp|inflation|budget|startup|ipo|stock|share|market|economy|finance|sebi/i,
  cricket:  /cricket|bcci|ipl|virat|rohit|dhoni|bumrah|test match|odi|t20|world cup|rcb|csk|mi |kkr|srh|dcr|pbks|rr /i,
  tech:     /ai |artificial intelligence|machine learning|startup|5g|isro|space|tech|digital india|chandrayaan|gaganyaan/i,
};

// Twitter state
let allTweets = [], usersMap = {}, mediaMap = {}, nextToken = null;
let currentFilter = 'all', isLoading = false;

// News state
let newsArticles = [], newsIndex = 0, savedIds = new Set(JSON.parse(localStorage.getItem('savedIds')||'[]'));
let currentNewsFilter = 'all';

// Mode: 'twitter' | 'news'
let currentMode = 'twitter';

// PWA
let deferredInstall = null;

// ── PWA Install ───────────────────────────────────────────────────────────────
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredInstall = e;
  document.getElementById('installBanner').style.display = 'flex';
});
window.addEventListener('appinstalled', () => {
  document.getElementById('installBanner').style.display = 'none';
});
function installApp() {
  if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; }
  document.getElementById('installBanner').style.display = 'none';
}
function dismissInstall() { document.getElementById('installBanner').style.display = 'none'; }

// Service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/static/sw.js').catch(() => {});
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function setTab(el, mode, filter) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');

  if (mode === 'twitter') {
    currentMode = 'twitter';
    currentFilter = filter;
    document.getElementById('twitterSection').style.display = 'block';
    document.getElementById('newsSection').style.display = 'none';
    document.getElementById('statsBar').style.display = 'none';

    if (allTweets.length === 0) {
      loadTweets(true);
    } else {
      renderFeed();
      updateStats();
    }
  } else {
    currentMode = 'news';
    currentNewsFilter = filter;
    document.getElementById('twitterSection').style.display = 'none';
    document.getElementById('newsSection').style.display = 'block';
    document.getElementById('statsBar').style.display = 'none';
    fetchCurrentNews();
  }
}

function handleRefresh() {
  if (currentMode === 'twitter') loadTweets(true);
  else fetchCurrentNews();
}

// ── Twitter Feed ──────────────────────────────────────────────────────────────
async function loadTweets(refresh = false) {
  if (isLoading) return;
  isLoading = true;

  if (refresh) {
    allTweets = []; usersMap = {}; mediaMap = {}; nextToken = null;
    document.getElementById('loadMoreWrap').style.display = 'none';
    document.getElementById('statsBar').style.display = 'none';
  }

  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.innerHTML = \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 0.8s linear infinite"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Loading…\`;

  if (allTweets.length === 0) renderSkeletons();

  try {
    const resp = await fetch('/api/timeline');
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || err.detail || err.title || 'HTTP ' + resp.status);
    }
    const data = await resp.json();
    if (data.errors && !data.data) throw new Error(data.errors[0]?.detail || 'API error');

    (data.includes?.users  || []).forEach(u => usersMap[u.id] = u);
    (data.includes?.media  || []).forEach(m => mediaMap[m.media_key] = m);

    const newTweets = data.data || [];
    nextToken = data.meta?.next_token || null;
    allTweets = refresh ? newTweets : [...allTweets, ...newTweets];

    renderFeed();
    updateStats();
  } catch (e) {
    showTwitterError(e.message);
  } finally {
    isLoading = false;
    btn.disabled = false;
    btn.innerHTML = \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refresh\`;
  }
}

async function loadMore() {
  if (!nextToken || isLoading) return;
  const btn = document.getElementById('loadMoreBtn');
  btn.disabled = true; btn.textContent = 'Loading…';
  try {
    const resp = await fetch('/api/timeline?pagination_token=' + encodeURIComponent(nextToken));
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    (data.includes?.users || []).forEach(u => usersMap[u.id] = u);
    (data.includes?.media || []).forEach(m => mediaMap[m.media_key] = m);
    allTweets.push(...(data.data || []));
    nextToken = data.meta?.next_token || null;
    renderFeed(); updateStats();
  } catch(e) { console.error(e); }
  finally {
    btn.disabled = false; btn.textContent = 'Load More';
    if (!nextToken) document.getElementById('loadMoreWrap').style.display = 'none';
  }
}

function getFilteredTweets() {
  if (currentFilter === 'all') return allTweets;
  const re = FILTERS[currentFilter];
  return re ? allTweets.filter(t => re.test(t.text)) : allTweets;
}

function renderFeed() {
  const feed = document.getElementById('feed');
  const tweets = getFilteredTweets();
  if (tweets.length === 0 && allTweets.length > 0) {
    feed.innerHTML = \`<div class="state-container"><div class="state-icon">🔍</div><div class="state-title">No matches for this filter</div><div class="state-sub">Try "Following" to see all tweets.</div></div>\`;
    document.getElementById('loadMoreWrap').style.display = 'none';
    return;
  }
  feed.innerHTML = tweets.map(renderTweetCard).join('');
  document.getElementById('loadMoreWrap').style.display = nextToken ? 'block' : 'none';
}

function renderTweetCard(tweet) {
  const author  = usersMap[tweet.author_id] || {};
  const metrics = tweet.public_metrics || {};
  const mediaKeys = tweet.attachments?.media_keys || [];

  const avatarHtml = author.profile_image_url
    ? \`<img class="avatar" src="\${author.profile_image_url.replace('_normal','_bigger')}" alt="\${esc(author.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">\`
      + \`<div class="avatar-placeholder" style="display:none">\${(author.name||'?')[0]}</div>\`
    : \`<div class="avatar-placeholder">\${(author.name||'?')[0]}</div>\`;

  const timeStr      = tweet.created_at ? timeAgo(new Date(tweet.created_at)) : '';
  const isIndia      = INDIA_FILTER.test(tweet.text);
  const indiaBadge   = isIndia ? \`<div class="india-badge">🇮🇳 India</div>\` : '';
  const verifiedBadge= author.verified ? \`<span class="verified-badge" title="Verified">✓</span>\` : '';
  const formattedText= formatTweetText(tweet);

  let mediaHtml = '';
  if (mediaKeys.length) {
    const media = mediaMap[mediaKeys[0]];
    if (media) {
      const imgUrl = media.url || media.preview_image_url;
      if (imgUrl) mediaHtml = \`<div class="tweet-media"><img src="\${imgUrl}" alt="\${esc(media.alt_text||'media')}" loading="lazy"></div>\`;
    }
  }

  const tweetUrl = \`https://x.com/\${author.username}/status/\${tweet.id}\`;
  return \`
    <a class="tweet-card" href="\${tweetUrl}" target="_blank" rel="noopener">
      <div style="display:flex;flex-direction:column;align-items:center">\${avatarHtml}</div>
      <div class="tweet-body">
        \${indiaBadge}
        <div class="tweet-header">
          <span class="tweet-name">\${esc(author.name||'Unknown')}</span>
          \${verifiedBadge}
          <span class="tweet-handle">@\${esc(author.username||'user')}</span>
          <span class="tweet-dot">·</span>
          <span class="tweet-time">\${timeStr}</span>
        </div>
        <div class="tweet-text">\${formattedText}</div>
        \${mediaHtml}
        <div class="tweet-metrics">
          <div class="metric">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            \${fmtNum(metrics.reply_count||0)}
          </div>
          <div class="metric">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            \${fmtNum(metrics.retweet_count||0)}
          </div>
          <div class="metric">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            \${fmtNum(metrics.like_count||0)}
          </div>
          <div class="metric">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            \${fmtNum(metrics.impression_count||0)}
          </div>
        </div>
      </div>
    </a>\`;
}

function renderSkeletons() {
  document.getElementById('feed').innerHTML = Array(6).fill(0).map(() => \`
    <div class="skeleton-card">
      <div class="skel skel-avatar"></div>
      <div class="skel-lines">
        <div class="skel skel-line w60"></div>
        <div class="skel skel-line w90"></div>
        <div class="skel skel-line w75"></div>
        <div class="skel skel-line w40"></div>
      </div>
    </div>\`).join('');
}

function showTwitterError(msg) {
  document.getElementById('feed').innerHTML = \`
    <div class="state-container">
      <div class="state-icon">⚠️</div>
      <div class="state-title">Could not load feed</div>
      <div class="state-sub">\${esc(msg)}</div>
      <button class="retry-btn" onclick="loadTweets(true)">Try Again</button>
    </div>\`;
}

function updateStats() {
  const bar = document.getElementById('statsBar');
  bar.style.display = 'flex';
  document.getElementById('tweetCount').textContent = getFilteredTweets().length;
  document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
}

// ── News Section ──────────────────────────────────────────────────────────────
async function fetchCurrentNews() {
  document.getElementById('newsLoadingState').style.display = 'flex';
  document.getElementById('newsErrorState').style.display = 'none';
  document.getElementById('newsCardWrap').style.display = 'none';
  try {
    const res  = await fetch('/api/news?topic=' + currentNewsFilter);
    const data = await res.json();
    if (data.success && data.articles?.length) {
      newsArticles = data.articles; newsIndex = 0;
      document.getElementById('newsLoadingState').style.display = 'none';
      document.getElementById('newsCardWrap').style.display = 'block';
      renderNewsCard(); renderNewsDots();
    } else {
      throw new Error(data.error || 'No articles found');
    }
  } catch(e) {
    document.getElementById('newsLoadingState').style.display = 'none';
    document.getElementById('newsErrorState').style.display = 'flex';
    document.getElementById('newsErrMsg').textContent = e.message;
  }
}

function renderNewsCard() {
  const a = newsArticles[newsIndex]; if (!a) return;
  document.getElementById('newsCat').textContent     = a.category;
  document.getElementById('newsHeadline').textContent= a.headline;
  document.getElementById('newsSummary').textContent = a.summary;
  document.getElementById('newsSource').textContent  = a.source || '';
  document.getElementById('newsTime').textContent    = a.time || '';
  const img = document.getElementById('newsImg');
  img.src   = a.image || 'https://images.unsplash.com/photo-1524230507669-5ff97982bb5e?w=800&q=80';
  img.onerror = () => { img.src = 'https://images.unsplash.com/photo-1524230507669-5ff97982bb5e?w=800&q=80'; };
  const saved = savedIds.has(a.id);
  const saveBtn = document.getElementById('newsSaveBtn');
  saveBtn.textContent = saved ? '✅ Saved' : '🔖 Save';
  saveBtn.className = 'news-btn' + (saved ? ' saved' : '');
  document.getElementById('newsCounter').textContent = (newsIndex+1) + ' / ' + newsArticles.length;
  updateNewsDots();
}

function renderNewsDots() {
  const c = document.getElementById('newsDots'); c.innerHTML = '';
  const max = Math.min(newsArticles.length, 12);
  for (let i = 0; i < max; i++) {
    const b = document.createElement('button');
    b.className = 'news-dot' + (i === newsIndex ? ' active' : '');
    b.onclick = () => { newsIndex = i; renderNewsCard(); };
    c.appendChild(b);
  }
  if (newsArticles.length > 12) {
    const s = document.createElement('span');
    s.style.cssText = 'color:var(--muted);font-size:0.75rem';
    s.textContent = '+' + (newsArticles.length - 12);
    c.appendChild(s);
  }
}

function updateNewsDots() {
  document.querySelectorAll('.news-dot').forEach((d, i) => {
    d.className = 'news-dot' + (i === newsIndex ? ' active' : '');
  });
}

function prevArticle() {
  if (!newsArticles.length) return;
  newsIndex = newsIndex > 0 ? newsIndex - 1 : newsArticles.length - 1;
  renderNewsCard();
}
function nextArticle() {
  if (!newsArticles.length) return;
  newsIndex = newsIndex < newsArticles.length - 1 ? newsIndex + 1 : 0;
  renderNewsCard();
}

// Keyboard nav
document.addEventListener('keydown', e => {
  if (currentMode === 'news') {
    if (e.key === 'ArrowLeft')  prevArticle();
    if (e.key === 'ArrowRight') nextArticle();
  }
});

// Swipe
let touchStartX = 0;
document.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, {passive:true});
document.addEventListener('touchend', e => {
  if (currentMode !== 'news') return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 50) { dx < 0 ? nextArticle() : prevArticle(); }
}, {passive:true});

function toggleSave() {
  const a = newsArticles[newsIndex]; if (!a) return;
  if (savedIds.has(a.id)) savedIds.delete(a.id); else savedIds.add(a.id);
  localStorage.setItem('savedIds', JSON.stringify([...savedIds]));
  renderNewsCard();
}
function openArticle() {
  const a = newsArticles[newsIndex];
  if (a?.url) window.open(a.url, '_blank');
}

// ── Shared Helpers ────────────────────────────────────────────────────────────
function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTweetText(tweet) {
  let text = esc(tweet.text);
  text = text.replace(/#(\\w+)/g, '<span class="hashtag">#$1</span>');
  text = text.replace(/@(\\w+)/g, '<span class="mention">@$1</span>');
  const urls = tweet.entities?.urls || [];
  urls.forEach(u => {
    const escaped = esc(u.url);
    const display = esc(u.display_url || u.expanded_url || u.url);
    text = text.replace(escaped, \`<a href="\${esc(u.expanded_url||u.url)}" onclick="event.stopPropagation()">\${display}</a>\`);
  });
  return text;
}

function fmtNum(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1).replace(/\\.0$/,'') + 'M';
  if (n >= 1000)    return (n/1000).toFixed(1).replace(/\\.0$/,'') + 'K';
  return n;
}

function timeAgo(date) {
  const diff = (Date.now() - date) / 1000;
  if (diff < 60)    return Math.floor(diff) + 's';
  if (diff < 3600)  return Math.floor(diff/60) + 'm';
  if (diff < 86400) return Math.floor(diff/3600) + 'h';
  return date.toLocaleDateString('en-IN', {day:'numeric', month:'short'});
}

const style = document.createElement('style');
style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(style);

// ── Init ──────────────────────────────────────────────────────────────────────
loadTweets(true);
setInterval(() => { if (currentMode === 'twitter') loadTweets(true); }, 15 * 60 * 1000);
</script>
</body>
</html>`)
})

export default app
