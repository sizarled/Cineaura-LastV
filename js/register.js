(() => {
  const C = window.CineAura;
  const { $, setupChrome, t, tmdb, imgUrl } = C;
  const params = new URLSearchParams(location.search);
  const completing = params.get("complete") === "1" && Boolean(C.auth.peekSession());
  const migrating = !completing && params.get("migrate") === "1";
  const USERNAME_RE = /^[A-Za-z0-9._]{3,24}$/;

  function showAlert(message) {
    const alert = $("#form-alert");
    alert.className = "form-alert show error";
    alert.textContent = message;
  }

  async function onSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const email = String(data.email || "").trim();
    const password = String(data.password || "");
    let metadata = { legacy_account: true };
    if (!migrating) {
      const birth = new Date(String(data.birth_date || ""));
      const oldestAllowed = new Date();
      oldestAllowed.setFullYear(oldestAllowed.getFullYear() - 13);
      if (String(data.full_name || "").trim().length < 2) return showAlert(t("reg.needName"));
      if (!USERNAME_RE.test(String(data.username || ""))) return showAlert(t("reg.badUser"));
      if (!Number.isFinite(birth.getTime()) || birth > oldestAllowed || birth.getFullYear() < 1920) return showAlert(t("reg.badAge"));
      if (!String(data.country || "").trim()) return showAlert(t("reg.needCountry"));
      if (!["male", "female"].includes(data.gender)) return showAlert(t("reg.needGender"));
      metadata = {
        legacy_account: false, full_name: String(data.full_name).trim(), username: String(data.username),
        birth_date: String(data.birth_date), country: String(data.country).trim(), gender: data.gender,
        ...(C.getReferralAttribution() || {}),
      };
    }
    const button = $("#submit-btn");
    button.disabled = true;
    button.textContent = t("reg.creating");
    try {
      if (completing) {
        await C.auth.updateUser({ data: metadata });
        await C.loadAuthMember();
        location.replace("./dashboard.html");
        return;
      }
      await C.auth.signUp(email, password, metadata);
      form.reset();
      form.hidden = true;
      $("#success-card").hidden = false;
      $("#success-card").scrollIntoView({ behavior: "smooth", block: "start" });
      // Member creation/linking happens ONLY after email verification on the server.
    } catch (error) {
      showAlert(C.authErrorText(error));
    } finally {
      button.disabled = false;
      button.textContent = t("reg.create");
    }
  }

  async function setVisual() {
    try {
      const data = await tmdb("/trending/movie/week");
      const hit = (data.results || []).find((x) => x.backdrop_path);
      if (!hit) return;
      $("#auth-visual").style.backgroundImage =
        `linear-gradient(180deg, rgba(7,15,24,.18), rgba(7,15,24,.78)), url('${imgUrl(hit.backdrop_path, "w1280")}')`;
    } catch {
      /* keep CSS fallback */
    }
  }

  async function setupCountry() {
    const input = $("#country");
    const hint = $("#country-hint");
    input.placeholder = t("reg.countryDetecting");
    const cc = await C.detectGeo(true).catch(() => "");
    try {
      input.value = cc === "PS" ? "Palestine" : cc ? new Intl.DisplayNames(["en"], { type: "region" }).of(cc) : "";
    } catch { input.value = ""; }
    if (!input.value) {
      // Geolocation is a convenience, never proof of identity or a signup dependency.
      input.readOnly = false;
      input.placeholder = "";
      hint.textContent = t("auth.secure.countryManual");
    } else hint.textContent = t("reg.countryAuto");
  }

  function init() {
    setupChrome();
    if (completing) {
      const email = document.querySelector('input[name="email"]');
      email.value = C.auth.peekSession().user.email;
      email.readOnly = true;
      const password = document.querySelector('input[name="password"]');
      password.closest("label").hidden = true;
      password.disabled = true;
      const title = $("#register-form h1");
      title.dataset.i18n = "auth.secure.complete";
      title.textContent = t(title.dataset.i18n);
    }
    if (migrating) {
      for (const element of document.querySelectorAll("[data-registration-detail]")) {
        element.hidden = true;
        for (const field of element.querySelectorAll("input")) field.disabled = true;
      }
      const title = $("#register-form h1");
      const lead = $("#register-form .lead");
      title.dataset.i18n = "auth.secure.legacyTitle";
      lead.dataset.i18n = "auth.secure.legacyHelp";
      title.textContent = t(title.dataset.i18n);
      lead.textContent = t(lead.dataset.i18n);
    } else {
      void setupCountry();
      const max = new Date();
      max.setFullYear(max.getFullYear() - 13);
      const birth = document.querySelector('input[name="birth_date"]');
      birth.max = max.toISOString().slice(0, 10);
      birth.min = "1920-01-01";
    }
    $("#toggle-password").addEventListener("click", () => {
      const input = document.querySelector('input[name="password"]');
      input.type = input.type === "password" ? "text" : "password";
    });
    $("#register-form").addEventListener("submit", onSubmit);
    void setVisual();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
