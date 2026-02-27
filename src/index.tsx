import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  NEWS_API_KEY: string
  TWITTER_USERNAME: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

// ── 1. NEWS API ───────────────────────────────────────────────────────────────
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

// ── 2. TWITTER CONFIG ENDPOINT ──────────────────────────────────────────────
app.get('/api/twitter-config', async (c) => {
  const username = c.req.query('username') || c.env?.TWITTER_USERNAME || 'Sj89Jain'
  return c.json({
    success: true,
    username,
    embedUrl: `https://twitter.com/${username}`,
  })
})

// ── STATIC FILES ──────────────────────────────────────────────────────────────
app.use('/static/*', serveStatic({ root: './' }))

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
  <title>India NewsShorts 🇮🇳</title>

  <!-- PWA META -->
  <meta name="application-name" content="India NewsShorts"/>
  <meta name="apple-mobile-web-app-title" content="NewsShorts"/>
  <meta name="apple-mobile-web-app-capable" content="yes"/>
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
  <meta name="mobile-web-app-capable" content="yes"/>
  <meta name="theme-color" content="#1e1b4b"/>
  <meta name="description" content="Live India news + Twitter feed in a short-card format"/>

  <!-- PWA MANIFEST -->
  <link rel="manifest" href="/static/manifest.json"/>

  <!-- ICONS (PWA + iOS) -->
  <link rel="icon"             href="/static/icon-192.png"/>
  <link rel="apple-touch-icon" href="/static/icon-192.png"/>

  <!-- STYLES -->
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"/>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *{font-family:'Inter',sans-serif;-webkit-tap-highlight-color:transparent;}
    body{overscroll-behavior-y:contain;}
    .card-enter{animation:slideIn .3s ease;}
    @keyframes slideIn{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
    .spinner{animation:spin 1s linear infinite;}
    @keyframes spin{to{transform:rotate(360deg)}}
    ::-webkit-scrollbar{display:none;}
    .no-scroll{scrollbar-width:none;}
    /* swipe hint */
    .swipe-area{touch-action:pan-y;}
    /* Twitter card accent */
    .twitter-card{border-top:3px solid #1d9bf0;}
    /* install banner */
    #installBanner{display:none;}
    .safe-bottom{padding-bottom:env(safe-area-inset-bottom,12px);}
  </style>
</head>
<body class="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 select-none">

<!-- ── INSTALL BANNER (shown when PWA installable) ── -->
<div id="installBanner"
     class="fixed top-0 inset-x-0 z-50 bg-gradient-to-r from-orange-500 to-green-600 px-4 py-2 flex items-center justify-between shadow-lg">
  <div class="flex items-center gap-2 text-white text-sm font-semibold">
    <i class="fas fa-download"></i>
    <span>Install India NewsShorts as an App!</span>
  </div>
  <div class="flex gap-2">
    <button onclick="installApp()" class="px-3 py-1 bg-white text-green-700 rounded-lg text-xs font-bold">Install</button>
    <button onclick="dismissInstall()" class="text-white/70 text-xs">✕</button>
  </div>
</div>

<!-- ── HEADER ── -->
<header class="bg-black/50 backdrop-blur-md border-b border-white/10 sticky top-0 z-40">
  <div class="max-w-xl mx-auto px-4 py-3">
    <!-- Logo row -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <div class="w-9 h-9 rounded-xl flex items-center justify-center text-white font-extrabold text-sm"
             style="background:linear-gradient(135deg,#FF9933,#138808)">IN</div>
        <h1 class="text-white font-extrabold text-xl tracking-tight">India NewsShorts</h1>
        <span class="px-2 py-0.5 bg-green-500 text-white text-[10px] font-bold rounded-full animate-pulse">LIVE</span>
      </div>
      <div class="flex items-center gap-3">
        <button onclick="showTwitterSetup()" id="twitterSetupBtn"
          class="text-blue-400 hover:text-blue-300 transition-all text-sm"
          title="Set Twitter username">
          <i class="fab fa-x-twitter"></i>
        </button>
        <button onclick="refreshNews()" id="refreshBtn"
          class="text-purple-300 hover:text-white transition-all" title="Refresh">
          <i class="fas fa-rotate-right"></i>
        </button>
        <span id="updateTime" class="text-purple-300 text-xs hidden"></span>
        <span id="counter" class="text-purple-300 text-sm font-medium">–</span>
      </div>
    </div>

    <!-- Topic tabs -->
    <div class="flex gap-2 overflow-x-auto no-scroll pb-1">
      <button onclick="changeTopic('all')"      id="tab-all"      class="tab-btn active-tab px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all bg-purple-600 text-white">🇮🇳 All India</button>
      <button onclick="changeTopic('critical')" id="tab-critical" class="tab-btn px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all bg-white/10 text-purple-200">⚠️ Critical</button>
      <button onclick="changeTopic('politics')" id="tab-politics" class="tab-btn px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all bg-white/10 text-purple-200">🏛️ Politics</button>
      <button onclick="changeTopic('social')"   id="tab-social"   class="tab-btn px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all bg-white/10 text-purple-200">👥 Social</button>
      <button onclick="changeTopic('economy')"  id="tab-economy"  class="tab-btn px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all bg-white/10 text-purple-200">💰 Economy</button>
      <button onclick="changeTopic('twitter')"  id="tab-twitter"  class="tab-btn px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all bg-white/10 text-blue-300">𝕏 @Sj89Jain</button>
    </div>
  </div>
</header>

<!-- ── TWITTER SETUP MODAL ── -->
<div id="twitterModal" class="hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4">
  <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-sm border border-white/10 shadow-2xl">
    <div class="flex items-center gap-3 mb-4">
      <i class="fab fa-x-twitter text-white text-2xl"></i>
      <h2 class="text-white font-extrabold text-lg">Set Your X/Twitter Feed</h2>
    </div>
    <p class="text-slate-300 text-sm mb-4">Enter any public Twitter/X username to view their timeline.</p>
    <div class="flex items-center bg-slate-700 rounded-xl px-3 py-2 mb-4 border border-white/10 focus-within:border-blue-400">
      <span class="text-slate-400 text-sm mr-1">@</span>
      <input id="twitterInput" type="text" placeholder="e.g. narendramodi"
        class="flex-1 bg-transparent text-white text-sm outline-none placeholder-slate-500"
        onkeydown="if(event.key==='Enter')saveTwitterUsername()"/>
    </div>
    <div class="flex gap-3">
      <button onclick="saveTwitterUsername()"
        class="flex-1 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold text-sm transition-all">
        <i class="fab fa-x-twitter mr-1"></i> Load Feed
      </button>
      <button onclick="closeTwitterModal()"
        class="px-4 py-2.5 bg-slate-700 text-slate-300 rounded-xl text-sm hover:bg-slate-600 transition-all">
        Cancel
      </button>
    </div>
    <p class="text-slate-500 text-xs mt-3 text-center">Uses official Twitter embed · Always works · No login needed</p>
  </div>
</div>

<!-- ── MAIN ── -->
<main class="max-w-xl mx-auto px-4 py-5 swipe-area" id="mainContent">

  <!-- Loading -->
  <div id="loadingState" class="flex flex-col items-center justify-center py-24">
    <div class="w-14 h-14 rounded-full border-4 border-purple-500 border-t-transparent spinner mb-4"></div>
    <p class="text-white text-base">Loading latest news…</p>
  </div>

  <!-- Error -->
  <div id="errorState" class="hidden max-w-sm mx-auto bg-red-500/20 border border-red-500 rounded-2xl p-6 text-center">
    <i class="fas fa-circle-exclamation text-red-400 text-4xl mb-3"></i>
    <h2 class="text-white text-lg font-bold mb-2">Something went wrong</h2>
    <p id="errorMsg" class="text-red-200 mb-4 text-sm"></p>
    <button onclick="refreshNews()" class="px-5 py-2 bg-purple-600 text-white rounded-lg text-sm">Try Again</button>
  </div>

  <!-- Twitter Embed View (shown when Twitter tab active) -->
  <div id="twitterView" class="hidden">
    <div class="bg-white/5 backdrop-blur rounded-2xl border border-white/10 overflow-hidden">
      <!-- Header bar -->
      <div class="flex items-center justify-between px-4 py-3 bg-black/30 border-b border-white/10">
        <div class="flex items-center gap-2">
          <i class="fab fa-x-twitter text-white text-lg"></i>
          <span id="twitterEmbedTitle" class="text-white font-bold text-sm">@Sj89Jain's Feed</span>
        </div>
        <a id="twitterOpenLink" href="https://twitter.com/Sj89Jain" target="_blank"
           class="text-blue-400 text-xs flex items-center gap-1 hover:text-blue-300 transition-all">
          Open on X <i class="fas fa-arrow-up-right-from-square text-[10px]"></i>
        </a>
      </div>
      <!-- Embedded timeline -->
      <div id="twitterEmbedContainer" class="min-h-[500px] bg-white rounded-b-2xl overflow-hidden">
        <!-- Twitter widget injected here -->
      </div>
    </div>
    <!-- Change username button -->
    <div class="mt-3 text-center">
      <button onclick="showTwitterSetup()"
        class="px-4 py-2 bg-blue-500/20 border border-blue-400/40 text-blue-300 rounded-xl text-sm hover:bg-blue-500/30 transition-all">
        <i class="fab fa-x-twitter mr-1"></i> Change account
      </button>
    </div>
  </div>

  <!-- News Card -->
  <div id="newsCard" class="hidden">
    <div class="relative bg-white rounded-2xl shadow-2xl overflow-hidden card-enter" id="cardInner">

      <!-- Category badge -->
      <div class="absolute top-4 left-4 z-10 flex items-center gap-1.5">
        <span id="cardCategory" class="px-3 py-1 bg-purple-600/90 text-white text-xs font-bold rounded-full backdrop-blur-sm"></span>
      </div>

      <!-- Image -->
      <div class="relative h-56 bg-gradient-to-br from-orange-400 to-green-400" id="imageWrap">
        <img id="cardImage" src="" alt="" class="w-full h-full object-cover"/>
        <div class="absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-black/50 to-transparent"></div>
      </div>

      <!-- Body -->
      <div class="p-5">
        <h2 id="cardHeadline" class="text-lg font-extrabold text-gray-900 mb-2 leading-snug"></h2>
        <p  id="cardSummary"  class="text-gray-600 text-sm leading-relaxed mb-4"></p>

        <div class="flex items-center justify-between text-xs text-gray-400 mb-4">
          <span id="cardSource" class="font-semibold flex items-center gap-1"></span>
          <span id="cardTime"></span>
        </div>

        <div class="flex gap-3">
          <button onclick="toggleSave()" id="saveBtn"
            class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all bg-gray-100 text-gray-700 hover:bg-gray-200">
            <i id="saveIcon" class="far fa-bookmark"></i>
            <span id="saveLabel">Save</span>
          </button>
          <button onclick="openArticle()"
            class="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-200 transition-all">
            <i class="fas fa-arrow-up-right-from-square"></i>
            <span id="readLabel">Read Full</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Navigation -->
    <div class="flex items-center justify-center gap-5 mt-5">
      <button onclick="prevArticle()"
        class="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 active:scale-95 transition-all">
        <i class="fas fa-chevron-left text-gray-700"></i>
      </button>
      <span class="text-white/60 text-xs">swipe or use ← →</span>
      <button onclick="nextArticle()"
        class="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 active:scale-95 transition-all">
        <i class="fas fa-chevron-right text-gray-700"></i>
      </button>
    </div>

    <!-- Dots -->
    <div id="dots" class="flex items-center justify-center gap-1.5 mt-4 flex-wrap"></div>
  </div>
</main>

<!-- ── FOOTER BANNER ── -->
<div id="footerBanner" class="hidden max-w-xl mx-auto px-4 pb-6 safe-bottom">
  <div class="rounded-xl p-3 text-center text-white" style="background:linear-gradient(135deg,#FF9933,#138808)">
    <p class="font-bold text-sm" id="bannerText">🇮🇳 Live news from India</p>
    <p class="text-orange-100 text-xs mt-0.5">Auto-refreshes every 5 min · Tap tabs to switch</p>
  </div>
</div>

<script>
// ── STATE ─────────────────────────────────────────────────────────────────────
let articles     = [];
let currentIndex = 0;
let savedIds     = new Set(JSON.parse(localStorage.getItem('savedIds') || '[]'));
let currentTopic = 'all';
let twitterUser  = localStorage.getItem('twitterUsername') || 'Sj89Jain';
let refreshTimer = null;
let deferredInstall = null;
let twitterWidgetLoaded = false;

const topicLabels = {
  all:     '🇮🇳 All India', critical:'⚠️ Critical',
  politics:'🏛️ Politics',   social:  '👥 Social Issues',
  economy: '💰 Economy',    twitter: '𝕏 Twitter Feed',
};

// ── PWA INSTALL ───────────────────────────────────────────────────────────────
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  document.getElementById('installBanner').style.display = 'flex';
});
window.addEventListener('appinstalled', () => {
  document.getElementById('installBanner').style.display = 'none';
});
function installApp() {
  if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; }
  document.getElementById('installBanner').style.display = 'none';
}
function dismissInstall() {
  document.getElementById('installBanner').style.display = 'none';
}

