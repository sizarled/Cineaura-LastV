(() => {
  const {
    $,
    $$,
    setupChrome,
    getSession,
    toast,
    supabaseRequest,
    restValue,
    escapeHtml,
    normalizeAccountStatus,
    t,
  } = window.CineAura;

  const LOCKER_ID = "13897974-6da6-11f1-a2d7-8a5fb7be40ea";
  // The Patreon page of the premium codes is set in Panel > Settings (sql/point_codes.sql);
  // the Patreon home page until then.
  let PATREON_URL = window.CineAura.PATREON_DEFAULT || "https://www.patreon.com/";
  window.CineAura.siteLink?.("patreon_plans").then((url) => {
    PATREON_URL = url;
  });
  // 2026-10-20: plans are MONTHLY (every premium plan buys one month, renewed each month)
  const PLANS = {
    Free: { months: 1, duration: "1 month", price: "$0" },
    Silver: { months: 1, duration: "1 month", price: "$5" },
    Gold: { months: 1, duration: "1 month", price: "$10" },
    Diamond: { months: 1, duration: "1 month", price: "$20" },
  };

  const state = {
    member: null,
    acct: null, // account_check(): the day of the ban while the account waits (sql/account_deadline.sql)
    mode: null,
    plan: null,
    bio: "",
    avatar: "",
    ip: "",
    mpcat: null,      // the points shop's price list (sql/membership_points.sql); null until deployed
    catalogTried: false,
  };

  const PREMIUM = ["Silver", "Gold", "Diamond"];
  // The memberships' fixed ladder — "change the upgrade" only ever climbs it.
  const PLAN_ORDER = { Free: 0, Silver: 1, Gold: 2, Diamond: 3 };
  const LOCKERS = [
    { key: "CPAGRIP", run: () => (typeof window.call_locker === "function" ? (window.call_locker(), true) : false) },
    { key: "ADBEUMEDIA", run: () => (typeof window._ET === "function" ? (window._ET(), true) : false) },
    { key: "Mylead", run: () => (typeof window.showLocker === "function" ? (window.showLocker(LOCKER_ID), true) : false) },
  ];

  const dots = (n, on) =>
    `<div class="step-dots">${Array.from({ length: n }, (_, i) => `<span class="${i < on ? "on" : ""}"></span>`).join("")}</div>`;

  function monthsFromDuration(text, fallbackPlan) {
    const raw = String(text || "").toLowerCase().trim();
    const num = parseInt(raw, 10);
    if (Number.isFinite(num) && num > 0) {
      if (raw.includes("year")) return num * 12;
      if (raw.includes("week")) return Math.max(1, Math.round((num * 7) / 30));
      if (raw.includes("day")) return Math.max(1, Math.ceil(num / 30));
      return num;
    }
    return PLANS[fallbackPlan]?.months || 1;
  }

  function durationLabel(months) {
    return months === 1 ? "1 month" : `${months} months`;
  }

  function expiresFrom(months) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d;
  }

  function dateLabel(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return d.toISOString().slice(0, 10);
  }

  function tableMissing(res) {
    return res?.data?.code === "PGRST205" || /could not find the table/i.test(JSON.stringify(res?.data || {}));
  }

  async function loadMember(id) {
    const res = await supabaseRequest(`/rest/v1/members?member_id=eq.${restValue(id)}&select=*`);
    return res.ok && res.data?.[0] ? res.data[0] : null;
  }

  async function detectIp() {
    try {
      const r = await fetch("https://api.ipify.org?format=json");
      const j = await r.json();
      state.ip = j.ip || "";
    } catch {
      state.ip = "";
    }
  }

  // The points shop behind the upgrade buttons (sql/membership_points.sql).
  // Missing RPC → the page simply falls back to its historic code-only flow.
  async function loadCatalog() {
    if (state.catalogTried) return state.mpcat;
    state.catalogTried = true;
    try {
      const res = await window.CineAura.rpc("membership_points_catalog", { p_member: state.member.member_id });
      if (res.ok && res.data?.ok) state.mpcat = res.data;
    } catch {
      /* membership-points shop not deployed yet on this site */
    }
    return state.mpcat;
  }

  function pointsPrice(plan) {
    const p = state.mpcat?.plans?.find((x) => x.plan === plan);
    return p && Number(p.price_points) > 0 ? Number(p.price_points) : null;
  }

  // The money price the Panel set (Panel > Plans → sql/plans.sql); the hard
  // price in PLANS only lasts until the catalog answers.
  function moneyPrice(plan, fallback) {
    const p = state.mpcat?.plans?.find((x) => x.plan === plan);
    return p && p.price_usd_cents != null ? `$${Number(p.price_usd_cents) / 100}` : fallback;
  }

  // One tap: the same atomic spend + plan hand-over the dashboard shop uses.
  async function buyWithPoints(plan, alertBox) {
    const price = pointsPrice(plan);
    let out = null;
    try {
      const res = await window.CineAura.rpc("membership_buy_with_points", {
        p_member: state.member.member_id,
        p_plan: plan,
      });
      if (res.ok) out = res.data;
    } catch {
      out = null;
    }
    if (!out?.ok) {
      const msg = out?.reason === "no_points"
        ? t("act.needPoints", { p: Number(out.price || price || 0), a: Number(out.available || 0) })
        : t("act.buyFail");
      if (alertBox) {
        alertBox.className = "form-alert show error";
        alertBox.textContent = msg;
      } else {
        toast(msg);
      }
      return false;
    }
    state.plan = plan;
    const months = Number(out.months) || 0;
    Object.assign(state.member, {
      status: "active",
      membership_type: plan,
      membership_expires_at: out.expires_at,
      membership_duration: months ? `${months} ${months === 1 ? "month" : "months"}` : state.member.membership_duration,
    });
    state.mpcat = null;
    state.catalogTried = false;
    stepSuccess({ ok: true, end: new Date(out.expires_at), extended: Boolean(out.extended), months });
    return true;
  }

  async function saveProfile() {
    const patch = {
      bio: state.bio,
      avatar_url: state.avatar,
      membership_type: state.plan,
    };
    const existing = await supabaseRequest(
      `/rest/v1/profiles?member_id=eq.${restValue(state.member.member_id)}&select=member_id`
    );
    if (existing.data?.[0]) {
      await supabaseRequest(`/rest/v1/profiles?member_id=eq.${restValue(state.member.member_id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      return;
    }
    await supabaseRequest("/rest/v1/profiles", {
      method: "POST",
      body: JSON.stringify({
        member_id: state.member.member_id,
        username: state.member.username,
        country: state.member.country || "",
        ...patch,
      }),
    });
  }

  async function applyMembership({ months, duration }) {
    const start = new Date();
    const end = expiresFrom(months);
    const body = {
      status: "active",
      membership_type: state.plan,
      membership_duration: duration || durationLabel(months),
      membership_expires_at: end.toISOString(),
    };
    const mem = await supabaseRequest(
      `/rest/v1/members?member_id=eq.${restValue(state.member.member_id)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    );
    if (!mem.ok) return { ok: false, message: t("act.memberFail") };
    Object.assign(state.member, body);
    return { ok: true, start, end };
  }

  // Why the server refused a code (sql/packages.sql account_code_redeem).
  const CODE_ERRORS = {
    invalid: "act.invalid", not_found: "act.invalid", used: "act.used", used_mine: "act.usedMine", other: "act.other",
    expired: "act.codeExpired", locked: "points.err.locked", banned: "act.banned", member: "act.notFound",
  };
  function codeError(r) {
    if (r.reason === "first_free") return t("act.err.firstFree");
    if (r.reason === "mode") return t(r.for === "activate" ? "act.err.forActivate" : "act.err.forReactivate");
    if (r.reason === "audience") return t(`pack.no.${["membership", "country", "language", "level", "age"].includes(r.why) ? r.why : "fit"}`);
    let text = t(CODE_ERRORS[r.reason] || "act.consumeFail");
    if (r.reason === "not_found" && Number.isFinite(Number(r.left)) && Number(r.left) <= 3) text += ` ${t("points.err.left", { n: Number(r.left) })}`;
    return text;
  }

  async function consumeCode(code) {
    const clean = String(code || "").replace(/\s+/g, "").trim();
    if (!clean) return { ok: false, message: t("act.enter") };
    // Every code is checked and used on the server (sql/packages.sql): the account codes of Panel >
    // Packages (their plan and months come with the code) and the one-use codes of activation.sql.
    const srv = await window.CineAura.rpc("account_code_redeem", { p_member: state.member.member_id, p_code: clean, p_ip: state.ip || "" }).catch(() => null);
    const missing = !srv || srv.status === 404 || ["PGRST202", "42883"].includes(srv.data?.code);
    if (!missing) {
      if (!srv.ok || !srv.data) return { ok: false, message: t("act.consumeFail") };
      const r = srv.data;
      if (!r.ok) return { ok: false, message: codeError(r) };
      state.plan = r.plan;
      Object.assign(state.member, {
        status: "active", membership_type: r.plan, membership_duration: r.duration, membership_expires_at: r.expires_at,
      });
      return { ok: true, start: new Date(), end: new Date(r.expires_at), extended: Boolean(r.extended), months: Number(r.months) || 0 };
    }
    // without sql/packages.sql: the code of activation.sql, read and used from the page as before
    const res = await supabaseRequest(
      `/rest/v1/activation?activation_code=eq.${restValue(clean)}&select=*`
    );
    if (tableMissing(res)) {
      return { ok: false, message: t("act.missing") };
    }
    const row = res.ok && res.data?.[0];
    if (!row) return { ok: false, message: t("act.invalid") };
    if (row.used) return { ok: false, message: t("act.used") };
    if (row.member_id && row.member_id !== state.member.member_id) {
      return { ok: false, message: t("act.other") };
    }
    if (row.membership_type && row.membership_type !== state.plan) {
      return { ok: false, message: `This code is for ${row.membership_type}, not ${state.plan}.` };
    }
    const months = monthsFromDuration(row.duration, state.plan);
    const duration = row.duration || durationLabel(months);
    const start = new Date();
    const end = expiresFrom(months);
    const patch = await supabaseRequest(
      `/rest/v1/activation?activation_code=eq.${restValue(clean)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          member_id: state.member.member_id,
          membership_type: state.plan,
          duration,
          started_at: start.toISOString(),
          expires_at: end.toISOString(),
          ip: state.ip,
          country: state.member.country || "",
          used: true,
          used_at: start.toISOString(),
          kind: state.mode,
        }),
      }
    );
    if (!patch.ok) return { ok: false, message: t("act.consumeFail") };
    return applyMembership({ months, duration });
  }

  async function activateFreeFirst() {
    const plan = PLANS.Free;
    const start = new Date();
    const end = expiresFrom(plan.months);
    await supabaseRequest("/rest/v1/activation", {
      method: "POST",
      body: JSON.stringify({
        activation_code: `FREE${state.member.member_id.replace(/\D/g, "")}${Date.now()}`.slice(0, 24),
        member_id: state.member.member_id,
        membership_type: "Free",
        duration: plan.duration,
        started_at: start.toISOString(),
        expires_at: end.toISOString(),
        ip: state.ip,
        country: state.member.country || "",
        used: true,
        used_at: start.toISOString(),
        kind: "activate",
      }),
    });
    return applyMembership({ months: plan.months, duration: plan.duration });
  }

  // "Get the code": the member picks one of the three locker providers —
  // CPAGRIP (call_locker), AdBlueMedia (_ET) and MyLead (showLocker, the
  // iframe loader loaded in <head>). An ad blocker that ate a provider's
  // script gets an honest line instead of a silent no-op.
  function openGetOptions() {
    $(".getcode-overlay")?.remove();
    const wrap = document.createElement("div");
    wrap.className = "getcode-overlay";
    wrap.innerHTML = `
      <div class="glass getcode-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(t("act.get.title"))}">
        <h2>${t("act.get.title")}</h2>
        <p class="muted">${t("act.get.lead")}</p>
        <div class="getcode-grid">
          ${LOCKERS.map((l) => `
            <button class="choice getcode-pick" data-locker="${l.key}" type="button">
              <strong>${l.key}</strong>
            </button>`).join("")}
        </div>
        <button class="btn btn-sm btn-ghost getcode-close" type="button">${t("act.get.close")}</button>
      </div>`;
    document.body.appendChild(wrap);
    let escOff = null;
    const close = () => {
      if (escOff) document.removeEventListener("keydown", escOff);
      wrap.remove();
    };
    escOff = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", escOff);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) close();
    });
    wrap.querySelector(".getcode-close").onclick = close;
    wrap.querySelectorAll("[data-locker]").forEach((btn) => {
      btn.onclick = () => {
        const locker = LOCKERS.find((l) => l.key === btn.dataset.locker);
        if (!locker || locker.run() === false) {
          toast(t("act.get.notLoaded"));
          return;
        }
        close();
      };
    });
  }

  function render(html) {
    $("#activate-root").innerHTML = html;
  }

  // "Activate it before …": the day this account is banned if it waits (account_check)
  function dueHtml() {
    const text = window.CineAura.accountDeadlineText?.(state.acct, "gate");
    return text ? `<p class="acct-gate-due" role="status">${text}</p>` : "";
  }

  // Never activated of its own? The SQL counts it the same way
  // (account_code_redeem: activated_at empty and not active → the first activation).
  function isFirstEver(status) {
    return !state.member.activated_at && status !== "active";
  }

  function stepChoice() {
    const current = state.member.membership_type || "Free";
    const status = normalizeAccountStatus(state.member.status);
    const firstEver = isFirstEver(status);
    /* The ladder of the choice screen:
       · first visit — one option only: "Activate the account" (Free membership);
       · afterwards — "Reactivate" (renews the CURRENT plan only) always, and
         "Change the upgrade" while a higher plan exists — never on Diamond. */
    const canChange = !firstEver && PLAN_ORDER[current] < PLAN_ORDER.Diamond;
    render(`
      <section class="glass wizard">
        ${dots(4, 1)}
        <span class="eyebrow">${t("act.eyebrow")}</span>
        <h1>${t("act.how")}</h1>
        <p class="muted">${t("act.howLead")}</p>
        <div class="success-meta">
          <div>${t("reg.username")} <strong>@${escapeHtml(state.member.username)}</strong></div>
          <div>${t("act.currentPlan")} <strong>${escapeHtml(current)}</strong></div>
          <div>${t("act.status")} <strong>${escapeHtml(status || t("dash.disabledTitle"))}</strong></div>
        </div>
        ${dueHtml()}
        <div class="choice-grid">
          ${firstEver ? `
          <button class="choice" id="pick-activate" type="button">
            <strong>${t("act.activate")}</strong>
            <p class="muted">${t("act.activateLead")}</p>
          </button>` : ""}
          ${!firstEver ? `
          <button class="choice" id="pick-reactivate" type="button">
            <strong>${t("act.reactivate")}</strong>
            <p class="muted">${t("act.reactivateLead")}</p>
          </button>` : ""}
          ${canChange ? `
          <button class="choice" id="pick-change" type="button">
            <strong>${t("act.changePlan")}</strong>
            <p class="muted">${t("act.changePlanLead")}</p>
          </button>` : ""}
        </div>
      </section>`);
    const actBtn = $("#pick-activate");
    if (actBtn) {
      actBtn.onclick = async () => {
        state.mode = "activate";
        await loadCatalog();
        stepPlanFirstFree();
      };
    }
    const reActBtn = $("#pick-reactivate");
    if (reActBtn) {
      reActBtn.onclick = async () => {
        state.mode = "reactivate";
        await loadCatalog();
        stepReactivateSummary();
      };
    }
    const changeBtn = $("#pick-change");
    if (changeBtn) {
      changeBtn.onclick = async () => {
        // premium codes are reactivation codes on the server
        state.mode = "reactivate";
        await loadCatalog();
        stepUpgrade();
      };
    }
  }

  // The FIRST activation is Free only — premium plans open afterwards,
  // as upgrades (stepUpgrade). Same rule the server applies
  // (account_code_redeem: activate-mode codes must be Free).
  function stepPlanFirstFree() {
    render(`
      <section class="glass wizard">
        ${dots(4, 2)}
        <span class="eyebrow">${t("common.membership")}</span>
        <h1>${t("act.choosePlan")}</h1>
        <p class="muted">${t("act.firstFreeNote")}</p>
        <div class="plan-pick">
          <button class="plan-card on" data-plan="Free" type="button">
            <strong>Free</strong>
            <p class="muted">${PLANS.Free.price} · ${PLANS.Free.duration}</p>
            <small>${t("act.noCodeFirst")}</small>
          </button>
        </div>
        <button class="btn btn-sm btn-ghost" id="back" type="button">${t("act.back")}</button>
      </section>`);
    $("#back").onclick = stepChoice;
    $$(".plan-card").forEach((btn) => {
      btn.onclick = () => {
        state.plan = "Free";
        stepProfile();
      };
    });
  }

  // "Change the upgrade": strictly the plans ABOVE the current one — lower
  // memberships never show, and the Diamond member never sees this tile at
  // all (nothing above it). Each plan is buyable in one tap with the points
  // shop — or with a code, exactly as memberships always were.
  function stepUpgrade() {
    const current = state.member.membership_type || "Free";
    const pool = PREMIUM.filter((name) => PLAN_ORDER[name] > PLAN_ORDER[current]);
    render(`
      <section class="glass wizard">
        ${dots(3, 2)}
        <span class="eyebrow">${t("act.changePlan")}</span>
        <h1>${t("act.changePlan")}</h1>
        <p class="muted">${t("act.changePlanLead")}</p>
        <div class="form-alert" id="up-alert"></div>
        <div class="plan-pick">
          ${pool.map((name) => {
            const p = PLANS[name];
            const pts = pointsPrice(name);
            return `
            <div class="plan-card up-card">
              <strong>${name}</strong>
              <p class="muted">${moneyPrice(name, p.price)} · ${p.duration}</p>
              ${pts ? `<p class="up-pts">${t("ptsShop.price", { n: pts })}</p>` : ""}
              ${pts ? `<button class="btn btn-sm btn-primary up-buy" data-plan="${name}" type="button">${t("act.payPoints", { n: pts })}</button>` : ""}
              <button class="btn btn-sm btn-ghost up-code" data-plan="${name}" type="button">${t("act.useCode")}</button>
            </div>`;
          }).join("")}
        </div>
        <button class="btn btn-sm btn-ghost" id="back" type="button">${t("act.back")}</button>
      </section>`);
    $("#back").onclick = stepChoice;
    $$(".up-buy").forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        await buyWithPoints(btn.dataset.plan, $("#up-alert"));
        btn.disabled = false;
      };
    });
    $$(".up-code").forEach((btn) => {
      btn.onclick = () => {
        state.plan = btn.dataset.plan;
        stepCode(true, true);
      };
    });
  }

  function stepProfile() {
    render(`
      <section class="glass wizard">
        ${dots(4, 3)}
        <span class="eyebrow">${t("act.profile")}</span>
        <h1>${t("act.createProf")}</h1>
        <p class="muted">${t("act.profLead")}</p>
        <div class="stack">
          <label class="muted">${t("reg.username")}<input value="${escapeHtml(state.member.username)}" disabled /></label>
          <label class="muted">${t("act.bio")}<textarea id="bio" placeholder="${t("act.bioPh")}">${escapeHtml(state.bio)}</textarea></label>
          ${window.CineAura.avatarFieldHtml({ id: "avatar", value: state.avatar, name: state.member.username, memberId: state.member.member_id })}
          <button class="btn btn-lg btn-primary" id="next" type="button">${t("rest.continue")}</button>
          <button class="btn btn-sm btn-ghost" id="back" type="button">${t("act.back")}</button>
        </div>
      </section>`);
    // An upload fills the link; "Continue" saves it with the rest of the profile.
    window.CineAura.wireAvatarField($("#activate-root"), {
      memberId: state.member.member_id,
      name: state.member.username,
      uploaded: (url) => {
        state.avatar = url;
      },
    });
    // the primary action is wired first, so no other assignment can ever kill it
    $("#next").onclick = async () => {
      state.bio = $("#bio")?.value.trim() || "";
      state.avatar = $("#avatar")?.value.trim() || state.avatar || "";
      const btn = $("#next");
      btn.disabled = true;
      btn.textContent = t("act.saving");
      try {
        await saveProfile();
      } catch {
        /* profile table is optional until dashboard SQL is run */
      }
      stepActivate();
    };
    $("#back").onclick = stepPlanFirstFree;
  }

  function stepReactivateSummary() {
    const m = state.member;
    const current = m.membership_type && PLANS[m.membership_type] ? m.membership_type : "Free";
    state.plan = current;
    render(`
      <section class="glass wizard">
        ${dots(3, 1)}
        <span class="eyebrow">${t("act.reactivate")}</span>
        <h1>${t("act.renew")}</h1>
        <p class="muted">${t("act.renewLead")}</p>
        <div class="success-meta">
          <div>${t("reg.username")} <strong>@${escapeHtml(m.username)}</strong></div>
          <div>${t("common.membership")} <strong>${escapeHtml(m.membership_type || "Free")}</strong></div>
          <div>${t("act.prevDur")} <strong>${escapeHtml(m.membership_duration || "1 month")}</strong></div>
          <div>${t("act.expired")} <strong>${escapeHtml(dateLabel(m.membership_expires_at))}</strong></div>
        </div>
        ${dueHtml()}
        <!-- Reactivation renews the CURRENT membership only — changing plans is
             the other tile ("Change the upgrade"), never this screen. -->
        <div class="plan-pick">
          <button class="plan-card on" data-plan="${current}" type="button" disabled>
            <strong>${current}</strong>
            <p class="muted">${moneyPrice(current, PLANS[current].price)} · ${PLANS[current].duration}</p>
          </button>
        </div>
        <p class="muted">${t("act.renewOnly")}</p>
        <div class="stack">
          <button class="btn btn-lg btn-primary" id="go" type="button">${t("act.reactivate")}</button>
          <button class="btn btn-sm btn-ghost" id="back" type="button">${t("act.back")}</button>
        </div>
      </section>`);
    $("#back").onclick = stepChoice;
    $("#go").onclick = () => stepCode(true);
  }

  function stepActivate() {
    if (state.plan === "Free") return stepFreeProgress();
    stepCode(false);
  }

  function stepFreeProgress() {
    render(`
      <section class="glass wizard">
        ${dots(4, 4)}
        <span class="eyebrow">Free</span>
        <h1>${t("act.activating")}</h1>
        <p class="muted" id="prog-msg">${t("act.waitFree")}</p>
        <div class="progress-track"><div class="progress-fill" id="bar"></div></div>
      </section>`);
    let w = 0;
    const bar = $("#bar");
    const timer = setInterval(async () => {
      w += 4;
      bar.style.width = `${Math.min(w, 100)}%`;
      if (w < 100) return;
      clearInterval(timer);
      const result = await activateFreeFirst();
      if (!result.ok) {
        $("#prog-msg").textContent = result.message || t("act.fail");
        return;
      }
      stepSuccess(result);
    }, 80);
  }

  function stepCode(isReactivate, fromUpgrade) {
    const premium = state.plan !== "Free";
    const pts = premium ? pointsPrice(state.plan) : null;
    const backFn = fromUpgrade ? stepUpgrade : isReactivate ? stepReactivateSummary : stepProfile;
    render(`
      <section class="glass wizard">
        ${dots(isReactivate ? 3 : 4, isReactivate ? 3 : 4)}
        <span class="eyebrow">${escapeHtml(state.plan)}</span>
        <h1>${t("act.enter")}</h1>
        <p class="muted">${t("act.codesOnce")}</p>
        <div class="form-alert" id="code-alert"></div>
        <div class="stack">
          <label class="muted">${t("act.actCode")}<input id="act-code" placeholder="${t("act.paste")}" autocomplete="off" /></label>
          <button class="btn btn-lg btn-primary" id="use-code" type="button">${t("act.activateAcc")}</button>
          ${pts ? `<button class="btn btn-lg btn-ghost" id="pay-points" type="button">${t("act.payPoints", { n: pts })}</button>` : ""}
          <button class="btn btn-lg btn-ghost" id="get-code" type="button">${fromUpgrade && premium ? t("act.patreon") : t("act.get")}</button>
          <button class="btn btn-sm btn-ghost" id="back" type="button">${t("act.back")}</button>
        </div>
      </section>`);
    $("#back").onclick = backFn;
    // Reactivation: the code comes from a locker of the member's choosing
    // (CPAGRIP / AdBlueMedia / MyLead). The upgrade keeps the Patreon door.
    $("#get-code").onclick = fromUpgrade ? () => window.open(PATREON_URL, "_blank", "noopener") : openGetOptions;
    const payBtn = $("#pay-points");
    if (payBtn) {
      payBtn.onclick = async () => {
        payBtn.disabled = true;
        await buyWithPoints(state.plan, $("#code-alert"));
        payBtn.disabled = false;
      };
    }
    $("#use-code").onclick = async () => {
      const btn = $("#use-code");
      btn.disabled = true;
      const result = await consumeCode($("#act-code").value);
      const alert = $("#code-alert");
      if (!result.ok) {
        btn.disabled = false;
        alert.className = "form-alert show error";
        alert.textContent = result.message;
        return;
      }
      stepSuccess(result);
    };
  }

  function stepSuccess(result) {
    // the day of the ban moved (or went): the banner of the other pages follows at once
    window.CineAura.accountCheck?.({ fresh: true }).catch(() => {});
    const end = result.end ? result.end.toISOString().slice(0, 10) : "";
    render(`
      <section class="glass wizard">
        <div class="check-mark" aria-hidden="true">✓</div>
        <span class="eyebrow">${t("act.done")}</span>
        <h1>${t("act.okTitle")}</h1>
        <p class="muted">${t("act.okLead", { plan: escapeHtml(state.plan), end: escapeHtml(end) })}</p>
        ${result.extended ? `<p class="muted act-extended">${t("act.extended")}</p>` : ""}
        <div class="success-meta">
          <div>${t("act.plan")} <strong>${escapeHtml(state.plan)}</strong></div>
          <div>${t("common.duration")} <strong>${result.months ? escapeHtml(t(result.months === 1 ? "pk.month1" : "pk.monthsN", { n: result.months })) : escapeHtml(state.member.membership_duration || PLANS[state.plan]?.duration || "")}</strong></div>
          <div>${t("act.until")} <strong>${escapeHtml(end)}</strong></div>
        </div>
        <div class="success-actions">
          <a class="btn btn-lg btn-primary" href="./dashboard.html">${t("auth.goDash")}</a>
        </div>
      </section>`);
    toast(t("act.ok"));
  }

  async function boot() {
    setupChrome();
    const session = getSession();
    if (!session?.member_id) {
      render(`<section class="glass wizard"><span class="eyebrow">${t("act.eyebrow")}</span><h1>${t("act.signFirst")}</h1><p class="muted">${t("act.needAcc")}</p><div class="success-actions"><a class="btn btn-lg btn-primary" href="./login.html">${t("nav.signin")}</a></div></section>`);
      return;
    }
    // an account past its 30 days is banned here (sql/account_deadline.sql)
    state.acct = await window.CineAura.accountCheck?.({ fresh: true }).catch(() => null);
    state.member = await loadMember(session.member_id);
    if (!state.member) {
      render(`<section class="glass wizard"><span class="eyebrow">${t("act.eyebrow")}</span><h1>${t("act.notFound")}</h1><div class="success-actions"><a class="btn btn-lg btn-primary" href="./login.html">${t("nav.signin")}</a></div></section>`);
      return;
    }
    if (normalizeAccountStatus(state.member.status) === "banned") {
      const why = window.CineAura.accountBanText?.(state.member.ban_reason);
      render(`<section class="glass wizard"><span class="eyebrow">${t("act.eyebrow")}</span><h1>${t("act.banned")}</h1><p class="muted">${why ? escapeHtml(why) : t("act.noAct")}</p></section>`);
      return;
    }
    const prof = await supabaseRequest(`/rest/v1/profiles?member_id=eq.${restValue(state.member.member_id)}&select=bio,avatar_url`);
    if (prof.data?.[0]) {
      state.bio = prof.data[0].bio || "";
      state.avatar = prof.data[0].avatar_url || "";
    }
    await detectIp();
    stepChoice();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
