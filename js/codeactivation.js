/* CineAura — Patreon code activation page (codeactivation.html).
 *
 * The visitor types his Patreon account into the box, then the page walks him
 * through Patreon's own OAuth sign-in. Back here with Patreon's answer, the
 * page calls the edge function (supabase/functions/patreon-claim) — that one
 * alone holds the client secret, talks to the Patreon API, confirms the paid
 * membership of OUR campaign, and pulls ONE unused code out of the stock
 * (a membership activation code, or a points serial). The same Patreon
 * account again gets the same code back, so nobody can farm the stock.
 *
 * The code ends up here, big and plain, with two buttons: copy, and download
 * a small .txt the visitor can keep.
 *
 * Setup (owner only):
 *   1. Run sql/patreon.sql in the Supabase SQL editor.
 *   2. supabase functions deploy patreon-claim
 *   3. supabase secrets set PATREON_CLIENT_ID=… PATREON_CLIENT_SECRET=… PATREON_CAMPAIGN_ID=…
 *   4. In the Patreon client settings (Developers → My clients) register the
 *      EXACT redirect URI this page prints in the DevTools console below.
 */
(() => {
  "use strict";

  const C = window.CineAura || {};
  const t = (k, p) => (typeof C.t === "function" ? C.t(k, p) : k);
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* SETUP — the public client id of the Patreon client (App "Ceneaura").
     The secret never appears in any file of the site: it lives only in the
     edge function's environment (supabase secrets set PATREON_CLIENT_SECRET…). */
  const CONFIG = {
    clientId: "2sNmjkMRCpWrpSkHCx3x5RRPXdN2mQb4lhQTycevlklvLW_XMWZ7DnfQ0ZAvJXfI",
    redirectUri: `${location.origin}${location.pathname}`,
    edgeUrl: `${(C.SUPABASE_URL || "").replace(/\/$/, "")}/functions/v1/patreon-claim`,
  };
  console.info("[codeactivation] register this EXACT redirect URI in the Patreon client settings:", CONFIG.redirectUri);

  const root = document.getElementById("ca-root");
  const stateKey = "cineaura_ca_state";

  const readState = () => {
    try { return JSON.parse(sessionStorage.getItem(stateKey) || "null"); } catch { return null; }
  };
  const writeState = (obj) => {
    try { sessionStorage.setItem(stateKey, JSON.stringify(obj)); } catch { /* private mode */ }
  };

  function box() {
    root.innerHTML = `
      <div class="ca-card">
        <p class="eyebrow">${t("ca.kicker")}</p>
        <h1>${t("ca.title")}</h1>
        <p class="muted">${t("ca.lead")}</p>
        <label class="ca-field">
          <span>${t("ca.accountLabel")}</span>
          <input id="ca-account" type="text" autocomplete="off" spellcheck="false"
                 placeholder="${t("ca.accountPh")}" dir="ltr" />
        </label>
        <button class="btn btn-primary" id="ca-go" type="button">${t("ca.verify")}</button>
        <p class="ca-note"><a href="https://www.patreon.com/cw/Workora" target="_blank" rel="noopener noreferrer">${t("ca.campaign")}</a></p>
        <p class="ca-note">${t("ca.notePrivacy")}</p>
      </div>`;
    const input = document.getElementById("ca-account");
    input.focus();
    input.onkeydown = (e) => { if (e.key === "Enter") document.getElementById("ca-go").click(); };
    document.getElementById("ca-go").onclick = () => {
      const account = input.value.trim();
      if (!account) {
        input.focus();
        C.toast?.(t("ca.accountNeed"));
        return;
      }
      const saved = readState() || {};
      saved.account = account;
      saved.nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
      writeState(saved);
      window.location.assign(oauthUrl(saved.nonce));
    };
  }

  function oauthUrl(nonce) {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: CONFIG.clientId,
      redirect_uri: CONFIG.redirectUri,
      scope: "identity identity.memberships identity[email]",
      state: nonce,
    });
    return `https://www.patreon.com/oauth2/authorize?${q.toString()}`;
  }

  function renderError(reason, extra) {
    const map = {
      oauth_failed: "ca.oauthFailed",
      oauth_denied: "ca.cancelled",
      not_patron: "ca.notPatron",
      not_active: "ca.notActive",
      sold_out: "ca.soldOut",
      not_configured: "ca.notConfigured",
      bad_state: "ca.badState",
      sql_missing: "ca.sqlMissing",
      banned: "ca.banned",
      net: "ca.netFail",
    };
    const key = map[reason] || "ca.netFail";
    root.innerHTML = `
      <div class="ca-card ca-card-err">
        <p class="ca-err-ic" aria-hidden="true">✕</p>
        <h1>${t("ca.errTitle")}</h1>
        <p class="muted">${t(key, extra)}</p>
        <button class="btn btn-ghost" id="ca-retry" type="button">${t("ca.again")}</button>
      </div>`;
    document.getElementById("ca-retry").onclick = () => {
      history.replaceState(null, "", CONFIG.redirectUri);
      box();
    };
  }

  function renderCode() {
    const res = window.__ca_result || {};
    const kindLabel = res.kind === "membership" ? t("ca.kindMembership") : t("ca.kindPoints");
    let detailLine = "";
    if (res.kind === "membership" && res.detail?.membership_type) {
      detailLine = escapeHtml(`${res.detail.membership_type} · ${res.detail.duration || ""}`.trim());
    } else if (res.kind === "points" && res.detail?.points) {
      detailLine = escapeHtml(t("ca.pointsValue", { n: res.detail.points }));
    }
    root.innerHTML = `
      <div class="ca-card ca-card-ok">
        <p class="ca-ok-ic" aria-hidden="true">✓</p>
        <h1>${t("ca.okTitle")}</h1>
        <p class="muted">${res.reused ? t("ca.okAgain") : t("ca.okLead")}</p>
        <div class="ca-code" id="ca-code" dir="ltr">${escapeHtml(res.code)}</div>
        <p class="ca-kind">${kindLabel}${detailLine ? ` · ${detailLine}` : ""}</p>
        <div class="ca-actions">
          <button class="btn btn-primary" id="ca-copy" type="button">${t("ca.copy")}</button>
          <button class="btn btn-ghost" id="ca-dl" type="button">${t("ca.download")}</button>
        </div>
        <p class="ca-note">${t(kindLabel === t("ca.kindMembership") ? "ca.howUseMembership" : "ca.howUsePoints")}</p>
      </div>`;
    const btn = document.getElementById("ca-copy");
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(res.code);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = res.code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      btn.textContent = t("ca.copied");
      btn.classList.add("is-ok");
    };
    document.getElementById("ca-dl").onclick = () => {
      const lines = [
        t("ca.txtHead"),
        ``,
        `${t("ca.txtCode")}: ${res.code}`,
        `${t("ca.txtKind")}: ${kindLabel}${detailLine ? ` (${res.detail?.membership_type || res.detail?.points || ""}${res.detail?.duration ? ` · ${res.detail.duration}` : ""}${res.kind === "points" && res.detail?.points ? " pts" : ""})` : ""}`,
        ``,
        t("ca.txtWhereCineAura"),
      ];
      const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "cineaura-activation-code.txt";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
    };
  }

  async function finish(oauthCode) {
    root.innerHTML = `
      <div class="ca-card">
        <div class="ca-spin" aria-hidden="true"></div>
        <h1>${t("ca.checking")}</h1>
        <p class="muted">${t("ca.checkingLead")}</p>
      </div>`;
    let out = null;
    try {
      const resp = await fetch(CONFIG.edgeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-info": "cineaura-web" },
        body: JSON.stringify({
          code: oauthCode,
          redirect_uri: CONFIG.redirectUri,
          account: (readState() || {}).account || "",
        }),
      });
      out = await resp.json();
    } catch {
      out = { ok: false, reason: "net" };
    }
    if (out?.ok && out.code) {
      window.__ca_result = out;
      history.replaceState(null, "", CONFIG.redirectUri);
      renderCode();
      return;
    }
    renderError(out?.reason || "net", { msg: out?.msg || "" });
  }

  // ── boot ────────────────────────────────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  const oauthCode = params.get("code");
  const error = params.get("error");
  const state = params.get("state") || "";
  if (oauthCode) {
    const saved = readState();
    if (saved?.nonce && state === saved.nonce) {
      finish(oauthCode);
    } else if (saved?.nonce) {
      renderError("bad_state");
    } else {
      // The session row was lost between the two tabs' visits — one retry is
      // a refresh away, never a hard wall.
      finish(oauthCode);
    }
  } else if (error) {
    renderError(error === "access_denied" ? "oauth_denied" : "oauth_failed");
  } else {
    box();
  }
})();
