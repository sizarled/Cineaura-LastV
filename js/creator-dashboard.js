/* Creator workspace: management UI for channels, blogs, spaces and libraries.
   Existing video/article/question/document tools stay the sources of truth for
   content; creator_hub_items supplies workspace membership and metadata for
   podcasts and ebooks until their dedicated editors ship. */
(() => {
  "use strict";
  const C = window.CineAura;
  if (!C) return;
  const $ = (s, root = document) => root.querySelector(s);
  const esc = (v) => C.escapeHtml(String(v ?? ""));
  const root = $("#creator-root");
  const session = C.getSession();
  const TYPES = {
    channel: { label: "cw.channel", tabs: ["videos", "podcasts", "playlists", "manage"] },
    blog: { label: "cw.blog", tabs: ["articles", "drafts", "categories", "manage"] },
    space: { label: "cw.space", tabs: ["questions", "answers", "categories", "manage"] },
    library: { label: "cw.library", tabs: ["books", "documents", "categories", "manage"] },
  };
  const TAB_KEYS = {
    videos: "cw.videos", podcasts: "cw.podcasts", playlists: "cw.playlists", articles: "cw.articles",
    drafts: "cw.drafts", questions: "cw.questions", answers: "cw.answers", books: "cw.books",
    documents: "cw.documents", categories: "cw.categories", manage: "cw.manage", subscribers: "cw.subscribers", discover: "cw.discover",
  };
  const state = { member: null, profile: {}, kind: new URLSearchParams(location.search).get("kind") || "channel", tab: "", hubs: [], hub: null, categories: [], articleRows: [], busy: false, schemaMissing: false };
  const AR = {
    "cw.title":"مساحة إدارة المحتوى — CineAura", "cw.profile":"الملف الشخصي", "cw.channel":"القناة", "cw.blog":"المدونة", "cw.space":"المساحة المجتمعية", "cw.library":"المكتبة",
    "cw.videos":"الفيديوهات", "cw.podcasts":"البودكاست", "cw.playlists":"قوائم التشغيل", "cw.manage":"الإدارة", "cw.articles":"المقالات", "cw.drafts":"المسودات", "cw.categories":"الأقسام", "cw.questions":"الأسئلة", "cw.answers":"الأجوبة", "cw.books":"الكتب الإلكترونية", "cw.documents":"المستندات", "cw.subscribers":"المشتركون", "cw.general":"عام", "cw.discover":"اكتشاف المساحات", "cw.subscribe":"اشتراك", "cw.unsubscribe":"إلغاء الاشتراك", "cw.subscribeFailed":"تعذّر الاشتراك، حاول مرة أخرى.", "cw.noDiscover":"لا توجد مساحات عامة أو حصرية بعد.", "cw.memberId":"معرّف العضو",
    "cw.loginTitle":"سجّل الدخول لإدارة مساحاتك", "cw.loginLead":"تُدار القنوات والمدونات والمساحات والمكتبات من هنا.", "cw.error":"تعذّر تحميل الصفحة", "cw.memberMissing":"تعذّر العثور على ملف عضويتك.", "cw.loadFail":"تعذّر تحميل مساحاتك. تحقق من تطبيق sql/creator_workspace.sql.", "cw.noWorkspace":"لم يتم اختيار مساحة", "cw.chooseWorkspace":"اختر مساحة", "cw.addWorkspace":"إضافة مساحة", "cw.createWorkspaceLead":"أنشئ مساحة {kind} لإدارة محتواها وأقسامها وفريقها ومشتركيها.", "cw.createContent":"إنشاء محتوى", "cw.addVideo":"إضافة فيديو", "cw.addPodcast":"إضافة بودكاست", "cw.addPlaylist":"إضافة قائمة تشغيل", "cw.addArticle":"إضافة مقال", "cw.addDraft":"إضافة مسودة", "cw.addQuestion":"طرح سؤال", "cw.addBook":"إضافة كتاب إلكتروني", "cw.addDocument":"إضافة مستند", "cw.addCategory":"إضافة قسم", "cw.editWorkspace":"تعديل المساحة", "cw.deleteWorkspace":"حذف المساحة", "cw.confirmDeleteWorkspace":"هل تريد حذف هذه المساحة وروابط محتواها؟", "cw.workspaceSettingsHint":"يمكنك ضبط الاسم والشعار والغلاف والمجال والنيش والظهور وأعضاء VIP والروابط من تعديل المساحة.", "cw.contentCount":"المحتوى المرتبط", "cw.assign":"إضافة إلى هذه المساحة", "cw.unlink":"إزالة من هذه المساحة", "cw.allWorkspaces":"كل المساحات التي تديرها", "cw.lines":"الأسطر", "cw.words":"الكلمات", "cw.characters":"الأحرف", "cw.publish":"نشر", "cw.preview":"معاينة",
    "cw.name":"الاسم / العنوان", "cw.description":"الوصف", "cw.logo":"رابط الشعار", "cw.cover":"رابط صورة الغلاف", "cw.visibility":"الظهور", "cw.public":"عام", "cw.exclusive":"حصري", "cw.private":"خاص", "cw.domain":"المجال", "cw.niche":"النيشات (حتى 5)", "cw.nichesHint":"نيش واحد في كل سطر، حتى خمسة.", "cw.relatedLinks":"روابط ذات صلة (سطر لكل رابط: الاسم | الرابط)", "cw.linksHint":"الموقع | https://example.com", "cw.vipIds":"معرّفات أعضاء VIP (واحد في كل سطر)", "cw.idsHint":"افصل المعرّفات بمسافات أو فواصل أو أسطر جديدة.", "cw.save":"حفظ", "cw.cancel":"إلغاء", "cw.saved":"تم الحفظ", "cw.saveFailed":"تعذّر الحفظ. تحقق من إعداد قاعدة البيانات ثم أعد المحاولة.", "cw.blogLimit":"يمكنك إنشاء ثلاث مدونات كحد أقصى.", "cw.open":"فتح", "cw.edit":"تعديل", "cw.delete":"حذف", "cw.remove":"إزالة", "cw.confirmDelete":"حذف هذا العنصر؟ لا يمكن التراجع عن ذلك.", "cw.deleteFailed":"تعذّر حذف المساحة.", "cw.id":"المعرّف", "cw.question":"السؤال", "cw.views":"المشاهدات", "cw.minutes":"دقائق المشاهدة", "cw.likes":"الإعجابات", "cw.dislikes":"عدم الإعجاب", "cw.comments":"التعليقات", "cw.shares":"المشاركات", "cw.reports":"البلاغات", "cw.reads":"القراءات", "cw.downloads":"التنزيلات", "cw.followers":"المتابعون", "cw.reasks":"إعادة السؤال", "cw.items":"العناصر",
    "cw.noItems":"لا يوجد محتوى بعد.", "cw.noVideos":"لا توجد فيديوهات منشورة بعد.", "cw.noPlaylists":"لا توجد قوائم تشغيل بعد.", "cw.noPodcasts":"لا توجد حلقات بودكاست بعد.", "cw.noArticles":"لا توجد مقالات منشورة بعد.", "cw.noDrafts":"لا توجد مسودات بعد.", "cw.noQuestions":"لا توجد أسئلة بعد.", "cw.noAnswers":"لا توجد أجوبة بعد.", "cw.noDocuments":"لا توجد مستندات بعد.", "cw.noBooks":"لا توجد كتب إلكترونية بعد.", "cw.noCategories":"لا توجد أقسام بعد.", "cw.categoryAdd":"إضافة قسم", "cw.categoryName":"اسم القسم", "cw.category":"القسم", "cw.rootCategory":"قسم رئيسي", "cw.categoryDepthHint":"يمكن تنظيم الأقسام في ثلاثة مستويات: رئيسي وثانوي وفرعي.", "cw.categoryDepthError":"يمكن تداخل الأقسام حتى ثلاثة مستويات فقط.", "cw.level":"المستوى", "cw.add":"إضافة", "cw.noSubscribers":"لا يوجد مشتركون بعد.", "cw.makeVip":"تعيين VIP", "cw.removeVip":"إزالة VIP", "cw.addPass":"إنشاء كلمة مرور مؤقتة", "cw.manageStaff":"إدارة الطاقم", "cw.staffHint":"أدخل معرّف العضو لمنحه صلاحية إدارة هذه المساحة.", "cw.password":"كلمة المرور", "cw.passDuration":"مدة الصلاحية", "cw.hour":"ساعة", "cw.hours":"ساعة", "cw.days":"يوم", "cw.allowedIds":"معرّفات الأعضاء المسموح لهم (اختياري)", "cw.link":"الرابط", "cw.thumbnail":"رابط الصورة المصغرة", "cw.bookHint":"للكتب الإلكترونية فقط؛ يمكن إضافة محرر كتب مخصص لاحقاً.", "cw.podcastHint":"يمكن إضافة محرر بودكاست لاحقاً؛ أضف هنا رابط الصفحة أو موجز البودكاست العام."
  };
  const t = (k, vars) => {
    const lang = C.getLang?.() || "en";
    const source = window.CineAuraKeys?.[k];
    const packed = source ? C.tr(source) : "";
    let value = (lang === "ar" && AR[k]) || (packed && packed !== source ? packed : C.t(k, vars));
    if (vars && typeof value === "string") Object.entries(vars).forEach(([name, val]) => { value = value.replaceAll(`{${name}}`, String(val)); });
    return value;
  };
  const req = (path, options) => C.supabaseRequest(path, options).catch(() => ({ ok: false, data: null }));
  const qv = (s) => encodeURIComponent(String(s ?? ""));
  const rootPath = (table, filter = "") => `/rest/v1/${table}?${filter}`;
  const visText = (v) => ({ public: t("cw.public"), exclusive: t("cw.exclusive"), private: t("cw.private") }[v] || v);
  const visibilityOptions = (value = "public") => ["public", "exclusive", "private"].map((v) => `<option value="${v}"${v === value ? " selected" : ""}>${esc(visText(v))}</option>`).join("");
  const selectedHubId = () => Number(state.hub?.id || 0);
  const loadArray = async (table, filter, order = "created_at.desc", limit = 200) => {
    const r = await req(rootPath(table, `${filter}&select=*&order=${order}&limit=${limit}`));
    return r.ok && Array.isArray(r.data) ? r.data : [];
  };
  const navLink = (kind, tab) => `<button type="button" data-kind="${kind}" data-tab="${tab}" class="${state.kind === kind && state.tab === tab ? "active" : ""}">${esc(t(TAB_KEYS[tab] || TYPES[kind].label))}</button>`;

  async function init() {
    document.title = t("cw.title");
    if (!session?.member_id) {
      root.innerHTML = `<section class="glass cw-empty"><h1>${esc(t("cw.loginTitle"))}</h1><p>${esc(t("cw.loginLead"))}</p><a class="btn btn-primary" href="./login.html">${esc(t("nav.signin"))}</a></section>`;
      return;
    }
    const id = qv(session.member_id);
    const [m, p] = await Promise.all([
      req(rootPath("members", `member_id=eq.${id}&select=member_id,username,membership_type`)),
      req(rootPath("profiles", `member_id=eq.${id}&select=avatar_url,display_name`)),
    ]);
    state.member = Array.isArray(m.data) ? m.data[0] : null;
    state.profile = Array.isArray(p.data) ? p.data[0] || {} : {};
    if (!state.member) {
      root.innerHTML = `<section class="glass cw-empty"><h1>${esc(t("cw.error"))}</h1><p>${esc(t("cw.memberMissing"))}</p></section>`;
      return;
    }
    if (!TYPES[state.kind]) state.kind = "channel";
    state.tab = TYPES[state.kind].tabs.includes(new URLSearchParams(location.search).get("tab"))
      ? new URLSearchParams(location.search).get("tab") : TYPES[state.kind].tabs[0];
    await loadHubs();
    drawShell();
    await drawPage();
  }

  async function loadHubs() {
    const owner = qv(state.member.member_id);
    const [ownedRes, staffRes] = await Promise.all([
      req(rootPath("creator_hubs", `owner_id=eq.${owner}&kind=eq.${qv(state.kind)}&select=*&order=created_at.asc`)),
      req(rootPath("creator_hub_staff", `member_id=eq.${owner}&select=hub_id,role,creator_hubs!inner(id,kind,owner_id,name,description,logo_url,cover_url,visibility,domain,niche,related_links,vip_member_ids,settings,created_at,updated_at)`)),
    ]);
    const owned = ownedRes.ok && Array.isArray(ownedRes.data) ? ownedRes.data : [];
    state.schemaMissing = [404, 406].includes(ownedRes.status) || [404, 406].includes(staffRes.status) || ownedRes.data?.code === "PGRST205" || staffRes.data?.code === "PGRST205";
    const staff = staffRes.ok && Array.isArray(staffRes.data) ? staffRes.data : [];
    const assigned = staff.map((x) => ({ ...(x.creator_hubs || {}), staff_role: x.role })).filter((x) => x.kind === state.kind);
    const unique = new Map([...owned, ...assigned].filter((h) => h.id).map((h) => [Number(h.id), h]));
    state.hubs = [...unique.values()];
    const fromUrl = Number(new URLSearchParams(location.search).get("hub"));
    const keepId = fromUrl || Number(localStorage.getItem(`cw-hub-${state.kind}`));
    state.hub = state.hubs.find((h) => Number(h.id) === keepId) || state.hubs[0] || null;
    if (state.hub) localStorage.setItem(`cw-hub-${state.kind}`, String(state.hub.id));
    state.categories = state.hub ? await loadArray("creator_hub_categories", `hub_id=eq.${Number(state.hub.id)}`, "depth.asc,sort_order.asc") : [];
  }

  function drawShell() {
    const m = state.member;
    const avatar = state.profile.avatar_url || C.avatarUrlFor?.(m.member_id, m.username) || "";
    const menus = Object.entries(TYPES).map(([kind, data]) => `<h3>${esc(t(data.label))}</h3>${data.tabs.map((tab) => navLink(kind, tab)).join("")}`).join("");
    root.innerHTML = `<div class="cw-layout">
      <aside class="glass cw-side"><a class="cw-member" href="./profile.html?@${encodeURIComponent(m.username)}">${avatar ? `<img src="${esc(avatar)}" alt="" />` : `<span class="cw-avatar">${esc((m.username || "?").slice(0,1).toUpperCase())}</span>`}<span><strong>@${esc(m.username)}</strong><small>${esc(t("cw.memberId"))}: ${esc(m.member_id)}</small></span></a>
        <nav class="cw-nav">${menus}<h3>${esc(t("cw.general"))}</h3><button type="button" data-tab="discover" class="${state.tab === "discover" ? "active" : ""}">${esc(t("cw.discover"))}</button><button type="button" data-tab="subscribers" class="${state.tab === "subscribers" ? "active" : ""}">${esc(t("cw.subscribers"))}</button><a href="./dashboard.html">${esc(t("nav.dashboard"))}</a></nav></aside>
      <section class="glass cw-main" id="cw-main"></section>
    </div><dialog class="cw-dialog" id="cw-dialog"></dialog>`;
    root.onclick = onClick;
  }

  function hubToolbar() {
    const opts = state.hubs.map((h) => `<option value="${Number(h.id)}"${Number(h.id) === selectedHubId() ? " selected" : ""}>${esc(h.name)}</option>`).join("");
    return `<div class="cw-toolbar">${state.hubs.length ? `<select aria-label="${esc(t("cw.chooseWorkspace"))}" data-hub-select>${opts}<option value="__add">+ ${esc(t("cw.addWorkspace"))}</option></select>` : ""}<button type="button" class="btn btn-sm btn-ghost" data-create-hub>${esc(t("cw.addWorkspace"))}</button>${selectedHubId() ? addContentToolbar() : ""}</div>`;
  }
  function addContentToolbar() {
    const kindOptions = state.kind === "channel" ? [["video", "cw.addVideo"], ["podcast", "cw.addPodcast"], ["playlist", "cw.addPlaylist"]]
      : state.kind === "blog" ? [["article", "cw.addArticle"], ["draft", "cw.addDraft"], ["category", "cw.addCategory"]]
      : state.kind === "space" ? [["question", "cw.addQuestion"], ["category", "cw.addCategory"]]
      : [["book", "cw.addBook"], ["document", "cw.addDocument"], ["category", "cw.addCategory"]];
    return `<select aria-label="${esc(t("cw.createContent"))}" data-add-content><option value="">${esc(t("cw.createContent"))}</option>${kindOptions.map(([v,k]) => `<option value="${v}">${esc(t(k))}</option>`).join("")}</select>`;
  }

  function pageHeading() {
    const tabLabel = state.tab === "subscribers" ? t("cw.subscribers") : t(TAB_KEYS[state.tab] || state.tab);
    return `<div class="cw-head"><div><p class="eyebrow">${esc(t(TYPES[state.kind].label))}</p><h1>${esc(tabLabel)}</h1><p class="cw-muted">${esc(state.hub?.name || t("cw.noWorkspace"))}</p></div>${hubToolbar()}</div>`;
  }

  async function drawPage() {
    const main = $("#cw-main", root);
    if (!main) return;
    main.innerHTML = `${pageHeading()}<div class="cw-tabs">${TYPES[state.kind].tabs.map((tab) => `<button type="button" data-tab="${tab}" class="${state.tab === tab ? "active" : ""}">${esc(t(TAB_KEYS[tab]))}</button>`).join("")}<button type="button" data-tab="discover" class="${state.tab === "discover" ? "active" : ""}">${esc(t("cw.discover"))}</button>${state.hub ? `<button type="button" data-tab="subscribers" class="${state.tab === "subscribers" ? "active" : ""}">${esc(t("cw.subscribers"))}</button>` : ""}</div><div id="cw-body"><p class="cw-muted">${esc(t("common.loading"))}</p></div>`;
    const body = $("#cw-body", main);
    if (state.schemaMissing) return (body.innerHTML = `<div class="cw-empty"><p>${esc(t("cw.loadFail"))}</p><code>sql/creator_workspace.sql</code></div>`);
    if (state.tab === "discover") return drawDiscover(body);
    if (state.tab === "manage") return drawHubManage(body);
    if (state.tab === "categories") return drawCategories(body);
    if (state.tab === "subscribers") return drawSubscribers(body);
    if (!state.hub) return (body.innerHTML = emptyWorkspace());
    if (state.kind === "channel" && state.tab === "videos") return drawVideos(body);
    if (state.kind === "channel" && state.tab === "playlists") return drawPlaylists(body);
    if (state.kind === "channel" && state.tab === "podcasts") return drawLooseItems(body, "podcast");
    if (state.kind === "blog" && ["articles", "drafts"].includes(state.tab)) return drawArticles(body, state.tab === "drafts");
    if (state.kind === "space" && ["questions", "answers"].includes(state.tab)) return drawQandA(body, state.tab);
    if (state.kind === "library" && state.tab === "documents") return drawDocuments(body);
    if (state.kind === "library" && state.tab === "books") return drawLooseItems(body, "book");
    body.innerHTML = emptyWorkspace();
  }
  function emptyWorkspace() { return `<div class="cw-empty"><p>${esc(t("cw.createWorkspaceLead", { kind: t(TYPES[state.kind].label) }))}</p><button class="btn btn-primary" type="button" data-create-hub>${esc(t("cw.addWorkspace"))}</button></div>`; }

  function renderRows(rows, options = {}) {
    const { type = "", open = "", edit = "", thumb = "", visibility = "public", metrics = [], emptyKey = "cw.noItems", deleteTable = "", deleteAction = "", idKey = "id", associateType = "" } = options;
    if (!rows.length) return `<div class="cw-empty">${esc(t(emptyKey))}</div>`;
    return `<div class="cw-list">${rows.map((r) => {
      const id = String(r[idKey] ?? "");
      const title = String(r.title || r.name || r.question || r.content_id || id);
      const subline = r.question || r.content_id || r.post_id || r.id || r.member_id || "";
      const image = r[thumb] || r.thumb_url || r.thumb || r.logo_url || "";
      const metricLine = metrics.map(([key, label]) => `${esc(t(label))}: ${r[key] == null ? "—" : Number(r[key])}`).join(" · ");
      return `<article class="cw-item">${image ? `<img class="cw-thumb" src="${esc(image)}" alt="" loading="lazy" />` : `<span class="cw-thumb" aria-hidden="true">✦</span>`}<div><h3>${esc(title)}</h3><p>${r.question ? `${esc(t("cw.question"))}: ` : `${esc(t("cw.id"))}: `}${esc(subline)} · ${esc(visText(r[visibility] || "public"))}${metricLine ? ` · ${metricLine}` : ""}</p></div><div class="cw-actions">${open ? `<a class="btn btn-sm btn-primary" href="${esc(open(r))}">${esc(t("cw.open"))}</a>` : ""}${edit ? `<a class="btn btn-sm btn-ghost" href="${esc(edit(r))}">${esc(t("cw.edit"))}</a>` : ""}${associateType ? (r._cwLinked ? `<button class="btn btn-sm btn-ghost" type="button" data-unlink-type="${esc(associateType)}" data-row-id="${esc(id)}">${esc(t("cw.unlink"))}</button>` : `<button class="btn btn-sm btn-ghost" type="button" data-associate-type="${esc(associateType)}" data-row-id="${esc(id)}" data-row-title="${esc(title)}" data-row-thumb="${esc(image)}" data-row-href="${esc(open ? open(r) : "")}" data-row-vis="${esc(r.visibility || "public")}">${esc(t("cw.assign"))}</button>`) : ""}${deleteAction === "video" ? `<button class="btn btn-sm btn-danger" type="button" data-delete-video="${esc(id)}">${esc(t("cw.delete"))}</button>` : deleteAction === "document" ? `<button class="btn btn-sm btn-danger" type="button" data-delete-document="${esc(id)}">${esc(t("cw.delete"))}</button>` : ""}${deleteTable ? `<button class="btn btn-sm btn-danger" type="button" data-delete-row="${esc(deleteTable)}" data-row-id="${esc(id)}">${esc(t("cw.delete"))}</button>` : ""}</div></article>`;
    }).join("")}</div>`;
  }
  async function mappedRows(rows, type, getId = (r) => r.id) {
    const allLinks = await loadArray("creator_hub_items", `content_type=eq.${qv(type)}`);
    const current = new Set(allLinks.filter((x) => Number(x.hub_id) === selectedHubId()).map((x) => String(x.content_id)));
    const assigned = new Set(allLinks.map((x) => String(x.content_id)));
    return rows.filter((r) => current.has(String(getId(r))) || !assigned.has(String(getId(r))))
      .map((r) => ({ ...r, _cwLinked: current.has(String(getId(r))) }));
  }
  async function drawVideos(box) {
    const res = await C.rpc("content_mine", { p_member: state.member.member_id }).catch(() => null);
    const all = res?.ok && Array.isArray(res.data) ? res.data.filter((x) => !x.scheduled) : [];
    const rows = await mappedRows(all, "video");
    box.innerHTML = renderRows(rows, { type: "video", associateType: "video", deleteAction: "video", idKey: "id", thumb: "thumb", open: (r) => `./video.html?id=${encodeURIComponent(r.id)}`, edit: () => `./video%20editor.html?workspace=${selectedHubId()}`, metrics: [["views","cw.views"],["minutes","cw.minutes"],["likes","cw.likes"],["dislikes","cw.dislikes"],["comments","cw.comments"],["shares","cw.shares"]], emptyKey: "cw.noVideos" });
  }
  async function drawPlaylists(box) {
    const all = await loadArray("content_playlists", `owner_id=eq.${qv(state.member.member_id)}`);
    const rows = await mappedRows(all, "playlist", (r) => r.playlist_id);
    box.innerHTML = renderRows(rows, { idKey: "playlist_id", associateType: "playlist", open: (r) => `./videos.html?playlist=${encodeURIComponent(r.playlist_id)}`, edit: () => "./dashboard.html#playlists", metrics: [["items_count","cw.items"]], emptyKey: "cw.noPlaylists" });
  }
  function safePreviewHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const allowed = new Set(["P","BR","H1","H2","H3","H4","UL","OL","LI","B","STRONG","I","EM","U","S","BLOCKQUOTE","A","IMG","HR"]);
    const walk = (node) => [...node.children].forEach((child) => {
      if (!allowed.has(child.tagName)) { child.replaceWith(...child.childNodes); return; }
      [...child.attributes].forEach((attr) => {
        const keep = (child.tagName === "A" && ["href","target","rel"].includes(attr.name)) || (child.tagName === "IMG" && ["src","alt","width","height"].includes(attr.name));
        if (!keep || ((attr.name === "href" || attr.name === "src") && !/^https?:/i.test(attr.value))) child.removeAttribute(attr.name);
      });
      if (child.tagName === "A") { child.setAttribute("rel", "noopener noreferrer"); child.setAttribute("target", "_blank"); }
      walk(child);
    });
    walk(doc.body);
    return doc.body.innerHTML;
  }
  async function drawArticles(box, draftsOnly) {
    const rows = await loadArray("community_articles", `member_id=eq.${qv(state.member.member_id)}`);
    state.articleRows = rows;
    const baseRows = draftsOnly ? rows.filter((x) => x.status === "draft") : rows.filter((x) => x.status !== "draft");
    const filtered = await mappedRows(baseRows, "article");
    if (!draftsOnly) return (box.innerHTML = renderRows(filtered, { idKey: "id", associateType: "article", thumb: "thumb", visibility: "visibility", open: (r) => `./article.html?id=${encodeURIComponent(r.id)}`, edit: (r) => `./article-Editor.html?edit=${encodeURIComponent(r.id)}&workspace=${selectedHubId()}`, metrics: [["views","cw.reads"],["likes","cw.likes"],["dislikes","cw.dislikes"],["comments","cw.comments"],["reports","cw.reports"]], deleteTable: "community_articles", emptyKey: "cw.noArticles" }));
    box.innerHTML = filtered.length ? `<div class="cw-list">${filtered.map((a) => {
      const plain = String(a.body || a.body_html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
      const words = plain ? plain.split(/\s+/).filter(Boolean).length : 0;
      const lines = plain ? plain.split(/\n/).length : 0;
      const chars = plain.length;
      return `<article class="cw-item">${a.thumb ? `<img class="cw-thumb" src="${esc(a.thumb)}" alt="" />` : `<span class="cw-thumb">✎</span>`}<div><h3>${esc(a.title || t("ae.untitled"))}</h3><p>${esc(t("cw.categories"))}: ${esc(a.categories || a.tags || "—")} · ${esc(visText(a.visibility || "public"))}</p><p>${esc(t("cw.lines"))}: ${lines} · ${esc(t("cw.words"))}: ${words} · ${esc(t("cw.characters"))}: ${chars}</p></div><div class="cw-actions">${a._cwLinked ? `<button class="btn btn-sm btn-ghost" type="button" data-unlink-type="article" data-row-id="${Number(a.id)}">${esc(t("cw.unlink"))}</button>` : `<button class="btn btn-sm btn-ghost" type="button" data-associate-type="article" data-row-id="${Number(a.id)}" data-row-title="${esc(a.title || "")}" data-row-thumb="${esc(a.thumb || "")}" data-row-href="./article.html?id=${encodeURIComponent(a.id)}" data-row-vis="${esc(a.visibility || "public")}">${esc(t("cw.assign"))}</button>`}<button class="btn btn-sm btn-primary" type="button" data-publish-article="${Number(a.id)}">${esc(t("cw.publish"))}</button><button class="btn btn-sm btn-ghost" type="button" data-preview-article="${Number(a.id)}">${esc(t("cw.preview"))}</button><a class="btn btn-sm btn-ghost" href="./article-Editor.html?edit=${encodeURIComponent(a.id)}&workspace=${selectedHubId()}">${esc(t("cw.edit"))}</a><button class="btn btn-sm btn-danger" type="button" data-delete-row="community_articles" data-row-id="${Number(a.id)}">${esc(t("cw.delete"))}</button></div></article>`;
    }).join("")}</div>` : `<div class="cw-empty">${esc(t("cw.noDrafts"))}</div>`;
  }
  async function drawDocuments(box) {
    const all = await loadArray("community_documents", `member_id=eq.${qv(state.member.member_id)}`);
    const rows = await mappedRows(all, "document");
    box.innerHTML = renderRows(rows, { idKey: "id", associateType: "document", deleteAction: "document", thumb: "thumb_url", visibility: "visibility", open: (r) => `./documents.html?id=${encodeURIComponent(r.id)}`, edit: () => `./document%20editor.html?workspace=${selectedHubId()}`, metrics: [["views","cw.reads"],["downloads","cw.downloads"],["likes","cw.likes"],["dislikes","cw.dislikes"],["comments","cw.comments"],["shares","cw.shares"],["reports","cw.reports"]], emptyKey: "cw.noDocuments" });
  }
  async function drawQandA(box, type) {
    if (type === "questions") {
      const all = await loadArray("community_questions", `member_id=eq.${qv(state.member.member_id)}`);
      const rows = await mappedRows(all, "question");
      box.innerHTML = renderRows(rows, { idKey: "id", associateType: "question", open: (r) => `./answers.html?q=${encodeURIComponent(r.id)}`, edit: () => `./answers%20editor.html?workspace=${selectedHubId()}`, metrics: [["answers_count","cw.answers"],["followers","cw.followers"],["reasks","cw.reasks"]], deleteTable: "community_questions", emptyKey: "cw.noQuestions" });
    } else {
      const rows = await loadArray("community_answers", `member_id=eq.${qv(state.member.member_id)}`);
      const decoratedAll = await Promise.all(rows.map(async (a) => {
        const q = await req(rootPath("community_questions", `id=eq.${Number(a.question_id)}&select=title`));
        return { ...a, title: a.body, question: Array.isArray(q.data) ? q.data[0]?.title || "" : "" };
      }));
      const decorated = await mappedRows(decoratedAll, "answer");
      box.innerHTML = renderRows(decorated, { idKey: "id", associateType: "answer", open: (r) => `./answers.html?q=${encodeURIComponent(r.question_id)}`, edit: () => `./answers%20editor.html?workspace=${selectedHubId()}`, metrics: [["votes","cw.likes"],["dislikes","cw.dislikes"],["comments","cw.comments"],["reports","cw.reports"]], deleteTable: "community_answers", emptyKey: "cw.noAnswers" });
    }
  }
  async function drawLooseItems(box, type) {
    const rows = await loadArray("creator_hub_items", `hub_id=eq.${selectedHubId()}&content_type=eq.${type}`);
    box.innerHTML = `<div class="cw-inline" style="margin-bottom:12px"><button class="btn btn-sm btn-primary" type="button" data-add-loose="${type}">${esc(t(type === "book" ? "cw.addBook" : "cw.addPodcast"))}</button><span class="cw-muted">${esc(t(type === "book" ? "cw.bookHint" : "cw.podcastHint"))}</span></div>${renderRows(rows, { idKey: "content_id", thumb: "thumb_url", open: (r) => r.href || "#", metrics: [["minutes_viewed","cw.minutes"],["shares","cw.shares"],["reports","cw.reports"]], deleteTable: "creator_hub_items", emptyKey: type === "book" ? "cw.noBooks" : "cw.noPodcasts" })}`;
  }

  async function drawHubManage(box) {
    if (!state.hub) return (box.innerHTML = emptyWorkspace());
    const hub = state.hub;
    const [subs, items, metrics] = await Promise.all([
      loadArray("creator_hub_subscribers", `hub_id=eq.${Number(hub.id)}`, "created_at.desc"),
      loadArray("creator_hub_items", `hub_id=eq.${Number(hub.id)}`),
      hubMetrics(hub),
    ]);
    const itemMetric = summarizeItems(items.filter((x) => ["podcast", "book"].includes(x.content_type)));
    const metric = { contents: metrics.contents + itemMetric.contents, minutes: metrics.minutes == null && itemMetric.minutes === 0 ? null : Number(metrics.minutes || 0) + itemMetric.minutes, reports: metrics.reports == null && itemMetric.reports === 0 ? null : Number(metrics.reports || 0) + itemMetric.reports, likes: metrics.likes, dislikes: metrics.dislikes, comments: metrics.comments }; 
    const workspaceRows = await Promise.all(state.hubs.map(async (item) => {
      const [s, it] = await Promise.all([loadArray("creator_hub_subscribers", `hub_id=eq.${Number(item.id)}`), loadArray("creator_hub_items", `hub_id=eq.${Number(item.id)}`)]);
      const count = state.kind === "channel" ? "" : `${it.length} ${t("cw.contentCount")}`;
      return `<article class="cw-item">${item.logo_url ? `<img class="cw-thumb" src="${esc(item.logo_url)}" alt="" />` : `<span class="cw-thumb">✦</span>`}<div><h3>${esc(item.name)}</h3><p>${esc(visText(item.visibility))} · ${s.length} ${esc(t("cw.subscribers"))}${count ? ` · ${esc(count)}` : ""}</p></div><div class="cw-actions"><button class="btn btn-sm btn-ghost" type="button" data-open-own="${Number(item.id)}">${esc(t("cw.open"))}</button><button class="btn btn-sm btn-ghost" type="button" data-edit-own="${Number(item.id)}">${esc(t("cw.edit"))}</button></div></article>`;
    }));
    box.innerHTML = `<h2>${esc(t("cw.allWorkspaces"))}</h2><div class="cw-list">${workspaceRows.join("")}</div><div class="cw-banner">${hub.cover_url ? `<img src="${esc(hub.cover_url)}" alt="" />` : ""}</div><div class="cw-identity">${hub.logo_url ? `<img src="${esc(hub.logo_url)}" alt="" />` : `<span class="cw-thumb">✦</span>`}<div><h2>${esc(hub.name)}</h2><span class="cw-chip">${esc(visText(hub.visibility))}</span></div></div><p>${esc(hub.description || "")}</p><div class="cw-grid"><div class="cw-stat"><b>${subs.length}</b><span>${esc(t("cw.subscribers"))}</span></div><div class="cw-stat"><b>${metric.contents}</b><span>${esc(t("cw.contentCount"))}</span></div><div class="cw-stat"><b>${metric.minutes}</b><span>${esc(t("cw.minutes"))}</span></div><div class="cw-stat"><b>${metric.likes == null ? "—" : metric.likes}</b><span>${esc(t("cw.likes"))}</span></div><div class="cw-stat"><b>${metric.dislikes == null ? "—" : metric.dislikes}</b><span>${esc(t("cw.dislikes"))}</span></div><div class="cw-stat"><b>${metric.comments == null ? "—" : metric.comments}</b><span>${esc(t("cw.comments"))}</span></div><div class="cw-stat"><b>${metric.reports == null ? "—" : metric.reports}</b><span>${esc(t("cw.reports"))}</span></div></div><div class="cw-inline"><button class="btn btn-primary" type="button" data-edit-hub>${esc(t("cw.editWorkspace"))}</button><button class="btn btn-ghost" type="button" data-pass-form>${esc(t("cw.addPass"))}</button><button class="btn btn-ghost" type="button" data-staff-form>${esc(t("cw.manageStaff"))}</button><button class="btn btn-danger" type="button" data-delete-hub>${esc(t("cw.deleteWorkspace"))}</button></div><p class="cw-muted" style="margin-top:15px">${esc(t("cw.workspaceSettingsHint"))}</p>`;
  }
  function summarizeItems(items) { return items.reduce((a, x) => ({ contents: a.contents + 1, minutes: a.minutes + Number(x.minutes_viewed || 0), reports: a.reports + Number(x.reports || 0) }), { contents: 0, minutes: 0, reports: 0 }); }
  async function hubMetrics(hub) {
    const sum = (rows, key) => rows.some((r) => r[key] != null) ? rows.reduce((n, r) => n + Number(r[key] || 0), 0) : null;
    const zero = { contents: 0, minutes: null, reports: null, likes: null, dislikes: null, comments: null };
    if (hub.kind === "channel") {
      const r = await C.rpc("content_mine", { p_member: state.member.member_id }).catch(() => null);
      const all = r?.ok && Array.isArray(r.data) ? r.data.filter((x) => !x.scheduled) : [];
      const rows = await mappedRows(all, "video");
      return { contents: rows.length, minutes: sum(rows, "minutes"), reports: null, likes: sum(rows, "likes"), dislikes: sum(rows, "dislikes"), comments: sum(rows, "comments") };
    }
    const table = hub.kind === "blog" ? "community_articles" : hub.kind === "space" ? "community_questions" : "community_documents";
    const filter = hub.kind === "space" ? `member_id=eq.${qv(state.member.member_id)}` : `member_id=eq.${qv(state.member.member_id)}`;
    const allRows = await loadArray(table, filter);
    const itemType = hub.kind === "blog" ? "article" : hub.kind === "library" ? "document" : "question";
    const rows = await mappedRows(allRows, itemType);
    if (hub.kind === "blog") return { ...zero, contents: rows.length, minutes: sum(rows, "reading_minutes"), likes: sum(rows, "likes"), dislikes: sum(rows, "dislikes"), comments: sum(rows, "comments"), reports: sum(rows, "reports") };
    if (hub.kind === "library") return { ...zero, contents: rows.length, minutes: sum(rows, "reading_minutes"), likes: sum(rows, "likes"), dislikes: sum(rows, "dislikes"), comments: sum(rows, "comments"), reports: sum(rows, "reports") };
    const allAnswers = await loadArray("community_answers", `member_id=eq.${qv(state.member.member_id)}`);
    const answers = await mappedRows(allAnswers, "answer");
    return { ...zero, contents: rows.length + answers.length, likes: sum(answers, "votes"), comments: sum(answers, "comments"), reports: sum(answers, "reports") };
  }

  async function drawCategories(box) {
    if (!state.hub) return (box.innerHTML = emptyWorkspace());
    const rows = await loadArray("creator_hub_categories", `hub_id=eq.${selectedHubId()}`, "depth.asc,sort_order.asc");
    state.categories = rows;
    box.innerHTML = `<div class="cw-card"><h2>${esc(t("cw.categoryAdd"))}</h2><div class="cw-category"><input id="cw-cat-name" placeholder="${esc(t("cw.categoryName"))}" /><select id="cw-cat-parent"><option value="">${esc(t("cw.rootCategory"))}</option>${rows.map((c) => `<option value="${Number(c.id)}">${"— ".repeat(Number(c.depth || 1))}${esc(c.name)}</option>`).join("")}</select><button class="btn btn-primary" type="button" data-save-category>${esc(t("cw.add"))}</button></div><p class="cw-muted">${esc(t("cw.categoryDepthHint"))}</p></div><div class="cw-list" style="margin-top:14px">${rows.length ? rows.map((c) => `<article class="cw-sub"><span>${"— ".repeat(Number(c.depth || 1))}<strong>${esc(c.name)}</strong> <small class="cw-muted">${esc(t("cw.level"))} ${Number(c.depth)}</small></span><button class="btn btn-sm btn-danger" type="button" data-delete-category="${Number(c.id)}">${esc(t("cw.delete"))}</button></article>`).join("") : `<div class="cw-empty">${esc(t("cw.noCategories"))}</div>`}</div>`;
  }
  async function drawDiscover(box) {
    const allRes = await req(rootPath("creator_hubs", `kind=eq.${qv(state.kind)}&visibility=neq.private&select=*&order=created_at.desc&limit=100`));
    if (!allRes.ok || !Array.isArray(allRes.data)) return (box.innerHTML = `<div class="cw-empty">${esc(t("cw.loadFail"))}</div>`);
    const memberships = await req(rootPath("creator_hub_subscribers", `member_id=eq.${qv(state.member.member_id)}&select=hub_id,tier`));
    const mine = new Map((Array.isArray(memberships.data) ? memberships.data : []).map((x) => [Number(x.hub_id), x]));
    box.innerHTML = allRes.data.length ? `<div class="cw-list">${allRes.data.map((h) => {
      const sub = mine.get(Number(h.id));
      const own = h.owner_id === state.member.member_id;
      return `<article class="cw-item">${h.logo_url ? `<img class="cw-thumb" src="${esc(h.logo_url)}" alt="" />` : `<span class="cw-thumb">✦</span>`}<div><h3>${esc(h.name)}</h3><p>${esc(h.description || "")} · ${esc(visText(h.visibility))} · ${esc(h.domain || "")} ${h.niche ? `· ${esc(h.niche)}` : ""}</p></div><div class="cw-actions">${own ? `<button class="btn btn-sm btn-ghost" type="button" data-open-own="${Number(h.id)}">${esc(t("cw.manage"))}</button>` : sub ? `<button class="btn btn-sm btn-ghost" type="button" data-unsubscribe-hub="${Number(h.id)}">${esc(t("cw.unsubscribe"))}</button>` : `<button class="btn btn-sm btn-primary" type="button" data-subscribe-hub="${Number(h.id)}">${esc(t("cw.subscribe"))}</button>`}</div></article>`;
    }).join("")}</div>` : `<div class="cw-empty">${esc(t("cw.noDiscover"))}</div>`;
  }
  async function drawSubscribers(box) {
    if (!state.hub) return (box.innerHTML = emptyWorkspace());
    const rows = await loadArray("creator_hub_subscribers", `hub_id=eq.${selectedHubId()}`, "created_at.desc");
    box.innerHTML = rows.length ? `<div class="cw-list">${rows.map((r) => `<div class="cw-sub"><span><strong>${esc(r.member_id)}</strong><small class="cw-muted"> · ${esc(r.tier || "subscriber")} · ${esc(String(r.created_at || "").slice(0,10))}</small></span><div class="cw-actions"><button class="btn btn-sm btn-ghost" type="button" data-toggle-vip="${esc(r.member_id)}">${esc(r.tier === "vip" ? t("cw.removeVip") : t("cw.makeVip"))}</button><button class="btn btn-sm btn-danger" type="button" data-remove-subscriber="${esc(r.member_id)}">${esc(t("cw.remove"))}</button></div></div>`).join("")}</div>` : `<div class="cw-empty">${esc(t("cw.noSubscribers"))}</div>`;
  }

  function showDialog(title, body, submitLabel = t("cw.save")) {
    const dlg = $("#cw-dialog", root);
    dlg.innerHTML = `<h2>${esc(title)}</h2>${body}<div class="cw-inline" style="justify-content:flex-end;margin-top:16px"><button type="button" class="btn btn-ghost" data-close-dialog>${esc(t("cw.cancel"))}</button><button type="button" class="btn btn-primary" data-dialog-submit>${esc(submitLabel)}</button></div>`;
    dlg.showModal();
    return dlg;
  }
  function hubForm(hub = {}) {
    const links = Array.isArray(hub.related_links) ? hub.related_links.map((x) => `${x.label || ""} | ${x.url || ""}`).join("\n") : "";
    return `<form class="cw-form" id="cw-hub-form"><label>${esc(t("cw.name"))}<input name="name" maxlength="100" required value="${esc(hub.name || "")}" /></label><label>${esc(t("cw.visibility"))}<select name="visibility">${visibilityOptions(hub.visibility || "public")}</select></label><label class="wide">${esc(t("cw.description"))}<textarea name="description" maxlength="3000">${esc(hub.description || "")}</textarea></label><label>${esc(t("cw.logo"))}<input name="logo_url" type="url" value="${esc(hub.logo_url || "")}" /></label><label>${esc(t("cw.cover"))}<input name="cover_url" type="url" value="${esc(hub.cover_url || "")}" /></label><label>${esc(t("cw.domain"))}<input name="domain" value="${esc(hub.domain || "")}" /></label><label>${esc(t("cw.niche"))}<textarea name="niche" placeholder="${esc(t("cw.nichesHint"))}">${esc(hub.niche || "")}</textarea></label><label class="wide">${esc(t("cw.relatedLinks"))}<textarea name="related_links" placeholder="${esc(t("cw.linksHint"))}">${esc(links)}</textarea></label><label class="wide">${esc(t("cw.vipIds"))}<textarea name="vip_member_ids" placeholder="${esc(t("cw.idsHint"))}">${esc((hub.vip_member_ids || []).join("\n"))}</textarea></label></form>`;
  }
  async function openHubForm(hub = null) {
    const dlg = showDialog(hub ? t("cw.editWorkspace") : t("cw.addWorkspace"), hubForm(hub || {}));
    dlg.querySelector("[data-dialog-submit]").onclick = async () => {
      const f = $("#cw-hub-form", dlg);
      if (!f.reportValidity()) return;
      const fd = new FormData(f);
      const links = String(fd.get("related_links") || "").split(/\r?\n/).map((line) => { const [label, ...u] = line.split("|"); return { label: label.trim(), url: u.join("|").trim() }; }).filter((x) => x.url);
      const body = { kind: state.kind, owner_id: state.member.member_id, name: String(fd.get("name")).trim(), description: String(fd.get("description") || ""), visibility: fd.get("visibility"), logo_url: String(fd.get("logo_url") || "").trim(), cover_url: String(fd.get("cover_url") || "").trim(), domain: String(fd.get("domain") || "").trim(), niche: String(fd.get("niche") || "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).slice(0, 5).join(", "), related_links: links, vip_member_ids: String(fd.get("vip_member_ids") || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean) };
      if (!hub && state.kind === "blog" && state.hubs.filter((x) => x.owner_id === state.member.member_id).length >= 3) return C.toast(t("cw.blogLimit"));
      const res = await req(rootPath("creator_hubs", hub ? `id=eq.${Number(hub.id)}` : ""), { method: hub ? "PATCH" : "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(hub ? Object.fromEntries(Object.entries(body).filter(([k]) => k !== "kind" && k !== "owner_id")) : body) });
      if (!res.ok) return C.toast(t("cw.saveFailed"));
      dlg.close(); await loadHubs(); drawShell(); await drawPage(); C.toast(t("cw.saved"));
    };
  }

  async function openLooseForm(type) {
    const isBook = type === "book";
    const dlg = showDialog(t(isBook ? "cw.addBook" : "cw.addPodcast"), `<form id="cw-loose-form" class="cw-form"><label>${esc(t("cw.name"))}<input name="title" required maxlength="160" /></label><label>${esc(t("cw.visibility"))}<select name="visibility">${visibilityOptions()}</select></label><label class="wide">${esc(t("cw.link"))}<input name="href" type="url" /></label><label>${esc(t("cw.thumbnail"))}<input name="thumb_url" type="url" /></label><label>${esc(t("cw.category"))}<select name="category_id"><option value="">—</option>${state.categories.map((c) => `<option value="${Number(c.id)}">${esc(c.name)}</option>`).join("")}</select></label></form>`);
    dlg.querySelector("[data-dialog-submit]").onclick = async () => {
      const f = $("#cw-loose-form", dlg); if (!f.reportValidity()) return;
      const fd = new FormData(f); const title = String(fd.get("title") || "").trim();
      const body = { hub_id: selectedHubId(), content_type: type, content_id: `cw-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, title, href: String(fd.get("href") || ""), thumb_url: String(fd.get("thumb_url") || ""), visibility: fd.get("visibility"), category_id: fd.get("category_id") ? Number(fd.get("category_id")) : null };
      const res = await req(rootPath("creator_hub_items", ""), { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=minimal" } });
      if (!res.ok) return C.toast(t("cw.saveFailed"));
      dlg.close(); await drawPage();
    };
  }
  function openSimpleForm(type) {
    if (type === "category") { state.tab = "categories"; drawShell(); return drawPage(); }
    const data = { video: ["cw.addVideo","./video%20editor.html"], podcast: ["cw.addPodcast",""], playlist: ["cw.addPlaylist","./dashboard.html#playlists"], article: ["cw.addArticle","./article-Editor.html"], draft: ["cw.addDraft","./article-Editor.html"], question: ["cw.addQuestion","./answers%20editor.html"], document: ["cw.addDocument","./document%20editor.html"], book: ["cw.addBook",""] }[type];
    if (!data) return;
    if (["podcast","book"].includes(type)) return openLooseForm(type);
    if (type === "playlist") return (location.href = data[1]);
    if (type === "document") return (location.href = `./dashboard.html?workspace=${selectedHubId()}#documents`);
    const draftParam = type === "draft" ? "&draft=1" : "";
    location.href = `${data[1]}?workspace=${selectedHubId()}${draftParam}`;
  }

  async function onClick(e) {
    const btn = e.target.closest("button"); if (!btn) return;
    if (btn.dataset.kind) {
      state.kind = btn.dataset.kind; state.tab = btn.dataset.tab; await loadHubs(); drawShell(); return drawPage();
    }
    if (btn.dataset.tab) { state.tab = btn.dataset.tab; drawShell(); return drawPage(); }
    if (btn.hasAttribute("data-create-hub")) return openHubForm();
    if (btn.hasAttribute("data-edit-hub")) return openHubForm(state.hub);
    if (btn.dataset.editOwn) return openHubForm(state.hubs.find((x) => Number(x.id) === Number(btn.dataset.editOwn)) || state.hub);
    if (btn.dataset.addLoose) return openLooseForm(btn.dataset.addLoose);
    if (btn.hasAttribute("data-pass-form")) return openPassForm();
    if (btn.hasAttribute("data-staff-form")) return openStaffForm();
    if (btn.hasAttribute("data-delete-hub")) {
      if (!confirm(t("cw.confirmDeleteWorkspace"))) return;
      const r = await req(rootPath("creator_hubs", `id=eq.${selectedHubId()}&owner_id=eq.${qv(state.member.member_id)}`), { method: "DELETE" });
      if (!r.ok) return C.toast(t("cw.deleteFailed"));
      await loadHubs(); drawShell(); return drawPage();
    }
    if (btn.dataset.openOwn) {
      state.hub = state.hubs.find((x) => Number(x.id) === Number(btn.dataset.openOwn)) || null;
      state.tab = "manage"; localStorage.setItem(`cw-hub-${state.kind}`, String(state.hub?.id || "")); drawShell(); return drawPage();
    }
    if (btn.dataset.subscribeHub) {
      const r = await req(rootPath("creator_hub_subscribers", ""), { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ hub_id: Number(btn.dataset.subscribeHub), member_id: state.member.member_id, tier: "subscriber" }) });
      if (!r.ok) C.toast(t("cw.subscribeFailed")); return drawPage();
    }
    if (btn.dataset.unsubscribeHub) {
      await req(rootPath("creator_hub_subscribers", `hub_id=eq.${Number(btn.dataset.unsubscribeHub)}&member_id=eq.${qv(state.member.member_id)}`), { method: "DELETE" }); return drawPage();
    }
    if (btn.dataset.toggleVip) {
      const current = await req(rootPath("creator_hub_subscribers", `hub_id=eq.${selectedHubId()}&member_id=eq.${qv(btn.dataset.toggleVip)}&select=tier`));
      const vip = Array.isArray(current.data) && current.data[0]?.tier === "vip";
      await req(rootPath("creator_hub_subscribers", `hub_id=eq.${selectedHubId()}&member_id=eq.${qv(btn.dataset.toggleVip)}`), { method: "PATCH", body: JSON.stringify({ tier: vip ? "subscriber" : "vip" }) });
      return drawPage();
    }
    if (btn.dataset.removeSubscriber) {
      await req(rootPath("creator_hub_subscribers", `hub_id=eq.${selectedHubId()}&member_id=eq.${qv(btn.dataset.removeSubscriber)}`), { method: "DELETE" }); return drawPage();
    }
    if (btn.dataset.saveCategory !== undefined) return saveCategory();
    if (btn.dataset.deleteCategory) {
      await req(rootPath("creator_hub_categories", `id=eq.${Number(btn.dataset.deleteCategory)}&hub_id=eq.${selectedHubId()}`), { method: "DELETE" }); return drawPage();
    }
    if (btn.dataset.previewArticle) {
      const a = state.articleRows.find((x) => Number(x.id) === Number(btn.dataset.previewArticle));
      if (!a) return;
      const dlg = showDialog(t("cw.preview"), `<article class="cw-preview"><h2>${esc(a.title || "")}</h2>${a.thumb ? `<img class="cw-preview-thumb" src="${esc(a.thumb)}" alt="" />` : ""}<div>${safePreviewHtml(a.body_html || a.body || "")}</div></article>`);
      dlg.querySelector("[data-dialog-submit]")?.remove();
      return;
    }
    if (btn.dataset.publishArticle) {
      const r = await req(rootPath("community_articles", `id=eq.${Number(btn.dataset.publishArticle)}&member_id=eq.${qv(state.member.member_id)}`), { method: "PATCH", body: JSON.stringify({ status: "published", publish_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      if (!r.ok) C.toast(t("cw.saveFailed")); else C.toast(t("cw.saved"));
      return drawPage();
    }
    if (btn.dataset.associateType) {
      const body = { hub_id: selectedHubId(), content_type: btn.dataset.associateType, content_id: btn.dataset.rowId, title: btn.dataset.rowTitle || "", thumb_url: btn.dataset.rowThumb || "", href: btn.dataset.rowHref || "", visibility: btn.dataset.rowVis || "public" };
      const r = await req(rootPath("creator_hub_items", ""), { method: "POST", body: JSON.stringify(body), headers: { Prefer: "resolution=merge-duplicates,return=minimal" } });
      if (!r.ok) C.toast(t("cw.saveFailed")); return drawPage();
    }
    if (btn.dataset.unlinkType) {
      await req(rootPath("creator_hub_items", `hub_id=eq.${selectedHubId()}&content_type=eq.${qv(btn.dataset.unlinkType)}&content_id=eq.${qv(btn.dataset.rowId)}`), { method: "DELETE" }); return drawPage();
    }
    if (btn.dataset.deleteDocument) {
      if (!confirm(t("cw.confirmDelete"))) return;
      const result = await window.CineAuraDocs?.removeDocument(btn.dataset.deleteDocument, state.member.member_id);
      if (!result?.ok) return C.toast(t("cw.deleteFailed"));
      return drawPage();
    }
    if (btn.dataset.deleteVideo) {
      if (!confirm(t("cw.confirmDelete"))) return;
      const r = await C.rpc("content_delete", { p_member: state.member.member_id, p_id: btn.dataset.deleteVideo }).catch(() => null);
      if (!r?.ok || r.data?.ok === false) return C.toast(t("cw.deleteFailed"));
      return drawPage();
    }
    if (btn.dataset.deleteRow) {
      if (!confirm(t("cw.confirmDelete"))) return;
      const table = btn.dataset.deleteRow;
      if (table === "creator_hub_items") await req(rootPath(table, `hub_id=eq.${selectedHubId()}&content_type=eq.${qv(state.kind === "channel" ? "podcast" : "book")}&content_id=eq.${qv(btn.dataset.rowId)}`), { method: "DELETE" });
      else await req(rootPath(table, `id=eq.${qv(btn.dataset.rowId)}&member_id=eq.${qv(state.member.member_id)}`), { method: "DELETE" });
      return drawPage();
    }
    if (btn.hasAttribute("data-close-dialog")) return $("#cw-dialog", root).close();
  }
  root.addEventListener("change", async (e) => {
    if (e.target.matches("[data-hub-select]")) {
      if (e.target.value === "__add") { e.target.value = String(selectedHubId() || ""); return openHubForm(); }
      state.hub = state.hubs.find((x) => Number(x.id) === Number(e.target.value)) || null;
      localStorage.setItem(`cw-hub-${state.kind}`, String(state.hub?.id || ""));
      state.categories = state.hub ? await loadArray("creator_hub_categories", `hub_id=eq.${Number(state.hub.id)}`, "depth.asc,sort_order.asc") : [];
      return drawPage();
    }
    if (e.target.matches("[data-add-content]")) openSimpleForm(e.target.value);
  });
  async function saveCategory() {
    const name = $("#cw-cat-name", root).value.trim();
    const parentId = $("#cw-cat-parent", root).value;
    if (!name) return;
    const parent = state.categories.find((x) => Number(x.id) === Number(parentId));
    const depth = parent ? Number(parent.depth) + 1 : 1;
    if (depth > 3) return C.toast(t("cw.categoryDepthError"));
    const res = await req(rootPath("creator_hub_categories", ""), { method: "POST", body: JSON.stringify({ hub_id: selectedHubId(), parent_id: parent ? Number(parent.id) : null, name, depth }) });
    if (!res.ok) return C.toast(t("cw.saveFailed"));
    await drawPage();
  }
  async function openPassForm() {
    const dlg = showDialog(t("cw.addPass"), `<form id="cw-pass-form" class="cw-form"><label>${esc(t("cw.password"))}<input name="password" required minlength="4" /></label><label>${esc(t("cw.passDuration"))}<select name="duration"><option value="1">1 ${esc(t("cw.hour"))}</option><option value="24">24 ${esc(t("cw.hours"))}</option><option value="168">7 ${esc(t("cw.days"))}</option><option value="720">30 ${esc(t("cw.days"))}</option></select></label><label class="wide">${esc(t("cw.allowedIds"))}<textarea name="ids" placeholder="${esc(t("cw.idsHint"))}"></textarea></label></form>`);
    dlg.querySelector("[data-dialog-submit]").onclick = async () => {
      const f = $("#cw-pass-form", dlg); if (!f.reportValidity()) return;
      const fd = new FormData(f); const expires = new Date(Date.now() + Number(fd.get("duration")) * 3600000).toISOString();
      const password_hash = await C.sha256(String(fd.get("password")));
      const allowed_member_ids = String(fd.get("ids") || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
      const r = await req(rootPath("creator_hub_passes", ""), { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ hub_id: selectedHubId(), password_hash, allowed_member_ids, expires_at: expires, created_by: state.member.member_id }) });
      if (!r.ok) return C.toast(t("cw.saveFailed")); dlg.close(); C.toast(t("cw.saved"));
    };
  }
  async function openStaffForm() {
    const current = await loadArray("creator_hub_staff", `hub_id=eq.${selectedHubId()}`, "added_at.asc");
    const dlg = showDialog(t("cw.manageStaff"), `<p class="cw-muted">${esc(t("cw.staffHint"))}</p><div class="cw-inline"><input id="cw-staff-id" placeholder="${esc(t("cw.memberId"))}" /><select id="cw-staff-role"><option value="manager">Manager</option><option value="editor">Editor</option><option value="moderator">Moderator</option></select><button type="button" class="btn btn-ghost" data-add-staff>${esc(t("cw.add"))}</button></div><div class="cw-list" style="margin-top:12px">${current.map((x) => `<div class="cw-sub"><span>${esc(x.member_id)} · ${esc(x.role)}</span><button type="button" class="btn btn-sm btn-danger" data-remove-staff="${esc(x.member_id)}">${esc(t("cw.remove"))}</button></div>`).join("")}</div>`);
    dlg.querySelector("[data-add-staff]").onclick = async () => {
      const member_id = $("#cw-staff-id", dlg).value.trim(); const role = $("#cw-staff-role", dlg).value;
      if (!member_id) return;
      const r = await req(rootPath("creator_hub_staff", ""), { method: "POST", body: JSON.stringify({ hub_id: selectedHubId(), member_id, role }), headers: { Prefer: "resolution=merge-duplicates,return=minimal" } });
      if (!r.ok) return C.toast(t("cw.saveFailed")); dlg.close(); openStaffForm();
    };
    dlg.querySelectorAll("[data-remove-staff]").forEach((b) => b.onclick = async () => { await req(rootPath("creator_hub_staff", `hub_id=eq.${selectedHubId()}&member_id=eq.${qv(b.dataset.removeStaff)}`), { method: "DELETE" }); dlg.close(); openStaffForm(); });
  }
  root.addEventListener("click", (e) => {
    if (e.target.matches("[data-dialog-submit]") && !e.target.onclick) e.preventDefault();
  });
  document.addEventListener("cineaura:lang", () => {
    if (!state.member) { document.title = t("cw.title"); return; }
    document.title = t("cw.title"); drawShell(); drawPage();
  });
  init().catch((err) => { console.error(err); root.innerHTML = `<section class="glass cw-empty"><h1>${esc(t("cw.error"))}</h1><p>${esc(t("cw.loadFail"))}</p></section>`; });
})();
