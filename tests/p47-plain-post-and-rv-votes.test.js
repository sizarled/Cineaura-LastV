// Task 47: plain text posts + market review votes (+ follow-up scope fix).
//   node tests/p47-plain-post-and-rv-votes.test.js
const { read, make } = require("./lib/harness");
const { ok, has, count, done } = make();

// ---------------- A. plain post kind
const sqlPl = read("sql/plain_posts.sql");
has("A1: constraint widened", sqlPl, "check (kind in ('playlist', 'recommendation', 'reclist', 'account', 'review', 'post'))");
has("A1: drops the old constraint first", sqlPl, "drop constraint if exists posts_kind_check");
has("A1: pgrst reload", sqlPl, "notify pgrst, 'reload schema';");

const js = read("js/profile.js");
has("A2: Post is the default Studio kind", js, ': "post";\n    box.innerHTML = `');
has("A3: every kind is one chip (no hidden default)", js, 'data-sk="${k}">${studioKindLabel(k)}</button>');
has("A4: plain posts open the rich composer", js, "drawRichComposer(host, kind);");
has("A5: picker optional for posts", js, 'kind === "post" ? t("cr.attachOpt")');
has("A6: posts skip the items check", js, 'if (kind !== "post" && !d.items.length) return toast(kind === "review" ? t("rev.needTitle") : t("rich.needItem"));');
has("A7: posts need only body", js, 'if (!body) return toast(t("prof.needPostText"));');
has("A8: other kinds unchanged", js, 'else if (!title || !body) return toast(kind === "review" ? t("rev.needText") : "Title and text are required.");');
has("A9: kindLabel for post", js, 'if (kind === "post") return t("prof.plainPost");');
has("A10: updates noun for post", js, 'if (kind === "post") return t("prof.updNounPost");');
count("A11: empty-title h3 tamed on both card templates", js, '${p.title ? `<h3>${escapeHtml(p.title)}</h3>` : ""}', 2);
has("A12: bell line falls back to body", js, 'String(p?.body || "").split("\\n")[0].slice(0, 60)');
has("A13: manager header fallback", js, '${escapeHtml(post.title || t("rich.untitled"))}');
has("A14: RICH_KINDS not widened", js, 'const RICH_KINDS = ["recommendation", "reclist", "review"];');

// ---------------- B. market review votes
const sqlRv = read("sql/market_review_votes.sql");
has("B1: votes table", sqlRv, "create table if not exists public.market_review_votes");
has("B2: review FK cascade", sqlRv, "references public.market_reviews(id) on delete cascade");
has("B3: one vote per member", sqlRv, "primary key (review_id, member_id)");
has("B4: vote check", sqlRv, "check (vote in ('up', 'down'))");
has("B5: +30/−30 points fn", sqlRv, "create or replace function public.mkt_review_points(p_review_id bigint)");
count("B6: +30 & −30 arms", sqlRv, "30 * (select count(*)::int from public.market_review_votes v", 2);
has("B7: table grant", sqlRv, "grant select, insert, update, delete on public.market_review_votes to anon, authenticated;");
has("B8: pgrst reload", sqlRv, "notify pgrst, 'reload schema';");

const mk = read("js/market-forms.js");
has("B9: thumbs-down icon", mk, "thumbDn: svg('<g transform=");
has("B10: helpful button", mk, 'data-mi-act="rv-up"');
has("B11: not-helpful button", mk, 'data-mi-act="rv-down"');
has("B12: my vote highlighted", mk, 'item.rv_mine === "up" ? "btn-vote-on" : "btn-ghost"');
has("B13: points chip on card", mk, 'class="muted mkt-rv-pts"');
has("B14: points = 30 × votes", mk, "M.fmt(rvUp * 30)");
count("B15: enrich helper", mk, "M.enrichReviewVotes = async (items) => {", 1);
has("B16: enrich reads votes table via imported helper", mk, "sbReq(`/rest/v1/market_review_votes?review_id=in.(${ids.join(\",\")})");
has("B16b: REST helpers imported from CineAura", mk, "supabaseRequest: sbReq, restValue: restV");
has("B17: safe defaults when table missing", mk, "x.rv_up = 0; x.rv_down = 0; x.rv_mine = \"\";");
has("B18: owner can't vote own review", mk, 'if (item.mine) return C.toast(t("mkt.rv.ownerCant"));');
has("B19: old vote removed before insert", mk, "/rest/v1/market_review_votes?review_id=eq.${restV(id)}&member_id=eq.${restV(me)}");
has("B20: vote insert payload", mk, 'body: JSON.stringify({ review_id: id, member_id: me, username: M.username(), vote: choice })');
has("B21: recount after vote", mk, "market_review_votes?review_id=eq.${restV(id)}&select=member_id,vote");
has("B22: card repainted in place", mk, "card.outerHTML = M.itemHtml(item)");
has("B23: toast reuses post wording", mk, 'C.toast(choice === "up" ? t("prof.youUp") : t("prof.youDown"))');
has("B24: failure toast", mk, 't("mkt.rv.voteFail")');
ok("B27: no bare helper calls left in market-forms", !mk.includes("await supabaseRequest(") && !mk.includes("${restValue("));
has("B28: rvId digits-only guard", mk, 'replace(/\\D/g, "")');
has("B29: unparsable id -> graceful fail", mk, 'if (!id) return C.toast(t("mkt.rv.voteFail"));');