// ── SERVICE WORKER ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/static/sw.js').catch(() => {});
}

// ── TWITTER WIDGET (Official Twitter Embed — 100% reliable) ──────────────────
function loadTwitterWidget(username) {
  const container = document.getElementById('twitterEmbedContainer');
  const title     = document.getElementById('twitterEmbedTitle');
  const link      = document.getElementById('twitterOpenLink');

  title.textContent = '@' + username + "'s Feed";
  link.href = 'https://twitter.com/' + username;
  link.textContent = '';
  link.innerHTML = 'Open on X <i class="fas fa-arrow-up-right-from-square text-[10px]"></i>';

  // Clear previous embed
  container.innerHTML = '<div class="flex items-center justify-center py-12"><div class="w-8 h-8 rounded-full border-4 border-blue-400 border-t-transparent spinner"></div><span class="ml-3 text-gray-500 text-sm">Loading tweets…</span></div>';

  // Build official Twitter timeline embed
  const tweetHtml = '<a class="twitter-timeline" '
    + 'data-theme="light" '
    + 'data-height="600" '
    + 'data-chrome="noheader nofooter noborders" '
    + 'href="https://twitter.com/' + username + '?ref_src=twsrc%5Etfw">'
    + 'Tweets by ' + username + '</a>';

  container.innerHTML = tweetHtml;

  // Load or re-run Twitter widgets JS
  if (window.twttr && window.twttr.widgets) {
    window.twttr.widgets.load(container);
  } else {
    const script = document.createElement('script');
    script.src = 'https://platform.twitter.com/widgets.js';
    script.async = true;
    script.charset = 'utf-8';
    script.onload = () => {
      twitterWidgetLoaded = true;
      if (window.twttr && window.twttr.widgets) {
        window.twttr.widgets.load(container);
      }
    };
    document.head.appendChild(script);
  }
}

