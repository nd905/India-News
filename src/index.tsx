import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-pages'

type Bindings = {
  NEWS_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

// ── FOLLOWING ACCOUNTS (what @Sj89Jain follows — curated list) ───────────────
const FOLLOWING_ACCOUNTS = [
  'rimi',
  'asan',
]

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
        id: `tw-${username}-${tid}`, tid,
        author: user.screen_name || username,
        name:   user.name || username,
        avatar: user.profile_image_url_https?.replace('_normal', '_bigger') || '',
        verified: user.verified || false,
        text, image,
        hasMedia: media.length > 0,
        created_at: tw.created_at || '',
        metrics: {
          retweet_count:  tw.retweet_count  || 0,
          favorite_count: tw.favorite_count || 0,
          reply_count:    tw.reply_count    || 0,
        },
        url: tid ? `https://twitter.com/${user.screen_name || username}/status/${tid}` : `https://twitter.com/${username}`,
        isTwitter: true,
      }
    }).filter((t: any) => t.text.length > 0)
  } catch { return [] }
}

app.get('/api/timeline', async (c) => {
  const results = await Promise.allSettled(FOLLOWING_ACCOUNTS.map(acc => fetchAccountTweets(acc)))
  let allTweets: any[] = []
  results.forEach(r => { if (r.status === 'fulfilled') allTweets.push(...r.value) })
  if (allTweets.length === 0) return c.json({ success: false, error: 'Could not fetch tweets.' }, 500)
  allTweets.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0
    return tb - ta
  })
  const seen = new Set<string>()
  allTweets = allTweets.filter(t => { if (seen.has(t.tid)) return false; seen.add(t.tid); return true })
  return c.json({ success: true, tweets: allTweets, count: allTweets.length })
})

app.get('/api/twitter', async (c) => {
  const username = (c.req.query('username') || 'Portfolio_Bull').trim()
  const tweets = await fetchAccountTweets(username)
  if (!tweets.length) return c.json({ success: false, error: `No tweets found for @${username}` }, 404)
  return c.json({ success: true, tweets, count: tweets.length })
})

app.get('/api/news', async (c) => {
  const topic  = c.req.query('topic') || 'all'
  const apiKey = c.env?.NEWS_API_KEY || '0f761fbbe8cb45dab9bac756f369ba88'
  const topicUrls: Record<string, string> = {
    all:      `https://newsapi.org/v2/everything?q=india+latest+news&language=en&sortBy=publishedAt&pageSize=20&apiKey=${apiKey}`,
    critical: `https://newsapi.org/v2/everything?q=india+(criticism+OR+scandal+OR+controversy+OR+protest+OR+allegation)&language=en&sortBy=popularity&pageSize=20&apiKey=${apiKey}`,
    politics: `https://newsapi.org/v2/everything?q=india+politics+(scandal+OR+opposition)&language=en&sortBy=popularity&pageSize=20&apiKey=${apiKey}`,
    social:   `https://newsapi.org/v2/everything?q=india+(inequality+OR+discrimination+OR+protest+OR+rights)&language=en&sortBy=popularity&pageSize=20&apiKey=${apiKey}`,
    economy:  `https://newsapi.org/v2/everything?q=india+economy+(crisis+OR+unemployment+OR+inflation)&language=en&sortBy=popularity&pageSize=20&apiKey=${apiKey}`,
  }
  try {
    const res  = await fetch(topicUrls[topic] || topicUrls.all, { headers: { 'User-Agent': 'India-NewsShorts/1.0' } })
    const data = await res.json() as any
    if (data.status === 'ok' && data.articles) {
      const articles = data.articles
        .filter((a: any) => a.title !== '[Removed]' && a.urlToImage)
        .map((a: any, i: number) => ({
          id: `news-${i}`, type: 'news',
          category: a.source?.name || 'News',
          headline: a.title,
          summary:  a.description || (a.content?.substring(0, 200) + '...') || 'No description.',
          image:    a.urlToImage,
          source:   a.source?.name,
          time: new Date(a.publishedAt).toLocaleString('en-IN', { hour:'numeric', minute:'numeric', hour12:true, month:'short', day:'numeric' }),
          url: a.url,
        }))
      return c.json({ success: true, articles })
    }
    return c.json({ success: false, error: data.message || 'Failed to fetch news' }, 500)
  } catch { return c.json({ success: false, error: 'Server error' }, 500) }
})

