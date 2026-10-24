// Home page — "Follow us": the site's social accounts in the footer
// (#social-strip). The links come from platforms_public() (sql/platforms.sql);
// until that migration runs, the same accounts are shown from the seed below so
// the strip is never empty.
(() => {
  const SLOT = () => document.getElementById("social-strip");
  const P = () => window.CineAuraPlatforms;
  const t = (key) => (window.CineAura && typeof window.CineAura.t === "function" ? window.CineAura.t(key) : key);

  // mirrors the insert block of sql/platforms.sql (Platforms.txt)
  const SEED_LINKS = [
    ["youtube", "https://www.youtube.com/@CineauraV2"],
    ["facebook", "https://www.facebook.com/CineauraV2"],
    ["facebook", "https://web.facebook.com/groups/2011674376679254"],
    ["instagram", "https://www.instagram.com/cineaurav2/"],
    ["tiktok", "https://www.tiktok.com/@cineauraV2"],
    ["telegram", "https://t.me/CineauraV2"],
    ["reddit", "https://www.reddit.com/r/Cineaura2"],
    ["pinterest", "https://www.pinterest.com/CineauraV2"],
    ["quora", "https://msaht-cineaurav2arabic.quora.com"],
    ["tumblr", "https://www.tumblr.com/cineaura-officiel-v2"],
    ["rumble", "https://rumble.com/c/c-7972430"],
    ["odysee", "https://odysee.com/@CineauraV2:c10d9b2863"],
    ["vimeo", "https://vimeo.com/channels/1972980"],
    ["bilibili", "https://www.bilibili.tv/en/space/1861102337"],
  ];

  async function links() {
    const C = window.CineAura;
    if (C && typeof C.rpc === "function") {
      try {
        const res = await C.rpc("platforms_public");
        const rows = res?.ok && Array.isArray(res.data) ? res.data : [];
        if (rows.length) return rows.map((r) => [r.platform, r.url]).filter(([k, u]) => k && /^https:\/\//.test(u || ""));
      } catch {
        /* migration not run yet — the seed below carries the strip */
      }
    }
    return SEED_LINKS;
  }

  /* the big horizontally-scrollable icon track of the home Platforms section */
  function drawTrack(items) {
    const track = document.getElementById("home-platforms-track");
    const pf = P();
    if (!track || !pf) return;
    track.innerHTML = items
      .filter(([k, u]) => pf.known(k) && u)
      .map(([k, u]) => {
        const p = pf.info(k);
        return `<a class="hpl-item" href="${u}" target="_blank" rel="noopener noreferrer" title="${p.name}">
          ${pf.badge(k, 56)}<b>${p.name}</b>
        </a>`;
      })
      .join("") + `<a class="hpl-item" href="mailto:${pf.EMAIL}" title="${pf.EMAIL}">
          <span class="pf-badge" style="width:56px;height:56px;background:#0d253f;border:1px solid var(--line)"><img class="pf-badge-img" src="icons/platforms/email.svg" alt="" width="30" height="30" /></span>
          <b>${t("home.social.email")}</b>
        </a>`;
  }

  function draw(items) {
    drawTrack(items);
    const slot = SLOT();
    if (!slot) return;
    const pf = P();
    if (!pf) return;
    const chips = items
      .filter(([k, u]) => pf.known(k) && u)
      .map(([k, u]) => {
        const p = pf.info(k);
        return `<a href="${u}" target="_blank" rel="noopener noreferrer" title="${p.name}">${pf.badge(k, 22)}<span>${p.name}</span></a>`;
      })
      .join("");
    slot.innerHTML = `
      <div class="pf-strip-head">
        <h4 data-i18n="home.social.h">${t("home.social.h")}</h4>
      </div>
      <div class="pf-strip" role="list">
        ${chips}
        <a href="mailto:${pf.EMAIL}" title="${pf.EMAIL}"><span class="pf-badge" style="width:22px;height:22px;background:#0d253f;border:1px solid var(--line)" aria-hidden="true"><img class="pf-badge-img" src="icons/platforms/email.svg" alt="" width="14" height="14" /></span><span>${t("home.social.email")}</span></a>
      </div>`;
  }

  async function init() {
    if (!SLOT() && !document.getElementById("home-platforms-track")) return;
    const items = await links();
    draw(items);
  }

  // rebuilt when the language flips (the Email chip is translated)
  document.addEventListener("cineaura:prefs", async () => draw(await links()));

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