// ── SHOW TWITTER VIEW ────────────────────────────────────────────────────────
function showTwitterView(username) {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('errorState').classList.add('hidden');
  document.getElementById('newsCard').classList.add('hidden');
  document.getElementById('twitterView').classList.remove('hidden');

  document.getElementById('footerBanner').classList.remove('hidden');
  document.getElementById('bannerText').textContent = '𝕏 @' + username + "'s live feed · Official Twitter embed";

  // Update counter
  document.getElementById('counter').textContent = '𝕏';
  document.getElementById('updateTime').classList.remove('hidden');
  document.getElementById('updateTime').textContent = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});

  loadTwitterWidget(username);
}

// ── FETCH NEWS ────────────────────────────────────────────────────────────────
async function fetchNews(topic) {
  if (topic === 'twitter') {
    showTwitterView(twitterUser);
    return;
  }

  showLoading();
  try {
    const res  = await fetch('/api/news?topic=' + topic);
    const data = await res.json();
    if (data.success && data.articles.length > 0) {
      articles = data.articles;
      currentIndex = 0;
      renderCard(); renderDots(); showCard();
      updateCounter(); updateTime();
      document.getElementById('footerBanner').classList.remove('hidden');
      document.getElementById('bannerText').textContent = '🇮🇳 ' + topicLabels[topic];
    } else {
      showError(data.error || 'No articles found.');
    }
  } catch (e) {
    showError('Network error. Check your connection.');
  }
}

