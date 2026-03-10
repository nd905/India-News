import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-pages'

type Bindings = {
  NEWS_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

// ── FOLLOWING ACCOUNTS (what @Sj89Jain follows — curated list) ───────────────
// Finance/Markets: Portfolio_Bull, ZeeBusiness, moneycontrolcom, EconomicTimes,
//                  CNBCTV18News, livemint, bsindia
// News/Politics:   narendramodi, nsitharaman, ANI, PTI_News, ndtvfeed,
//                  zeenews, RahulGandhi, arvindkejriwal
// Tech/Others:     Piyush_Goyal, rsprasad
const FOLLOWING_ACCOUNTS = [
  // Finance & Markets
  'Portfolio_Bull', 'ZeeBusiness', 'moneycontrolcom', 'EconomicTimes',
  'CNBCTV18News', 'livemint', 'bsindia', 'StockMarket_India',
  // News & Politics
  'narendramodi', 'nsitharaman', 'ANI', 'PTI_News',
  'ndtvfeed', 'zeenews', 'RahulGandhi', 'arvindkejriwal',
  // Tech & Business
  'Piyush_Goyal', 'rsprasad', 'nirmalasite', 'FinMinIndia',
]

// Helper: parse syndication HTML → tweet array
async function fetchAccountTweets(username: string): Promise<any[]> {
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${username}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  })
  if (!res.ok) return []

  const html = await res.text()
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/)
  if (!match) return []

  try {
    const data = JSON.parse(match[1]) as any
    const entries: any[] = data?.props?.pageProps?.timeline?.entries || []
    return entries.map((e: any) => {
      const tw   = e?.content?.tweet || {}
      const user = tw.user || {}
      const text = (tw.full_text || '').trim()
      const tid  = tw.id_str || ''
      const media: any[] = tw.extended_entities?.media || tw.entities?.media || []
      const image = media.length > 0
        ? media[0].media_url_https
        : (user.profile_image_url_https?.replace('_normal', '_bigger') || '')

      return {
        id:         `tw-${username}-${tid}`,
        tid,
        author:     user.screen_name || username,
        name:       user.name || username,
        avatar:     user.profile_image_url_https?.replace('_normal', '_bigger') || '',
        verified:   user.verified || false,
        text,
        image,
        hasMedia:   media.length > 0,
        created_at: tw.created_at || '',
        metrics: {
          retweet_count: tw.retweet_count || 0,
          favorite_count: tw.favorite_count || 0,
          reply_count: tw.reply_count || 0,
        },
        url: tid ? `https://twitter.com/${user.screen_name || username}/status/${tid}` : `https://twitter.com/${username}`,
        isTwitter: true,
      }
    }).filter((t: any) => t.text.length > 0)
  } catch {
    return []
  }
}

// ── 1. FOLLOWING TIMELINE — multi-account syndication feed ───────────────────
app.get('/api/timeline', async (c) => {
  const filter = c.req.query('filter') || 'all'

  // Fetch top accounts in parallel (pick first 8 for speed)
  const accountsToFetch = FOLLOWING_ACCOUNTS.slice(0, 12)
  
  const results = await Promise.allSettled(
    accountsToFetch.map(acc => fetchAccountTweets(acc))
  )

  // Merge all tweets
  let allTweets: any[] = []
  results.forEach(r => {
    if (r.status === 'fulfilled') allTweets.push(...r.value)
  })

  if (allTweets.length === 0) {
    return c.json({ success: false, error: 'Could not fetch tweets. Please try again.' }, 500)
  }

  // Sort by created_at (newest first)
  allTweets.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0
    return tb - ta
  })

  // Deduplicate by tweet ID
  const seen = new Set<string>()
  allTweets = allTweets.filter(t => {
    if (seen.has(t.tid)) return false
    seen.add(t.tid)
    return true
  })

  return c.json({ success: true, tweets: allTweets, count: allTweets.length })
})

// ── 2. SINGLE ACCOUNT TWEETS (for the old /api/twitter endpoint) ─────────────
app.get('/api/twitter', async (c) => {
  const username = (c.req.query('username') || 'Portfolio_Bull').trim()
  const tweets = await fetchAccountTweets(username)
  if (!tweets.length) {
    return c.json({ success: false, error: `No tweets found for @${username}` }, 404)
  }
  return c.json({ success: true, tweets, count: tweets.length })
})

