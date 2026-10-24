// Homepage – "All updates" aggregator — real feed of every novelty on CineAura:
// market products, member videos, IPTV lists, movies AND series (TMDB trending
// pushed by js/main.js), announcements. "عرض المزيد" takes the visitor to the
// page of the open section (movies → movies.html, the Market → market.html, …).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LANG = () => document.documentElement.getAttribute("lang") || "en";
  const tr = (ar, fr, en) => (LANG() === "ar" ? ar : LANG() === "fr" ? fr : en);

  // The chips; "series" is a feed of its own (TMDB trending + the site series page).
  const FILTERS = [
    { id: "all", label_ar: "الكل", label_fr: "Tout", label_en: "All" },
    { id: "market", label_ar: "المتجر", label_fr: "Boutique", label_en: "Market" },
    { id: "video", label_ar: "الفيديو", label_fr: "Vidéos", label_en: "Videos" },
    { id: "iptv", label_ar: "القنوات", label_fr: "IPTV", label_en: "IPTV" },
    { id: "movie", label_ar: "الأفلام", label_fr: "Films", label_en: "Movies" },
    { id: "series", label_ar: "المسلسلات", label_fr: "Séries", label_en: "Series" },
    { id: "promo", label_ar: "عروض", label_fr: "Offres", label_en: "Offers" },
  ];

  // "عرض المزيد" of a chip opens the section's own page.
  const KIND_PAGE = {
    market: "./market.html",
    video: "./video.html",
    iptv: "./iptv.html",
    movie: "./movies.html",
    series: "./series.html",
    promo: "./prize.html",
    all: "./search.html",
  };
  const KIND_LABEL = {
    market: () => tr("المتجر", "la boutique", "the Market"),
    video: () => tr("الفيديو", "les vidéos", "Videos"),
    iptv: () => "IPTV",
    movie: () => tr("الأفلام", "les films", "Movies"),
    series: () => tr("المسلسلات", "les séries", "Series"),
    promo: () => tr("العروض", "les offres", "Offers"),
    all: () => tr("البحث", "la recherche", "Search"),
  };

  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function timeAgo(d) {
    try {
      const diff = Date.now() - new Date(d).getTime();
      if (!Number.isFinite(diff) || diff < 0) return tr("الآن", "À l'instant", "Just now");
      const m = Math.floor(diff / 60000);
      if (m < 1) return tr("الآن", "À l'instant", "Just now");
      if (m < 60) return `${m} ${tr("د", "min", "m")} `;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h} ${tr("ساعة", "h", "h")} `;
      const days = Math.floor(h / 24);
      return `${days} ${tr("يوم", "j", "d")} `;
    } catch {
      return "—";
    }
  }

  // The real data path: the same RPC helper the rest of the site uses
  // (js/common.js supabaseRequest). window.supabase never existed on this page.
  const memberId = () => window.CineAura?.getSession?.()?.member_id || "";
  async function call(name, args = {}) {
    const C = window.CineAura;
    if (!C || typeof C.rpc !== "function") return null;
    try {
      const res = await C.rpc(name, args);
      return res?.ok ? (res.data ?? null) : null;
    } catch {
      return null;
    }
  }

  let allItems = [];
  let activeFilter = "all";
  const VISIBLE = 8;

  function renderChips() {
    const bar = $("#live-filters");
    if (!bar) return;
    const counts = {};
    for (const it of allItems) counts[it.kind] = (counts[it.kind] || 0) + 1;
    bar.innerHTML = FILTERS.map((f) => {
      const c = f.id === "all" ? allItems.length : counts[f.id] || 0;
      const label = LANG() === "ar" ? f.label_ar : LANG() === "fr" ? f.label_fr : f.label_en;
      return `<button class="live-chip ${activeFilter === f.id ? "active" : ""}" data-filter="${f.id}" type="button">${esc(label)} <small>${c}</small></button>`;
    }).join("");
  }

  const filtered = () => (activeFilter === "all" ? allItems : allItems.filter((x) => x.kind === activeFilter));

  function hasSelectionIn(el) {
    try {
      const sel = window.getSelection && window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
      if (!sel.toString().trim()) return false;
      const a = sel.anchorNode && sel.anchorNode.parentElement;
      const f = sel.focusNode && sel.focusNode.parentElement;
      return (a && el.contains(a)) || (f && el.contains(f));
    } catch {
      return false;
    }
  }

  // "عرض المزيد": always a link to the page of the open section — movies goes to
  // the movies page, the Market to the Market page — never an inline expansion.
  function moreLinkHtml() {
    const page = KIND_PAGE[activeFilter] || KIND_PAGE.all;
    const label = KIND_LABEL[activeFilter] ? KIND_LABEL[activeFilter]() : KIND_LABEL.all();
    const text = activeFilter === "all"
      ? tr("عرض المزيد في البحث", "Voir plus en recherche", "More in Search")
      : tr(`عرض المزيد في ${label}`, `Voir plus : ${label}`, `More in ${label}`);
    const arrow = LANG() === "ar" ? "←" : "→";
    return `<div class="live-more"><a class="live-more-link" href="${page}">${esc(text)} <span aria-hidden="true">${arrow}</span></a></div>`;
  }

  function renderGrid() {
    const grid = $("#live-grid");
    if (!grid) return;
    if (hasSelectionIn(grid)) return; // don't destroy a text selection
    const list = filtered().slice(0, VISIBLE);
    if (!allItems.length) {
      grid.innerHTML = `<div class="live-loading">${tr("جاري تحميل التحديثات…", "Chargement…", "Loading updates…")}</div>`;
      return;
    }
    if (!list.length) {
      grid.innerHTML = `<div class="live-empty">${tr("لا يوجد تحديث في هذا القسم حالياً.", "Aucune actu dans cette catégorie.", "No updates in this category yet.")}</div>` + moreLinkHtml();
      return;
    }
    grid.innerHTML =
      list
        .map(
          (it) => `
      <article class="live-card" data-kind="${it.kind}">
        <div class="live-media">${it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy" onerror="this.style.display='none'">` : `<span class="live-ico">${it.icon || "✦"}</span>`}</div>
        <div class="live-body">
          <div class="live-type ${it.kind}">${esc(it.badge || it.kind)} <span class="live-time">${esc(timeAgo(it.date))}</span></div>
          <div class="live-title-text">${esc(it.title)}</div>
          <div class="live-meta">${it.meta || ""}</div>
          <div class="live-actions">
            ${it.href ? `<a class="primary" href="${esc(it.href)}">${tr("عرض", "Voir", "View")}</a>` : ""}
            ${it.href2 ? `<a href="${esc(it.href2)}">${tr("التفاصيل", "Détails", "Details")}</a>` : ""}
          </div>
        </div>
      </article>`
        )
        .join("") + moreLinkHtml();
  }

  async function fetchAll() {
    const items = [];
    const me = memberId();

    // 1) The team's announcement (Panel > Announcements) — the same call the
    //    bar above the hero makes (js/home-hub.js site_banner_get).
    try {
      const d = await call("site_banner_get");
      const banner = (Array.isArray(d) ? d[0] : d) || {};
      if (banner.message || banner.title) {
        items.push({
          kind: "promo", badge: tr("إعلان", "Annonce", "Announcement"),
          title: banner.title || banner.message || banner.text || "",
          meta: `<span>${esc(banner.subtitle || "")}</span>`,
          image: banner.image || banner.cover || "",
          href: banner.link || banner.url || "index.html#live-updates",
          date: banner.created_at || banner.updated_at || banner.date || new Date().toISOString(), icon: "📢",
        });
      }
    } catch { /* the banner is optional */ }

    // 2) The Market's trending products (sql/market.sql market_home — the home of market.html).
    try {
      const d = await call("market_home", { p_member: me });
      const rows = Array.isArray(d?.trending) ? d.trending : [];
      for (const m of rows.slice(0, 10)) {
        const img = Array.isArray(m.images) && m.images.length ? m.images[0] : "";
        items.push({
          kind: "market", badge: tr("المتجر", "Boutique", "Market"),
          title: m.title || tr("منتج جديد", "Nouveau produit", "New product"),
          meta: `<span>@${esc(m.seller?.username || m.store_name || "Cineaura")}</span>`,
          image: typeof img === "string" ? img : "",
          href: `./market.html?Product=${encodeURIComponent(m.id || "")}`,
          date: m.created_at || m.updated_at || new Date().toISOString(), icon: "🛒",
        });
      }
    } catch { /* market SQL missing: no cards, the page ships as before */ }

    // 3) The newest member videos (video.html's feed — content_search, sort date).
    try {
      const d = await call("content_search", { p_member: me, p_sort: "date", p_limit: 12 });
      const rows = Array.isArray(d?.items) ? d.items : [];
      for (const v of rows.slice(0, 10)) {
        items.push({
          kind: "video", badge: tr("فيديو", "Vidéo", "Video"),
          title: v.title || tr("فيديو جديد", "Nouvelle vidéo", "New video"),
          meta: `<span>@${esc(v.owner || "Cineaura")}</span>`,
          image: v.thumb || v.poster || v.cover || "",
          href: `./video.html?id=${encodeURIComponent(v.id || "")}`,
          date: v.publish_at || v.created_at || new Date().toISOString(), icon: "▶",
        });
      }
    } catch { /* no videos yet */ }

    // 4) The newest IPTV lists members published (iptv.html — iptv_lists_search, sort date).
    try {
      const d = await call("iptv_lists_search", { p_member: me, p_q: "", p_sort: "date", p_filter: "", p_limit: 8, p_offset: 0 });
      const rows = Array.isArray(d?.items) ? d.items : [];
      for (const l of rows.slice(0, 8)) {
        items.push({
          kind: "iptv", badge: "IPTV",
          title: l.name || "IPTV",
          meta: `<span>${Number(l.channels) || 0} ${tr("قناة", "chaînes", "channels")}</span>${l.owner ? ` · @${esc(l.owner)}` : ""}`,
          image: l.logo || "",
          href: `./listchannels.html?list=${encodeURIComponent(l.id || "")}`,
          date: l.updated_at || l.created_at || new Date().toISOString(), icon: "📺",
        });
      }
    } catch { /* no lists yet */ }

    // 5) Movies AND series of the moment — js/main.js pushes the TMDB trending
    //    (tmbd:trending event / window.__cineauraTrending).
    try {
      const trending = window.__cineauraTrending || window.__tmdbTrending || [];
      for (const it of trending.slice(0, 14)) {
        const series = it.media_type === "tv";
        items.push({
          kind: series ? "series" : "movie",
          badge: series ? tr("مسلسل", "Série", "Series") : tr("فيلم", "Film", "Movie"),
          title: it.title || it.name || "",
          meta: `<span>TMDB</span> · ⭐ ${esc(it.vote_average || "—")}`,
          image: it.poster_path ? `https://image.tmdb.org/t/p/w185${it.poster_path}` : it.backdrop_path ? `https://image.tmdb.org/t/p/w300${it.backdrop_path}` : "",
          href: `watch.html#tmdb-${it.id}`,
          date: it.release_date || it.first_air_date || new Date().toISOString(), icon: series ? "🎞" : "🎬",
        });
      }
    } catch { /* trending is a bonus */ }

    // 6) The visitor's own milestone if the points are around (js/common.js memberPoints).
    try {
      const pts = window.memberPoints || window.__memberPoints;
      if (pts && pts.level) {
        items.push({
          kind: "promo", badge: tr("نقاط", "Points", "Points"),
          title: tr(`مستوى جديد: ${pts.level}`, `Nouveau palier : ${pts.level}`, `New milestone: ${pts.level}`),
          meta: `<span>${tr("نظام النقاط", "Système de points", "Points system")}</span>`,
          image: "", href: "index.html#points-levels", date: new Date().toISOString(), icon: "🏆",
        });
      }
    } catch { /* guest */ }

    // Nothing fetched at all (SQL not run yet): keep the four honest pointers so
    // the section does not look dead.
    if (!items.length) {
      items.push(
        { kind: "market", badge: tr("المتجر", "Boutique", "Market"), title: tr("تحديث المتجر: منتجات جديدة يومياً", "Actu boutique : nouveaux produits chaque jour", "Store update: new products daily"), meta: "<span>Cineaura Market</span>", image: "", href: "./market.html", date: new Date().toISOString(), icon: "🛒" },
        { kind: "video", badge: tr("فيديو", "Vidéo", "Video"), title: tr("أحدث الفيديوهات في المنصة", "Dernières vidéos sur la plateforme", "Latest videos on the platform"), meta: "<span>Cineaura</span>", image: "", href: "./video.html", date: new Date().toISOString(), icon: "▶" },
        { kind: "iptv", badge: "IPTV", title: "IPTV — " + tr("قوائم محدثة", "listes mises à jour", "lists updated"), meta: "", image: "", href: "./iptv.html", date: new Date().toISOString(), icon: "📺" },
        { kind: "movie", badge: tr("الأفلام", "Films", "Movies"), title: "TMDB " + tr("الأكثر رواجاً", "Tendances", "Trending"), meta: "TMDB", image: "", href: "./movies.html", date: new Date().toISOString(), icon: "🎬" },
        { kind: "series", badge: tr("مسلسل", "Série", "Series"), title: "TMDB " + tr("الأكثر رواجاً", "Tendances", "Trending"), meta: "TMDB", image: "", href: "./series.html", date: new Date().toISOString(), icon: "🎞" },
      );
    }

    items.sort((a, b) => new Date(b.date) - new Date(a.date));
    return items;
  }

  async function redraw() {
    renderChips();
    renderGrid();
  }

  function bindFilterEvents() {
    $("#live-filters")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn) return;
      activeFilter = btn.dataset.filter;
      $$("#live-filters .live-chip").forEach((c) => c.classList.toggle("active", c.dataset.filter === activeFilter));
      renderGrid();
    });
  }

  async function init() {
    const root = document.getElementById("live-updates");
    if (!root) return;
    const subtitle = root.querySelector("[data-live-subtitle]");
    const paintSub = () => {
      if (subtitle)
        subtitle.textContent = tr(
          "جميع المستجدات في مكان واحد — المتجر، الفيديو، IPTV، الأفلام، المسلسلات والعروض",
          "Toutes les nouveautés en un seul endroit — boutique, vidéos, IPTV, films, séries et offres",
          "All updates in one place — market, videos, IPTV, movies, series and offers"
        );
    };
    paintSub();
    bindFilterEvents();
    // js/main.js pushes the TMDB trending once it is in — merge without waiting.
    window.__cineauraPushTrending = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return;
      window.__cineauraTrending = arr;
      fetchAll().then((n) => {
        allItems = n;
        redraw();
      });
    };
    try {
      allItems = await fetchAll();
      redraw();
    } catch (err) {
      console.error("[live-updates]", err);
      const g = $("#live-grid");
      if (g) g.innerHTML = `<div class="live-empty">${esc(String(err.message || err))}</div>`;
    }
    // keep the "live" feel: refresh every 90 s
    setInterval(async () => {
      const n = await fetchAll().catch(() => null);
      if (n && n.length) {
        allItems = n;
        redraw();
      }
    }, 90000);
    // chips and cards carry ar/fr/en labels: repainted on any language switch
    // (js/common.js applyPrefs → cineaura:prefs; the old 'lang:change' was never fired)
    document.addEventListener("cineaura:prefs", async () => {
      paintSub();
      allItems = await fetchAll();
      redraw();
    });
    window.addEventListener("tmdb:trending", (e) => {
      if (e.detail?.length) window.__cineauraPushTrending(e.detail);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
