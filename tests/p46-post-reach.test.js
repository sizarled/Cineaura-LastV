// Task 46: post reach & daily suggestion engine.  node tests/p46-post-reach.test.js
const { read, make } = require("./lib/harness");
const { ok, has, count, done } = make();

// ---------------------------------------------------------------- SQL
const sql = read("sql/post_reach.sql");

has("parent_id column on post_comments", sql, "alter table public.post_comments add column if not exists parent_id bigint");
has("parent_id FK cascade", sql, "references public.post_comments(id) on delete cascade");
has("parent_id index", sql, "create index if not exists post_comments_parent_idx");

has("post_surfaced table", sql, "create table if not exists public.post_surfaced");
has("post_surfaced PK day-budget", sql, "primary key (post_id, member_id, on_day)");
has("post_surfaced default UTC day", sql, "on_day date not null default ((now() at time zone 'utc')::date)");
has("post_surfaced RLS select", sql, 'create policy "post_surfaced select"');
has("post_surfaced grant select", sql, "grant select on public.post_surfaced to anon, authenticated;");

has("reach +30 up", sql, "30 * (select count(*)::int from public.post_votes v where v.post_id = p_post_id and v.vote = 'up')");
has("reach -60 valid reports", sql, "60 * (select count(*)::int from public.post_reports r where r.post_id = p_post_id and r.verdict = 'valid')");
has("day points per UTC day", sql, "(c.created_at at time zone 'utc')::date = p_day");
has("silence walks yesterday too", sql, "(now() at time zone 'utc')::date - 1");
has("silence = day end + |points| hours, cap 30d", sql, "(d + 1)::timestamptz + make_interval(hours => least((-pts)::int, 24 * 30))");
has("post_silenced wrapper", sql, "select coalesce(public.post_silenced_until(p_post_id) > now(), false)");

has("posts_gate batch fn", sql, "create or replace function public.posts_gate(p_member text, p_ids text[])");
has("gate owner exemption", sql, "or p.owner_id = p_member");
has("gate follower exemption", sql, "where f.follower_id = p_member and f.following_id = p.owner_id");
has("gate follower accepted", sql, "and f.status = 'accepted'");

has("suggestions fn", sql, "create or replace function public.post_suggestions(p_member text, p_limit int default 12)");
has("suggestions watched from views", sql, "select tmdb_id from public.views where viewer_id = p_member");
has("suggestions watched from hestory", sql, "select tmdb_id from public.hestory where visitor_id = p_member");
has("suggestions public only", sql, "where p.visibility = 'public'");
has("suggestions skip own posts", sql, "and p.owner_id <> p_member");
has("suggestions exclude silenced", sql, "and not public.post_silenced(p.post_id)");
has("suggestions match hits", sql, "pi.tmdb_id in (select tmdb_id from watched)");
has("suggestions reach budget", sql, "where reach > 0 and shown < reach and hits > 0");
has("suggestions no double surfacing", sql, "and s2.member_id = p_member");
has("suggestions log budget", sql, "insert into public.post_surfaced (post_id, member_id, on_day)");
has("suggestions log conflict-safe", sql, "on conflict do nothing");
has("suggestions expose hits+reach", sql, "jsonb_build_object('hits', sel.hits, 'reach', sel.reach)");
has("suggestions limit cap 50", sql, "limit greatest(1, least(coalesce(p_limit, 12), 50))");
has("suggestions active owners", sql, "lower(btrim(coalesce(m.status, ''))) = 'active'");

has("top members fn", sql, "create or replace function public.post_top_members(p_limit int default 12)");
has("top members positive reach only", sql, "from per_post where reach > 0");
has("top members payload", sql, "jsonb_build_object('owner_id', owner_id, 'username', username,");
has("pgrst reload", sql, "notify pgrst, 'reload schema';");
count("seven execute grants", sql, "grant execute on function public.", 7);

// sql/search.sql — silence filters with exemptions on all 3 post branches
const search = read("sql/search.sql");
count("search: 3 silence filters", search, "or not public.post_silenced(p.post_id))", 3);
count("search: 3 owner exemptions", search, "and (me = p.owner_id", 3);
count("search: 3 follower exemptions", search, "or exists (select 1 from public.follows fo", 3);
count("search: 3 accepted-status checks", search, "fo.follower_id = me and fo.following_id = p.owner_id and fo.status = 'accepted'", 3);

// ---------------------------------------------------------------- JS
const js = read("js/profile.js");