// ── RENDER CARD ───────────────────────────────────────────────────────────────
function renderCard() {
  const a = articles[currentIndex];
  if (!a) return;

  document.getElementById('cardCategory').textContent = a.category;
  document.getElementById('cardHeadline').textContent = a.headline;
  document.getElementById('cardSummary').textContent  = a.summary;
  document.getElementById('cardTime').textContent     = a.time;
  document.getElementById('cardSource').textContent   = a.source;
  document.getElementById('readLabel').textContent    = 'Read Full';

  // Image
  const img = document.getElementById('cardImage');
  img.src = a.image || 'https://images.unsplash.com/photo-1524230507669-5ff97982bb5e?w=800&q=80';
  img.alt = a.headline;
  img.onerror = () => {
    img.src = 'https://images.unsplash.com/photo-1524230507669-5ff97982bb5e?w=800&q=80';
  };

  // Save button
  const saved = savedIds.has(a.id);
  document.getElementById('saveIcon').className  = saved ? 'fas fa-bookmark' : 'far fa-bookmark';
  document.getElementById('saveLabel').textContent = saved ? 'Saved' : 'Save';
  document.getElementById('saveBtn').className =
    'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all ' +
    (saved ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200');

  // Animate
  const inner = document.getElementById('cardInner');
  inner.classList.remove('card-enter');
  void inner.offsetWidth;
  inner.classList.add('card-enter');

  updateCounter(); updateDots();
}

// ── DOTS ──────────────────────────────────────────────────────────────────────
function renderDots() {
  const c = document.getElementById('dots');
  c.innerHTML = '';
  const max = Math.min(articles.length, 12);
  for (let i = 0; i < max; i++) {
    const b = document.createElement('button');
    b.onclick = () => { currentIndex = i; renderCard(); };
    b.className = i === currentIndex
      ? 'w-7 h-2 bg-orange-500 rounded-full transition-all'
      : 'w-2 h-2 bg-white/30 rounded-full hover:bg-white/50 transition-all';
    c.appendChild(b);
  }
  if (articles.length > 12) {
    const s = document.createElement('span');
    s.className = 'text-white/50 text-xs ml-1';
    s.textContent = '+' + (articles.length - 12);
    c.appendChild(s);
  }
}
function updateDots() {
  document.querySelectorAll('#dots button').forEach((b, i) => {
    b.className = i === currentIndex
      ? 'w-7 h-2 bg-orange-500 rounded-full transition-all'
      : 'w-2 h-2 bg-white/30 rounded-full hover:bg-white/50 transition-all';
  });
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────
function prevArticle() {
  if (!articles.length) return;
  currentIndex = currentIndex > 0 ? currentIndex - 1 : articles.length - 1;
  renderCard();
}
function nextArticle() {
  if (!articles.length) return;
  currentIndex = currentIndex < articles.length - 1 ? currentIndex + 1 : 0;
  renderCard();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft')  prevArticle();
  if (e.key === 'ArrowRight') nextArticle();
});

// Touch / swipe support
let touchStartX = 0;
document.getElementById('mainContent').addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
}, {passive:true});
document.getElementById('mainContent').addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 50) { dx < 0 ? nextArticle() : prevArticle(); }
}, {passive:true});

