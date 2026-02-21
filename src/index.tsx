import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  NEWS_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// ── API PROXY ROUTE ──────────────────────────────────────────────────────────
// Keeps the NewsAPI key hidden from the browser
app.get('/api/news', async (c) => {
  const topic = c.req.query('topic') || 'all'
  const apiKey = c.env?.NEWS_API_KEY || '0f761fbbe8cb45dab9bac756f369ba88'

  const topicUrls: Record<string, string> = {
    all:      `https://newsapi.org/v2/everything?q=india+latest+news&language=en&sortBy=publishedAt&pageSize=20&apiKey=${apiKey}`,
    critical: `https://newsapi.org/v2/everything?q=india+(criticism+OR+scandal+OR+controversy+OR+protest+OR+allegation)&language=en&sortBy=popularity&pageSize=20&apiKey=${apiKey}`,
    politics: `https://newsapi.org/v2/everything?q=india+politics+(criticism+OR+allegation+OR+scandal+OR+opposition)&language=en&sortBy=popularity&pageSize=20&apiKey=${apiKey}`,
    social:   `https://newsapi.org/v2/everything?q=india+(inequality+OR+discrimination+OR+protest+OR+rights+OR+social)&language=en&sortBy=popularity&pageSize=20&apiKey=${apiKey}`,
    economy:  `https://newsapi.org/v2/everything?q=india+economy+(criticism+OR+crisis+OR+unemployment+OR+inflation)&language=en&sortBy=popularity&pageSize=20&apiKey=${apiKey}`,
  }

  const url = topicUrls[topic] || topicUrls.all

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'India-NewsShorts/1.0 (https://india-news.pages.dev)' }
    })
    const data = await res.json() as any

    if (data.status === 'ok' && data.articles) {
      const articles = data.articles
        .filter((a: any) => a.title !== '[Removed]' && a.urlToImage)
        .map((a: any, i: number) => ({
          id: i + 1,
          category: a.source?.name || 'News',
          headline: a.title,
          summary: a.description || (a.content?.substring(0, 200) + '...') || 'No description available.',
          image: a.urlToImage || 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&q=80',
          source: a.source?.name,
          time: new Date(a.publishedAt).toLocaleString('en-IN', {
            hour: 'numeric',
            minute: 'numeric',
            hour12: true,
            month: 'short',
            day: 'numeric',
          }),
          url: a.url,
        }))

      return c.json({ success: true, articles })
    }

    return c.json({ success: false, error: data.message || 'Failed to fetch news' }, 500)
  } catch (err) {
    return c.json({ success: false, error: 'Server error while fetching news' }, 500)
  }
})

// ── STATIC FILES ──────────────────────────────────────────────────────────────
app.use('/static/*', serveStatic({ root: './' }))