has("commentListHtml helper", js, "function commentListHtml(comments, postId)");
has("comment root guard", js, "while (x.parent_id && byId.has(x.parent_id) && guard++ < 10)");
has("reply markup class", js, '<div class="cmt${depth ? " cmt-reply" : ""}">');
has("reply button data attrs", js, 'data-reply-to="${c.parent_id ? rootOf(c) : c.id}"');
has("reply button post attr", js, 'data-reply-post="${escapeHtml(postId)}"');
has("reply button user attr", js, 'data-reply-user="${escapeHtml(c.username)}"');
has("reply respects updates block", js, 'const canReply = state.me && !blockedFeature("updates");');
count("both card templates share the renderer", js, "${commentListHtml(comments, p.post_id)}", 2);
ok("old flat comment map gone", !js.includes('${(comments || []).map((c) => `<p><a href="${profileHref(c.username)}">'));

has("reply handler", js, 'const replyBtn = e.target.closest("[data-reply-to]");');
has("reply sets parent", js, "rInp.dataset.parent = replyBtn.dataset.replyTo;");
has("reply placeholder", js, 'rInp.placeholder = t("prof.replyTo", { user: "@" + (replyBtn.dataset.replyUser || "") });');
count("comments guard (send + reply)", js, 'guardFeature("comments")', 2);
has("parent in comment POST", js, "...(parent ? { parent_id: parent } : {})");
has("focus-cmt resets reply mode", js, "delete inp.dataset.parent;");
has("send resets reply mode", js, "delete input.dataset.parent;");
ok("comment NOT double-counted as event", !js.includes('kind: "comment"'));

has("suggest section in template", js, '<section class="person-updates suggest-zone">');
has("suggest list container", js, '<div id="suggest-list">');
has("suggest eyebrow", js, '${t("prof.suggestSub")}');
has("suggest title", js, '<h2>${t("prof.suggestions")}</h2>');
has("rpc post_suggestions call", js, "/rest/v1/rpc/post_suggestions");
has("suggestions params", js, '{ p_member: state.me.member.member_id, p_limit: 12 }');
has("suggestions hide my down-votes", js, ".filter((p) => !downIds.has(p.post_id))");
has("suggestions prefetch items", js, "/rest/v1/post_items?post_id=in.(${sIds})");
has("suggestions card lead i18n", js, 't("prof.suggestLead", { actor })');
has("suggestions hits chip", js, 't("prof.suggestHits", { n: p.hits })');
has("suggestions reuse post card", js, "postCardInnerHtml(p, iMap[p.post_id] || [], vMap[p.post_id] || [], cMap[p.post_id] || [])");
count("suggest click bound on both paths", js, '$("#suggest-list").onclick = (e) => {', 2);

count("posts_gate RPC calls", js, "/rest/v1/rpc/posts_gate", 2);
has("updates gate before posts fetch", js, "body: JSON.stringify({ p_member: state.me.member.member_id, p_ids: candIds })");
has("updates rows filtered by gate", js, "rows = rows.filter((r) => okIds.has(r.post_id));");
has("search gate anonymous-safe", js, '{ p_member: state.me?.member?.member_id || "", p_ids: visible.map((p) => p.post_id) }');
has("search results filtered", js, "gated = visible.filter((p) => okIds.has(p.post_id));");
has("search renders gated", js, "results.innerHTML = gated.map((p) => {");

has("tab renamed to Find", js, 'data-stab="profiles">${t("prof.find")}</button>');
has("leader-board container", js, '<div id="q-top"></div>');
has("top members RPC", js, "/rest/v1/rpc/post_top_members");
has("top members limit", js, '{ p_limit: 12 }');
has("leader-board heading", js, '<h2>${t("prof.topMembers")}</h2>');
has("leader-board meta i18n", js, 't("prof.topMemberMeta", { n: Number(r.posts || 0), pts: Number(r.reach || 0) })');
has("visit button kept", js, 'href="${profileHref(r.username)}">${t("common.visit")}</a>');

has("suggestions draw as hoisted fn", js, "async function drawSuggestions()");
has("early path draws suggestions too", js, "the suggestions block still has content to offer.");
ok("down-vote set hoisted above template", js.indexOf("const downIds =") < js.indexOf('body.innerHTML = `\n      <div class="filter-bar">'));

// ---------------------------------------------------------------- i18n
const en = read("js/i18n.js");
const EK = {
  "prof.find": "Find",
  "prof.suggestions": "Suggestions",
  "prof.suggestSub": "Picked from what you watch",
  "prof.suggestEmpty": "No suggestions yet — watch a few titles first.",
  "prof.suggestLead": "Suggested for you: {actor}",
  "prof.suggestHits": "{n} of your watched titles inside",
  "prof.topMembers": "Most reached members",
  "prof.topMemberMeta": "{n} posts · {pts} reach",
  "prof.reachPts": "reach points",
  "prof.reply": "Reply",
  "prof.replyTo": "Reply to {user}",
};
Object.entries(EK).forEach(([k, v]) => has(`engine key ${k}`, en, `"${k}": "${v}"`));

