/* Questions page appearance picker — shares the site's 14 styles and saved prefs. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const THEME_IDS = [
    "default", "facebook", "youtube", "instagram", "netflix", "prime", "appletv",
    "win7", "win8", "win10", "win11", "macos", "android", "ios",
  ];
  const RESET_LABELS = { ar: "إعادة تعيين", en: "Reset", fr: "Réinitialiser", de: "Zurücksetzen", es: "Restablecer", nl: "Resetten", it: "Ripristina" };
  const CURRENT_LABELS = { ar: "الحالي: ", en: "Current: ", fr: "Actuel : ", de: "Aktuell: ", es: "Actual: ", nl: "Huidig: ", it: "Attuale: " };

  function start(attempt = 0) {
    const app = window.CineAura;
    if (!app || (!window.CineauraTheme?.renderPicker && attempt < 40)) {
      if (attempt < 40) setTimeout(() => start(attempt + 1), 50);
      return;
    }

    const trigger = $("qa-theme-trigger");
    const panel = $("qa-theme-panel");
    const grid = $("qa-theme-grid");
    if (!trigger || !panel || !grid || trigger.dataset.ready === "true") return;
    trigger.dataset.ready = "true";

    const themeApi = window.CineauraTheme;
    const themeMeta = Array.isArray(themeApi?.THEMES) ? themeApi.THEMES : THEME_IDS.map((id) => ({ id, label: id }));
    if (themeApi?.renderPicker) themeApi.renderPicker(grid, app.getStyle?.() || "default");
    else renderFallbackGrid(grid, themeMeta, app.getStyle?.() || "default");

    const translate = (key, fallback) => {
      const value = app.t?.(key);
      return typeof value === "string" && value !== key ? value : fallback;
    };
    const lang = () => app.getLang?.() || document.documentElement.lang || "en";
    const patchProfile = (prefs) => {
      const session = app.getSession?.();
      if (!session?.member_id || typeof app.supabaseRequest !== "function" || typeof app.restValue !== "function") return;
      app.supabaseRequest(`/rest/v1/profiles?member_id=eq.${app.restValue(session.member_id)}`, {
        method: "PATCH",
        keepalive: true,
        body: JSON.stringify(prefs),
      }).catch(() => {});
    };
    const apply = (prefs) => {
      app.applyPrefs?.({ ...prefs, persist: true });
      patchProfile(prefs);
      sync();
    };
    const sync = () => {
      const style = app.getStyle?.() || document.documentElement.dataset.style || "default";
      const mode = app.getTheme?.() || document.documentElement.dataset.theme || "night";
      const meta = themeMeta.find((item) => item.id === style);
      const isArabic = lang() === "ar";
      const dot = trigger.querySelector(".qa-theme-dot");
      if (dot && meta?.bar) dot.style.background = meta.bar;
      trigger.setAttribute("aria-label", translate("set.theme", isArabic ? "المظهر" : "Appearance"));
      trigger.title = translate("set.theme", isArabic ? "المظهر" : "Appearance");
      panel.querySelectorAll("[data-qa-mode]").forEach((button) => {
        button.setAttribute("aria-checked", String(button.dataset.qaMode === mode));
      });
      grid.querySelectorAll("[data-style-pick]").forEach((button) => {
        const selected = button.getAttribute("data-style-pick") === style;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-checked", String(selected));
        button.setAttribute("aria-pressed", String(selected));
      });
      const modeName = mode === "day"
        ? translate("set.light", isArabic ? "نهاري" : "Light")
        : translate("set.dark", isArabic ? "ليلي" : "Dark");
      const current = $("qa-theme-current");
      if (current) current.textContent = `${CURRENT_LABELS[lang()] || "Current: "}${meta?.label || "CineAura"} · ${modeName}`;
      const reset = panel.querySelector("[data-qa-theme-reset]");
      if (reset) reset.textContent = RESET_LABELS[lang()] || "Reset";
      const heading = $("qa-theme-heading");
      if (heading) heading.textContent = translate("set.theme", isArabic ? "المظهر" : "Appearance");
    };

    let open = false;
    const openPanel = () => {
      open = true;
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      sync();
    };
    const closePanel = (returnFocus = false) => {
      open = false;
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (returnFocus) trigger.focus();
    };

    trigger.addEventListener("click", () => (open ? closePanel() : openPanel()));
    panel.querySelector("[data-qa-theme-close]")?.addEventListener("click", () => closePanel(true));
    panel.querySelectorAll("[data-qa-mode]").forEach((button) => {
      button.addEventListener("click", () => apply({ theme: button.dataset.qaMode }));
    });
    grid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-style-pick]");
      const style = button?.getAttribute("data-style-pick");
      if (THEME_IDS.includes(style)) apply({ style });
    });
    panel.querySelector("[data-qa-theme-reset]")?.addEventListener("click", () => {
      apply({ style: "default", theme: "night" });
      const resetNotice = lang() === "ar" ? "تمت إعادة المظهر الافتراضي" : "Appearance reset";
      app.toast?.(resetNotice);
    });

    document.addEventListener("click", (event) => {
      if (!open || panel.contains(event.target) || trigger.contains(event.target)) return;
      closePanel();
    });
    document.addEventListener("keydown", (event) => {
      if (open && event.key === "Escape") {
        event.preventDefault();
        closePanel(true);
      }
    });
    document.addEventListener("cineaura:prefs", sync);
    window.addEventListener("cineaura:style", sync);
    sync();
  }

  function renderFallbackGrid(grid, themes, current) {
    grid.className = "sset-themes-grid";
    grid.replaceChildren();
    themes.forEach((theme) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sset-theme-card${theme.id === current ? " active" : ""}`;
      button.setAttribute("role", "radio");
      button.setAttribute("data-style-pick", theme.id);
      button.setAttribute("aria-checked", String(theme.id === current));
      button.setAttribute("aria-pressed", String(theme.id === current));
      const preview = document.createElement("span");
      preview.className = "sset-theme-prev";
      const bar = document.createElement("span");
      bar.className = "sset-theme-prev__bar";
      const label = document.createElement("span");
      label.className = "sset-theme-name";
      label.textContent = theme.label || theme.id;
      preview.appendChild(bar);
      button.append(preview, label);
      grid.appendChild(button);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => start(), { once: true });
  else start();
})();
