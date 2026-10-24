/* platform.html — the social-network LINKING page.
 * Opened from Panel > Platforms ("Link a network") or Panel > Settings.
 *
 *   platform.html            → the grid of available networks; linked ones
 *                              carry a green tick.
 *   platform.html#youtube    → the full-page form of that one network (the
 *                              hash is case-insensitive: #Youtube works too):
 *                              page URL, publish day, API credentials
 *                              (write-only: a blank field keeps what is
 *                              stored) and the webhook URL, then the Link
 *                              button.
 *   Success → a "Linked!" banner with "Link another network" underneath;
 *   failure → a "Linking failed" banner with the error and its reason.
 *
 * Needs a Panel staff session (the platforms_* RPCs); without one the page
 * explains to open the Panel first.
 */
(function () {
  "use strict";
  const $ = (sel, root = document) => root.querySelector(sel);
  const C = () => window.CineAura || {};
  const t = (k, vars) => (typeof C().t === "function" ? C().t(k, vars) : k);
  const esc = (s) => (typeof C().escapeHtml === "function" ? C().escapeHtml(s) : String(s ?? ""));
  const P = () => window.CineAuraPlatforms || { list: [], known: () => false, info: (k) => ({ key: k, name: k }), badge: () => "", CRED_FIELDS: {} };

  const PANEL_KEY = "cineaura_panel"; // the Panel's staff session
  function sessionToken() {
    try {
      const row = JSON.parse(sessionStorage.getItem(PANEL_KEY) || localStorage.getItem(PANEL_KEY) || "null");
      return (row && row.token) || "";
    } catch { return ""; }
  }

  let cfg = {};        // platform_settings rows by platform
  let linkedOverride = {}; // green ticks updated live after a successful link
  let currentForm = "";    // which network's form is on screen

  const dayLabel = (d) => (d === null || d === undefined || d === "" || Number.isNaN(Number(d)) ? t("panel.pf.every") : t("panel.pf.d." + Number(d)));
  const isLinked = (key) => (linkedOverride[key] !== undefined ? linkedOverride[key] : cfg[key]?.enabled === true);

  async function loadConfig() {
    const res = await C().rpc("platforms_config", { p_token: sessionToken() }).catch(() => null);
    const raw = JSON.stringify(res?.data || res || {});
    if (res == null) return { net: false };
    if (/staff_forbidden|staff_auth|401|403/.test(raw)) return { net: true, forbidden: true };
    cfg = {};
    if (res.ok && Array.isArray(res.data)) res.data.forEach((r) => (cfg[r.platform] = r));
    return { net: true };
  }

  /* ── the networks grid ── */
  function drawGrid(root) {
    document.title = "CineAura · " + t("platform.pageTitle");
    root.innerHTML = `
      <header class="pfg-hero">
        <h1>${t("platform.pageTitle")}</h1>
        <p class="muted">${t("platform.lead")}</p>
      </header>
      <div class="pfg-grid">
        ${P().list.map((p) => {
          const linked = isLinked(p.key);
          const row = cfg[p.key] || {};
          return `<a class="pfg-card${linked ? " linked" : ""}" href="#${p.key}" data-net="${p.key}">
            ${linked ? `<span class="pfg-tick" title="${esc(t("platform.linked"))}">✓</span>` : ""}
            <span class="pfg-badge">${P().badge(p.key, 46)}</span>
            <span class="pfg-name">${p.name}</span>
            <span class="pfg-state ${linked ? "on" : "off"}">${t(linked ? "platform.linked" : "platform.unlinked")}</span>
            ${row.profile_url ? `<span class="pfg-url" dir="ltr">${esc(row.profile_url.replace(/^https?:\/\//, ""))}</span>` : ""}
            ${row.publish_day !== null && row.publish_day !== undefined ? `<span class="pfg-day">${dayLabel(row.publish_day)}</span>` : ""}
          </a>`;
        }).join("")}
      </div>
      <p class="muted pfg-mail">${t("platform.anyQ")} · <a href="mailto:${P().EMAIL}" dir="ltr">${P().EMAIL}</a></p>`;
  }

  /* ── one network: the full-page link form ── */
  function credsSummary(creds, key) {
    const fields = (P().CRED_FIELDS[key] || []).filter((f) => String(creds?.[f] || "").trim());
    return fields.length + (String(creds?.webhook_url || "").trim() ? 1 : 0);
  }

  function drawForm(root, key) {
    const p = P().info(key);
    const row = cfg[key] || {};
    const creds = row.credentials && typeof row.credentials === "object" ? row.credentials : {};
    const fields = P().CRED_FIELDS[key] || [];
    document.title = `CineAura · ${p.name} — ${t("platform.link.short")}`;
    root.innerHTML = `
      <div class="pfg-form-top">
        <button class="btn btn-sm btn-ghost" type="button" data-back>← ${t("platform.back")}</button>
      </div>
      <header class="pfg-hero">
        <div class="pfg-form-badge">${P().badge(key, 64)}</div>
        <h1>${t("platform.formH", { name: p.name })}</h1>
        <p class="muted">${t(p.api === false ? "platform.formLeadHook" : "platform.formLead")}</p>
      </header>
      <form class="pf-box pfg-form" data-form novalidate>
        <div class="pfg-row">
          <label class="lang-chip pfg-switch"><input type="checkbox" data-f-enabled checked /> ${t("platform.enabled")}</label>
        </div>
        <div class="pfg-grid2">
          <label>${t("platform.pageUrl")}
            <input type="url" dir="ltr" data-f-url placeholder="https://…" maxlength="500" value="${esc(row.profile_url || "")}" />
          </label>
          <label>${t("platform.publishDay")}
            <select data-f-day>
              <option value="" ${row.publish_day === null || row.publish_day === undefined ? "selected" : ""}>${t("panel.pf.every")}</option>
              ${[0, 1, 2, 3, 4, 5, 6].map((d) => `<option value="${d}" ${Number(row.publish_day) === d ? "selected" : ""}>${t("panel.pf.d." + d)}</option>`).join("")}
            </select>
          </label>
        </div>
        <h3 class="pfg-sub">${t("platform.credsTitle")} <span class="pfg-kept muted" data-kept-label>${credsSummary(creds, key) ? t("panel.pf.credsSet", { n: credsSummary(creds, key) }) : t("panel.pf.credsNone")}</span></h3>
        <p class="muted">${t("platform.credsNote")}</p>
        <div class="pfg-grid2" data-creds>
          ${fields.map((f) => `<label dir="ltr">${esc(f)}
            <input type="password" autocomplete="off" dir="ltr" data-f-cred="${f}" placeholder="${esc(creds[f] ? "••••••" : "")}" />
            <input type="hidden" data-f-kept="${f}" value="${esc(String(creds[f] || ""))}" />
          </label>`).join("")}
        </div>
        ${!fields.length ? `<p class="muted">${t("panel.pf.noApiNote")}</p>` : ""}
        <label>${t("platform.webhook")}
          <input type="url" dir="ltr" data-f-cred="webhook_url" maxlength="1000" placeholder="https://…" value="${esc(creds.webhook_url || "")}" />
        </label>
        <p class="muted">${t("platform.webhookNote")}</p>
        <div class="pfg-actions">
          <button class="btn btn-primary pfg-link-btn" type="submit" data-f-link>${t("platform.linkBtn", { name: p.name })}</button>
        </div>
        <div data-result></div>
      </form>`;

    root.querySelector("[data-back]").addEventListener("click", () => { location.hash = ""; });
    const form = root.querySelector("[data-form]");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("[data-f-link]");
      const out = form.querySelector("[data-result]");
      const url = form.querySelector("[data-f-url]").value.trim();
      if (url && !/^https:\/\/[^/?#\s<>"`]+/i.test(url)) return linkFail(out, "bad_url");
      // merge: typed credential replaces; blank keeps the stored one; webhook explicit
      const creds = {};
      form.querySelectorAll("[data-f-cred]").forEach((inp) => {
        const f = inp.dataset.fCred;
        const kept = form.querySelector(`[data-f-kept="${f}"]`)?.value || "";
        const typed = inp.value.trim();
        if (f === "webhook_url" ? true : typed || kept) creds[f] = typed || kept;
      });
      const dayRaw = form.querySelector("[data-f-day]").value;
      btn.disabled = true;
      out.innerHTML = `<p class="muted">${t("platform.linking")}…</p>`;
      const res = await C().rpc("platforms_settings_save", {
        p_token: sessionToken(), p_platform: key,
        p_enabled: form.querySelector("[data-f-enabled]").checked,
        p_profile_url: url, p_publish_day: dayRaw === "" ? null : Number(dayRaw),
        p_credentials: creds,
      }).catch(() => null);
      btn.disabled = false;
      const raw = JSON.stringify(res?.data || res || {});
      const err = /staff_forbidden/.test(raw) ? "staff_forbidden"
        : /staff_auth|401|403/.test(raw) ? "staff_auth"
        : res?.ok && res.data?.ok !== false ? ""
        : res?.data?.error || (res?.ok ? "unknown" : "network");
      if (err) return linkFail(out, err);
      linkedOverride[key] = form.querySelector("[data-f-enabled]").checked;
      await loadConfig();
      out.innerHTML = `
        <div class="pfg-msg ok">
          <div class="pfg-msg-icon">✓</div>
          <h3>${t("platform.linkSuccess", { name: p.name })}</h3>
          <p class="muted">${t("platform.linkSuccessSub")}</p>
          <button class="btn btn-primary" type="button" data-another>${t("platform.linkAnother")}</button>
        </div>`;
      out.querySelector("[data-another]").addEventListener("click", () => { location.hash = ""; });
    });
  }

  function linkFail(out, reason) {
    const label = t("platform.reason." + reason);
    out.innerHTML = `
      <div class="pfg-msg fail">
        <div class="pfg-msg-icon">✗</div>
        <h3>${t("platform.linkFail")}</h3>
        <p>${label.startsWith("platform.reason.") ? t("platform.reason.unknown") : label}</p>
        <p class="muted" dir="ltr" style="word-break:break-all">${esc(reason)}</p>
        <button class="btn btn-ghost" type="button" data-another>${t("platform.back")}</button>
      </div>`;
    out.querySelector("[data-another]").addEventListener("click", () => { location.hash = ""; });
  }

  /* ── gate + router ── */
  async function route() {
    const root = $("#pfg-root");
    if (!root) return;
    if (!sessionToken()) {
      root.innerHTML = `
        <div class="pf-box pfg-gate">
          <h3>${t("platform.needStaff")}</h3>
          <p class="muted">${t("platform.needStaffSub")}</p>
          <p><a class="btn btn-primary" href="panel.html">${t("platform.goPanel")}</a></p>
        </div>`;
      return;
    }
    const key = location.hash.replace(/^#/, "").trim().toLowerCase();
    if (key && P().known(key)) {
      if (currentForm !== key || !root.querySelector("[data-form]")) drawForm(root, key);
      currentForm = key;
      return;
    }
    currentForm = "";
    if (!Object.keys(cfg).length && !root.querySelector(".pfg-grid")) root.innerHTML = `<p class="muted" style="text-align:center">${t("common.loading")}…</p>`;
    const st = await loadConfig();
    if (st.forbidden) {
      root.innerHTML = `
        <div class="pf-box pfg-gate">
          <h3>${t("platform.needStaff")}</h3>
          <p class="muted">${t("platform.forbidden")}</p>
          <p><a class="btn btn-primary" href="panel.html">${t("platform.goPanel")}</a></p>
        </div>`;
      return;
    }
    drawGrid(root);
  }

  function init() {
    window.addEventListener("hashchange", route);
    route();
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
  window.CineAuraPlatformPage = { route };
})();