const TR = {
  "Picked from what you watch": {
    english: "Picked from what you watch", arabic: "مختارة مما تشاهده",
    french: "Sélectionnées d'après ce que vous regardez", german: "Ausgewählt nach dem, was du dir ansiehst",
    italian: "Scelti in base a ciò che guardi", spanish: "Elegido según lo que ves", dutch: "Gekozen op basis van wat jij kijkt",
  },
  "Suggestions": {
    english: "Suggestions", arabic: "الاقتراحات", french: "Suggestions", german: "Vorschläge",
    italian: "Suggerimenti", spanish: "Sugerencias", dutch: "Suggesties",
  },
  "No suggestions yet — watch a few titles first.": {
    english: "No suggestions yet — watch a few titles first.", arabic: "لا اقتراحات بعد — شاهد بعض العناوين أولاً.",
    french: "Aucune suggestion pour l'instant — regardez d'abord quelques titres.",
    german: "Noch keine Vorschläge — schau dir zuerst ein paar Titel an.",
    italian: "Nessun suggerimento per ora — guarda prima qualche titolo.",
    spanish: "Aún no hay sugerencias — mira primero algunos títulos.", dutch: "Nog geen suggesties — bekijk eerst een paar titels.",
  },
  "Suggested for you: {actor}": {
    english: "Suggested for you: {actor}", arabic: "مقترح لك: {actor}", french: "Suggéré pour vous : {actor}",
    german: "Für dich vorgeschlagen: {actor}", italian: "Suggerito per te: {actor}",
    spanish: "Sugerido para ti: {actor}", dutch: "Voor jou gesuggereerd: {actor}",
  },
  "{n} of your watched titles inside": {
    english: "{n} of your watched titles inside", arabic: "{n} من العناوين التي شاهدتها بداخله",
    french: "{n} de vos titres vus à l'intérieur", german: "{n} deiner gesehenen Titel darin",
    italian: "{n} dei tuoi titoli visti al suo interno", spanish: "{n} de tus títulos vistos dentro",
    dutch: "{n} van jouw bekeken titels erin",
  },
  "Most reached members": {
    english: "Most reached members", arabic: "الأعضاء الأكثر وصولاً",
    french: "Membres au plus grand rayonnement", german: "Mitglieder mit der größten Reichweite",
    italian: "Membri più raggiunti", spanish: "Miembros con más alcance", dutch: "Meest bereikte leden",
  },
  "{n} posts · {pts} reach": {
    english: "{n} posts · {pts} reach", arabic: "{n} منشورات · {pts} وصول",
    french: "{n} publications · {pts} de rayonnement", german: "{n} Beiträge · {pts} Reichweite",
    italian: "{n} post · {pts} di reach", spanish: "{n} publicaciones · {pts} de alcance",
    dutch: "{n} berichten · {pts} bereik",
  },
  "reach points": {
    english: "reach points", arabic: "نقاط الوصول", french: "points de rayonnement",
    german: "Reichweiten-Punkte", italian: "punti di reach", spanish: "puntos de alcance", dutch: "bereikpunten",
  },
  "Reply to {user}": {
    english: "Reply to {user}", arabic: "رد على {user}", french: "Répondre à {user}",
    german: "{user} antworten", italian: "Rispondi a {user}", spanish: "Responder a {user}", dutch: "{user} beantwoorden",
  },
};
const LANGS = ["english", "arabic", "french", "german", "italian", "spanish", "dutch"];
LANGS.forEach((lg) => {
  const pjs = read(`lang/${lg}.js`);
  const plng = read(`lang/${lg}.lng`);
  Object.entries(TR).forEach(([sentence, m]) => {
    has(`${lg}.js: ${sentence.slice(0, 24)}`, pjs, `"${sentence}": "${m[lg]}"`);
    has(`${lg}.lng: ${sentence.slice(0, 24)}`, plng, `${sentence} = ${m[lg]}`);
  });
});
LANGS.forEach((lg) => {
  const pjs = read(`lang/${lg}.js`);
  count(`${lg}.js single Reply-to`, pjs, '"Reply to {user}":', 1);
  count(`${lg}.js single Suggestions`, pjs, '"Suggestions":', 1);
});

// ---------------------------------------------------------------- CSS
const css = read("css/profile.css");
has("reply indent", css, ".cmt-reply { margin-inline-start: 22px;");
has("reply button style", css, ".cmt-reply-btn {");
has("reply mode input highlight", css, "input[data-parent] { border-color: var(--cyan);");
has("suggest zone spacing", css, ".suggest-zone {");

done();
