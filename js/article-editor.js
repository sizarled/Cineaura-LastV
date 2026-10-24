/* CineAura — the article editor (article-Editor.html) and the article reader pieces.
   One editor for members and staff: Profile › Create › Article, Community › New
   article and Panel › Content › New article all land here.

   Everything the editor writes is sanitised before it is stored, and the reader
   sanitises again on the way out (defence in depth: a row written by an older
   build, or by hand through the REST API, still cannot inject a script).

   window.CineAuraArticles = { mount, sanitize, canRead, meta }
*/
(() => {
  "use strict";
  const C = () => window.CineAura;
  const t = (...a) => C().t(...a);
  const esc = (...a) => C().escapeHtml(...a);
  const req = (...a) => C().supabaseRequest(...a);
  const session = () => (C()?.getSession ? C().getSession() : null);

  // Taxonomy is content, not chrome: kept bilingual here and resolved by the
  // reader's language, so it never adds 40 keys to every pack.
  const L = (o) => (o && (o[C()?.getLang?.()] || o.en)) || "";
  const CONTENT = {
    movies: { en: "Movies", ar: "الأفلام" },
    series: { en: "Series", ar: "المسلسلات" },
    anime: { en: "Anime", ar: "الأنمي" },
    games: { en: "Games", ar: "الألعاب" },
    tech: { en: "Tech", ar: "التقنية" },
  };
  const NICHES = {
    movies: [
      { en: "Drama", ar: "الدراما" },
      { en: "Thriller", ar: "الإثارة والتشويق" },
      { en: "Horror", ar: "الرعب" },
      { en: "Comedy", ar: "الكوميديا" },
      { en: "Documentary", ar: "الوثائقي" },
    ],
    series: [
      { en: "Arabic series", ar: "المسلسلات العربية" },
      { en: "Turkish series", ar: "المسلسلات التركية" },
      { en: "Korean series", ar: "المسلسلات الكورية" },
      { en: "Foreign series", ar: "المسلسلات الأجنبية" },
    ],
    anime: [
      { en: "Shonen", ar: "الشونين" },
      { en: "Romance", ar: "الرومانسي" },
      { en: "Sci-fi", ar: "الخيال العلمي" },
      { en: "Classic anime", ar: "الأنمي الكلاسيكي" },
    ],
    games: [
      { en: "Action", ar: "ألعاب الحركة" },
      { en: "Strategy", ar: "ألعاب الاستراتيجية" },
      { en: "Mobile", ar: "ألعاب الجوال" },
      { en: "Esports", ar: "الرياضات الإلكترونية" },
    ],
    tech: [
      { en: "AI", ar: "الذكاء الاصطناعي" },
      { en: "Devices", ar: "الأجهزة" },
      { en: "Apps", ar: "التطبيقات" },
      { en: "Digital security", ar: "الأمن الرقمي" },
    ],
  };
  const HELP = {
    start: { en: "Getting started", ar: "البدء" },
    account: { en: "Account & security", ar: "الحساب والأمان" },
    plans: { en: "Plans & payment", ar: "الباقات والدفع" },
    watch: { en: "Watching & playback", ar: "المشاهدة والتشغيل" },
    levels: { en: "Levels & balance", ar: "المستويات والرصيد" },
  };
  const HELP_SUBS = {
    start: [
      { en: "Creating an account", ar: "إنشاء حساب" },
      { en: "Signing in", ar: "تسجيل الدخول" },
      { en: "Password reset", ar: "استعادة كلمة السر" },
    ],
    account: [
      { en: "Account settings", ar: "إعدادات الحساب" },
      { en: "Privacy", ar: "الخصوصية" },
      { en: "Account protection", ar: "حماية الحساب" },
    ],
    plans: [
      { en: "Subscriptions", ar: "الاشتراكات" },
      { en: "Payment methods", ar: "طرق الدفع" },
      { en: "Invoices & refunds", ar: "الفواتير والاسترداد" },
    ],
    watch: [
      { en: "Playback quality", ar: "جودة التشغيل" },
      { en: "Supported devices", ar: "الأجهزة المدعومة" },
      { en: "Playback problems", ar: "حل مشاكل التشغيل" },
    ],
    levels: [
      { en: "LV level", ar: "مستوى LV" },
      { en: "Balance tier", ar: "Balance tier" },
      { en: "Rewards", ar: "المكافآت" },
    ],
  };
  const LANG_NAME = { ar: "العربية", en: "English", fr: "Français", es: "Español", de: "Deutsch", tr: "Türkçe" };
  // the languages an article can be written in (the language pickers below)
  const LANGS = Object.keys(LANG_NAME);
  const TIERS = "N1 N2 N3 K1 K2 K3 M1 M2 M3 B1 B2 B3".split(" ");
  const COUNTRIES = ["MA", "DZ", "TN", "LY", "EG", "SD", "SA", "AE", "QA", "KW", "BH", "OM", "YE", "IQ", "SY", "LB", "JO", "PS", "MR", "TR", "FR", "DE", "ES", "GB", "US", "CA"];
  const COUNTRY_NAMES = {
    MA: { en: "Morocco", ar: "المغرب" }, DZ: { en: "Algeria", ar: "الجزائر" }, TN: { en: "Tunisia", ar: "تونس" },
    LY: { en: "Libya", ar: "ليبيا" }, EG: { en: "Egypt", ar: "مصر" }, SD: { en: "Sudan", ar: "السودان" },
    SA: { en: "Saudi Arabia", ar: "السعودية" }, AE: { en: "United Arab Emirates", ar: "الإمارات" }, QA: { en: "Qatar", ar: "قطر" },
    KW: { en: "Kuwait", ar: "الكويت" }, BH: { en: "Bahrain", ar: "البحرين" }, OM: { en: "Oman", ar: "عُمان" },
    YE: { en: "Yemen", ar: "اليمن" }, IQ: { en: "Iraq", ar: "العراق" }, SY: { en: "Syria", ar: "سوريا" },
    LB: { en: "Lebanon", ar: "لبنان" }, JO: { en: "Jordan", ar: "الأردن" }, PS: { en: "Palestine", ar: "فلسطين" },
    MR: { en: "Mauritania", ar: "موريتانيا" }, TR: { en: "Turkey", ar: "تركيا" }, FR: { en: "France", ar: "فرنسا" },
    DE: { en: "Germany", ar: "ألمانيا" }, ES: { en: "Spain", ar: "إسبانيا" }, GB: { en: "United Kingdom", ar: "المملكة المتحدة" },
    US: { en: "United States", ar: "الولايات المتحدة" }, CA: { en: "Canada", ar: "كندا" },
  };
  const countryLabel = (code) => L(COUNTRY_NAMES[code]) || code;

  /* ---------- sanitiser --------------------------------------------------- */
  const ALLOWED = new Set(["P", "BR", "H2", "H3", "H4", "B", "STRONG", "I", "EM", "U", "S", "BLOCKQUOTE", "UL", "OL", "LI", "A", "IMG", "VIDEO", "IFRAME", "SPAN", "DIV", "FIGURE", "FIGCAPTION", "HR"]);
  const ATTRS = {
    A: ["href", "title", "target", "rel"],
    IMG: ["src", "alt", "width", "height", "loading", "data-size", "data-align"],
    VIDEO: ["src", "controls", "poster", "width", "height", "data-size"],
    IFRAME: ["src", "allowfullscreen", "loading", "width", "height", "title"],
    "*": ["data-size", "data-align"],
  };
  const SAFE_URL = /^(https?:|mailto:|\/|#|data:image\/(png|jpe?g|gif|webp);base64,)/i;

  function sanitize(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, "text/html");
    const root = doc.getElementById("r");
    const walk = (node) => {
      [...node.children].forEach((el) => {
        const tag = el.tagName;
        if (!ALLOWED.has(tag)) {
          // keep the words, drop the element (script/style/object/embed… vanish)
          if (["SCRIPT", "STYLE", "OBJECT", "EMBED", "LINK", "META"].includes(tag)) return el.remove();
          const text = doc.createTextNode(el.textContent || "");
          el.replaceWith(text);
          return;
        }
        [...el.attributes].forEach((a) => {
          const name = a.name.toLowerCase();
          const ok = (ATTRS[tag] || []).includes(name) || ATTRS["*"].includes(name);
          if (!ok || name.startsWith("on")) return el.removeAttribute(a.name);
          if ((name === "src" || name === "href") && !SAFE_URL.test(a.value.trim())) return el.removeAttribute(a.name);
        });
        if (tag === "A") {
          el.setAttribute("rel", "noopener noreferrer nofollow");
          el.setAttribute("target", "_blank");
        }
        if (tag === "IFRAME" && !/^https:\/\/(www\.)?(youtube\.com|player\.vimeo\.com)\//.test(el.getAttribute("src") || ""))
          return el.remove();
        walk(el);
      });
    };
    walk(root);
    return root.innerHTML;
  }

  /* ---------- helpers ----------------------------------------------------- */
  async function whoami() {
    const s = session();
    if (!s?.member_id) return null;
    return { member_id: s.member_id, username: s.username || "" };
  }

  async function isStaff(me) {
    if (!me) return false;
    try {
      const res = await req(`/rest/v1/staff?member_id=eq.${encodeURIComponent(me.member_id)}&select=role`);
      return Boolean(res.ok && Array.isArray(res.data) && res.data.length);
    } catch {
      return false;
    }
  }

  const listOf = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
  const listStr = (a) => (Array.isArray(a) ? a.filter(Boolean).join(",") : "");
  const when = (iso) => String(iso || "").slice(0, 16).replace("T", " ");

  /* ---------- uploads (images) -------------------------------------------- */
  async function putImage(file, folder) {
    const max = 1600;
    const bmp = await createImageBitmap(file).catch(() => null);
    let blob = file;
    if (bmp) {
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      blob = (await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.86))) || file;
    }
    const path = `${folder}/${Date.now()}${Math.floor(Math.random() * 999)}.jpg`;
    const res = await fetch(
      `${C().SUPABASE_URL}/storage/v1/object/source/${path.split("/").map(encodeURIComponent).join("/")}`,
      {
        method: "POST",
        headers: {
          apikey: C().SUPABASE_KEY,
          Authorization: `Bearer ${C().SUPABASE_KEY}`,
          "Content-Type": "image/jpeg",
          "x-upsert": "true",
          "cache-control": "max-age=86400",
        },
        body: blob,
      }
    );
    if (!res.ok) return "";
    return `${C().SUPABASE_URL}/storage/v1/object/public/source/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  /* ---------- reader gate -------------------------------------------------- */
  function critOf(row) {
    const x = row?.excl || {};
    return {
      followers: Boolean(x.followers),
      countries: Array.isArray(x.countries) ? x.countries : listOf(x.countries),
      languages: Array.isArray(x.languages) ? x.languages : listOf(x.languages),
      lvMin: Number(x.lv_min ?? 0),
      lvMax: Number(x.lv_max ?? 10),
      tier: x.tier || "",
    };
  }

  // Whether this viewer may read the body. The owner and staff always can.
  function canRead(row, viewer, staff = false) {
    if (!row) return false;
    const future = row.publish_at && Date.parse(row.publish_at) > Date.now();
    if (row.status === "draft" || row.status === "pending" || future)
      return Boolean(viewer && viewer.member_id === row.member_id) || staff;
    if (viewer && viewer.member_id === row.member_id) return true;
    if (staff) return true;
    if (row.visibility === "public") return true;
    if (row.visibility === "private") {
      const users = listOf(row.private_users);
      return Boolean(viewer && users.includes(viewer.username));
    }
    // exclusive: every configured criterion has to match the viewer
    if (!viewer) return false;
    const c = critOf(row);
    const v = viewer.profile || {};
    if (c.followers && !viewer.follows) return false;
    if (c.countries.length && !c.countries.includes(v.country)) return false;
    if (c.languages.length && !c.languages.includes(v.language)) return false;
    const lv = Number(v.level ?? 0);
    if (lv < c.lvMin || lv > c.lvMax) return false;
    if (c.tier && TIERS.indexOf(v.tier) < TIERS.indexOf(c.tier)) return false;
    return true;
  }

  // Sanitised body for the public article page (community.js calls this).
  function bodyHtml(row) {
    if (!row) return "";
    if (row.body_html) return sanitize(row.body_html);
    return `<p>${esc(row.body || "")}</p>`;
  }

  /* ---------- the editor --------------------------------------------------- */
  function mount(root, opts = {}) {
    if (!root) return;
    const me = session();
    if (!me?.member_id)
      return (root.innerHTML = `<p class="ae-login-note">${esc(t("ae.needLogin"))} <a class="btn btn-sm btn-primary" href="./login.html">${esc(t("nav.signin"))}</a></p>`);
    state.me = { member_id: me.member_id, username: me.username || "" };
    state.root = root;
    state.editId = opts.id || new URLSearchParams(location.search).get("edit") || "";
    boot();
  }

  const state = { me: null, root: null, editId: "", sel: null, media: "", thumb: "", existing: null, pvRun: 0, reminded: false };

  function shell() {
    const themeIcon = document.documentElement.dataset.theme === "day" ? "☾" : "☀︎";
    return `
      <div class="ae-shell">
        <header class="ae-header">
          <div class="ae-header-inner">
            <div class="ae-logo" aria-label="CineAura">
              <span class="ae-logo-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
              <span class="ae-logo-word">Cine<span>Aura</span></span>
            </div>
            <span class="ae-state" id="ae-state">${esc(t("ae.draft"))}</span>
            <button class="btn btn-sm btn-ghost ae-theme" type="button" id="ae-theme" aria-label="${esc(t("set.theme"))}">${themeIcon}</button>
            <button class="btn btn-sm btn-ghost" type="button" id="ae-preview">${esc(t("ae.preview"))}</button>
            <button class="btn btn-sm btn-primary" type="button" id="ae-publish">${esc(t("ae.publish"))}</button>
          </div>
        </header>

        <div class="ae-layout">
          <section class="ae-card ae-main">
            <div class="ae-toolbar" id="ae-tb" role="toolbar" aria-label="${esc(t("ae.editorTools"))}"></div>
            <div class="ae-doc">
              <input id="ae-title" class="ae-title" type="text" maxlength="200" placeholder="${esc(t("ae.titlePh"))}" aria-label="${esc(t("ae.titlePh"))}" />
              <textarea id="ae-desc" class="ae-desc" rows="2" maxlength="400" placeholder="${esc(t("ae.descPh"))}" aria-label="${esc(t("ae.descPh"))}"></textarea>
              <div id="ae-body" class="ae-body" contenteditable="true" role="textbox" aria-multiline="true" data-ph="${esc(t("ae.bodyPh"))}"></div>
            </div>
          </section>

          <aside class="ae-side">
            <div class="ae-card ae-panel">
              <h3>${esc(t("ae.where"))}</h3>
              <label class="ae-check"><input type="checkbox" id="ae-in-content" checked /> ${esc(t("ae.inContent"))}</label>
              <div class="ae-sub show" id="ae-content-sub">
                <label class="ae-f" for="ae-field">${esc(t("ae.field"))}</label>
                <select id="ae-field"></select>
                <label class="ae-f" for="ae-niche">${esc(t("ae.niche"))}</label>
                <select id="ae-niche"></select>
                <label class="ae-f" for="ae-micro">${esc(t("ae.micro"))}</label>
                <input id="ae-micro" type="text" maxlength="80" placeholder="${esc(t("ae.optional"))}" />
                <label class="ae-f" for="ae-nano">${esc(t("ae.nano"))}</label>
                <input id="ae-nano" type="text" maxlength="80" disabled placeholder="${esc(t("ae.nanoHint"))}" />
              </div>
              <label class="ae-check ae-help-check"><input type="checkbox" id="ae-in-help" /> ${esc(t("ae.inHelp"))}</label>
              <p class="ae-hint">${esc(t("ae.helpNote"))}</p>
              <div class="ae-sub" id="ae-help-sub">
                <label class="ae-f">${esc(t("ae.helpSections"))}</label>
                <div id="ae-help-tree"></div>
                <p class="ae-hint">${esc(t("ae.helpSectionsHint"))}</p>
              </div>
            </div>

            <div class="ae-card ae-panel">
              <h3>${esc(t("ae.when"))}</h3>
              <div class="ae-seg" id="ae-when">
                <button type="button" class="on" data-v="now">${esc(t("ae.now"))}</button>
                <button type="button" data-v="later">${esc(t("ae.later"))}</button>
              </div>
              <div class="ae-sub" id="ae-when-sub">
                <label class="ae-f" for="ae-when-at">${esc(t("ae.date"))}</label>
                <input type="datetime-local" id="ae-when-at" />
              </div>
            </div>

            <div class="ae-card ae-panel">
              <h3>${esc(t("ae.vis"))}</h3>
              <div class="ae-seg three" id="ae-vis">
                <button type="button" class="on" data-v="public">${esc(t("ae.vis.public"))}</button>
                <button type="button" data-v="exclusive">${esc(t("ae.vis.exclusive"))}</button>
                <button type="button" data-v="private">${esc(t("ae.vis.private"))}</button>
              </div>
              <p class="ae-hint" id="ae-vis-hint">${esc(t("ae.vis.publicHint"))}</p>
              <div class="ae-sub" id="ae-excl">
                <label class="ae-check"><input type="checkbox" id="ae-fol" /> ${esc(t("ae.followersOnly"))}</label>
                <label class="ae-f" for="ae-country">${esc(t("ae.country"))}</label>
                <select id="ae-country"></select><div class="ae-chips" id="ae-country-chips"></div>
                <label class="ae-f" for="ae-lang">${esc(t("ae.language"))}</label>
                <select id="ae-lang"></select><div class="ae-chips" id="ae-lang-chips"></div>
                <label class="ae-f">${esc(t("ae.level"))}</label>
                <div class="ae-row"><input type="number" id="ae-lvmin" min="0" max="10" value="0" aria-label="${esc(t("ae.lvMin"))}" /><input type="number" id="ae-lvmax" min="0" max="10" value="10" aria-label="${esc(t("ae.lvMax"))}" /></div>
                <label class="ae-f" for="ae-tier">${esc(t("ae.tier"))}</label>
                <select id="ae-tier"></select>
              </div>
              <div class="ae-sub" id="ae-priv">
                <label class="ae-f" for="ae-user">${esc(t("ae.addUser"))}</label>
                <div class="ae-row"><input id="ae-user" type="text" placeholder="@username" dir="ltr" /><button class="btn btn-sm ae-quiet-btn" type="button" id="ae-user-add">${esc(t("ae.add"))}</button></div>
                <div class="ae-chips" id="ae-user-chips"></div>
                <p class="ae-hint">${esc(t("ae.privateGateText"))}</p>
                <label class="ae-f" for="ae-pass">${esc(t("ae.passwords"))}</label>
                <div class="ae-row"><input id="ae-pass" type="text" dir="ltr" autocomplete="off" placeholder="${esc(t("ae.joinPass"))}" /><button class="btn btn-sm ae-quiet-btn" type="button" id="ae-pass-add">${esc(t("ae.add"))}</button></div>
                <div class="ae-mini"><button class="btn btn-sm ae-quiet-btn" type="button" id="ae-pass-gen">${esc(t("ae.genPass"))}</button></div>
                <div class="ae-chips" id="ae-pass-chips"></div>
                <p class="ae-hint">${esc(t("ae.passHint"))}</p>
              </div>
            </div>

            <div class="ae-card ae-panel">
              <h3>${esc(t("ae.details"))}</h3>
              <label class="ae-f" for="ae-language">${esc(t("ae.articleLang"))}</label>
              <select id="ae-language"></select>
              <label class="ae-f" for="ae-cat">${esc(t("ae.categories"))}</label>
              <input id="ae-cat" type="text" maxlength="40" placeholder="${esc(t("ae.catPh"))}" />
              <div class="ae-chips" id="ae-cat-chips"></div>
            </div>

            <div class="ae-card ae-panel">
              <h3>${esc(t("ae.thumb"))}</h3>
              <div class="ae-thumb" id="ae-thumb">${esc(t("ae.noThumb"))}</div>
              <div class="ae-mini">
                <button class="btn btn-sm ae-quiet-btn" type="button" id="ae-th-up">${esc(t("ae.upload"))}</button>
                <button class="btn btn-sm ae-quiet-btn" type="button" id="ae-th-url">${esc(t("ae.url"))}</button>
                <button class="btn btn-sm ae-quiet-btn" type="button" id="ae-th-auto">${esc(t("ae.fromBody"))}</button>
                <button class="btn btn-sm btn-danger" type="button" id="ae-th-del">${esc(t("ae.remove"))}</button>
              </div>
              <input type="file" id="ae-th-file" accept="image/*" hidden />
            </div>
          </aside>
        </div>

        <dialog id="ae-dlg" class="ae-dialog">
          <h3 id="ae-dlg-title"></h3>
          <label class="ae-f" for="ae-dlg-url">${esc(t("ae.mediaUrl"))}</label>
          <input id="ae-dlg-url" type="url" dir="ltr" placeholder="https://" />
          <p class="ae-hint" id="ae-dlg-hint"></p>
          <div class="ae-dlg-act">
            <button class="btn btn-sm btn-primary" type="button" id="ae-dlg-ok">${esc(t("ae.insert"))}</button>
            <button class="btn btn-sm btn-ghost" type="button" id="ae-dlg-file">${esc(t("ae.uploadFile"))}</button>
            <button class="btn btn-sm btn-ghost" type="button" id="ae-dlg-no">${esc(t("common.cancel"))}</button>
          </div>
          <input type="file" id="ae-dlg-input" hidden />
        </dialog>

        <dialog id="ae-pv" class="ae-dialog ae-pv">
          <div class="ae-pv-bar"><strong>${esc(t("ae.preview"))}</strong><button class="btn btn-sm btn-ghost" type="button" id="ae-pv-close">${esc(t("common.close"))}</button></div>
          <div class="ae-sim" id="ae-sim">
            <label>${esc(t("ae.sim.name"))}<input type="text" id="ae-s-user" value="@sara" dir="ltr" /></label>
            <label>${esc(t("ae.sim.country"))}<select id="ae-s-country"></select></label>
            <label>${esc(t("ae.sim.lang"))}<select id="ae-s-lang"></select></label>
            <label>${esc(t("ae.sim.lv"))}<input type="number" id="ae-s-lv" min="0" max="10" value="3" /></label>
            <label>${esc(t("ae.sim.tier"))}<select id="ae-s-tier"></select></label>
            <label>${esc(t("ae.sim.follows"))}<select id="ae-s-fol"><option value="1">${esc(t("ae.yes"))}</option><option value="0">${esc(t("ae.no"))}</option></select></label>
          </div>
          <div class="ae-read" id="ae-read"></div>
        </dialog>
      </div>`;
  }

  async function boot() {
    const root = state.root;
    root.innerHTML = shell();
    const $ = (id) => root.querySelector(`#${id}`);
    state.$ = $;
    state.data = {
      when: "now",
      vis: "public",
      countries: [],
      languages: [],
      users: [],
      passes: [],
      cats: [],
      helpSections: [],
      inContent: true,
      inHelp: false,
    };

    buildToolbar($("ae-tb"));
    buildSelects($);
    state.staff = await isStaff(state.me);
    state.me.staff = state.staff;
    syncPublishLabel();

    // load an existing article (member edit, or staff editing any article)
    if (state.editId) {
      let res = null;
      try {
        res = await req(`/rest/v1/community_articles?id=eq.${encodeURIComponent(state.editId)}&select=*`);
      } catch {
        /* keep the new-article shell usable if the network is temporarily down */
      }
      const row = res?.ok && Array.isArray(res.data) ? res.data[0] : null;
      if (row) {
        state.existing = row;
        $("ae-title").value = row.title || "";
        $("ae-desc").value = row.description || "";
        $("ae-body").innerHTML = sanitize(row.body_html || (row.body ? `<p>${esc(row.body)}</p>` : ""));
        state.thumb = row.thumb || "";
        state.data.cats = listOf(row.categories || row.tags);
        state.data.users = listOf(row.private_users);
        state.data.passes = listOf(row.private_passwords);
        state.data.helpSections = listOf(row.help_sections);

        const places = String(row.places || "content");
        state.data.inContent = places === "both" || places.includes("content") || !places.includes("help");
        state.data.inHelp = places === "both" || places.includes("help");
        $("ae-in-content").checked = state.data.inContent;
        $("ae-content-sub").classList.toggle("show", state.data.inContent);
        $("ae-in-help").checked = state.data.inHelp;
        $("ae-help-sub").classList.toggle("show", state.data.inHelp);

        if (LANGS.includes(row.language)) $("ae-language").value = row.language;
        const c = critOf(row);
        state.data.countries = c.countries.slice();
        state.data.languages = c.languages.slice();
        $("ae-fol").checked = c.followers;
        $("ae-lvmin").value = c.lvMin;
        $("ae-lvmax").value = c.lvMax;
        $("ae-tier").value = c.tier;
        setVis(["public", "exclusive", "private"].includes(row.visibility) ? row.visibility : "public");

        const fieldKey = Object.prototype.hasOwnProperty.call(CONTENT, row.content_field) ? row.content_field : "";
        if (fieldKey) {
          $("ae-field").value = fieldKey;
          $("ae-field").dispatchEvent(new Event("change"));
          const savedNiche = (NICHES[fieldKey] || []).find((n) => n.en === row.content_niche || n.ar === row.content_niche);
          if (savedNiche) $("ae-niche").value = L(savedNiche);
        }
        $("ae-micro").value = row.content_micro || "";
        $("ae-nano").value = row.content_nano || "";
        $("ae-nano").disabled = !$("ae-micro").value.trim();

        const selectedHelp = new Set(
          Object.values(HELP_SUBS)
            .flat()
            .filter((item) => state.data.helpSections.includes(item.en) || state.data.helpSections.includes(item.ar))
            .map((item) => L(item))
        );
        root.querySelectorAll("#ae-help-tree input").forEach((input) => {
          input.checked = selectedHelp.has(input.value) || state.data.helpSections.includes(input.value);
        });

        const publishAt = Date.parse(row.publish_at || "");
        if (Number.isFinite(publishAt) && publishAt > Date.now()) {
          setWhen("later");
          const local = new Date(publishAt - new Date(publishAt).getTimezoneOffset() * 60000);
          $("ae-when-at").value = local.toISOString().slice(0, 16);
        }
        syncThumb();
      }
    }

    wire($);
    if (state.data.inHelp) setHelpMode(true);
    paintChips($);
    updateState();
  }

  /* ---------- toolbar ------------------------------------------------------ */
  const ICON = (p) => `<svg viewBox="0 0 24 24">${p}</svg>`;
  const TOOLS = [
    [["bold", "<b>B</b>", "ae.t.bold"], ["italic", "<i>I</i>", "ae.t.italic"], ["underline", "<u>U</u>", "ae.t.underline"], ["strikeThrough", "<s>S</s>", "ae.t.strike"]],
    [["h2", "H2", "ae.t.h2"], ["h3", "H3", "ae.t.h3"], ["p", "¶", "ae.t.p"], ["blockquote", ICON('<path d="M7 7h4v5H7zM13 7h4v5h-4z"/>'), "ae.t.quote"]],
    [["insertUnorderedList", ICON('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'), "ae.t.ul"], ["insertOrderedList", "1.", "ae.t.ol"]],
    [["justifyRight", ICON('<path d="M3 6h18M9 12h12M3 18h18"/>'), "ae.t.right"], ["justifyCenter", ICON('<path d="M3 6h18M7 12h10M3 18h18"/>'), "ae.t.center"], ["justifyLeft", ICON('<path d="M3 6h18M3 12h12M3 18h18"/>'), "ae.t.left"]],
    [["link", ICON('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'), "ae.t.link"], ["removeFormat", "✕", "ae.t.clear"], ["undo", "↶", "ae.t.undo"], ["redo", "↷", "ae.t.redo"]],
    [["image", ICON('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'), "ae.t.image"], ["video", ICON('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9l5 3-5 3z"/>'), "ae.t.video"]],
  ];

  function buildToolbar(box) {
    TOOLS.forEach((group) => {
      const g = document.createElement("div");
      g.className = "ae-grp";
      group.forEach(([cmd, html, label]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ae-tb" + (cmd === "image" || cmd === "video" ? " wide" : "");
        b.innerHTML = html;
        b.title = t(label);
        b.setAttribute("aria-label", t(label));
        b.onmousedown = (e) => e.preventDefault();
        b.onclick = () => runCmd(cmd);
        g.appendChild(b);
      });
      box.appendChild(g);
    });
  }

  function buildSelects($) {
    const root = state.root;
    const field = root.querySelector("#ae-field");
    field.innerHTML = Object.keys(CONTENT).map((k) => `<option value="${k}">${esc(L(CONTENT[k]))}</option>`).join("");
    const niches = () => {
      const list = NICHES[root.querySelector("#ae-field").value] || [];
      root.querySelector("#ae-niche").innerHTML = list.map((x) => `<option value="${esc(L(x))}">${esc(L(x))}</option>`).join("");
    };
    niches();
    field.onchange = niches;
    root.querySelector("#ae-country").innerHTML = `<option value="">${esc(t("ae.add"))}</option>` +
      COUNTRIES.map((code) => `<option value="${esc(code)}">${esc(countryLabel(code))}</option>`).join("");
    root.querySelector("#ae-lang").innerHTML = `<option value="">${esc(t("ae.add"))}</option>` +
      LANGS.map((code) => `<option value="${esc(code)}">${esc(LANG_NAME[code])}</option>`).join("");
    root.querySelector("#ae-language").innerHTML = LANGS.map((l) => `<option value="${esc(l)}">${esc(LANG_NAME[l])}</option>`).join("");
    root.querySelector("#ae-tier").innerHTML = `<option value="">${esc(t("ae.noTier"))}</option>` + TIERS.map((x) => `<option value="${x}">${x}</option>`).join("");
    // the preview's reader simulator speaks the same vocabulary
    const simC = root.querySelector("#ae-s-country");
    const simL = root.querySelector("#ae-s-lang");
    if (simC) simC.innerHTML = `<option value="">${esc(t("ae.sim.none"))}</option>` + COUNTRIES.map((c) => `<option value="${esc(c)}">${esc(countryLabel(c))}</option>`).join("");
    if (simL) simL.innerHTML = `<option value="">${esc(t("ae.sim.none"))}</option>` + LANGS.map((l) => `<option value="${l}">${esc(LANG_NAME[l])}</option>`).join("");
    const simT = root.querySelector("#ae-s-tier");
    if (simT) simT.innerHTML = `<option value="">${esc(t("ae.noTier"))}</option>` + TIERS.map((x) => `<option value="${x}">${x}</option>`).join("");
    root.querySelector("#ae-help-tree").innerHTML = Object.keys(HELP)
      .map(
        (sec) =>
          `<div class="ae-hsec"><b>${esc(L(HELP[sec]))}</b>${(HELP_SUBS[sec] || [])
            .map((x) => `<label class="ae-check"><input type="checkbox" value="${esc(L(x))}"> ${esc(L(x))}</label>`)
            .join("")}</div>`
      )
      .join("");
  }

  /* ---------- commands ----------------------------------------------------- */
  function restore() {
    const body = state.root.querySelector("#ae-body");
    body.focus();
    if (state.sel) {
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(state.sel);
    }
  }
  function runCmd(cmd) {
    if (cmd === "image" || cmd === "video") return openMedia(cmd);
    restore();
    if (cmd === "h2" || cmd === "h3" || cmd === "p" || cmd === "blockquote") document.execCommand("formatBlock", false, cmd);
    else if (cmd === "link") {
      const u = prompt(t("ae.linkAsk"), "https://");
      if (u && SAFE_URL.test(u)) document.execCommand("createLink", false, u);
    } else document.execCommand(cmd);
  }
  function insertHtml(html) {
    restore();
    document.execCommand("insertHTML", false, html + "<p><br></p>");
  }
  function videoHtml(url) {
    let m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
    if (m) return `<iframe src="https://www.youtube.com/embed/${m[1]}" loading="lazy" allowfullscreen></iframe>`;
    m = url.match(/vimeo\.com\/(\d+)/);
    if (m) return `<iframe src="https://player.vimeo.com/video/${m[1]}" loading="lazy" allowfullscreen></iframe>`;
    return `<video src="${esc(url)}" controls></video>`;
  }

  // <dialog>.showModal() is missing in older Safari/WebViews: fall back to the
  // open attribute instead of throwing inside the click handler (the editor
  // used to die silently on those browsers).
  function openDialog(dlg) {
    if (!dlg) return;
    if (typeof dlg.showModal === "function") {
      try {
        dlg.showModal();
        return;
      } catch {
        /* fall through */
      }
    }
    dlg.setAttribute("open", "");
  }
  function closeDialog(dlg) {
    if (!dlg) return;
    if (typeof dlg.close === "function") {
      try {
        dlg.close();
        return;
      } catch {
        /* fall through */
      }
    }
    dlg.removeAttribute("open");
  }

  function openMedia(kind) {
    const root = state.root;
    state.media = kind;
    root.querySelector("#ae-dlg-title").textContent = kind === "image" ? t("ae.addImage") : t("ae.addVideo");
    root.querySelector("#ae-dlg-hint").textContent = kind === "image" ? t("ae.imageHint") : t("ae.videoHint");
    root.querySelector("#ae-dlg-input").accept = kind + "/*";
    root.querySelector("#ae-dlg-url").value = "";
    openDialog(root.querySelector("#ae-dlg"));
  }

  /* ---------- chips -------------------------------------------------------- */
  function paintChips($) {
    const chip = (arr, host, after) => {
      host.innerHTML = arr
        .map((v, i) => `<span class="ae-chip">${esc(v)}<button type="button" data-chip="${i}" aria-label="${esc(t("ae.remove"))}">×</button></span>`)
        .join("");
      host.querySelectorAll("[data-chip]").forEach(
        (b) =>
          (b.onclick = () => {
            arr.splice(Number(b.dataset.chip), 1);
            paintChips($);
            after?.();
          })
      );
    };
    chip(state.data.countries, $("ae-country-chips"));
    chip(state.data.languages, $("ae-lang-chips"));
    chip(state.data.users, $("ae-user-chips"));
    chip(state.data.passes, $("ae-pass-chips"));
    chip(state.data.cats, $("ae-cat-chips"));
  }

  /* ---------- state helpers ------------------------------------------------ */
  function setWhen(v) {
    const $ = state.$;
    state.data.when = v;
    $("ae-when").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    $("ae-when-sub").classList.toggle("show", v === "later");
    updateState();
  }
  function setVis(v) {
    const $ = state.$;
    state.data.vis = v;
    $("ae-vis").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    $("ae-excl").classList.toggle("show", v === "exclusive");
    $("ae-priv").classList.toggle("show", v === "private");
    $("ae-vis-hint").textContent = t(`ae.vis.${v}Hint`);
  }
  function syncThumb() {
    const el = state.root.querySelector("#ae-thumb");
    if (!el) return;
    el.style.backgroundImage = state.thumb ? `url("${state.thumb}")` : "";
    el.classList.toggle("has", Boolean(state.thumb));
    el.textContent = state.thumb ? "" : t("ae.noThumb");
  }
  function updateState() {
    const el = state.root?.querySelector("#ae-state");
    if (!el) return;
    const d = state.data;
    const parts = [];
    if (d.when === "later") parts.push(t("ae.scheduled"));
    if (d.inHelp) parts.push(state.me.staff ? t("ae.inHelp") : t("ae.pending"));
    el.textContent = parts.length ? parts.join(" · ") : t("ae.draft");
  }

  function setHelpMode(enabled) {
    const $ = state.$;
    state.data.inHelp = Boolean(enabled);
    $("ae-in-help").checked = state.data.inHelp;
    $("ae-help-sub").classList.toggle("show", state.data.inHelp);
    const buttons = $("ae-vis").querySelectorAll("button");
    if (state.data.inHelp) {
      // Help articles are always public; members' submissions wait for review.
      setVis("public");
      buttons.forEach((b) => {
        b.disabled = true;
        b.style.opacity = b.dataset.v === "public" ? "1" : ".45";
      });
      $("ae-vis-hint").textContent = t("ae.helpPublic");
    } else {
      buttons.forEach((b) => {
        b.disabled = false;
        b.style.opacity = "";
      });
      $("ae-vis-hint").textContent = t(`ae.vis.${state.data.vis}Hint`);
    }
    updateState();
    syncPublishLabel();
  }

  /* ---------- wiring ------------------------------------------------------- */
  function wire($) {
    const root = state.root;
    const body = $("ae-body");
    document.addEventListener("selectionchange", () => {
      const s = getSelection();
      if (s.rangeCount && body.contains(s.anchorNode)) state.sel = s.getRangeAt(0).cloneRange();
    });

    // segments
    $("ae-when").querySelectorAll("button").forEach((b) => (b.onclick = () => setWhen(b.dataset.v)));
    $("ae-vis").querySelectorAll("button").forEach((b) => (b.onclick = () => setVis(b.dataset.v)));

    const themeButton = $("ae-theme");
    const syncThemeButton = () => {
      const isDay = document.documentElement.dataset.theme === "day";
      themeButton.textContent = isDay ? "☾" : "☀︎";
      themeButton.setAttribute("aria-label", t("set.theme"));
      themeButton.title = isDay ? "Switch to night mode" : "Switch to day mode";
    };
    themeButton.onclick = () => {
      const theme = document.documentElement.dataset.theme === "day" ? "night" : "day";
      C().applyPrefs?.({ theme, persist: true });
      syncThemeButton();
    };
    document.addEventListener("cineaura:prefs", syncThemeButton);
    syncThemeButton();

    $("ae-in-content").onchange = (e) => {
      state.data.inContent = e.target.checked;
      $("ae-content-sub").classList.toggle("show", e.target.checked);
      syncPublishLabel();
    };
    $("ae-in-help").onchange = (e) => setHelpMode(e.target.checked);

    $("ae-micro").oninput = (e) => {
      const nano = $("ae-nano");
      nano.disabled = !e.target.value.trim();
      if (nano.disabled) nano.value = "";
    };

    $("ae-country").onchange = (e) => {
      const v = e.target.value;
      if (v && !state.data.countries.includes(v)) state.data.countries.push(v);
      e.target.value = "";
      paintChips($);
    };
    $("ae-lang").onchange = (e) => {
      const v = e.target.value;
      if (v && !state.data.languages.includes(v)) state.data.languages.push(v);
      e.target.value = "";
      paintChips($);
    };
    const addUser = () => {
      const v = $("ae-user").value.trim().replace(/^@?/, "@");
      if (v.length > 1 && !state.data.users.includes(v)) state.data.users.push(v);
      $("ae-user").value = "";
      paintChips($);
    };
    $("ae-user-add").onclick = addUser;
    $("ae-user").onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addUser();
      }
    };
    const addPass = (given) => {
      const v = (given || $("ae-pass").value).trim();
      if (v && !state.data.passes.includes(v)) state.data.passes.push(v);
      $("ae-pass").value = "";
      paintChips($);
    };
    $("ae-pass-add").onclick = () => addPass();
    $("ae-pass").onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addPass();
      }
    };
    $("ae-pass-gen").onclick = () => {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const raw = Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => chars[x % chars.length]).join("");
      addPass(raw.replace(/(.{4})/, "$1-"));
    };
    $("ae-cat").onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const v = e.target.value.trim();
        if (v && !state.data.cats.includes(v)) state.data.cats.push(v);
        e.target.value = "";
        paintChips($);
      }
    };

    // media dialog
    $("ae-dlg-ok").onclick = () => {
      const u = $("ae-dlg-url").value.trim();
      if (!SAFE_URL.test(u)) return C().toast(t("ae.badUrl"));
      closeDialog($("ae-dlg"));
      insertHtml(state.media === "image" ? `<img src="${esc(u)}" alt="">` : videoHtml(u));
      if (state.media === "image" && !state.thumb) {
        state.thumb = u;
        syncThumb();
      }
    };
    $("ae-dlg-no").onclick = () => closeDialog($("ae-dlg"));
    $("ae-dlg-file").onclick = () => $("ae-dlg-input").click();
    $("ae-dlg-input").onchange = async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      closeDialog($("ae-dlg"));
      if (state.media === "video") return insertHtml(videoHtml(URL.createObjectURL(f)));
      C().toast(t("ae.uploading"));
      const url = await putImage(f, `Articles/${state.me.member_id}`);
      if (!url) return C().toast(t("ae.uploadFail"));
      insertHtml(`<img src="${esc(url)}" alt="">`);
      if (!state.thumb) {
        state.thumb = url;
        syncThumb();
      }
    };

    // thumbnail
    $("ae-th-up").onclick = () => $("ae-th-file").click();
    $("ae-th-file").onchange = async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      const url = await putImage(f, `Articles/${state.me.member_id}`);
      if (!url) return C().toast(t("ae.uploadFail"));
      state.thumb = url;
      syncThumb();
    };
    $("ae-th-url").onclick = () => {
      const u = prompt(t("ae.mediaUrl"), "https://");
      if (u && SAFE_URL.test(u)) {
        state.thumb = u;
        syncThumb();
      }
    };
    $("ae-th-auto").onclick = () => {
      const img = body.querySelector("img");
      if (!img) return C().toast(t("ae.noImage"));
      state.thumb = img.getAttribute("src");
      syncThumb();
    };
    $("ae-th-del").onclick = () => {
      state.thumb = "";
      syncThumb();
    };

    $("ae-preview").onclick = () => {
      renderPreview();
      openDialog(root.querySelector("#ae-pv"));
    };
    // the simulator answers as the author types
    const sim = root.querySelector("#ae-sim");
    if (sim) {
      sim.addEventListener("input", () => renderPreview());
      sim.addEventListener("change", () => renderPreview());
    }
    $("ae-pv-close").onclick = () => closeDialog(root.querySelector("#ae-pv"));

    $("ae-publish").onclick = () => save();

    // image size / alignment on click
    body.addEventListener("click", (e) => {
      if (/^(IMG|VIDEO|IFRAME)$/.test(e.target.tagName)) showImgBar(e.target);
      else hideImgBar();
    });
    body.addEventListener("keydown", hideImgBar);
    document.addEventListener("mousedown", (e) => {
      const bar = root.querySelector("#ae-imgbar");
      if (state.cur && !bar?.contains(e.target) && !body.contains(e.target)) hideImgBar();
    });
    window.addEventListener("scroll", placeImgBar, { passive: true });
    window.addEventListener("resize", placeImgBar);
  }

  /* ---------- floating media bar ------------------------------------------ */
  const SIZES = [["o", "ae.sz.o"], ["s", "ae.sz.s"], ["m", "ae.sz.m"], ["l", "ae.sz.l"], ["xl", "ae.sz.xl"]];
  function showImgBar(el) {
    const root = state.root;
    let bar = root.querySelector("#ae-imgbar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "ae-imgbar";
      (root.querySelector(".ae-shell") || root).appendChild(bar);
      bar.onmousedown = (e) => e.preventDefault();
      bar.onclick = (e) => {
        const b = e.target.closest("button");
        if (!b || !state.cur) return;
        if (b.dataset.sz) state.cur.dataset.size = b.dataset.sz;
        else if (b.dataset.al) state.cur.dataset.align = b.dataset.al;
        else if (b.dataset.del) {
          state.cur.remove();
          hideImgBar();
          return;
        }
        syncImgBar();
      };
    }
    state.cur?.removeAttribute("data-sel");
    state.cur = el;
    el.setAttribute("data-sel", "1");
    bar.innerHTML =
      SIZES.map(([v, k]) => `<button type="button" data-sz="${v}">${esc(t(k))}</button>`).join("") +
      "<i></i>" +
      ['right', 'center', 'left'].map((a) => `<button type="button" data-al="${a}" title="${esc(t("ae.al." + a))}">${esc(t("ae.al." + a))}</button>`).join("") +
      `<i></i><button type="button" data-del="1" title="${esc(t("ae.remove"))}">✕</button>`;
    bar.classList.toggle("vid", el.tagName !== "IMG");
    bar.classList.add("on");
    syncImgBar();
    placeImgBar();
  }
  function placeImgBar() {
    const bar = state.root?.querySelector("#ae-imgbar");
    if (!bar || !state.cur || !bar.classList.contains("on")) return;
    const rect = state.cur.getBoundingClientRect();
    const height = bar.offsetHeight || 40;
    const width = bar.offsetWidth;
    let top = rect.top - height - 8;
    if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - height - 8);
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
    bar.style.top = `${Math.max(8, top)}px`;
    bar.style.left = `${left}px`;
  }
  function hideImgBar() {
    state.cur?.removeAttribute("data-sel");
    state.cur = null;
    state.root.querySelector("#ae-imgbar")?.classList.remove("on");
  }
  // Help-only from a member waits for the moderators, so the button says so.
  function syncPublishLabel() {
    const $ = state.$;
    const btn = $("ae-publish");
    if (!btn) return;
    const helpOnly = state.data.inHelp && !state.data.inContent && !state.staff;
    btn.textContent = helpOnly ? t("ae.sendReview") : t("ae.publish");
    btn.dataset.helpOnly = helpOnly ? "1" : "";
  }

  function syncImgBar() {
    const bar = state.root.querySelector("#ae-imgbar");
    if (!bar || !state.cur) return;
    const size = state.cur.dataset.size || (state.cur.tagName === "IMG" ? "o" : "xl");
    const align = state.cur.dataset.align || "center";
    bar.querySelectorAll("[data-sz]").forEach((b) => b.classList.toggle("on", b.dataset.sz === size));
    bar.querySelectorAll("[data-al]").forEach((b) => b.classList.toggle("on", b.dataset.al === align));
  }

  /* ---------- reader html (preview + the public page) ---------------------- */
  const TIER_AT = (tier) => (tier ? TIERS.indexOf(tier) : -1);

  // The viewer sitting in the preview dialog (never authenticated: it is a
  // simulator, so nothing here is a permission check).
  function simViewer() {
    const $ = state.$;
    const user = ($("ae-s-user").value || "").trim().replace(/^@?/, "@");
    return {
      username: user,
      country: $("ae-s-country").value,
      language: $("ae-s-lang").value,
      level: Number($("ae-s-lv").value || 0),
      tier: $("ae-s-tier").value,
      follows: $("ae-s-fol").value === "1",
    };
  }

  // The criteria the author actually set, as [label, met, required-text] rows.
  function simChecks(v) {
    const $ = state.$;
    const d = state.data;
    const rows = [];
    if ($("ae-fol").checked) rows.push([t("ae.sim.followers"), v.follows, t("ae.followersOnly")]);
    if (d.countries.length) rows.push([t("ae.country"), d.countries.includes(v.country), d.countries.map(countryLabel).join(" · ")]);
    if (d.languages.length) rows.push([t("ae.language"), d.languages.includes(v.language), d.languages.map((l) => LANG_NAME[l] || l).join(" · ")]);
    const a = Number($("ae-lvmin").value || 0);
    const b = Number($("ae-lvmax").value || 10);
    if (a > 0 || b < 10) rows.push([t("ae.sim.lv"), v.level >= a && v.level <= b, `${a} – ${b}`]);
    if ($("ae-tier").value) rows.push([t("ae.tier"), TIER_AT(v.tier) >= TIER_AT($("ae-tier").value), `${$("ae-tier").value}+`]);
    return rows;
  }

  function simArticle() {
    const $ = state.$;
    const title = $("ae-title").value.trim() || t("ae.untitled");
    const desc = $("ae-desc").value.trim();
    const when = state.data.when === "later" && $("ae-when-at").value
      ? new Date($("ae-when-at").value).toLocaleString()
      : t("ae.now");
    const body = sanitize(state.root.querySelector("#ae-body").innerHTML) || `<p class="ae-hint">${esc(t("ae.sim.noContent"))}</p>`;
    const cover = state.thumb ? `<img class="ae-cover" src="${esc(state.thumb)}" alt="" />` : "";
    const chips = state.data.cats.map((c) => `<span class="ae-chip">${esc(c)}</span>`).join("");
    return {
      head: `${cover}<h1>${esc(title)}</h1>
        <div class="ae-meta"><span>${esc(LANG_NAME[$("ae-language").value] || $("ae-language").value)}</span><span>${esc(when)}</span>${chips}</div>
        ${desc ? `<p class="ae-lead">${esc(desc)}</p>` : ""}`,
      body,
    };
  }

  const CHECK_OK = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CHECK_NO = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

  /* The preview: public shows the page, private asks for a password, exclusive
     runs the same checks the reader page runs — step by step, so the author can
     see exactly which criterion keeps a reader out. */
  function renderPreview() {
    const $ = state.$;
    const out = state.root.querySelector("#ae-read");
    if (!out) return;
    const run = ++state.pvRun;
    const v = simViewer();
    const d = state.data;
    const { head, body } = simArticle();

    if (d.vis === "public") {
      out.innerHTML = head + body;
      return;
    }

    if (d.vis === "private") {
      if (v.username && d.users.includes(v.username)) {
        out.innerHTML = head + body;
        return;
      }
      const gate = `<div class="ae-gate">
        <h2>${esc(t("ae.privateGate"))}</h2>
        <p class="ae-hint">${esc(t("ae.privateGateText"))}</p>
        ${d.passes.length
          ? `<div class="ae-row"><input type="text" id="ae-g-pass" dir="ltr" placeholder="${esc(t("ae.joinPass"))}" autocomplete="off" /><button class="btn btn-sm btn-primary" type="button" id="ae-g-join">${esc(t("ae.join"))}</button></div>
             <p class="ae-hint" id="ae-g-err" role="status"></p>`
          : ""}
      </div>`;
      out.innerHTML = head + gate;
      const join = $("ae-g-join");
      if (!join) return;
      const go = () => {
        const pass = $("ae-g-pass").value.trim();
        if (!pass || !d.passes.includes(pass)) {
          $("ae-g-err").textContent = t("ae.wrongPass");
          return;
        }
        // a reader who enters a password joins the list the author is building
        if (!d.users.includes(v.username)) {
          d.users.push(v.username);
          renderPreview();
        }
      };
      join.onclick = go;
      $("ae-g-pass").onkeydown = (e) => {
        if (e.key === "Enter") go();
      };
      return;
    }

    // exclusive
    const checks = simChecks(v);
    if (!checks.length) {
      out.innerHTML = head + body;
      return;
    }
    out.innerHTML = head + `<div class="ae-gate">
      <h2>${esc(t("ae.exclusiveGate"))}</h2>
      <p class="ae-hint" id="ae-v-msg">${esc(t("ae.chk.intro"))}</p>
      <ul class="ae-checks">${checks
        .map(
          (c, i) => `<li id="ae-ck-${i}" class="ae-check-row"><span class="ae-mk"><i class="ae-spin"></i></span>
            <span class="ae-tx"><b>${esc(t("ae.chk.checking", { what: c[0] }))}</b><small>${esc(t("ae.chk.required", { what: c[2] }))}</small></span>
            <em class="ae-st">…</em></li>`
        )
        .join("")}</ul>
      <div id="ae-v-end"></div>
    </div>`;

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      let ok = true;
      for (let i = 0; i < checks.length; i += 1) {
        await wait(520);
        if (run !== state.pvRun) return;
        const li = state.root.querySelector(`#ae-ck-${i}`);
        if (!li) return;
        const met = checks[i][1];
        ok = ok && met;
        li.classList.toggle("ok", met);
        li.classList.toggle("no", !met);
        li.querySelector(".ae-mk").innerHTML = met ? CHECK_OK : CHECK_NO;
        li.querySelector(".ae-tx b").textContent = met ? t("ae.chk.ok", { what: checks[i][0] }) : t("ae.chk.fail", { what: checks[i][0] });
        li.querySelector(".ae-st").textContent = met ? t("ae.chk.match") : t("ae.chk.no");
      }
      await wait(420);
      if (run !== state.pvRun) return;
      const msg = state.root.querySelector("#ae-v-msg");
      if (ok) {
        if (msg) msg.textContent = t("ae.chk.all");
        await wait(700);
        if (run !== state.pvRun) return;
        out.innerHTML = head + body;
        return;
      }
      if (msg) msg.textContent = t("ae.chk.failLead");
      const end = state.root.querySelector("#ae-v-end");
      if (end) {
        end.innerHTML = `<button class="btn btn-sm btn-primary" type="button" id="ae-remind">${esc(t("ae.remind"))}</button>`;
        const btn = state.root.querySelector("#ae-remind");
        btn.onclick = () => {
          state.reminded = !state.reminded;
          btn.textContent = state.reminded ? t("ae.reminded") : t("ae.remind");
          C().toast(state.reminded ? t("ae.remindOn") : t("ae.remindOff"));
        };
      }
    })();
  }

  function readerHtml(row) {
    const $ = state.$;
    const root = state.root;
    if (row) return bodyHtml(row);
    const title = $("ae-title").value.trim() || t("ae.untitled");
    const desc = $("ae-desc").value.trim();
    const html = sanitize(root.querySelector("#ae-body").innerHTML);
    return `<h1>${esc(title)}</h1>${desc ? `<p class="ae-lead">${esc(desc)}</p>` : ""}${html || `<p class="ae-hint">${esc(t("ae.emptyBody"))}</p>`}`;
  }

  /* ---------- save --------------------------------------------------------- */
  async function save() {
    const $ = state.$;
    const root = state.root;
    const title = $("ae-title").value.trim();
    const body = root.querySelector("#ae-body");
    const html = sanitize(body.innerHTML);
    const plain = body.textContent.trim();
    if (!title) {
      C().toast(t("ae.needTitle"));
      $("ae-title").focus();
      return;
    }
    if (!plain && !body.querySelector("img,video,iframe")) return C().toast(t("ae.emptyBody"));
    const d = state.data;
    if (!d.inContent && !d.inHelp) return C().toast(t("ae.needPlace"));
    if (d.inHelp && !root.querySelectorAll("#ae-help-tree input:checked").length) return C().toast(t("ae.needSection"));
    if (d.vis === "private" && !d.users.length && !d.passes.length) return C().toast(t("ae.needPrivate"));
    if (d.when === "later") {
      if (!$("ae-when-at").value) return C().toast(t("ae.needDate"));
      if (new Date($("ae-when-at").value).getTime() <= Date.now()) return C().toast(t("ae.futureDate"));
    }

    const staff = await isStaff(state.me);
    const places = [d.inContent ? "content" : "", d.inHelp ? "help" : ""].filter(Boolean).join("+") || "content";
    const payload = {
      member_id: state.existing?.member_id || state.me.member_id,
      title,
      description: $("ae-desc").value.trim(),
      body: plain,
      body_html: html,
      language: $("ae-language").value,
      categories: listStr(d.cats),
      tags: listStr(d.cats),
      thumb: state.thumb,
      visibility: d.vis,
      excl: {
        followers: $("ae-fol").checked,
        countries: d.countries,
        languages: d.languages,
        lv_min: Number($("ae-lvmin").value || 0),
        lv_max: Number($("ae-lvmax").value || 10),
        tier: $("ae-tier").value,
      },
      private_users: listStr(d.users),
      private_passwords: listStr(d.passes),
      publish_at: d.when === "later" ? new Date($("ae-when-at").value).toISOString() : new Date().toISOString(),
      // Help from a member waits for a moderator; staff publish directly
      status: d.inHelp && !staff ? "pending" : "published",
      places,
      help_sections: listStr([...root.querySelectorAll("#ae-help-tree input:checked")].map((i) => i.value)),
      content_field: $("ae-field").value,
      content_niche: $("ae-niche").value,
      content_micro: $("ae-micro").value.trim(),
      content_nano: $("ae-nano").value.trim(),
      updated_at: new Date().toISOString(),
      updated_by: state.me.member_id,
    };

    const btn = $("ae-publish");
    if (btn.disabled) return;
    btn.disabled = true;
    let res;
    try {
      if (state.editId) {
        // ownership re-read at execution time; staff may edit any article
        const chk = await req(`/rest/v1/community_articles?id=eq.${encodeURIComponent(state.editId)}&select=member_id`);
        const owner = chk.ok && Array.isArray(chk.data) ? chk.data[0]?.member_id : null;
        if (owner !== state.me.member_id && !staff) {
          btn.disabled = false;
          return C().toast(t("ae.forbidden"));
        }
        res = await req(`/rest/v1/community_articles?id=eq.${encodeURIComponent(state.editId)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        res = await req("/rest/v1/community_articles", { method: "POST", body: JSON.stringify(payload) });
      }
    } catch (error) {
      console.error("Article save request failed", error);
      btn.disabled = false;
      return C().toast(t("ae.saveFail"));
    }
    btn.disabled = false;
    if (!res?.ok) {
      console.error("Article save failed", res?.status, res?.data);
      return C().toast(t("ae.saveFail"));
    }
    const row = Array.isArray(res.data) ? res.data[0] : null;
    const successText = payload.status === "pending"
      ? t("ae.sentReview")
      : d.when === "later"
        ? t("ae.scheduled")
        : t("ae.published");
    C().toast(successText);
    $("ae-state").textContent = payload.status === "pending"
      ? t("ae.pending")
      : d.when === "later"
        ? t("ae.scheduled")
        : t("ae.published");
    if (row?.id) setTimeout(() => (location.href = `./articles.html?id=${row.id}`), 700);
  }

  window.CineAuraArticles = { mount, sanitize, canRead, bodyHtml, critOf };
})();