has("B25: market tab enriches votes", js, "await M.enrichReviewVotes?.(mk.items);");
has("B26: updates feed enriches votes", js, "await MK?.enrichReviewVotes?.(mfeed.items);");

// ---------------- C. SQL escaping fix
const pr = read("sql/post_reach.sql");
ok("C1: no backslash-quote anywhere in post_reach.sql", !pr.includes("\\'"));
has("C2: post''s doubled", pr, "post''s reach budget");

// ---------------- D. translations
const en = read("js/i18n.js");
const EK = {
  "prof.plainPost": "Post", "prof.updNounPost": "the post", "cr.attachOpt": "Attach titles (optional)",
  "prof.needPostText": "Write the post first.", "mkt.rv.helpful": "Helpful ({n})",
  "mkt.rv.notHelpful": "Not helpful ({n})", "mkt.rv.ptsLine": "+{pos} · −{neg} points",
  "mkt.rv.ownerCant": "You can't rate your own review.", "mkt.rv.voteFail": "Couldn't save the vote. Try again.",
};
Object.entries(EK).forEach(([k, v]) => has(`D: engine ${k}`, en, `"${k}": "${v}"`));

const TR = {
  "the post": { english: "the post", arabic: "المنشور", french: "la publication", german: "der Beitrag", italian: "il post", spanish: "la publicación", dutch: "het bericht" },
  "Attach titles (optional)": { english: "Attach titles (optional)", arabic: "أرفق عناوين (اختياري)", french: "Joindre des titres (optionnel)", german: "Titel anhängen (optional)", italian: "Allega titoli (facoltativo)", spanish: "Adjuntar títulos (opcional)", dutch: "Titels bijvoegen (optioneel)" },
  "Write the post first.": { english: "Write the post first.", arabic: "اكتب المنشور أولاً.", french: "Écrivez d'abord la publication.", german: "Schreib zuerst den Beitrag.", italian: "Scrivi prima il post.", spanish: "Escribe primero la publicación.", dutch: "Schrijf eerst het bericht." },
  "Helpful ({n})": { english: "Helpful ({n})", arabic: "مفيد ({n})", french: "Utile ({n})", german: "Hilfreich ({n})", italian: "Utile ({n})", spanish: "Útil ({n})", dutch: "Nuttig ({n})" },
  "Not helpful ({n})": { english: "Not helpful ({n})", arabic: "غير مفيد ({n})", french: "Pas utile ({n})", german: "Nicht hilfreich ({n})", italian: "Non utile ({n})", spanish: "No útil ({n})", dutch: "Niet nuttig ({n})" },
  "+{pos} · −{neg} points": { english: "+{pos} · −{neg} points", arabic: "+{pos} · −{neg} نقطة", french: "+{pos} · −{neg} points", german: "+{pos} · −{neg} Punkte", italian: "+{pos} · −{neg} punti", spanish: "+{pos} · −{neg} puntos", dutch: "+{pos} · −{neg} punten" },
  "You can't rate your own review.": { english: "You can't rate your own review.", arabic: "لا يمكنك تقييم مراجعتك الخاصة.", french: "Vous ne pouvez pas noter votre propre avis.", german: "Du kannst deine eigene Rezension nicht bewerten.", italian: "Non puoi valutare la tua recensione.", spanish: "No puedes valorar tu propia reseña.", dutch: "Je kunt je eigen review niet beoordelen." },
  "Couldn't save the vote. Try again.": { english: "Couldn't save the vote. Try again.", arabic: "تعذّر حفظ التصويت. حاول مرة أخرى.", french: "Impossible d'enregistrer le vote. Réessayez.", german: "Stimme konnte nicht gespeichert werden. Versuch es erneut.", italian: "Impossibile salvare il voto. Riprova.", spanish: "No se pudo guardar el voto. Inténtalo de nuevo.", dutch: "Kon de stem niet opslaan. Probeer het opnieuw." },
};
["english", "arabic", "french", "german", "italian", "spanish", "dutch"].forEach((lg) => {
  const pjs = read(`lang/${lg}.js`);
  const plng = read(`lang/${lg}.lng`);
  Object.entries(TR).forEach(([sentence, m]) => {
    has(`D: ${lg}.js ${sentence.slice(0, 18)}`, pjs, `"${sentence}": "${m[lg]}"`);
    has(`D: ${lg}.lng ${sentence.slice(0, 18)}`, plng.split("\n").find((r) => r.startsWith(`${sentence} = `)) || "", `${sentence} = ${m[lg]}`);
  });
});
["english", "arabic", "french", "german", "italian", "spanish", "dutch"].forEach((lg) => {
  count(`D: ${lg}.js single Helpful`, read(`lang/${lg}.js`), '"Helpful ({n})":', 1);
});

// ---------------- E. small CSS
const mc = read("css/market.css");
has("E1: points chip style", mc, ".mkt-rv-pts {");
has("E2: vote-on available on market pages", mc, ".btn.btn-vote-on {");

done();