// ── 3. NEWS API ───────────────────────────────────────────────────────────────
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
app.use('/static/*', serveStatic())

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>India NewsShorts 🇮🇳</title>
  <meta name="application-name" content="India NewsShorts"/>
  <meta name="apple-mobile-web-app-title" content="NewsShorts"/>
  <meta name="apple-mobile-web-app-capable" content="yes"/>
  <meta name="mobile-web-app-capable" content="yes"/>
  <meta name="theme-color" content="#0f0f0f"/>
  <meta name="description" content="Live India news + @Sj89Jain's Following feed"/>
  <link rel="manifest" href="/static/manifest.json"/>
  <link rel="icon" href="/static/icon-192.png"/>
  <link rel="apple-touch-icon" href="/static/icon-192.png"/>
  <style>
    :root{--saffron:#FF9933;--green:#138808;--bg:#0f0f0f;--card:#1a1a1a;--card-hover:#222;--border:#2a2a2a;--text:#e8e8e8;--muted:#777;--link:#1d9bf0;}
    *{margin:0;padding:0;box-sizing:border-box;}
    body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;overscroll-behavior-y:contain;}
    /* Header */
    header{position:sticky;top:0;z-index:100;background:rgba(15,15,15,0.96);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);}
    .header-inner{max-width:680px;margin:0 auto;padding:0 1rem;display:flex;align-items:center;justify-content:space-between;height:52px;}
    .logo{display:flex;align-items:center;gap:8px;font-size:1rem;font-weight:700;text-decoration:none;color:var(--text);}
    .logo-flag{font-size:1.4rem;}
    .logo span{color:var(--saffron);}
    .live-badge{background:var(--green);color:#fff;font-size:0.62rem;font-weight:800;padding:2px 7px;border-radius:20px;animation:pulse 2s infinite;letter-spacing:.5px;}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
    .hdr-actions{display:flex;align-items:center;gap:10px;}
    .refresh-btn{background:var(--saffron);color:#000;border:none;border-radius:18px;padding:6px 14px;font-size:0.8rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px;transition:opacity .2s;}
    .refresh-btn:hover{opacity:.85}
    .refresh-btn:disabled{opacity:.4;cursor:not-allowed;}
    .refresh-btn svg{width:13px;height:13px;}
    /* Tricolor */
    .tricolor{height:3px;background:linear-gradient(90deg,var(--saffron) 33.3%,#fff 33.3% 66.6%,var(--green) 66.6%);}
    /* Tabs */
    main{max-width:680px;margin:0 auto;}
    .tabs{display:flex;border-bottom:1px solid var(--border);overflow-x:auto;scrollbar-width:none;}
    .tabs::-webkit-scrollbar{display:none;}
    .tab{padding:13px 16px;background:none;border:none;border-bottom:3px solid transparent;color:var(--muted);font-size:0.88rem;font-weight:500;cursor:pointer;white-space:nowrap;transition:all .15s;}
    .tab:hover{color:var(--text);background:rgba(255,255,255,.04);}
    .tab.active{color:var(--saffron);border-bottom-color:var(--saffron);font-weight:700;}
    /* Stats */
    .stats{display:flex;align-items:center;gap:10px;padding:9px 16px;background:rgba(255,153,51,.05);border-bottom:1px solid var(--border);font-size:0.8rem;color:var(--muted);}
    .stats .dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;}
    .stats strong{color:var(--text);}
    /* Feed */
    #feed{min-height:60vh;}
    /* Tweet card */
    .tweet-card{display:flex;gap:12px;padding:15px 16px;border-bottom:1px solid var(--border);text-decoration:none;color:inherit;transition:background .15s;cursor:pointer;}
    .tweet-card:hover{background:var(--card-hover);}
    .avatar-wrap{display:flex;flex-direction:column;align-items:center;gap:0;}
    .avatar{width:42px;height:42px;min-width:42px;border-radius:50%;object-fit:cover;background:var(--border);}
    .avatar-ph{width:42px;height:42px;min-width:42px;border-radius:50%;background:linear-gradient(135deg,var(--saffron),var(--green));display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:#fff;}
    .tweet-body{flex:1;min-width:0;}
    .tweet-header{display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;margin-bottom:3px;}
    .tweet-name{font-weight:700;font-size:0.93rem;}
    .tweet-handle{color:var(--muted);font-size:0.84rem;}
    .tweet-dot{color:var(--muted);font-size:0.84rem;}
    .tweet-time{color:var(--muted);font-size:0.84rem;}
    .verified{color:var(--link);font-size:0.8rem;}
    .tweet-text{font-size:0.95rem;line-height:1.55;word-break:break-word;margin-bottom:9px;}
    .tweet-text a{color:var(--link);text-decoration:none;}
    .hashtag,.mention{color:var(--link);}
    .tweet-media{margin-bottom:9px;border-radius:12px;overflow:hidden;border:1px solid var(--border);}
    .tweet-media img{width:100%;max-height:280px;object-fit:cover;display:block;}
    .tweet-metrics{display:flex;gap:18px;color:var(--muted);font-size:0.8rem;}
    .metric{display:flex;align-items:center;gap:4px;}
    .metric svg{width:14px;height:14px;}
    /* India badge */
    .india-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(255,153,51,.12);color:var(--saffron);font-size:0.7rem;font-weight:700;padding:2px 7px;border-radius:20px;margin-bottom:5px;border:1px solid rgba(255,153,51,.25);}
    /* Load more */
    .load-more{padding:22px;text-align:center;}
    .load-more-btn{background:transparent;border:1px solid var(--saffron);color:var(--saffron);padding:9px 28px;border-radius:22px;font-size:0.9rem;font-weight:700;cursor:pointer;transition:all .2s;}
    .load-more-btn:hover{background:var(--saffron);color:#000;}
    /* States */
    .state{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:12px;color:var(--muted);text-align:center;}
    .state-icon{font-size:2.8rem;}
    .state-title{font-size:1.05rem;font-weight:600;color:var(--text);}
    .state-sub{font-size:0.88rem;max-width:300px;line-height:1.5;}
    .retry-btn{margin-top:8px;background:var(--saffron);color:#000;border:none;border-radius:18px;padding:8px 22px;font-weight:700;font-size:0.88rem;cursor:pointer;}
    /* Skeleton */
    .skel-card{padding:15px 16px;border-bottom:1px solid var(--border);display:flex;gap:12px;}
    .skel{background:linear-gradient(90deg,var(--border) 25%,#2f2f2f 50%,var(--border) 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;border-radius:4px;}
    @keyframes shimmer{to{background-position:-200% 0;}}
    .skel-av{width:42px;height:42px;border-radius:50%;min-width:42px;}
    .skel-lines{flex:1;display:flex;flex-direction:column;gap:9px;}
    .skel-line{height:11px;}
    /* News section */
    #newsSection{display:none;}
    .news-wrap{max-width:480px;margin:18px auto;padding:0 16px;}
    .news-card{background:var(--card);border-radius:14px;overflow:hidden;border:1px solid var(--border);}
    .news-card img{width:100%;height:190px;object-fit:cover;display:block;}
    .news-body{padding:15px;}
    .news-cat{display:inline-block;background:rgba(255,153,51,.12);color:var(--saffron);font-size:0.7rem;font-weight:700;padding:2px 9px;border-radius:18px;margin-bottom:9px;}
    .news-title{font-size:1rem;font-weight:700;line-height:1.4;margin-bottom:7px;}
    .news-desc{font-size:0.85rem;color:#aaa;line-height:1.5;margin-bottom:11px;}
    .news-meta{display:flex;justify-content:space-between;font-size:0.78rem;color:var(--muted);margin-bottom:13px;}
    .news-actions{display:flex;gap:9px;}
    .news-btn{flex:1;padding:9px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:0.83rem;font-weight:600;cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:5px;}
    .news-btn:hover{background:var(--card-hover);}
    .news-btn.saved{background:rgba(255,153,51,.18);border-color:var(--saffron);color:var(--saffron);}
    .news-nav{display:flex;align-items:center;justify-content:center;gap:18px;padding:14px 0 6px;}
    .nav-btn{width:42px;height:42px;border-radius:50%;background:var(--card);border:1px solid var(--border);color:var(--text);font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;}
    .nav-btn:hover{background:var(--card-hover);}
    .news-counter{color:var(--muted);font-size:0.83rem;}
    .news-dots{display:flex;align-items:center;justify-content:center;gap:5px;padding:6px 0 16px;flex-wrap:wrap;}
    .ndot{width:7px;height:7px;border-radius:50%;background:var(--border);cursor:pointer;transition:all .15s;}
    .ndot.active{background:var(--saffron);width:20px;border-radius:3px;}
    /* PWA banner */
    #installBanner{display:none;position:fixed;top:0;inset-inline:0;z-index:200;background:linear-gradient(90deg,var(--saffron),var(--green));padding:9px 16px;align-items:center;justify-content:space-between;}
    .install-text{color:#fff;font-size:0.82rem;font-weight:600;}
    .install-yes{background:#fff;color:#000;border:none;border-radius:14px;padding:4px 12px;font-size:0.78rem;font-weight:700;cursor:pointer;}
    .install-no{background:none;color:rgba(255,255,255,.7);border:none;font-size:0.78rem;cursor:pointer;margin-left:8px;}
    @media(max-width:600px){.tweet-card{padding:12px;}.tab{padding:11px 13px;font-size:0.83rem;}}
  </style>
</head>
<body>

<div id="installBanner">
  <span class="install-text">📲 Install India NewsShorts</span>
  <div>
    <button class="install-yes" onclick="installApp()">Install</button>
    <button class="install-no" onclick="dismissInstall()">✕</button>
  </div>
</div>

<header>
  <div class="header-inner">
    <a class="logo" href="/">
      <span class="logo-flag">🇮🇳</span>
      India<span>NewsShorts</span>
      <span class="live-badge">LIVE</span>
    </a>
    <div class="hdr-actions">
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
<div class="tricolor"></div>

<main>
  <div class="tabs" id="tabsBar">
    <button class="tab active" onclick="setTab(this,'tw','all')">🏠 Following</button>
    <button class="tab" onclick="setTab(this,'tw','india')">🇮🇳 India</button>
    <button class="tab" onclick="setTab(this,'tw','politics')">🏛 Politics</button>
    <button class="tab" onclick="setTab(this,'tw','finance')">📈 Finance</button>
    <button class="tab" onclick="setTab(this,'tw','cricket')">🏏 Cricket</button>
    <button class="tab" onclick="setTab(this,'tw','tech')">💻 Tech</button>
    <button class="tab" onclick="setTab(this,'news','all')">📰 News</button>
    <button class="tab" onclick="setTab(this,'news','economy')">💰 Economy</button>
    <button class="tab" onclick="setTab(this,'news','critical')">⚠️ Critical</button>
  </div>

  <!-- Stats bar -->
  <div id="statsBar" class="stats" style="display:none">
    <div class="dot"></div>
    <span>Showing <strong id="tweetCount">0</strong> tweets · Updated <strong id="lastUpdated">—</strong></span>
  </div>

  <!-- Twitter section -->
  <div id="twitterSection">
    <div id="feed"></div>
    <div class="load-more" id="loadMoreWrap" style="display:none">
      <button class="load-more-btn" id="loadMoreBtn" onclick="showMore()">Load More</button>
    </div>
  </div>

  <!-- News section -->
  <div id="newsSection">
    <div class="news-wrap">
      <div id="newsLoading" class="state">
        <div class="state-icon">⏳</div>
        <div class="state-title">Loading news…</div>
      </div>
      <div id="newsError" class="state" style="display:none">
        <div class="state-icon">⚠️</div>
        <div class="state-title">Could not load news</div>
        <div class="state-sub" id="newsErrMsg"></div>
        <button class="retry-btn" onclick="fetchNews()">Try Again</button>
      </div>
      <div id="newsCardWrap" style="display:none">
        <div class="news-card">
          <img id="newsImg" src="" alt=""/>
          <div class="news-body">
            <span class="news-cat" id="newsCat"></span>
            <div class="news-title" id="newsTitle"></div>
            <div class="news-desc" id="newsDesc"></div>
            <div class="news-meta">
              <span id="newsSrc"></span>
              <span id="newsTime"></span>
            </div>
            <div class="news-actions">
              <button class="news-btn" id="saveBtn" onclick="toggleSave()">🔖 Save</button>
              <button class="news-btn" onclick="openNews()">↗ Read Full</button>
            </div>
          </div>
        </div>
        <div class="news-nav">
          <button class="nav-btn" onclick="prevNews()">‹</button>
          <span class="news-counter" id="newsCounter">– / –</span>
          <button class="nav-btn" onclick="nextNews()">›</button>
        </div>
        <div class="news-dots" id="newsDots"></div>
      </div>
    </div>
  </div>
</main>

<script>
// ── State ─────────────────────────────────────────────────────────────────────
const FILTERS = {
  india:    /india|bharat|modi|delhi|mumbai|chennai|bengaluru|kolkata|hyderabad|bjp|congress|ipl|lok sabha|rajya sabha|rupee|rbi|sensex|nifty|bse|nse|sebi/i,
  politics: /modi|bjp|congress|aap|parliament|lok sabha|rajya sabha|election|cm |chief minister|minister|governor|pm |prime minister|rahul|kejriwal|yogi|mamata/i,
  finance:  /sensex|nifty|bse|nse|rupee|rbi|gdp|inflation|budget|ipo|stock|share|market|economy|finance|sebi|mutual fund|smallcap|midcap|largecap|₹/i,
  cricket:  /cricket|bcci|ipl|virat|rohit|dhoni|bumrah|test match|odi|t20|world cup|rcb|csk|mi |kkr|srh/i,
  tech:     /ai |artificial intelligence|startup|5g|isro|space|tech|digital india|chandrayaan|software|app launch|coding/i,
};
const INDIA_FILTER = FILTERS.india;

let allTweets = [], shownCount = 20, currentFilter = 'all', twitterMode = true;
let newsArticles = [], newsIdx = 0, newsTopic = 'all';
let savedIds = new Set(JSON.parse(localStorage.getItem('savedIds')||'[]'));
let deferredInstall = null, isLoading = false;

// ── PWA ────────────────────────────────────────────────────────────────────
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredInstall = e;
  document.getElementById('installBanner').style.display = 'flex';
});
window.addEventListener('appinstalled', () => { document.getElementById('installBanner').style.display = 'none'; });
function installApp(){ if(deferredInstall){deferredInstall.prompt();deferredInstall=null;} document.getElementById('installBanner').style.display='none'; }
function dismissInstall(){ document.getElementById('installBanner').style.display='none'; }
if('serviceWorker' in navigator) navigator.serviceWorker.register('/static/sw.js').catch(()=>{});

// ── Tabs ───────────────────────────────────────────────────────────────────
function setTab(el, mode, filter) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  if (mode === 'tw') {
    twitterMode = true; currentFilter = filter;
    document.getElementById('twitterSection').style.display = 'block';
    document.getElementById('newsSection').style.display = 'none';
    if (allTweets.length === 0) loadTimeline(); else { renderFeed(); updateStats(); }
  } else {
    twitterMode = false; newsTopic = filter;
    document.getElementById('twitterSection').style.display = 'none';
    document.getElementById('newsSection').style.display = 'block';
    document.getElementById('statsBar').style.display = 'none';
    fetchNews();
  }
}

function handleRefresh() {
  if (twitterMode) loadTimeline(); else fetchNews();
}

// ── Twitter Feed ───────────────────────────────────────────────────────────
async function loadTimeline() {
  if (isLoading) return;
  isLoading = true;
  allTweets = []; shownCount = 20;

  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.innerHTML = \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin .8s linear infinite"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Loading…\`;

  document.getElementById('statsBar').style.display = 'none';
  document.getElementById('loadMoreWrap').style.display = 'none';
  renderSkeletons();

  try {
    const res = await fetch('/api/timeline');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to load feed');
    allTweets = data.tweets || [];
    renderFeed();
    updateStats();
  } catch(e) {
    showTwErr(e.message);
  } finally {
    isLoading = false;
    btn.disabled = false;
    btn.innerHTML = \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refresh\`;
  }
}

function getFiltered() {
  if (currentFilter === 'all') return allTweets;
  const re = FILTERS[currentFilter];
  return re ? allTweets.filter(t => re.test(t.text)) : allTweets;
}

function renderFeed() {
  const feed = document.getElementById('feed');
  const tweets = getFiltered();
  if (!tweets.length) {
    feed.innerHTML = \`<div class="state"><div class="state-icon">🔍</div><div class="state-title">No matches for this filter</div><div class="state-sub">Switch to "Following" to see all tweets.</div></div>\`;
    document.getElementById('loadMoreWrap').style.display = 'none';
    return;
  }
  const shown = tweets.slice(0, shownCount);
  feed.innerHTML = shown.map(renderCard).join('');
  document.getElementById('loadMoreWrap').style.display = tweets.length > shownCount ? 'block' : 'none';
}

function showMore() {
  shownCount += 20;
  renderFeed();
  updateStats();
}

function renderCard(tw) {
  const isIndia = INDIA_FILTER.test(tw.text);
  const badge = isIndia ? \`<div class="india-badge">🇮🇳 India</div>\` : '';
  const verified = tw.verified ? \`<span class="verified" title="Verified">✓</span>\` : '';
  const time = tw.created_at ? timeAgo(new Date(tw.created_at)) : '';
  const text = formatText(tw.text);
  const media = tw.hasMedia && tw.image
    ? \`<div class="tweet-media"><img src="\${esc(tw.image)}" alt="media" loading="lazy" onerror="this.parentElement.style.display='none'"></div>\`
    : '';
  const avatarHtml = tw.avatar
    ? \`<img class="avatar" src="\${esc(tw.avatar)}" alt="\${esc(tw.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">\`
      + \`<div class="avatar-ph" style="display:none">\${(tw.name||'?')[0]}</div>\`
    : \`<div class="avatar-ph">\${(tw.name||'?')[0]}</div>\`;

  return \`<a class="tweet-card" href="\${esc(tw.url)}" target="_blank" rel="noopener">
    <div class="avatar-wrap">\${avatarHtml}</div>
    <div class="tweet-body">
      \${badge}
      <div class="tweet-header">
        <span class="tweet-name">\${esc(tw.name||tw.author)}</span>
        \${verified}
        <span class="tweet-handle">@\${esc(tw.author)}</span>
        <span class="tweet-dot">·</span>
        <span class="tweet-time">\${time}</span>
      </div>
      <div class="tweet-text">\${text}</div>
      \${media}
      <div class="tweet-metrics">
        <div class="metric">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          \${fmtNum(tw.metrics?.reply_count||0)}
        </div>
        <div class="metric">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          \${fmtNum(tw.metrics?.retweet_count||0)}
        </div>
        <div class="metric">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          \${fmtNum(tw.metrics?.favorite_count||0)}
        </div>
      </div>
    </div>
  </a>\`;
}

function renderSkeletons() {
  document.getElementById('feed').innerHTML = Array(6).fill(0).map(()=>\`
    <div class="skel-card">
      <div class="skel skel-av"></div>
      <div class="skel-lines">
        <div class="skel skel-line" style="width:55%"></div>
        <div class="skel skel-line" style="width:88%"></div>
        <div class="skel skel-line" style="width:72%"></div>
        <div class="skel skel-line" style="width:38%"></div>
      </div>
    </div>\`).join('');
}

function showTwErr(msg) {
  document.getElementById('feed').innerHTML = \`
    <div class="state">
      <div class="state-icon">⚠️</div>
      <div class="state-title">Could not load feed</div>
      <div class="state-sub">\${esc(msg)}</div>
      <button class="retry-btn" onclick="loadTimeline()">Try Again</button>
    </div>\`;
}

function updateStats() {
  const filtered = getFiltered();
  document.getElementById('statsBar').style.display = 'flex';
  document.getElementById('tweetCount').textContent = filtered.length;
  document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
}

// ── News ───────────────────────────────────────────────────────────────────
async function fetchNews() {
  document.getElementById('newsLoading').style.display = 'flex';
  document.getElementById('newsError').style.display = 'none';
  document.getElementById('newsCardWrap').style.display = 'none';
  try {
    const res = await fetch('/api/news?topic=' + newsTopic);
    const d = await res.json();
    if (d.success && d.articles?.length) {
      newsArticles = d.articles; newsIdx = 0;
      document.getElementById('newsLoading').style.display = 'none';
      document.getElementById('newsCardWrap').style.display = 'block';
      renderNews(); renderNewsDots();
    } else throw new Error(d.error || 'No articles');
  } catch(e) {
    document.getElementById('newsLoading').style.display = 'none';
    document.getElementById('newsError').style.display = 'flex';
    document.getElementById('newsErrMsg').textContent = e.message;
  }
}

function renderNews() {
  const a = newsArticles[newsIdx]; if (!a) return;
  document.getElementById('newsCat').textContent   = a.category;
  document.getElementById('newsTitle').textContent = a.headline;
  document.getElementById('newsDesc').textContent  = a.summary;
  document.getElementById('newsSrc').textContent   = a.source || '';
  document.getElementById('newsTime').textContent  = a.time || '';
  const img = document.getElementById('newsImg');
  img.src = a.image || 'https://images.unsplash.com/photo-1524230507669-5ff97982bb5e?w=800&q=80';
  img.onerror = () => { img.src = 'https://images.unsplash.com/photo-1524230507669-5ff97982bb5e?w=800&q=80'; };
  const saved = savedIds.has(a.id);
  const btn = document.getElementById('saveBtn');
  btn.textContent = saved ? '✅ Saved' : '🔖 Save';
  btn.className = 'news-btn' + (saved ? ' saved' : '');
  document.getElementById('newsCounter').textContent = (newsIdx+1) + ' / ' + newsArticles.length;
  updateNewsDots();
}

function renderNewsDots() {
  const c = document.getElementById('newsDots'); c.innerHTML = '';
  Math.min(newsArticles.length, 12);
  for (let i = 0; i < Math.min(newsArticles.length,12); i++) {
    const b = document.createElement('button');
    b.className = 'ndot' + (i===newsIdx?' active':'');
    b.onclick = ()=>{ newsIdx=i; renderNews(); };
    c.appendChild(b);
  }
}

function updateNewsDots() {
  document.querySelectorAll('.ndot').forEach((d,i)=>{ d.className='ndot'+(i===newsIdx?' active':''); });
}

function prevNews(){ if(!newsArticles.length)return; newsIdx=newsIdx>0?newsIdx-1:newsArticles.length-1; renderNews(); }
function nextNews(){ if(!newsArticles.length)return; newsIdx=newsIdx<newsArticles.length-1?newsIdx+1:0; renderNews(); }

document.addEventListener('keydown', e => {
  if (!twitterMode) { if(e.key==='ArrowLeft') prevNews(); if(e.key==='ArrowRight') nextNews(); }
});
let tX=0;
document.addEventListener('touchstart',e=>{ tX=e.touches[0].clientX; },{passive:true});
document.addEventListener('touchend',e=>{
  if(twitterMode)return;
  const dx=e.changedTouches[0].clientX-tX;
  if(Math.abs(dx)>50){ dx<0?nextNews():prevNews(); }
},{passive:true});

function toggleSave() {
  const a=newsArticles[newsIdx]; if(!a)return;
  if(savedIds.has(a.id))savedIds.delete(a.id); else savedIds.add(a.id);
  localStorage.setItem('savedIds',JSON.stringify([...savedIds]));
  renderNews();
}
function openNews() {
  const a=newsArticles[newsIdx]; if(a?.url)window.open(a.url,'_blank');
}

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function formatText(raw) {
  let t = esc(raw);
  t = t.replace(/#(\\w+)/g,'<span class="hashtag">#$1</span>');
  t = t.replace(/@(\\w+)/g,'<span class="mention">@$1</span>');
  t = t.replace(/https?:\\/\\/[^\\s]+/g, url => \`<a href="\${url}" onclick="event.stopPropagation()" target="_blank" rel="noopener">\${url.replace(/^https?:\\/\\//,'').substring(0,30)}…</a>\`);
  return t;
}

function fmtNum(n){ if(n>=1e6)return(n/1e6).toFixed(1).replace(/\\.0$/,'')+'M'; if(n>=1e3)return(n/1e3).toFixed(1).replace(/\\.0$/,'')+'K'; return n; }

function timeAgo(d){
  const s=(Date.now()-d)/1000;
  if(s<60)return Math.floor(s)+'s';
  if(s<3600)return Math.floor(s/60)+'m';
  if(s<86400)return Math.floor(s/3600)+'h';
  return d.toLocaleDateString('en-IN',{day:'numeric',month:'short'});
}

document.head.insertAdjacentHTML('beforeend','<style>@keyframes spin{to{transform:rotate(360deg)}}</style>');

// ── Init ───────────────────────────────────────────────────────────────────
loadTimeline();
setInterval(()=>{ if(twitterMode)loadTimeline(); }, 15*60*1000);
</script>
</body>
</html>`)
})

export default app