app.use('/static/*', serveStatic())

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
  <title>भारत NewsShorts 🇮🇳</title>
  <meta name="application-name" content="भारत NewsShorts"/>
  <meta name="apple-mobile-web-app-title" content="भारत News"/>
  <meta name="apple-mobile-web-app-capable" content="yes"/>
  <meta name="mobile-web-app-capable" content="yes"/>
  <meta name="theme-color" content="#0a0a0a"/>
  <meta name="description" content="India news + Twitter feed — ad-free, fast, Hindi support"/>
  <link rel="manifest" href="/static/manifest.json"/>
  <link rel="icon" href="/static/icon-192.png"/>
  <link rel="apple-touch-icon" href="/static/icon-192.png"/>
  <style>
    :root{
      --accent:#FF6B35;--saffron:#FF9933;--green:#138808;
      --bg:#0a0a0a;--card:#161616;--card2:#1e1e1e;
      --border:#252525;--text:#f0f0f0;--muted:#666;--muted2:#3a3a3a;
      --link:#1d9bf0;--radius:18px;--radius-sm:10px;
    }
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box;}
    body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;overscroll-behavior-y:contain;-webkit-font-smoothing:antialiased;}

    /* PWA banner */
    #installBanner{display:none;position:fixed;top:0;inset-inline:0;z-index:300;background:linear-gradient(90deg,var(--accent),#d4521f);padding:10px 16px;align-items:center;justify-content:space-between;}
    .install-text{color:#fff;font-size:.82rem;font-weight:600;}
    .install-yes{background:#fff;color:#000;border:none;border-radius:14px;padding:5px 13px;font-size:.78rem;font-weight:700;cursor:pointer;}
    .install-no{background:none;color:rgba(255,255,255,.6);border:none;font-size:.78rem;cursor:pointer;margin-left:8px;}

    /* Header */
    header{position:sticky;top:0;z-index:100;background:rgba(10,10,10,.97);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);}
    .header-inner{max-width:680px;margin:0 auto;padding:0 1rem;display:flex;align-items:center;justify-content:space-between;height:54px;}
    .logo{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--text);}
    .logo-name{font-size:1.05rem;font-weight:700;letter-spacing:-.3px;}
    .logo-name em{color:var(--accent);font-style:normal;}
    .live-pill{background:var(--green);color:#fff;font-size:.6rem;font-weight:800;padding:2px 7px;border-radius:20px;animation:pulse 2s infinite;letter-spacing:.6px;}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes shimmer{to{background-position:-200% 0}}

    .refresh-btn{background:var(--accent);color:#fff;border:none;border-radius:20px;padding:7px 15px;font-size:.8rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px;transition:opacity .2s,transform .15s;}
    .refresh-btn:hover{opacity:.88;transform:scale(1.03);}
    .refresh-btn:active{transform:scale(.97);}
    .refresh-btn:disabled{opacity:.35;cursor:not-allowed;transform:none;}
    .refresh-btn svg{width:13px;height:13px;}

    .tricolor{height:3px;background:linear-gradient(90deg,var(--saffron) 33.3%,#fff 33.3% 66.6%,var(--green) 66.6%);}

    /* Tabs */
    main{max-width:680px;margin:0 auto;}
    .tabs{display:flex;overflow-x:auto;scrollbar-width:none;padding:0 8px;gap:2px;background:var(--bg);border-bottom:1px solid var(--border);}
    .tabs::-webkit-scrollbar{display:none;}
    .tab{padding:10px 13px;background:none;border:none;border-bottom:3px solid transparent;color:var(--muted);font-size:.84rem;font-weight:500;cursor:pointer;white-space:nowrap;transition:color .15s,border-color .15s;}
    .tab:hover{color:var(--text);}
    .tab.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:700;}

    /* Stats */
    .stats{display:flex;align-items:center;gap:10px;padding:8px 16px;background:rgba(255,107,53,.04);border-bottom:1px solid var(--border);font-size:.78rem;color:var(--muted);}
    .stats .dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;}
    .stats strong{color:var(--text);}

    /* Skeletons */
    .skel-card{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;gap:12px;}
    .skel{background:linear-gradient(90deg,var(--border) 25%,#2a2a2a 50%,var(--border) 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;border-radius:6px;}
    .skel-av{width:44px;height:44px;border-radius:50%;min-width:44px;}
    .skel-lines{flex:1;display:flex;flex-direction:column;gap:10px;}
    .skel-line{height:11px;}

    /* States */
    .state{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:64px 20px;gap:12px;color:var(--muted);text-align:center;}
    .state-icon{font-size:3rem;}
    .state-title{font-size:1.05rem;font-weight:700;color:var(--text);}
    .state-sub{font-size:.88rem;max-width:300px;line-height:1.55;}
    .retry-btn{margin-top:8px;background:var(--accent);color:#fff;border:none;border-radius:20px;padding:9px 24px;font-weight:700;font-size:.88rem;cursor:pointer;}

    /* Twitter feed */
    #feed{min-height:60vh;}
    .tweet-card{display:flex;gap:13px;padding:15px 16px;border-bottom:1px solid var(--border);text-decoration:none;color:inherit;cursor:pointer;transition:background .15s;animation:fadeUp .3s ease both;}
    .tweet-card:hover{background:var(--card);}
    .avatar-wrap{display:flex;flex-direction:column;align-items:center;}
    .avatar{width:44px;height:44px;min-width:44px;border-radius:50%;object-fit:cover;background:var(--border);border:2px solid var(--border);}
    .avatar-ph{width:44px;height:44px;min-width:44px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--green));display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:#fff;}
    .tweet-body{flex:1;min-width:0;}
    .tweet-header{display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;margin-bottom:4px;}
    .tweet-name{font-weight:700;font-size:.93rem;}
    .tweet-handle,.tweet-dot,.tweet-time{color:var(--muted);font-size:.82rem;}
    .verified{color:var(--link);font-size:.78rem;}
    .india-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(255,107,53,.1);color:var(--accent);font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:20px;margin-bottom:5px;border:1px solid rgba(255,107,53,.2);}
    .tweet-text{font-size:.94rem;line-height:1.57;word-break:break-word;margin-bottom:10px;}
    .tweet-text a{color:var(--link);text-decoration:none;}
    .hashtag,.mention{color:var(--link);}
    .tweet-media{margin-bottom:10px;border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--border);}
    .tweet-media img{width:100%;max-height:280px;object-fit:cover;display:block;}
    .tweet-metrics{display:flex;gap:20px;color:var(--muted);font-size:.79rem;}
    .metric{display:flex;align-items:center;gap:4px;}
    .metric svg{width:14px;height:14px;}
    .load-more{padding:24px;text-align:center;}
    .load-more-btn{background:transparent;border:1px solid var(--accent);color:var(--accent);padding:10px 30px;border-radius:24px;font-size:.9rem;font-weight:700;cursor:pointer;transition:all .2s;}
    .load-more-btn:hover{background:var(--accent);color:#fff;}

    /* News section */
    #newsSection{display:none;}
    .news-shell{max-width:480px;margin:0 auto;padding:14px 14px 28px;}

    /* Progress dots */
    .news-dots-top{display:flex;align-items:center;justify-content:center;gap:5px;padding:4px 0 14px;}
    .ndot-top{width:6px;height:6px;border-radius:50%;background:var(--muted2);cursor:pointer;border:none;transition:all .25s;}
    .ndot-top.active{width:22px;border-radius:3px;background:var(--accent);}

    /* Card */
    .news-card-v2{background:var(--card);border-radius:var(--radius);overflow:hidden;border:1px solid var(--border);animation:fadeUp .3s ease both;}

    /* Image */
    .news-img-wrap{position:relative;width:100%;height:210px;overflow:hidden;background:linear-gradient(135deg,#1a1a2e,#16213e);}
    .news-img-wrap img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .4s ease;}
    .news-card-v2:hover .news-img-wrap img{transform:scale(1.03);}
    .news-img-overlay{position:absolute;bottom:0;left:0;right:0;height:90px;background:linear-gradient(to top,rgba(22,22,22,1),transparent);}
    .news-cat-badge{position:absolute;top:12px;left:12px;background:var(--accent);color:#fff;font-size:.68rem;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:.3px;}
    .news-time-badge{position:absolute;top:12px;right:12px;background:rgba(0,0,0,.55);color:rgba(255,255,255,.75);font-size:.65rem;font-weight:500;padding:3px 9px;border-radius:20px;backdrop-filter:blur(4px);}

    /* Body */
    .news-card-body{padding:16px 16px 12px;}
    .news-headline{font-size:1.08rem;font-weight:700;line-height:1.42;margin-bottom:10px;color:var(--text);}
    .news-summary{font-size:.875rem;color:#aaa;line-height:1.62;margin-bottom:12px;}

    /* Hindi */
    .hindi-row{margin-bottom:14px;}
    .hindi-btn{display:inline-flex;align-items:center;gap:6px;background:rgba(255,107,53,.1);color:var(--accent);border:1px solid rgba(255,107,53,.25);border-radius:20px;padding:5px 13px;font-size:.78rem;font-weight:600;cursor:pointer;transition:all .2s;}
    .hindi-btn:hover{background:rgba(255,107,53,.2);}
    .hindi-btn.loading{opacity:.6;pointer-events:none;}
    .hindi-btn.done{background:rgba(255,107,53,.18);border-color:var(--accent);}
    .hindi-text{margin-top:10px;padding:11px 13px;background:rgba(255,107,53,.06);border-left:3px solid var(--accent);border-radius:0 var(--radius-sm) var(--radius-sm) 0;font-size:.87rem;line-height:1.65;color:#ddd;display:none;}
    .hindi-text.visible{display:block;animation:fadeUp .25s ease;}

    /* Footer */
    .news-card-footer{display:flex;align-items:center;justify-content:space-between;padding:10px 16px 14px;border-top:1px solid var(--border);}
    .news-source{font-size:.75rem;color:var(--muted);}
    .news-source strong{color:rgba(255,255,255,.55);font-weight:600;}
    .news-actions{display:flex;gap:8px;}
    .news-action-btn{display:flex;align-items:center;gap:5px;background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);padding:7px 13px;font-size:.78rem;font-weight:600;cursor:pointer;transition:all .15s;}
    .news-action-btn:hover{background:var(--border);}
    .news-action-btn.saved{background:rgba(255,107,53,.15);border-color:var(--accent);color:var(--accent);}

    /* Nav */
    .news-nav-row{display:flex;align-items:center;justify-content:space-between;padding:14px 4px 0;}
    .nav-arrow{width:44px;height:44px;border-radius:50%;background:var(--card);border:1px solid var(--border);color:var(--text);font-size:1.2rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;}
    .nav-arrow:hover{background:var(--card2);border-color:var(--muted);}
    .news-counter{font-size:.82rem;color:var(--muted);}
    .swipe-hint{text-align:center;padding:8px 0 0;color:var(--muted2);font-size:.75rem;}

    @media(max-width:600px){
      .tweet-card{padding:12px 13px;}
      .tab{padding:10px 11px;font-size:.81rem;}
      .news-shell{padding:10px 10px 20px;}
      .news-img-wrap{height:185px;}
      .news-headline{font-size:1rem;}
    }
  </style>
</head>
<body>

<div id="installBanner">
  <span class="install-text">📲 Install भारत NewsShorts as an App!</span>
  <div>
    <button class="install-yes" onclick="installApp()">Install</button>
    <button class="install-no" onclick="dismissInstall()">✕</button>
  </div>
</div>

<header>
  <div class="header-inner">
    <a class="logo" href="/">
      <span style="font-size:1.45rem">🇮🇳</span>
      <span class="logo-name"><em>भारत</em> NewsShorts</span>
      <span class="live-pill">LIVE</span>
    </a>
    <button class="refresh-btn" id="refreshBtn" onclick="handleRefresh()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M23 4v6h-6M1 20v-6h6"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>
      Refresh
    </button>
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
    <button class="tab" onclick="setTab(this,'news','all')">📰 All News</button>
    <button class="tab" onclick="setTab(this,'news','economy')">💰 Economy</button>
    <button class="tab" onclick="setTab(this,'news','critical')">⚠️ Critical</button>
  </div>

  <div id="statsBar" class="stats" style="display:none">
    <div class="dot"></div>
    <span>Showing <strong id="tweetCount">0</strong> tweets · Updated <strong id="lastUpdated">—</strong></span>
  </div>

  <div id="twitterSection">
    <div id="feed"></div>
    <div class="load-more" id="loadMoreWrap" style="display:none">
      <button class="load-more-btn" onclick="showMore()">Load More</button>
    </div>
  </div>

  <div id="newsSection">
    <div id="newsLoading" class="state">
      <div class="state-icon">⏳</div>
      <div class="state-title">Loading latest news…</div>
    </div>
    <div id="newsError" class="state" style="display:none">
      <div class="state-icon">⚠️</div>
      <div class="state-title">Could not load news</div>
      <div class="state-sub" id="newsErrMsg"></div>
      <button class="retry-btn" onclick="fetchNews()">Try Again</button>
    </div>
    <div id="newsCardWrap" style="display:none">
      <div class="news-shell">
        <div class="news-dots-top" id="newsDotsTop"></div>
        <div class="news-card-v2">
          <div class="news-img-wrap">
            <img id="newsImg" src="" alt=""/>
            <div class="news-img-overlay"></div>
            <span class="news-cat-badge" id="newsCat"></span>
            <span class="news-time-badge" id="newsTime"></span>
          </div>
          <div class="news-card-body">
            <div class="news-headline" id="newsTitle"></div>
            <div class="news-summary"  id="newsDesc"></div>
            <div class="hindi-row">
              <button class="hindi-btn" id="hintBtn" onclick="translateToHindi()">
                <span>अ</span> हिंदी में पढ़ें
              </button>
              <div class="hindi-text" id="hindiText"></div>
            </div>
          </div>
          <div class="news-card-footer">
            <span class="news-source">By <strong id="newsSrc"></strong></span>
            <div class="news-actions">
              <button class="news-action-btn" id="saveBtn" onclick="toggleSave()">🔖 Save</button>
              <button class="news-action-btn" onclick="openNews()">↗ Read Full</button>
            </div>
          </div>
        </div>
        <div class="news-nav-row">
          <button class="nav-arrow" onclick="prevNews()">‹</button>
          <span class="news-counter" id="newsCounter">– / –</span>
          <button class="nav-arrow" onclick="nextNews()">›</button>
        </div>
        <div class="swipe-hint">swipe or use ← → keys</div>
      </div>
    </div>
  </div>
</main>

<script>
const FILTERS={
  cricket:/cricket|bcci|ipl|virat|rohit|dhoni|bumrah|test match|odi|t20|world cup|rcb|csk|mi |kkr|srh|wicket|batting|bowling|innings/i,
  finance:/sensex|nifty|bse|nse|rupee|rbi|gdp|inflation|budget|ipo|stock|share|market|economy|finance|sebi|mutual fund|\\u20b9|profit|loss|revenue|invest|bull|bear|trading/i,
  politics:/modi|bjp|congress|aap|parliament|lok sabha|rajya sabha|election|cm |chief minister|minister|pm |prime minister|rahul|kejriwal|yogi|mamata|vote|political|party|govt|government/i,
  tech:/ai |artificial intelligence|startup|5g|isro|space|tech|digital india|chandrayaan|software|machine learning|blockchain|crypto|cybersecurity|cloud|data|robot/i,
  india:/india|bharat|modi|delhi|mumbai|chennai|bengaluru|kolkata|hyderabad|bjp|congress|ipl|lok sabha|rupee|rbi|sensex|nifty/i,
};
function classifySection(text){
  if(FILTERS.cricket.test(text)) return 'cricket';
  if(FILTERS.finance.test(text)) return 'finance';
  if(FILTERS.politics.test(text))return 'politics';
  if(FILTERS.tech.test(text))    return 'tech';
  if(FILTERS.india.test(text))   return 'india';
  return 'all';
}

let allTweets=[],shownCount=20,currentFilter='all',twitterMode=true;
let newsArticles=[],newsIdx=0,newsTopic='all';
let savedIds  =new Set(JSON.parse(localStorage.getItem('savedIds')||'[]'));
let hindiCache=JSON.parse(localStorage.getItem('hindiCache')||'{}');
let deferredInstall=null,isLoading=false;

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;document.getElementById('installBanner').style.display='flex';});
window.addEventListener('appinstalled',()=>{document.getElementById('installBanner').style.display='none';});
function installApp(){if(deferredInstall){deferredInstall.prompt();deferredInstall=null;}document.getElementById('installBanner').style.display='none';}
function dismissInstall(){document.getElementById('installBanner').style.display='none';}
if('serviceWorker'in navigator)navigator.serviceWorker.register('/static/sw.js').catch(()=>{});

function setTab(el,mode,filter){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  if(mode==='tw'){
    twitterMode=true;currentFilter=filter;
    document.getElementById('twitterSection').style.display='block';
    document.getElementById('newsSection').style.display='none';
    if(allTweets.length===0)loadTimeline();else{renderFeed();updateStats();}
  }else{
    twitterMode=false;newsTopic=filter;
    document.getElementById('twitterSection').style.display='none';
    document.getElementById('newsSection').style.display='block';
    document.getElementById('statsBar').style.display='none';
    fetchNews();
  }
}
function handleRefresh(){if(twitterMode)loadTimeline();else fetchNews();}

async function loadTimeline(){
  if(isLoading)return;
  isLoading=true;allTweets=[];shownCount=20;
  const btn=document.getElementById('refreshBtn');
  btn.disabled=true;
  btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin .8s linear infinite"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Loading\u2026';
  document.getElementById('statsBar').style.display='none';
  document.getElementById('loadMoreWrap').style.display='none';
  renderSkeletons();
  try{
    const res=await fetch('/api/timeline');
    const data=await res.json();
    if(!data.success)throw new Error(data.error||'Failed');
    allTweets=(data.tweets||[]).map(t=>({...t,section:classifySection(t.text||'')}));
    renderFeed();updateStats();
  }catch(e){showTwErr(e.message);}
  finally{
    isLoading=false;btn.disabled=false;
    btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refresh';
  }
}

function getFiltered(){return currentFilter==='all'?allTweets:allTweets.filter(t=>t.section===currentFilter);}

function renderFeed(){
  const feed=document.getElementById('feed');
  const tweets=getFiltered();
  if(!tweets.length){
    feed.innerHTML='<div class="state"><div class="state-icon">🔍</div><div class="state-title">No matches for this filter</div><div class="state-sub">Switch to "Following" to see all tweets.</div></div>';
    document.getElementById('loadMoreWrap').style.display='none';return;
  }
  feed.innerHTML=tweets.slice(0,shownCount).map(renderCard).join('');
  document.getElementById('loadMoreWrap').style.display=tweets.length>shownCount?'block':'none';
}
function showMore(){shownCount+=20;renderFeed();updateStats();}

function renderCard(tw){
  const isIndia=FILTERS.india.test(tw.text);
  const badge=isIndia?'<div class="india-badge">&#127470;&#127475; India</div>':'';
  const verified=tw.verified?'<span class="verified" title="Verified">&#10003;</span>':'';
  const time=tw.created_at?timeAgo(new Date(tw.created_at)):'';
  const text=formatText(tw.text);
  const media=tw.hasMedia&&tw.image
    ?'<div class="tweet-media"><img src="'+esc(tw.image)+'" alt="media" loading="lazy" onerror="this.parentElement.style.display=\'none\'"></div>'
    :'';
  const avatarHtml=tw.avatar
    ?'<img class="avatar" src="'+esc(tw.avatar)+'" alt="'+esc(tw.name)+'" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
     +'<div class="avatar-ph" style="display:none">'+((tw.name||'?')[0])+'</div>'
    :'<div class="avatar-ph">'+((tw.name||'?')[0])+'</div>';
  return '<a class="tweet-card" href="'+esc(tw.url)+'" target="_blank" rel="noopener">'
    +'<div class="avatar-wrap">'+avatarHtml+'</div>'
    +'<div class="tweet-body">'
      +badge
      +'<div class="tweet-header">'
        +'<span class="tweet-name">'+esc(tw.name||tw.author)+'</span>'
        +verified
        +'<span class="tweet-handle">@'+esc(tw.author)+'</span>'
        +'<span class="tweet-dot">&middot;</span>'
        +'<span class="tweet-time">'+time+'</span>'
      +'</div>'
      +'<div class="tweet-text">'+text+'</div>'
      +media
      +'<div class="tweet-metrics">'
        +'<div class="metric"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'+fmtNum(tw.metrics?.reply_count||0)+'</div>'
        +'<div class="metric"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'+fmtNum(tw.metrics?.retweet_count||0)+'</div>'
        +'<div class="metric"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'+fmtNum(tw.metrics?.favorite_count||0)+'</div>'
      +'</div>'
    +'</div>'
  +'</a>';
}

function renderSkeletons(){
  document.getElementById('feed').innerHTML=Array(5).fill(0).map(()=>'<div class="skel-card"><div class="skel skel-av"></div><div class="skel-lines"><div class="skel skel-line" style="width:50%"></div><div class="skel skel-line" style="width:85%"></div><div class="skel skel-line" style="width:68%"></div><div class="skel skel-line" style="width:35%"></div></div></div>').join('');
}
function showTwErr(msg){
  document.getElementById('feed').innerHTML='<div class="state"><div class="state-icon">&#9888;&#65039;</div><div class="state-title">Could not load feed</div><div class="state-sub">'+esc(msg)+'</div><button class="retry-btn" onclick="loadTimeline()">Try Again</button></div>';
}
function updateStats(){
  const f=getFiltered();
  document.getElementById('statsBar').style.display='flex';
  document.getElementById('tweetCount').textContent=f.length;
  document.getElementById('lastUpdated').textContent=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
}

async function fetchNews(){
  document.getElementById('newsLoading').style.display='flex';
  document.getElementById('newsError').style.display='none';
  document.getElementById('newsCardWrap').style.display='none';
  try{
    const res=await fetch('/api/news?topic='+newsTopic);
    const d=await res.json();
    if(d.success&&d.articles?.length){
      newsArticles=d.articles;newsIdx=0;
      document.getElementById('newsLoading').style.display='none';
      document.getElementById('newsCardWrap').style.display='block';
      renderNews();buildDotsTop();
    }else throw new Error(d.error||'No articles found');
  }catch(e){
    document.getElementById('newsLoading').style.display='none';
    document.getElementById('newsError').style.display='flex';
    document.getElementById('newsErrMsg').textContent=e.message;
  }
}

function renderNews(){
  const a=newsArticles[newsIdx];if(!a)return;
  const card=document.querySelector('.news-card-v2');
  if(card){card.style.animation='none';void card.offsetWidth;card.style.animation='';}
  document.getElementById('newsCat').textContent  =a.category;
  document.getElementById('newsTitle').textContent=a.headline;
  document.getElementById('newsDesc').textContent =a.summary;
  document.getElementById('newsSrc').textContent  =a.source||'Unknown';
  document.getElementById('newsTime').textContent =a.time||'';
  const img=document.getElementById('newsImg');
  img.src=a.image||'';
  img.onerror=()=>{img.src='https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&q=80';};
  const saved=savedIds.has(a.id);
  const btn=document.getElementById('saveBtn');
  btn.textContent=saved?'\u2705 Saved':'\uD83D\uDD16 Save';
  btn.className='news-action-btn'+(saved?' saved':'');
  document.getElementById('newsCounter').textContent=(newsIdx+1)+' / '+newsArticles.length;
  const hindiText=document.getElementById('hindiText');
  const hindiBtn=document.getElementById('hintBtn');
  hindiText.classList.remove('visible');hindiText.textContent='';
  hindiBtn.className='hindi-btn';
  hindiBtn.innerHTML='<span>\u0905</span> \u0939\u093F\u0902\u0926\u0940 \u092E\u0947\u0902 \u092A\u0922\u093C\u0947\u0902';
  if(hindiCache[a.id]){
    hindiText.textContent=hindiCache[a.id];
    hindiText.classList.add('visible');
    hindiBtn.className='hindi-btn done';
    hindiBtn.innerHTML='<span>\u0905</span> \u0939\u093F\u0902\u0926\u0940 \u2713';
  }
  updateDotsTop();
}

async function translateToHindi(){
  const a=newsArticles[newsIdx];if(!a)return;
  const btn=document.getElementById('hintBtn');
  const hindiEl=document.getElementById('hindiText');
  if(hindiCache[a.id]){
    hindiEl.textContent=hindiCache[a.id];
    hindiEl.classList.toggle('visible');return;
  }
  btn.className='hindi-btn loading';
  btn.innerHTML='<span>\u0905</span> Translating\u2026';
  const toTranslate=(a.headline+'. '+a.summary).substring(0,400);
  try{
    const url='https://api.mymemory.translated.net/get?q='+encodeURIComponent(toTranslate)+'&langpair=en|hi';
    const res=await fetch(url);
    const data=await res.json();
    const translated=data?.responseData?.translatedText||'';
    if(!translated||translated.toLowerCase().includes('mymemory'))throw new Error('unavailable');
    hindiCache[a.id]=translated;
    localStorage.setItem('hindiCache',JSON.stringify(hindiCache));
    hindiEl.textContent=translated;
    hindiEl.classList.add('visible');
    btn.className='hindi-btn done';
    btn.innerHTML='<span>\u0905</span> \u0939\u093F\u0902\u0926\u0940 \u2713';
  }catch{
    btn.className='hindi-btn';
    btn.innerHTML='<span>\u0905</span> \u0939\u093F\u0902\u0926\u0940 \u092E\u0947\u0902 \u092A\u0922\u093C\u0947\u0902';
    hindiEl.textContent='Translation failed. Please try again later.';
    hindiEl.classList.add('visible');
  }
}

function buildDotsTop(){
  const c=document.getElementById('newsDotsTop');c.innerHTML='';
  const total=Math.min(newsArticles.length,15);
  for(let i=0;i<total;i++){
    const b=document.createElement('button');
    b.className='ndot-top'+(i===newsIdx?' active':'');
    b.onclick=()=>{newsIdx=i;renderNews();};
    c.appendChild(b);
  }
}
function updateDotsTop(){document.querySelectorAll('.ndot-top').forEach((d,i)=>{d.className='ndot-top'+(i===newsIdx?' active':'');});}

function prevNews(){if(!newsArticles.length)return;newsIdx=newsIdx>0?newsIdx-1:newsArticles.length-1;renderNews();}
function nextNews(){if(!newsArticles.length)return;newsIdx=newsIdx<newsArticles.length-1?newsIdx+1:0;renderNews();}
function toggleSave(){const a=newsArticles[newsIdx];if(!a)return;if(savedIds.has(a.id))savedIds.delete(a.id);else savedIds.add(a.id);localStorage.setItem('savedIds',JSON.stringify([...savedIds]));renderNews();}
function openNews(){const a=newsArticles[newsIdx];if(a?.url)window.open(a.url,'_blank');}

document.addEventListener('keydown',e=>{if(!twitterMode){if(e.key==='ArrowLeft')prevNews();if(e.key==='ArrowRight')nextNews();}});
let tX=0;
document.addEventListener('touchstart',e=>{tX=e.touches[0].clientX;},{passive:true});
document.addEventListener('touchend',e=>{if(twitterMode)return;const dx=e.changedTouches[0].clientX-tX;if(Math.abs(dx)>50){dx<0?nextNews():prevNews();}},{passive:true});

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function formatText(raw){
  let t=esc(raw);
  t=t.replace(/\\n/g,'<br>');
  t=t.replace(/#(\\w+)/g,'<span class="hashtag">#$1</span>');
  t=t.replace(/@(\\w+)/g,'<span class="mention">@$1</span>');
  t=t.replace(/https?:\\/\\/[^\\s<]+/g,url=>{
    const clean=url.replace(/^https?:\\/\\//,'').replace(/\\/$/,'');
    const short=clean.length>30?clean.substring(0,30)+'\u2026':clean;
    return '<a href="'+url+'" onclick="event.stopPropagation()" target="_blank" rel="noopener">'+short+'</a>';
  });
  return t;
}
function fmtNum(n){if(n>=1e6)return(n/1e6).toFixed(1).replace(/\\.0$/,'')+'M';if(n>=1e3)return(n/1e3).toFixed(1).replace(/\\.0$/,'')+'K';return String(n);}
function timeAgo(d){const s=(Date.now()-d)/1000;if(s<60)return Math.floor(s)+'s';if(s<3600)return Math.floor(s/60)+'m';if(s<86400)return Math.floor(s/3600)+'h';return d.toLocaleDateString('en-IN',{day:'numeric',month:'short'});}

document.head.insertAdjacentHTML('beforeend','<style>@keyframes spin{to{transform:rotate(360deg)}}</style>');
loadTimeline();
setInterval(()=>{if(twitterMode)loadTimeline();},15*60*1000);
</script>
</body>
</html>`)
})

export default app