// ── ACTIONS ───────────────────────────────────────────────────────────────────
function toggleSave() {
  const a = articles[currentIndex]; if (!a) return;
  if (savedIds.has(a.id)) savedIds.delete(a.id); else savedIds.add(a.id);
  localStorage.setItem('savedIds', JSON.stringify([...savedIds]));
  renderCard();
}
function openArticle() {
  const a = articles[currentIndex];
  if (a?.url) window.open(a.url, '_blank');
}

// ── TOPIC CHANGE ──────────────────────────────────────────────────────────────
function changeTopic(topic) {
  currentTopic = topic;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.className = b.id === 'tab-twitter'
      ? 'tab-btn px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all bg-white/10 text-blue-300'
      : 'tab-btn px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all bg-white/10 text-purple-200';
  });
  const active = document.getElementById('tab-' + topic);
  if (active) active.className = (topic === 'twitter'
    ? 'tab-btn active-tab px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all bg-blue-500 text-white'
    : 'tab-btn active-tab px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all bg-purple-600 text-white');

  // Hide twitter view when switching away
  if (topic !== 'twitter') {
    document.getElementById('twitterView').classList.add('hidden');
  }

  fetchNews(topic);
}

// ── TWITTER SETUP ─────────────────────────────────────────────────────────────
function showTwitterSetup() {
  document.getElementById('twitterModal').classList.remove('hidden');
  document.getElementById('twitterInput').value = twitterUser;
  setTimeout(() => document.getElementById('twitterInput').focus(), 100);
}
function closeTwitterModal() {
  document.getElementById('twitterModal').classList.add('hidden');
}
function saveTwitterUsername() {
  const val = document.getElementById('twitterInput').value.trim().replace(/^@/, '');
  if (!val) return;
  twitterUser = val;
  localStorage.setItem('twitterUsername', val);
  // Update tab label
  const twitterTab = document.getElementById('tab-twitter');
  if (twitterTab) twitterTab.textContent = '𝕏 @' + val;
  closeTwitterModal();
  changeTopic('twitter');
}

