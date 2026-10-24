// Panel > Plans — the four memberships' prices and say. Edit a plan's dollar
// price, its points price and the pricing system (money only, points only, or
// both at once), how many months one buy says, the homepage perks and ribbon,
// and whether the card shows on the homepage at all. Reads/writes go through
// plans_admin / plans_save (sql/plans.sql); the same rows answer the homepage
// (plans_public), the Activate page and the points membership shop.

(() => {
  "use strict";

  const PA = window.CineAuraPanelAdmin;
  if (!PA) return;
  const K = PA.kit;
  const C = window.CineAura;
  const { t, escapeHtml: esc, toast } = C;

  const MODES = ["money", "points", "both"];
  let RATE = 100; // the withdrawal rate plans_admin answers with (points per $1)

  function planCard(p) {
    const name = p.plan;
    const free = name === "Free";
    const cents = Number(p.price_usd_cents || 0);
    const approx = Math.ceil((cents / 100) * RATE);
    const done = [p.updated_at ? String(p.updated_at).slice(0, 16).replace("T", " ") : "", p.updated_by].filter(Boolean);
    // The permissions block (sql/plans_settings.sql): normalized server-side, so a
    // site that has not run the migration yet falls back to today's numbers.
    const s0 = p.settings && typeof p.settings === "object" ? p.settings : {};
    const s = {
      ad_free: Boolean(s0.ad_free ?? !free),
      daily: Number(s0.daily_uploads ?? 50),
      batch: Number(s0.batch_uploads ?? 1),
      codesMax: Number(s0.codes_max ?? (free ? 5 : 10)),
      codeMonths: Number(s0.code_months ?? (free ? 1 : name === "Silver" ? 3 : name === "Gold" ? 6 : 12)),
      turns: s0.withdraw_turns == null ? "" : Number(s0.withdraw_turns),
      cap: Number(s0.level_cap ?? (name === "Diamond" ? 10 : name === "Gold" ? 8 : name === "Silver" ? 5 : 2)),
    };
    return `
      <section class="pa-box" data-plan="${esc(name)}">
        <h3>${esc(name)}</h3>
        ${free ? `<p class="muted">${esc(t("plans.free"))}</p>` : ""}
        <form class="pa-form-grid" data-pp="${esc(name)}" novalidate>
          <label><span>${esc(t("plans.f.price"))}</span>
            <input name="price" inputmode="decimal" dir="ltr" value="${esc((cents / 100).toFixed(2).replace(/\.00$/, ""))}" /></label>
          <label><span>${esc(t("plans.f.points"))}</span>
            <input name="points" inputmode="numeric" dir="ltr" value="${p.price_points == null ? "" : esc(p.price_points)}" ${free ? "disabled" : ""} /></label>
          <label><span>${esc(t("plans.f.mode"))}</span>
            <select name="mode">${MODES.map((m) => `<option value="${m}" ${m === (free ? "money" : p.mode) ? "selected" : ""}>${esc(t(`plans.mode.${m}`))}</option>`).join("")}</select></label>
          <label><span>${esc(t("plans.f.months"))}</span>
            <input name="months" type="number" min="1" max="120" step="1" dir="ltr" value="${Number(p.months || 1)}" /></label>
          <label class="wide"><span class="muted">${esc(t("plans.ptRule", { rate: K.num(RATE), n: K.num(approx) }))}</span></label>
          <label><span>${esc(t("plans.f.ribbon"))}</span>
            <input name="ribbon" maxlength="60" dir="auto" placeholder="${esc(t("plans.ribbonPh"))}" value="${esc(p.ribbon || "")}" /></label>
          <label class="pa-check"><input type="checkbox" name="visible" ${p.visible ? "checked" : ""} /> ${esc(t("plans.f.visible"))}</label>
          <label class="wide"><span>${esc(t("plans.f.perks"))}</span>
            <textarea name="perks" rows="9" spellcheck="false">${esc((Array.isArray(p.perks) ? p.perks : []).join("\n"))}</textarea>
            <small class="muted">${esc(t("plans.perksHint"))}</small></label>
          <div class="wide pa-set">
            <h4>${esc(t("plans.set.title"))}</h4>
            <p class="muted">${esc(t("plans.set.hint"))}</p>
          </div>
          <label class="pa-check"><input type="checkbox" name="s_ad_free" ${s.ad_free ? "checked" : ""} /> ${esc(t("plans.set.adFree"))}</label>
          <label><span>${esc(t("plans.set.daily"))}</span>
            <input name="s_daily" type="number" min="1" max="1000" step="1" dir="ltr" value="${s.daily}" /></label>
          <label><span>${esc(t("plans.set.batch"))}</span>
            <input name="s_batch" type="number" min="1" max="20" step="1" dir="ltr" value="${s.batch}" /></label>
          <label><span>${esc(t("plans.set.codesMax"))}</span>
            <input name="s_codesmax" type="number" min="0" max="100" step="1" dir="ltr" value="${s.codesMax}" /></label>
          <label><span>${esc(t("plans.set.codeMonths"))}</span>
            <input name="s_codemonths" type="number" min="1" max="120" step="1" dir="ltr" value="${s.codeMonths}" /></label>
          <label><span>${free ? esc(t("plans.set.turnsFree")) : esc(t("plans.set.turns"))}</span>
            <input name="s_turns" type="number" min="1" max="99" step="1" dir="ltr" value="${s.turns}" ${free ? "disabled" : ""} /></label>
          <label><span>${esc(t("plans.set.cap"))}</span>
            <input name="s_cap" type="number" min="1" max="10" step="1" dir="ltr" value="${s.cap}" /></label>
          ${done.length ? `<p class="wide muted">${esc(t("plans.savedBy", { at: done[0], by: done[1] || "—" }))}</p>` : ""}
          <div class="wide acc-actions">
            <button class="btn btn-sm btn-primary" type="submit">${esc(t("plans.save"))}</button>
          </div>
        </form>
      </section>`;
  }

  function collect(form, name) {
    const f = form.elements;
    const perks = (f.perks.value || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return {
      plan: name,
      price_usd_cents: String(Math.round(Number(f.price.value || 0) * 100)),
      price_points: (f.points.value || "").trim(),
      mode: f.mode.value || "money",
      months: (f.months.value || "").trim() || "1",
      ribbon: f.ribbon.value || "",
      visible: f.visible.checked ? "true" : "false",
      perks,
      settings: {
        ad_free: f.s_ad_free.checked ? "true" : "false",
        daily_uploads: (f.s_daily.value || "").trim(),
        batch_uploads: (f.s_batch.value || "").trim(),
        codes_max: (f.s_codesmax.value || "").trim(),
        code_months: (f.s_codemonths.value || "").trim(),
        withdraw_turns: name === "Free" ? "" : (f.s_turns.value || "").trim(),
        level_cap: (f.s_cap.value || "").trim(),
      },
    };
  }

  async function viewPlans(main) {
    main.innerHTML = `
      ${K.head(t("panel.nav.plans"), t("plans.title"), t("plans.lead"))}
      <div class="follow-pane pa-pane" id="pa-pane"></div>`;
    const pane = main.querySelector("#pa-pane");
    const r = await K.rpc("plans_admin", {});
    const d = K.data(r);
    if (!pane.isConnected) return;
    if (!d?.ok) {
      const reason = String(d?.reason || K.errKey(r) || "");
      pane.innerHTML = `<p class="muted">${esc(reason === "staff_setup" ? t("plans.missing") : t("plans.fail"))}</p>`;
      return;
    }
    RATE = Math.max(1, Number(d.rate || 100));
    const plans = d.plans || [];
    pane.innerHTML = plans.map(planCard).join("");
    pane.querySelectorAll("form[data-pp]").forEach((form) => {
      form.onsubmit = (ev) => {
        ev.preventDefault();
        K.busy(form, async () => {
          const r2 = await K.rpc("plans_save", { d: collect(form, form.dataset.pp) });
          const d2 = K.data(r2);
          if (!form.isConnected) return;
          if (d2?.ok) {
            toast(t("plans.saved", { plan: form.dataset.pp }));
            viewPlans(main); // a fresh copy of what the site now shows
          } else {
            toast(t("plans.saveFail"));
          }
        });
      };
    });
  }

  PA.add("plans", viewPlans);
})();