// ── MAIN PAGE ────────────────────────────────────────────────────────────────
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>India NewsShorts 🇮🇳</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { font-family: 'Inter', sans-serif; }
    .card-enter { animation: slideIn 0.35s ease; }
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(20px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .spinner { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    ::-webkit-scrollbar { display: none; }
    .topic-scroll { scrollbar-width: none; }
  </style>
</head>
<body class="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">

  <!-- ── HEADER ── -->
  <header class="bg-black/50 backdrop-blur-sm border-b border-white/10 sticky top-0 z-50">
    <div class="max-w-xl mx-auto px-4 py-3">
      <!-- Logo row -->
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <div class="w-9 h-9 rounded-xl flex items-center justify-center text-white font-extrabold text-sm"
               style="background:linear-gradient(135deg,#FF9933,#138808)">IN</div>
          <h1 class="text-white font-extrabold text-xl tracking-tight">India NewsShorts</h1>
          <span class="px-2 py-0.5 bg-green-500 text-white text-[10px] font-bold rounded animate-pulse">LIVE</span>
        </div>
        <div class="flex items-center gap-3">
          <button onclick="refreshNews()" id="refreshBtn"
            class="text-purple-300 hover:text-white transition-all"
            title="Refresh">
            <i class="fas fa-rotate-right"></i>
          </button>
          <span id="updateTime" class="text-purple-300 text-xs hidden"></span>
          <span id="counter" class="text-purple-300 text-sm font-medium">–</span>
        </div>
      </div>

      <!-- Topic tabs -->
      <div class="flex gap-2 overflow-x-auto topic-scroll pb-1">
        <button onclick="changeTopic('all')"      id="tab-all"      class="tab-btn active-tab px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all">All India</button>
        <button onclick="changeTopic('critical')" id="tab-critical" class="tab-btn px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all bg-white/10 text-purple-200 hover:bg-white/20">⚠️ Critical</button>
        <button onclick="changeTopic('politics')" id="tab-politics" class="tab-btn px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all bg-white/10 text-purple-200 hover:bg-white/20">🏛️ Politics</button>
        <button onclick="changeTopic('social')"   id="tab-social"   class="tab-btn px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all bg-white/10 text-purple-200 hover:bg-white/20">👥 Social</button>
        <button onclick="changeTopic('economy')"  id="tab-economy"  class="tab-btn px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all bg-white/10 text-purple-200 hover:bg-white/20">💰 Economy</button>
      </div>
    </div>
  </header>

  <!-- ── MAIN ── -->
  <main class="max-w-xl mx-auto px-4 py-6" id="mainContent">
    <!-- Loading -->
    <div id="loadingState" class="flex flex-col items-center justify-center py-24">
      <div class="w-14 h-14 rounded-full border-4 border-purple-500 border-t-transparent spinner mb-4"></div>
      <p class="text-white text-lg">Loading latest news…</p>
    </div>

    <!-- Error -->
    <div id="errorState" class="hidden max-w-sm mx-auto bg-red-500/20 border border-red-500 rounded-2xl p-6 text-center">
      <i class="fas fa-circle-exclamation text-red-400 text-4xl mb-3"></i>
      <h2 class="text-white text-lg font-bold mb-2">Something went wrong</h2>
      <p id="errorMsg" class="text-red-200 mb-4 text-sm"></p>
      <button onclick="refreshNews()" class="px-5 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-all text-sm">Try Again</button>
    </div>

    <!-- News Card -->
    <div id="newsCard" class="hidden">
      <div class="relative bg-white rounded-2xl shadow-2xl overflow-hidden card-enter" id="cardInner">
        <!-- Category badge -->
        <div class="absolute top-4 left-4 z-10">
          <span id="cardCategory" class="px-3 py-1 bg-purple-600/90 text-white text-xs font-semibold rounded-full backdrop-blur-sm"></span>
        </div>

        <!-- Image -->
        <div class="relative h-64 bg-gradient-to-br from-orange-400 to-green-400">
          <img id="cardImage" src="" alt="" class="w-full h-full object-cover" />
          <div class="absolute bottom-0 inset-x-0 h-20 bg-gradient-to-t from-black/60 to-transparent"></div>
        </div>

        <!-- Body -->
        <div class="p-5">
          <h2 id="cardHeadline" class="text-xl font-extrabold text-gray-900 mb-2 leading-snug"></h2>
          <p  id="cardSummary"  class="text-gray-600 text-sm leading-relaxed mb-4"></p>

          <div class="flex items-center justify-between text-xs text-gray-400 mb-4">
            <span id="cardSource" class="font-semibold"></span>
            <span id="cardTime"></span>
          </div>

          <div class="flex gap-3">
            <button onclick="toggleSave()" id="saveBtn"
              class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm transition-all bg-gray-100 text-gray-700 hover:bg-gray-200">
              <i id="saveIcon" class="far fa-bookmark"></i>
              <span id="saveLabel">Save</span>
            </button>
            <button onclick="openArticle()"
              class="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-medium text-sm hover:bg-gray-200 transition-all">
              <i class="fas fa-arrow-up-right-from-square"></i>
              <span>Read Full</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Navigation -->
      <div class="flex items-center justify-center gap-5 mt-6">
        <button onclick="prevArticle()"
          class="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 active:scale-95 transition-all">
          <i class="fas fa-chevron-left text-gray-700"></i>
        </button>
        <span class="text-white text-xs font-medium">Use ← → keys or click</span>
        <button onclick="nextArticle()"
          class="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 active:scale-95 transition-all">
          <i class="fas fa-chevron-right text-gray-700"></i>
        </button>
      </div>

      <!-- Dots -->
      <div id="dots" class="flex items-center justify-center gap-1.5 mt-5 flex-wrap"></div>
    </div>
  </main>

  <!-- ── FOOTER BANNER ── -->
  <div id="footerBanner" class="hidden max-w-xl mx-auto px-4 pb-8">
    <div class="rounded-xl p-4 text-center text-white"
         style="background:linear-gradient(135deg,#FF9933,#138808)">
      <p class="font-bold text-sm" id="bannerText">🇮🇳 Live news from India</p>
      <p class="text-orange-100 text-xs mt-0.5">Auto-refreshes every 5 min · Switch topics above</p>
    </div>
  </div>

  <script>
    // ── STATE ────────────────────────────────────────────────────────────────
    let articles = [];
    let currentIndex = 0;
    let savedIds = new Set();
    let currentTopic = 'all';
    let refreshTimer = null;

    const topicLabels = {
      all:      'All India',
      critical: '⚠️ Critical/Controversial',
      politics: '🏛️ Political Criticism',
      social:   '👥 Social Issues',
      economy:  '💰 Economic Critique',
    };

    // ── FETCH ────────────────────────────────────────────────────────────────
    async function fetchNews(topic) {
      showLoading();
      try {
        const res  = await fetch('/api/news?topic=' + topic);
        const data = await res.json();
        if (data.success && data.articles.length > 0) {
          articles = data.articles;
          currentIndex = 0;
          renderCard();
          renderDots();
          showCard();
          updateCounter();
          updateTime();
          document.getElementById('footerBanner').classList.remove('hidden');
          document.getElementById('bannerText').textContent =
            '🇮🇳 Live news from India – ' + topicLabels[topic];
        } else {
          showError(data.error || 'No articles found for this topic.');
        }
      } catch (e) {
        showError('Network error. Please check your connection.');
      }
    }

    // ── RENDER CARD ──────────────────────────────────────────────────────────
    function renderCard() {
      const a = articles[currentIndex];
      if (!a) return;

      document.getElementById('cardCategory').textContent = a.category;
      document.getElementById('cardHeadline').textContent  = a.headline;
      document.getElementById('cardSummary').textContent   = a.summary;
      document.getElementById('cardSource').textContent    = a.source;
      document.getElementById('cardTime').textContent      = a.time;

      const img = document.getElementById('cardImage');
      img.src = a.image;
      img.alt = a.headline;
      img.onerror = () => { img.src = 'https://images.unsplash.com/photo-1524230507669-5ff97982bb5e?w=800&q=80'; };

      // Save button state
      const saved = savedIds.has(a.id);
      const saveBtn = document.getElementById('saveBtn');
      document.getElementById('saveIcon').className  = saved ? 'fas fa-bookmark' : 'far fa-bookmark';
      document.getElementById('saveLabel').textContent = saved ? 'Saved' : 'Save';
      saveBtn.className = 'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm transition-all ' +
        (saved ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200');

      // Animate card
      const inner = document.getElementById('cardInner');
      inner.classList.remove('card-enter');
      void inner.offsetWidth;
      inner.classList.add('card-enter');

      updateCounter();
      updateDots();
    }

    // ── DOTS ─────────────────────────────────────────────────────────────────
    function renderDots() {
      const container = document.getElementById('dots');
      const max = Math.min(articles.length, 10);
      container.innerHTML = '';
      for (let i = 0; i < max; i++) {
        const btn = document.createElement('button');
        btn.onclick = () => { currentIndex = i; renderCard(); };
        btn.className = i === currentIndex
          ? 'w-7 h-2 bg-orange-500 rounded-full transition-all'
          : 'w-2  h-2 bg-white/30 rounded-full hover:bg-white/50 transition-all';
        container.appendChild(btn);
      }
      if (articles.length > 10) {
        const more = document.createElement('span');
        more.className = 'text-white text-xs ml-1';
        more.textContent = '+' + (articles.length - 10);
        container.appendChild(more);
      }
    }

    function updateDots() {
      const btns = document.querySelectorAll('#dots button');
      btns.forEach((b, i) => {
        b.className = i === currentIndex
          ? 'w-7 h-2 bg-orange-500 rounded-full transition-all'
          : 'w-2  h-2 bg-white/30 rounded-full hover:bg-white/50 transition-all';
      });
    }

    // ── NAVIGATION ───────────────────────────────────────────────────────────
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

    // ── ACTIONS ───────────────────────────────────────────────────────────────
    function toggleSave() {
      const a = articles[currentIndex];
      if (!a) return;
      if (savedIds.has(a.id)) savedIds.delete(a.id); else savedIds.add(a.id);
      renderCard();
    }
    function openArticle() {
      const a = articles[currentIndex];
      if (a?.url) window.open(a.url, '_blank');
    }

    // ── TOPIC CHANGE ─────────────────────────────────────────────────────────
    function changeTopic(topic) {
      currentTopic = topic;
      // Update tab styles
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.className = 'tab-btn px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all bg-white/10 text-purple-200 hover:bg-white/20';
      });
      const active = document.getElementById('tab-' + topic);
      if (active) active.className = 'tab-btn active-tab px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all bg-purple-600 text-white';
      fetchNews(topic);
    }

    // ── REFRESH ───────────────────────────────────────────────────────────────
    function refreshNews() {
      const btn = document.getElementById('refreshBtn');
      btn.style.transform = 'rotate(360deg)';
      btn.style.transition = 'transform 0.5s';
      setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 500);
      fetchNews(currentTopic);
    }

    // ── UI STATES ─────────────────────────────────────────────────────────────
    function showLoading() {
      document.getElementById('loadingState').classList.remove('hidden');
      document.getElementById('errorState').classList.add('hidden');
      document.getElementById('newsCard').classList.add('hidden');
    }
    function showCard() {
      document.getElementById('loadingState').classList.add('hidden');
      document.getElementById('errorState').classList.add('hidden');
      document.getElementById('newsCard').classList.remove('hidden');
    }
    function showError(msg) {
      document.getElementById('loadingState').classList.add('hidden');
      document.getElementById('newsCard').classList.add('hidden');
      document.getElementById('errorState').classList.remove('hidden');
      document.getElementById('errorMsg').textContent = msg;
    }

    // ── HELPERS ───────────────────────────────────────────────────────────────
    function updateCounter() {
      document.getElementById('counter').textContent =
        articles.length ? (currentIndex + 1) + ' / ' + articles.length : '–';
    }
    function updateTime() {
      const el = document.getElementById('updateTime');
      el.textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      el.classList.remove('hidden');
    }

    // ── AUTO REFRESH ──────────────────────────────────────────────────────────
    function startAutoRefresh() {
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(() => fetchNews(currentTopic), 300000);
    }

    // ── INIT ──────────────────────────────────────────────────────────────────
    fetchNews('all');
    startAutoRefresh();
  </script>
</body>
</html>`)
})

export default app