// ── REFRESH ───────────────────────────────────────────────────────────────────
function refreshNews() {
  const btn = document.getElementById('refreshBtn');
  btn.style.transform = 'rotate(360deg)'; btn.style.transition = 'transform .5s';
  setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 500);
  if (currentTopic === 'twitter') {
    loadTwitterWidget(twitterUser);
  } else {
    fetchNews(currentTopic);
  }
}

// ── UI STATES ─────────────────────────────────────────────────────────────────
function showLoading() {
  document.getElementById('loadingState').classList.remove('hidden');
  document.getElementById('errorState').classList.add('hidden');
  document.getElementById('newsCard').classList.add('hidden');
  document.getElementById('twitterView').classList.add('hidden');
}
function showCard() {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('errorState').classList.add('hidden');
  document.getElementById('newsCard').classList.remove('hidden');
  document.getElementById('twitterView').classList.add('hidden');
}
function showError(msg) {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('newsCard').classList.add('hidden');
  document.getElementById('twitterView').classList.add('hidden');
  document.getElementById('errorState').classList.remove('hidden');
  document.getElementById('errorMsg').textContent = msg;
}
function updateCounter() {
  document.getElementById('counter').textContent =
    articles.length ? (currentIndex+1)+' / '+articles.length : '–';
}
function updateTime() {
  const el = document.getElementById('updateTime');
  el.textContent = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  el.classList.remove('hidden');
}

// ── AUTO REFRESH ──────────────────────────────────────────────────────────────
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (currentTopic !== 'twitter') fetchNews(currentTopic);
  }, 300000);
}

// ── INIT ──────────────────────────────────────────────────────────────────────
// Update Twitter tab label with saved username
const twitterTab = document.getElementById('tab-twitter');
if (twitterTab && twitterUser) twitterTab.textContent = '𝕏 @' + twitterUser;

fetchNews('all');
startAutoRefresh();
</script>
</body>
</html>`)
})

export default app
