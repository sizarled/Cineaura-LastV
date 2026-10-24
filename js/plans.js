// Home > Plans & Pricing, fed live from Panel > Plans (sql/plans.sql): the
// price, the pricing system (money / points / both), how many months a buy
// says, and the perks every card lists. The markup in index.html stays the
// fallback — should the table or the answer be missing, the page shows the
// static cards exactly as before.

(() => {
  "use strict";

  const grid = document.querySelector("#plans .plans-grid");
  if (!grid) return;

  // Perk lines that ship translated in every language file: hand them their
  // data-i18n key so a language switch re-translates the card by itself.
  // (Custom lines simply render untranslated until a key exists.)
  const PERK_KEYS = {
    "Registration required": "home.plan.reg",
    "Watch all movies & series": "home.plan.watch",
    "Free IPTV channels": "home.plan.freeIptv",
    "Free + premium IPTV": "home.plan.bothIptv",
    "Quality up to 1080p": "home.plan.q",
    "Viewing with ads": "home.plan.ads",
    "Ad-free viewing": "home.plan.noads",
    "Publish watch links": "home.plan.links",
    "Win prizes": "home.plan.prizes",
    "Share recommendations & reviews": "home.plan.recs",
    "Up to 5 access codes": "home.plan.codes5",
    "Up to 10 access codes": "home.plan.codes10",
  };
  const RIBBON_KEYS = { "Most Popular": "home.plan.popular" };

  const C = window.CineAura;
  const t = (k, v) => (C?.t ? C.t(k, v) : k);
  const esc = (s) => (C?.esc ? C.esc(String(s ?? "")) : String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])));
  const money = (cents) => {
    const v = Number(cents || 0) / 100;
    return `$${Number.isInteger(v) ? v : v.toFixed(2)}`;
  };
  // An inline translation right now (for keyless, dynamic text).
  const tr = (s) => (C?.tr ? C.tr(String(s)) : String(s));
  // data-i18n + fallback text: the language file re-fills it on every switch.
  const i18nSpan = (key, raw) => `<span data-i18n="${esc(key)}">${esc(tr(raw))}</span>`;

  const CHECK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12L10 17L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

  function termHtml(p) {
    const months = Math.max(1, Number(p.months || 1));
    if (months === 1) return `<p class="plan-term">${i18nSpan("home.plan.valid1", "Access code valid for 1 month")}</p>`;
    return `<p class="plan-term">${esc(t("ptsShop.term", { m: months }))}</p>`;
  }

  function priceHtml(p) {
    const cents = Number(p.price_usd_cents || 0);
    const pts = p.mode !== "money" && p.price_points != null ? Number(p.price_points) : null;
    const months = Math.max(1, Number(p.months || 1));
    const per = p.mode === "points"
      ? ""
      : (months === 1
          ? i18nSpan("home.plan.month", "/ month")
          : `<span>/ ${esc(t("ptsShop.term", { m: months }))}</span>`);
    const big = p.mode === "points" ? t("ptsShop.price", { n: pts ?? 0 }) : money(cents);
    return `<div class="plan-price"><strong>${esc(big)}</strong>${per}</div>`;
  }

  function cardHtml(p) {
    const name = p.plan || "";
    const lower = name.toLowerCase();
    const ribbon = String(p.ribbon || "").trim();
    const ribbonHtml = ribbon
      ? `<div class="plan-ribbon">${RIBBON_KEYS[ribbon] ? i18nSpan(RIBBON_KEYS[ribbon], ribbon) : `<span>${esc(tr(ribbon))}</span>`}</div>`
      : "";
    const perks = Array.isArray(p.perks) ? p.perks : [];
    const pts = p.mode !== "money" && p.price_points != null ? Number(p.price_points) : null;
    const ptsLine = p.mode === "both" && pts != null
      ? `<p class="plan-term plan-pts">${esc(t("ptsShop.price", { n: pts }))}</p>`
      : "";
    const free = lower === "free";
    const cta = free
      ? { href: "./register.html", key: "home.plan.start", label: "Start Free" }
      : { href: `./register.html?plan=${encodeURIComponent(lower)}`, key: `home.plan.${lower}`, label: `Choose ${name}` };
    return `
      <article class="glass plan ${esc(lower)}">
        ${ribbonHtml}
        <h3 class="plan-name">${esc(tr(name))}</h3>
        ${priceHtml(p)}
        ${termHtml(p)}
        ${ptsLine}
        <ul>
          ${perks.map((line) => `<li>${CHECK}${PERK_KEYS[line] ? i18nSpan(PERK_KEYS[line], line) : `<span>${esc(tr(line))}</span>`}</li>`).join("")}
        </ul>
        <a class="btn ${lower === "gold" ? "btn-primary" : "btn-ghost"}" href="${esc(cta.href)}">${i18nSpan(cta.key, cta.label)}</a>
      </article>`;
  }

  let last = null; // last healthy answer, re-rendered on a language switch
  function render(plans) {
    last = plans;
    grid.innerHTML = plans.map(cardHtml).join("");
  }

  async function load() {
    try {
      if (!C?.rpc) return;
      const res = await C.rpc("plans_public");
      if (res.ok && res.data?.ok && Array.isArray(res.data.plans) && res.data.plans.length) render(res.data.plans);
    } catch { /* the static cards in the page stay up */ }
  }

  // A language switch re-translates every data-i18n span; the few keyless,
  // dynamic texts (extra months, custom ribbons, custom perks) follow on a
  // re-render.
  new MutationObserver(() => { if (last) render(last); }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  load();
})();
