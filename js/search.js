/* CineAura — search.html: the search system with seven tabs and their result
   types (sql/search.sql).

   Videos     videos, playlists, recommendations, reviews
   Movies     movies (TMDB), recommendations, reviews, playlists
   Series     series (TMDB), recommendations, reviews, playlists
   Channels   free channels, the site's own lists (staff), member channels and
              lists — an exclusive list opens only when every criterion the
              publisher set is met (country, language, followers, account level,
              membership level and one of the publisher's passwords); a private
              list appears only when its publisher allows it in search, and then
              only with a "request to join" button the publisher must approve.
   Profiles   profiles, posts, recommendations
   Market     products, categories, purchase recommendations, reviews,
              shopping lists
   Prizes     prizes, challenges, lottery, prize groups

   Every tab narrows by "added" (today, yesterday, this week, this month, this
   year, all time) and orders by the ranking points of sql/search.sql:

     +60 a watched minute · +30 a recommendation · −30 a "don't recommend"
     +1 a comment · +1 an off-site link share · −60 a valid report

   Movies and series rank by their TMDB rating and trending (the browser reads
   TMDB directly). The address keeps every choice:
   ?q=&tab=&kind=&when=&sort=&lang=&region=&age=&tag=&owner=
*/
(() => {
  "use strict";
  const C = window.CineAura;
  const V = window.CineAuraVideos;
  const { t, escapeHtml: esc } = C;

  // ---------------------------------------------------------------- config
  const TABS = {
    videos: { kinds: ["videos", "playlists", "recs", "reviews"] },
    movies: { kinds: ["movies", "recs", "reviews", "playlists"] },
    series: { kinds: ["series", "recs", "reviews", "playlists"] },
    channels: { kinds: ["free", "staff", "member"] },
    profiles: { kinds: ["profiles", "posts", "recs"] },
    market: { kinds: ["products", "categories", "recs", "reviews", "lists"] },
    prizes: { kinds: ["prizes", "challenges", "lottery", "groups"] },
  };
  const TAB_ORDER = ["videos", "movies", "series", "channels", "profiles", "market", "prizes"];
  const SORTS = {
    videos: ["rank", "relevance", "date", "views", "recs", "minutes", "shares", "az", "za"],
    movies: ["rank", "relevance", "rating", "date", "views", "az", "za"],
    series: ["rank", "relevance", "rating", "date", "views", "az", "za"],
    channels: ["rank", "relevance", "date", "views", "lists", "az", "za"],
    profiles: ["rank", "relevance", "date", "followers", "az", "za"],
    market: ["rank", "relevance", "date", "price", "az", "za"],
    prizes: ["rank", "relevance", "date", "az", "za"],
  };
  const WHENS = ["", "today", "yesterday", "week", "month", "year"];
  const PAGE = 24;
  // Facet label keys (result types).
  const FACET = {
    videos: "srch.f.videos", playlists: "srch.f.playlists", recs: "srch.f.recs",
    reviews: "srch.f.reviews", movies: "srch.f.movies", series: "srch.f.series",
    free: "srch.f.free", staff: "srch.f.staff", member: "srch.f.member",
    profiles: "srch.f.profiles", posts: "srch.f.posts",
    products: "srch.f.products", categories: "srch.f.categories",
    market: "srch.f.products", lists: "srch.f.buyLists",
    prizes: "srch.f.prizes", challenges: "srch.f.challenges",
    lottery: "srch.f.lottery", groups: "srch.f.groups",
  };

  const params = new URLSearchParams(location.search);
  const legacyTab = { tmdb: "movies", video: "videos", channel: "channels" };
  const startTab = legacyTab[params.get("tab")] || params.get("tab");
  const state = {
    q: (params.get("q") || "").trim(),
    tab: TAB_ORDER.includes(startTab) ? startTab : "videos",
    kind: params.get("kind") || "",
    when: WHENS.includes(params.get("when")) ? params.get("when") : "",
    sort: params.get("sort") || "",
    lang: params.get("lang") || "",
    region: (params.get("region") || "").toUpperCase(),
    age: [3, 6, 13, 16, 18].includes(Number(params.get("age"))) ? Number(params.get("age")) : "",
    tag: (params.get("tag") || "").replace(/^#+/, "").trim().toLowerCase(),
    owner: (params.get("owner") || "").replace(/^@+/, "").trim(),
    items: [],
    total: 0,
    page: 0,
    pages: 1,
    seq: 0,
  };
  if (!TABS[state.tab].kinds.includes(state.kind)) state.kind = TABS[state.tab].kinds[0];

  const $ = (sel) => document.querySelector(sel);

  // ---------------------------------------------------------------- rpc
  async function call(name, args = {}) {
    const res = await V.call(name, args);
    return res;
  }

  // ---------------------------------------------------------------- url
  function syncUrl() {
    const q = new URLSearchParams();
    if (state.q) q.set("q", state.q);
    if (state.tab !== "videos") q.set("tab", state.tab);
    if (state.kind !== TABS[state.tab].kinds[0]) q.set("kind", state.kind);
    if (state.when) q.set("when", state.when);
    if (state.sort) q.set("sort", state.sort);
    if (state.lang) q.set("lang", state.lang);
    if (state.region) q.set("region", state.region);
    if (state.age) q.set("age", String(state.age));
    if (state.tag && state.tab === "videos") q.set("tag", state.tag);
    if (state.owner && state.tab === "videos") q.set("owner", state.owner);
    const s = q.toString();
    history.replaceState(history.state, "", `${location.pathname}${s ? `?${s}` : ""}`);
  }

  function effectiveSort() {
    return state.sort || (state.q ? "relevance" : "rank");
  }

  // ---------------------------------------------------------------- controls
  function drawTabs() {
    const ph = t(`srch.ph.${state.tab}`);
    $("#vs-q").placeholder = ph;
    $("#vs-q").setAttribute("aria-label", ph);
    $("#vs-kind").innerHTML = TAB_ORDER.map((k) => {
      const on = state.tab === k;
      const n = on && state.total ? state.total : 0;
      const count = n ? ` <span class="follow-count">${esc(V.fmtCount(n))}</span>` : "";
      return `<button type="button" role="tab" class="follow-tab${on ? " active" : ""}" data-kind-tab="${k}" aria-selected="${on}">${esc(t(`vid.kind.${k}`))}${count}</button>`;
    }).join("");
  }

  function facetKey(k) {
    // the market tab calls its recommendations "purchase recommendations"
    if (state.tab === "market" && k === "recs") return "srch.f.buyRecs";
    return FACET[k] || `srch.f.${k}`;
  }

  function drawFacets() {
    return TABS[state.tab].kinds
      .map((k) => {
        const on = state.kind === k;
        return `<button type="button" class="vs-facet${on ? " active" : ""}" data-facet="${k}" aria-pressed="${on}">${esc(t(facetKey(k)))}</button>`;
      })
      .join("");
  }

  function sortLabel(k) {
    if (k === "rank") return t("srch.sort.rank");
    if (k === "rating") return t("srch.sort.rating");
    if (k === "price") return t("srch.sort.price");
    if (k === "followers") return t("srch.sort.followers");
    if (k === "lists") return t("vid.csort.lists");
    if (k === "minutes") return t("srch.sort.minutes");
    if (k === "shares") return t("srch.sort.shares");
    return t(`vid.sort.${k}`);
  }

  function drawFilters() {
    const sel = (id, label, opts, value) => `
      <label class="vs-filter" for="${id}">
        <span>${esc(label)}</span>
        <select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
      </label>`;
    const sortOpts = SORTS[state.tab].map((k) => [k, sortLabel(k)]);
    const whenOpts = WHENS.map((w) => [w, t(w ? `srch.when.${w}` : "srch.when.all")]);
    const langOpts = [["", t("vid.all")], ...V.LANGUAGES.map((l) => [l, V.langLabel(l)])];
    const regionOpts = [["", t("vid.all")], ...C.countryChoices()];
    const ageOpts = [["", t("vid.all")], ...V.AGES.map((a) => [a, V.ageLabel(a)])];
    const showLang = ["videos", "movies", "series"].includes(state.tab);
    const showRegion = state.tab === "videos" && ["videos", "recs"].includes(state.kind);
    const showAge = showRegion;
    const chips = [
      state.tag && state.tab === "videos" ? `<span class="vs-chip"><bdi>#${esc(state.tag)}</bdi><button type="button" data-clear="tag" aria-label="${esc(t("vid.clear"))}">×</button></span>` : "",
      state.owner && state.tab === "videos" ? `<span class="vs-chip"><bdi>@${esc(state.owner)}</bdi><button type="button" data-clear="owner" aria-label="${esc(t("vid.clear"))}">×</button></span>` : "",
    ].join("");
    const canReset = state.lang || state.region || state.age || state.sort || state.when || state.tag || state.owner;
    $("#vs-filters").innerHTML = `
      <div class="vs-facets" role="group" aria-label="${esc(t("srch.resultTypes"))}">${drawFacets()}</div>
      <div class="vs-filter-row">
        ${sel("vs-sort", t("vid.sortBy"), sortOpts, effectiveSort())}
        ${sel("vs-when", t("srch.added"), whenOpts, state.when)}
        ${showLang ? sel("vs-lang", t("vid.f.lang"), langOpts, state.lang) : ""}
        ${showRegion ? sel("vs-region", t("vid.region"), regionOpts, state.region) : ""}
        ${showAge ? sel("vs-age", t("vid.f.age"), ageOpts, state.age) : ""}
        ${chips ? `<div class="vs-active">${chips}</div>` : ""}
        ${canReset ? `<button class="btn btn-sm btn-ghost vs-reset" type="button" data-reset>${esc(t("vid.resetFilters"))}</button>` : ""}
      </div>
      <p class="vs-note muted vs-rank-note" title="${esc(t("srch.rankTitle"))}">${esc(t("srch.rankLegend"))}</p>
      ${state.tab === "movies" || state.tab === "series" ? `<p class="vs-note muted">${esc(t("srch.tmdbNote"))}</p>` : ""}`;
  }

  function wireControls() {
    $("#vs-q").value = state.q;
    $("#vs-form").addEventListener("submit", (e) => {
      e.preventDefault();
      state.q = $("#vs-q").value.trim();
      run();
    });
    $("#vs-kind").addEventListener("click", (e) => {
      const b = e.target.closest("[data-kind-tab]");
      if (!b || b.dataset.kindTab === state.tab) return;
      state.tab = b.dataset.kindTab;
      state.kind = TABS[state.tab].kinds[0];
      state.sort = "";
      run();
    });
    $("#vs-filters").addEventListener("click", (e) => {
      const f = e.target.closest("[data-facet]");
      if (f) {
        if (f.dataset.facet === state.kind) return;
        state.kind = f.dataset.facet;
        run();
        return;
      }
      const clear = e.target.closest("[data-clear]");
      if (clear) {
        state[clear.dataset.clear] = "";
        run();
        return;
      }
      if (e.target.closest("[data-reset]")) {
        Object.assign(state, { sort: "", when: "", lang: "", region: "", age: "", tag: "", owner: "" });
        run();
      }
    });
    $("#vs-filters").addEventListener("change", (e) => {
      const id = e.target.id;
      if (id === "vs-sort") state.sort = e.target.value === (state.q ? "relevance" : "rank") ? "" : e.target.value;
      if (id === "vs-when") state.when = e.target.value;
      if (id === "vs-lang") state.lang = e.target.value;
      if (id === "vs-region") state.region = e.target.value;
      if (id === "vs-age") state.age = e.target.value ? Number(e.target.value) : "";
      run();
    });
    $("#vs-results").addEventListener("click", (e) => {
      if (e.target.closest("[data-more]")) {
        load(true);
        return;
      }
      const unlock = e.target.closest("[data-unlock]");
      if (unlock) {
        passwordDialog(unlock.dataset.unlock);
        return;
      }
      const join = e.target.closest("[data-join]");
      if (join) {
        joinRequest(join.dataset.join);
      }
    });
    document.addEventListener("cineaura:lang", () => {
      drawTabs();
      drawFilters();
    });
  }

  // ---------------------------------------------------------------- cards
  const scoreChip = (item) =>
    item && Number.isFinite(Number(item.score))
      ? `<span class="sc-score" title="${esc(t("srch.rankTitle"))}"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/></svg><bdi dir="ltr">${esc(V.fmtNum(Number(item.score) || 0))}</bdi><span class="sr-only">${esc(t("srch.rankTitle"))}</span></span>`
      : "";

  const ago = (iso) => (iso ? V.timeAgo(iso) : "");

  function videoCard(x) {
    return `<div class="sc-item">${V.cardHtml(x, { vis: true })}<div class="sc-foot">${scoreChip(x)}${x.rec ? `<span class="sc-tag sc-tag-green">${esc(t("srch.recommended"))}</span>` : ""}</div></div>`;
  }

  function thumbStrip(thumbs) {
    const list = Array.isArray(thumbs) ? thumbs.filter(Boolean).slice(0, 4) : [];
    if (!list.length) return `<span class="sc-thumbs sc-thumbs-ph" aria-hidden="true"></span>`;
    return `<span class="sc-thumbs">${list.map((u) => `<img src="${esc(u)}" alt="" loading="lazy" />`).join("")}</span>`;
  }

  function playlistCard(x) {
    const media = x.media ? `<span class="sc-tag">${esc(t(x.media === "tv" ? "vid.kind.series" : "vid.kind.movies"))}</span>` : "";
    const href = x.source === "videos"
      ? `./profile.html?username=${encodeURIComponent(x.owner || "")}#playlists`
      : x.source === "post"
        ? `./profile.html?post=${encodeURIComponent(x.id)}`
        : `./playlist.html?ID=${encodeURIComponent(x.id)}`;
    return `<a class="sc-card" href="${href}">
      ${thumbStrip(x.thumbs)}
      <span class="sc-body">
        <b class="sc-title">${esc(x.title || "")}</b>
        <span class="sc-meta"><bdi>@${esc(x.owner || "")}</bdi> · ${esc(t("srch.itemsN", { n: V.fmtNum(x.items || 0) }))}${x.views ? ` · ${esc(t("vid.viewsN", { n: V.fmtCount(x.views) }))}` : ""} · ${esc(ago(x.created_at))}</span>
        ${x.body ? `<span class="sc-desc">${esc(x.body)}</span>` : ""}
        <span class="sc-foot">${media}${scoreChip(x)}</span>
      </span>
    </a>`;
  }

  function reviewCard(x) {
    const href = x.content_id
      ? `./video.html?id=${encodeURIComponent(x.content_id)}`
      : x.tmdb
        ? `./watch.html?${x.media === "tv" ? "tv" : "movie"}=${encodeURIComponent(x.tmdb)}`
        : x.id && String(x.id).startsWith("P")
          ? `./profile.html?post=${encodeURIComponent(x.id)}`
          : `./profile.html?username=${encodeURIComponent(x.owner || "")}`;
    const title = x.title || t("srch.reviewTitle");
    return `<a class="sc-card sc-review" href="${href}">
      ${x.thumb ? `<span class="sc-thumbs"><img src="${esc(x.thumb)}" alt="" loading="lazy" /></span>` : ""}
      <span class="sc-body">
        <b class="sc-title">${esc(t("srch.reviewOf", { title }))}</b>
        <span class="sc-quote">${esc(x.body || "")}</span>
        ${x.pros ? `<span class="sc-pros"><b>${esc(t("srch.pros"))}:</b> ${esc(x.pros)}</span>` : ""}
        ${x.cons ? `<span class="sc-cons"><b>${esc(t("srch.cons"))}:</b> ${esc(x.cons)}</span>` : ""}
        <span class="sc-meta">${x.author ? `<bdi>@${esc(x.author)}</bdi> · ` : ""}${esc(ago(x.created_at))}${x.verified ? ` · <span class="sc-tag sc-tag-green">${esc(t("srch.verified"))}</span>` : ""}</span>
      </span>
    </a>`;
  }

  function postCard(x) {
    const kindLabel = t(`srch.postKind.${x.kind}`);
    const thumbs = (Array.isArray(x.items) ? x.items : []).filter((i) => i && i.poster);
    return `<a class="sc-card sc-post" href="./profile.html?post=${encodeURIComponent(x.id)}">
      ${thumbStrip(thumbs.map((i) => `https://image.tmdb.org/t/p/w200${i.poster}`))}
      <span class="sc-body">
        <b class="sc-title">${esc(x.title || t("srch.untitled"))}</b>
        <span class="sc-meta"><bdi>@${esc(x.owner || "")}</bdi> · <span class="sc-tag">${esc(kindLabel)}</span> · ${esc(ago(x.created_at))}</span>
        ${x.body ? `<span class="sc-desc">${esc(x.body)}</span>` : ""}
        <span class="sc-foot">
          <span class="sc-stat">▲ ${esc(V.fmtNum(x.ups || 0))}</span>
          <span class="sc-stat">▼ ${esc(V.fmtNum(x.downs || 0))}</span>
          <span class="sc-stat">${esc(t("srch.commentsN", { n: V.fmtNum(x.comments || 0) }))}</span>
          ${scoreChip(x)}
        </span>
      </span>
    </a>`;
  }

  function recCard(x) {
    const thumbs = (Array.isArray(x.items) ? x.items : []).filter((i) => i && i.poster);
    const href = x.product_id
      ? `./market.html?Product=${encodeURIComponent(x.product_id)}`
      : x.list_id
        ? `./market.html?List=${encodeURIComponent(x.list_id)}`
        : `./profile.html?post=${encodeURIComponent(x.id)}`;
    return `<a class="sc-card sc-post" href="${href}">
      ${thumbStrip(x.thumb ? [x.thumb] : thumbs.map((i) => `https://image.tmdb.org/t/p/w200${i.poster}`))}
      <span class="sc-body">
        <b class="sc-title">${esc(x.title || x.product || x.list || t("srch.recommended"))}</b>
        ${x.body || x.note ? `<span class="sc-desc">${esc(x.body || x.note)}</span>` : ""}
        <span class="sc-meta">${x.author || x.owner ? `<bdi>@${esc(x.author || x.owner)}</bdi> · ` : ""}${esc(ago(x.created_at))}</span>
        <span class="sc-foot">
          ${x.ups != null ? `<span class="sc-stat">▲ ${esc(V.fmtNum(x.ups || 0))}</span>` : ""}
          ${x.ups != null ? `<span class="sc-stat">▼ ${esc(V.fmtNum(x.downs || 0))}</span>` : ""}
          ${x.again ? `<span class="sc-tag">${esc(t("srch.reSharedN", { n: V.fmtNum(x.again) }))}</span>` : ""}
          <span class="sc-tag sc-tag-green">${esc(t("srch.recommended"))}</span>
          ${scoreChip(x)}
        </span>
      </span>
    </a>`;
  }

  function profileCard(x) {
    const initial = esc((String(x.name || x.username || "?").trim()[0] || "?").toUpperCase());
    return `<a class="sc-card sc-profile" href="./profile.html?username=${encodeURIComponent(x.username || x.id)}">
      <span class="sc-avatar" aria-hidden="true">${initial}${x.avatar ? `<img src="${esc(x.avatar)}" alt="" loading="lazy" />` : ""}</span>
      <span class="sc-body">
        <b class="sc-title">${esc(x.name || x.username || "")}</b>
        <span class="sc-meta"><bdi>@${esc(x.username || "")}</bdi> · ${esc(t("srch.followersN", { n: V.fmtCount(x.followers || 0) }))}${x.country ? ` · ${esc(C.countryName(x.country))}` : ""}</span>
        ${x.bio ? `<span class="sc-desc">${esc(x.bio)}</span>` : ""}
        <span class="sc-foot">
          <span class="sc-tag">${esc(C.tr(x.membership || "Free"))}</span>
          <span class="sc-tag">${esc(t("srch.levelShort", { n: x.level ?? 0 }))}</span>
        </span>
      </span>
    </a>`;
  }

  function channelCard(x) {
    const logo = x.logo ? `<img class="sc-logo" src="${esc(x.logo)}" alt="" loading="lazy" />` : `<span class="sc-logo sc-logo-ph" aria-hidden="true">${esc((String(x.name || "?").trim()[0] || "?").toUpperCase())}</span>`;
    return `<a class="sc-card sc-channel" href="./listchannels.html?list=${encodeURIComponent(x.list_id || "")}${x.key ? `&channel=${encodeURIComponent(x.key)}` : ""}&name=${encodeURIComponent(x.name || "")}">
      ${logo}
      <span class="sc-body">
        <b class="sc-title">${esc(x.name || "")}</b>
        <span class="sc-meta">${x.group ? `<bdi>${esc(x.group)}</bdi> · ` : ""}${x.list ? `${esc(t("srch.onList", { name: x.list }))} · ` : ""}<bdi>@${esc(x.owner || "")}</bdi>${x.staff ? ` · <span class="sc-tag sc-tag-green">${esc(t("srch.ch.official"))}</span>` : ""}</span>
        <span class="sc-foot">${scoreChip(x)}</span>
      </span>
    </a>`;
  }

  function freeChannelCard(x) {
    return `<a class="sc-card sc-channel" href="./iptv.html">
      <span class="sc-logo sc-logo-ph sc-logo-free" aria-hidden="true">▶</span>
      <span class="sc-body">
        <b class="sc-title">${esc(x.name || "")}</b>
        <span class="sc-meta">${esc(t("srch.f.free"))}</span>
      </span>
    </a>`;
  }

  const visLabel = (v) => t(`srch.ch.${v === "private" ? "private" : v === "exclusive" ? "exclusive" : "public"}`);

  function listCard(x, { join = false } = {}) {
    const card = x.id || x.list_id;
    const req = x.request;
    const crit = [];
    if (x.followers) crit.push(t("srch.ch.f.followers"));
    if (x.countries) crit.push(`${t("srch.ch.f.countries")}: ${x.countries}`);
    if (x.languages) crit.push(`${t("srch.ch.f.languages")}: ${x.languages}`);
    if (x.premium) crit.push(t("srch.ch.f.premium"));
    if (x.level) crit.push(t("srch.ch.f.level", { n: x.level }));
    if (x.password) crit.push(t("srch.ch.f.password"));
    const btns = join
      ? `<button class="btn btn-sm ${req && req.status === "pending" ? "btn-ghost" : "btn-primary"}" type="button" data-join="${esc(card)}" ${req && req.status === "pending" ? "disabled" : ""}>${esc(
          req ? (req.status === "pending" ? t("srch.ch.joinSent") : req.status === "approved" ? t("srch.ch.joinApproved") : t("srch.ch.joinRejected")) : t("srch.ch.join")
        )}</button>`
      : x.password && x.locked
        ? `<button class="btn btn-sm btn-primary" type="button" data-unlock="${esc(card)}">${esc(t("srch.ch.unlock"))}</button>`
        : `<a class="btn btn-sm btn-ghost" href="./listchannels.html?list=${encodeURIComponent(card)}">${esc(t("srch.ch.openList"))}</a>`;
    return `<div class="sc-card sc-list ${join ? "sc-list-join" : ""}">
      <span class="sc-list-head">
        <b class="sc-title">${esc(x.name || "")}</b>
        <span class="sc-tag ${x.visibility === "private" ? "sc-tag-red" : x.visibility === "exclusive" ? "sc-tag-amber" : "sc-tag-green"}">${esc(visLabel(x.visibility))}</span>
        ${x.official || x.staff ? `<span class="sc-tag sc-tag-green">${esc(t("srch.ch.official"))}</span>` : ""}
      </span>
      ${x.description ? `<span class="sc-desc">${esc(x.description)}</span>` : ""}
      <span class="sc-meta"><bdi>@${esc(x.owner || "")}</bdi> · ${esc(t("srch.channelsN", { n: V.fmtNum(x.channels || 0) }))} · ${esc(t("vid.viewsN", { n: V.fmtCount(x.views || 0) }))} · ${esc(ago(x.created_at))}</span>
      ${join ? `<p class="sc-join-note">${esc(t("srch.ch.privateText"))}</p>` : ""}
      ${crit.length ? `<span class="sc-crit">${crit.map((c) => `<span class="sc-chip">${esc(c)}</span>`).join("")}</span>` : ""}
      <span class="sc-foot">${btns}${scoreChip(x)}</span>
    </div>`;
  }

  function productCard(x) {
    const img = Array.isArray(x.images) && x.images[0] ? x.images[0] : x.thumb;
    return `<a class="sc-card sc-product" href="./market.html?Product=${encodeURIComponent(x.id || "")}">
      ${img ? `<span class="sc-thumbs"><img src="${esc(img)}" alt="" loading="lazy" /></span>` : `<span class="sc-thumbs sc-thumbs-ph" aria-hidden="true"></span>`}
      <span class="sc-body">
        <b class="sc-title">${esc(x.title || "")}</b>
        <span class="sc-meta">${x.store ? `<bdi>${esc(x.store)}</bdi> · ` : ""}${esc(t("srch.soldN", { n: V.fmtNum(x.sales || 0) }))} · ${esc(ago(x.created_at))}</span>
        <span class="sc-foot">
          <span class="sc-price"><bdi dir="ltr">${esc(V.fmtNum(x.price || 0))}</bdi> ${esc(t("srch.pts"))}</span>
          ${x.recs ? `<span class="sc-tag sc-tag-green">${esc(t("srch.recsN", { n: V.fmtNum(x.recs) }))}</span>` : ""}
          ${x.reviewed ? `<span class="sc-tag">${esc(t("srch.reviewsN", { n: V.fmtNum(x.reviewed) }))}</span>` : ""}
          ${scoreChip(x)}
        </span>
      </span>
    </a>`;
  }

  function categoryCard(x) {
    return `<a class="sc-card sc-product" href="./market.html?Categories=${encodeURIComponent(x.id || "")}">
      ${thumbStrip(x.images)}
      <span class="sc-body">
        <b class="sc-title">${esc(x.title || "")}</b>
        <span class="sc-meta">${esc(t("srch.productsN", { n: V.fmtNum(x.products || 0) }))}</span>
      </span>
    </a>`;
  }

  function marketReviewCard(x) {
    return `<a class="sc-card sc-review" href="./market.html?Product=${encodeURIComponent(x.product_id || "")}">
      ${x.thumb ? `<span class="sc-thumbs"><img src="${esc(x.thumb)}" alt="" loading="lazy" /></span>` : ""}
      <span class="sc-body">
        <b class="sc-title">${esc(x.product || t("srch.reviewTitle"))}</b>
        ${Array.isArray(x.pros) && x.pros.length ? `<span class="sc-pros"><b>${esc(t("srch.pros"))}:</b> ${esc(x.pros.join(" · "))}</span>` : ""}
        ${Array.isArray(x.cons) && x.cons.length ? `<span class="sc-cons"><b>${esc(t("srch.cons"))}:</b> ${esc(x.cons.join(" · "))}</span>` : ""}
        <span class="sc-meta"><bdi>@${esc(x.author || "")}</bdi> · ${esc(ago(x.created_at))}${x.verified ? ` · <span class="sc-tag sc-tag-green">${esc(t("srch.verified"))}</span>` : ""}</span>
      </span>
    </a>`;
  }

  function marketListCard(x) {
    return `<a class="sc-card" href="./market.html?List=${encodeURIComponent(x.id || "")}">
      ${thumbStrip(x.thumbs)}
      <span class="sc-body">
        <b class="sc-title">${esc(x.title || "")}</b>
        ${x.body ? `<span class="sc-desc">${esc(x.body)}</span>` : ""}
        <span class="sc-meta"><bdi>@${esc(x.author || "")}</bdi> · ${esc(t("srch.itemsN", { n: V.fmtNum(x.items || 0) }))} · ${esc(ago(x.created_at))}</span>
      </span>
    </a>`;
  }

  function prizeCard(x) {
    const modes = (Array.isArray(x.modes) ? x.modes : []).map((m) => `<span class="sc-tag">${esc(t(`srch.mode.${m}`))}</span>`).join("");
    return `<a class="sc-card sc-prize" href="./prize.html?GroupPrize=${encodeURIComponent(x.group_id ?? 0)}&Prize=${encodeURIComponent(x.id || "")}">
      ${x.thumb ? `<span class="sc-thumbs"><img src="${esc(x.thumb)}" alt="" loading="lazy" /></span>` : `<span class="sc-thumbs sc-thumbs-ph" aria-hidden="true"></span>`}
      <span class="sc-body">
        ${x.group ? `<small class="sc-group">${esc(x.group)}</small>` : ""}
        <b class="sc-title">${esc(x.title || "")}</b>
        ${x.body ? `<span class="sc-desc">${esc(x.body)}</span>` : ""}
        <span class="sc-meta">${esc(t("srch.entriesN", { n: V.fmtNum(x.entries || 0) }))} · ${x.ends ? esc(t("srch.endsOn", { date: x.ends })) : esc(t("srch.noEnd"))}</span>
        <span class="sc-foot">${modes}${x.minutes ? `<span class="sc-tag">${esc(t("srch.minutesNeed", { n: V.fmtNum(x.minutes) }))}</span>` : ""}</span>
      </span>
    </a>`;
  }

  function groupCard(x) {
    return `<a class="sc-card sc-prize" href="./prize.html?GroupPrize=${encodeURIComponent(x.id || "")}">
      ${x.thumb ? `<span class="sc-thumbs"><img src="${esc(x.thumb)}" alt="" loading="lazy" /></span>` : ""}
      <span class="sc-body">
        <b class="sc-title">${esc(x.title || "")}</b>
        <span class="sc-meta">${esc(t("srch.prizeGroups", { n: V.fmtNum(x.prizes || 0) }))}</span>
      </span>
    </a>`;
  }

  function tmdbCard(x) {
    return `<div class="sc-item">${C.posterCard(x, x.media_type === "tv" ? "tv" : "movie")}</div>`;
  }

  function render(items, { tmdb = false } = {}) {
    const grid = tmdb ? "vs-posters" : "sc-grid";
    return `<div class="${grid}">${items.map((x) => (tmdb ? tmdbCard(x) : cardFor(x))).join("")}</div>`;
  }

  function cardFor(x) {
    switch (x.type) {
      case "video":
        return videoCard({ ...x, rec: state.kind === "recs" });
      case "playlist":
        return playlistCard(x);
      case "review":
        return x.product_id ? marketReviewCard(x) : reviewCard(x);
      case "post":
        return postCard(x);
      case "rec":
        return recCard(x);
      case "mrec":
        return recCard(x);
      case "profile":
        return profileCard(x);
      case "channel":
        return channelCard(x);
      case "free":
        return freeChannelCard(x);
      case "list":
        return listCard(x);
      case "joinlist":
        return listCard(x, { join: true });
      case "product":
        return productCard(x);
      case "category":
        return categoryCard(x);
      case "mreview":
        return marketReviewCard(x);
      case "mlist":
        return marketListCard(x);
      case "prize":
        return prizeCard(x);
      case "group":
        return groupCard(x);
      default:
        return "";
    }
  }

  // ---------------------------------------------------------------- headings & empty
  function heading() {
    if (state.q) return t("vid.resultsFor", { q: state.q });
    return t(`srch.latest.${state.tab}`);
  }

  function headHtml() {
    return `<div class="vs-results-head"><h2>${esc(heading())}</h2><span class="muted">${esc(t("srch.countN", { n: V.fmtNum(state.total) }))}</span></div>`;
  }

  function emptyHtml() {
    return `<div class="vs-none glass">
      <h2>${esc(t("vid.noResults"))}</h2>
      <p class="muted">${esc(t("vid.noResultsText"))}</p>
    </div>`;
  }

  function failHtml(setup) {
    return `<p class="empty">${esc(t(setup ? "srch.setup" : "vid.loadFail"))}</p>`;
  }

  function moreHtml() {
    return state.items.length < state.total
      ? `<div class="vs-more"><button class="btn btn-lg btn-ghost" type="button" data-more>${esc(t("vid.loadMore"))}</button></div>`
      : "";
  }

  // ---------------------------------------------------------------- loaders
  function drawLoading() {
    $("#vs-results").innerHTML = `<p class="muted">${esc(t("common.loading"))}</p>`;
  }

  // Videos tab (sql/search.sql search_content)
  async function loadContent(more) {
    const res = await call("search_content", {
      p_member: V.memberId(),
      p_q: state.q,
      p_kind: state.kind,
      p_when: state.when,
      p_sort: effectiveSort() === "rank" ? "rank" : effectiveSort(),
      p_limit: PAGE,
      p_offset: more ? state.items.length : 0,
    });
    return finish(res, more);
  }

  // Movies & Series tabs: TMDB for the titles, search_titles for the rest
  async function loadTitles(more) {
    const media = state.tab === "series" ? "tv" : "movie";
    const local = state.kind !== "movies" && state.kind !== "series";
    if (local) {
      const sort = ["rank", "relevance", "date", "views", "az", "za"].includes(effectiveSort()) ? effectiveSort() : "";
      const res = await call("search_titles", {
        p_member: V.memberId(),
        p_q: state.q,
        p_kind: state.kind,
        p_media: media,
        p_when: state.when,
        p_sort: sort,
        p_limit: PAGE,
        p_offset: more ? state.items.length : 0,
      });
      return finish(res, more);
    }
    // TMDB titles
    const seq = ++state.seq;
    const box = $("#vs-results");
    if (!more) {
      state.items = [];
      state.page = 0;
      drawLoading();
    }
    const page = state.page + 1;
    let data;
    try {
      data = state.q
        ? await C.tmdb(`/search/${media === "tv" ? "tv" : "movie"}?query=${encodeURIComponent(state.q)}&page=${page}&include_adult=false`)
        : await C.tmdb(`/trending/${media}/week?page=${page}`);
    } catch {
      if (seq === state.seq) box.innerHTML = failHtml(false);
      return;
    }
    if (seq !== state.seq) return;
    state.page = page;
    state.pages = Number(data?.total_pages || 1);
    let list = Array.isArray(data?.results) ? data.results.map((x) => ({ ...x, media_type: media })) : [];
    list = whenFilter(list);
    list = tmdbSorted(list);
    state.items = more ? state.items.concat(list) : list;
    state.total = more ? state.total + list.length : Number(data?.total_results || list.length);
    drawTabs();
    drawFilters();
    if (!state.items.length) {
      box.innerHTML = emptyHtml();
      return;
    }
    box.innerHTML = `${headHtml()}${render(state.items, { tmdb: true })}${
      state.page < state.pages ? `<div class="vs-more"><button class="btn btn-lg btn-ghost" type="button" data-more>${esc(t("vid.loadMore"))}</button></div>` : ""
    }`;
    V.observeCards(box);
  }

  function whenFilter(list) {
    if (!state.when) return list;
    const now = new Date();
    const day = 86400000;
    const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    let from = 0;
    let to = Infinity;
    if (state.when === "today") from = startOf(now);
    else if (state.when === "yesterday") {
      from = startOf(now) - day;
      to = startOf(now);
    } else if (state.when === "week") from = startOf(now) - 6 * day;
    else if (state.when === "month") from = startOf(now) - 29 * day;
    else if (state.when === "year") from = startOf(now) - 364 * day;
    return list.filter((x) => {
      const d = Date.parse(x.release_date || x.first_air_date || "");
      return !d || (d >= from && d < to);
    });
  }

  function tmdbSorted(list) {
    const key = effectiveSort();
    const title = (x) => String(x.title || x.name || "").toLocaleLowerCase(C.getLocale());
    const date = (x) => Date.parse(x.release_date || x.first_air_date || "") || 0;
    const copy = list.slice();
    if (key === "rating") copy.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0));
    else if (key === "views" || key === "rank") copy.sort((a, b) => (b.popularity || 0) - (a.popularity || 0) || (b.vote_average || 0) - (a.vote_average || 0));
    else if (key === "date") copy.sort((a, b) => date(b) - date(a));
    else if (key === "az") copy.sort((a, b) => title(a).localeCompare(title(b), C.getLocale()));
    else if (key === "za") copy.sort((a, b) => title(b).localeCompare(title(a), C.getLocale()));
    else copy.sort((a, b) => ((b.vote_average || 0) * (b.vote_count || 0)) - ((a.vote_average || 0) * (a.vote_count || 0)));
    return copy;
  }

  // Channels tab (sql/search.sql search_channels)
  async function loadChannels(more) {
    const res = await call("search_channels", {
      p_member: V.memberId(),
      p_q: state.q,
      p_kind: state.kind,
      p_when: state.when,
      p_sort: effectiveSort(),
      p_limit: PAGE,
      p_offset: more ? state.items.length : 0,
    });
    return finish(res, more);
  }

  async function loadProfiles(more) {
    const res = await call("search_profiles", {
      p_member: V.memberId(),
      p_q: state.q,
      p_kind: state.kind,
      p_when: state.when,
      p_sort: effectiveSort(),
      p_limit: PAGE,
      p_offset: more ? state.items.length : 0,
    });
    return finish(res, more);
  }

  async function loadMarket(more) {
    const res = await call("search_market", {
      p_member: V.memberId(),
      p_q: state.q,
      p_kind: state.kind,
      p_when: state.when,
      p_sort: effectiveSort(),
      p_limit: PAGE,
      p_offset: more ? state.items.length : 0,
    });
    return finish(res, more);
  }

  async function loadPrizes(more) {
    const res = await call("search_prizes", {
      p_member: V.memberId(),
      p_q: state.q,
      p_kind: state.kind,
      p_when: state.when,
      p_sort: effectiveSort(),
      p_limit: PAGE,
      p_offset: more ? state.items.length : 0,
    });
    return finish(res, more);
  }

  function finish(res, more) {
    const box = $("#vs-results");
    if (!res.ok) {
      if (!more) box.innerHTML = failHtml(res.setup);
      return;
    }
    const items = Array.isArray(res.data?.items) ? res.data.items : [];
    state.total = Number(res.data?.total || 0);
    state.items = more ? state.items.concat(items) : items;
    drawTabs();
    drawFilters();
    if (!state.items.length) {
      if (!more) box.innerHTML = emptyHtml();
      return;
    }
    box.innerHTML = `${headHtml()}${render(state.items)}${moreHtml()}`;
    V.observeCards(box);
  }

  function load(more = false) {
    if (!more) {
      state.items = [];
      state.total = 0;
      drawLoading();
    } else {
      $("#vs-results").querySelector("[data-more]")?.setAttribute("disabled", "");
    }
    if (state.tab === "movies" || state.tab === "series") return loadTitles(more);
    if (state.tab === "channels") return loadChannels(more);
    if (state.tab === "profiles") return loadProfiles(more);
    if (state.tab === "market") return loadMarket(more);
    if (state.tab === "prizes") return loadPrizes(more);
    return loadContent(more);
  }

  // ---------------------------------------------------------------- passwords & join
  function passwordDialog(listId) {
    const dlg = V.openDialog(
      `<h2>${esc(t("srch.ch.unlock"))}</h2>
       <p class="muted">${esc(t("srch.ch.passwordText"))}</p>
       <form class="vs-fields" data-pw-form>
         <input name="code" maxlength="64" autocomplete="off" placeholder="${esc(t("srch.ch.passwordPh"))}" aria-label="${esc(t("srch.ch.passwordPh"))}" autofocus />
         <p class="vs-hint" data-pw-err hidden></p>
         <div class="vdlg-actions">
           <button class="btn btn-sm btn-ghost" type="button" data-close>${esc(t("common.cancel"))}</button>
           <button class="btn btn-sm btn-primary" type="submit">${esc(t("srch.ch.unlockGo"))}</button>
         </div>
       </form>`,
      { label: t("srch.ch.unlock") }
    );
    dlg.el.querySelector("[data-pw-form]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const code = form.elements.code.value.trim();
      const err = form.querySelector("[data-pw-err]");
      if (!code) return form.elements.code.focus();
      form.querySelector("button[type=submit]").disabled = true;
      const res = await call("iptv_list_unlock", { p_member: V.memberId(), p_list: listId, p_code: code });
      form.querySelector("button[type=submit]").disabled = false;
      if (res.ok && res.data?.ok) {
        dlg.close();
        C.toast(t("srch.unlockOk"));
        run();
        return;
      }
      err.hidden = false;
      err.textContent = t("srch.unlockBad");
    });
  }

  async function joinRequest(listId) {
    if (!V.memberId()) {
      C.toast(t("srch.needSignin"));
      return;
    }
    const res = await call("iptv_list_join_request", { p_member: V.memberId(), p_list: listId, p_note: "" });
    if (res.ok && res.data?.ok) {
      C.toast(t("srch.requestSent"));
      run();
    } else {
      C.toast(t("srch.requestFail"));
    }
  }

  // ---------------------------------------------------------------- run
  function run() {
    syncUrl();
    drawTabs();
    drawFilters();
    load(false);
  }

  function boot() {
    C.setupChrome();
    wireControls();
    run();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
