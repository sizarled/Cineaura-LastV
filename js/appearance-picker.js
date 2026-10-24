/* Shared page appearance picker. It uses the same CineAura preferences as Dashboard. */
(() => {
  "use strict";

  const FALLBACK_THEMES = [
    { id: "default", label: "CineAura", icon: "✨", bar: "#01b4e4", body: "#0d253f" },
    { id: "facebook", label: "Facebook", icon: "f", bar: "#1877f2", body: "#f0f2f5" },
    { id: "youtube", label: "YouTube", icon: "▶", bar: "#ff0000", body: "#0f0f0f" },
    { id: "instagram", label: "Instagram", icon: "◎", bar: "#d62976", body: "#000000" },
    { id: "netflix", label: "Netflix", icon: "N", bar: "#e50914", body: "#000000" },
    { id: "prime", label: "Prime Video", icon: "P", bar: "#00a8e1", body: "#0a1628" },
    { id: "appletv", label: "Apple TV+", icon: "", bar: "#000000", body: "#1c1c1e" },
    { id: "win7", label: "Windows 7", icon: "▭", bar: "#2a7bd8", body: "#a9d0f0" },
    { id: "win8", label: "Windows 8", icon: "⊞", bar: "#0078d7", body: "#0078d7" },
    { id: "win10", label: "Windows 10", icon: "⊞", bar: "#0078d4", body: "#f3f3f3" },
    { id: "win11", label: "Windows 11", icon: "⊞", bar: "#0067c0", body: "#f3f3f3" },
    { id: "macos", label: "macOS", icon: "●", bar: "#007aff", body: "#ececef" },
    { id: "android", label: "Android", icon: "🤖", bar: "#3ddc84", body: "#141218" },
    { id: "ios", label: "iOS", icon: "◐", bar: "#007aff", body: "#f2f2f7" },
  ];

  const COPY = {
    ar: { mode: "وضع الألوان", reset: "إعادة التعيين", current: "الحالي:", resetDone: "تمت إعادة ضبط المظهر" },
    en: { mode: "Color mode", reset: "Reset", current: "Current:", resetDone: "Appearance reset" },
    fr: { mode: "Mode de couleur", reset: "Réinitialiser", current: "Actuel :", resetDone: "Apparence réinitialisée" },
    de: { mode: "Farbmodus", reset: "Zurücksetzen", current: "Aktuell:", resetDone: "Darstellung zurückgesetzt" },
    es: { mode: "Modo de color", reset: "Restablecer", current: "Actual:", resetDone: "Apariencia restablecida" },
    nl: { mode: "Kleurmodus", reset: "Herstellen", current: "Huidig:", resetDone: "Weergave hersteld" },
    it: { mode: "Modalità colore", reset: "Reimposta", current: "Attuale:", resetDone: "Aspetto ripristinato" },
  };

  const STYLE_IDS = FALLBACK_THEMES.map((theme) => theme.id);
  const $ = (selector, root = document) => root.querySelector(selector);

  function start() {
    const app = window.CineAura;
    const trigger = document.getElementById("artheme-btn");
    const panel = document.getElementById("artheme-panel");
    if (!app || !trigger || !panel || trigger.dataset.appearanceReady === "true") return;

    const grid = $(".at-grid", panel);
    const modeGroup = $(".at-mode", panel);
    const styles = Array.isArray(app.getStyles?.()) ? app.getStyles() : STYLE_IDS;
    const allowedStyles = new Set(styles.filter((id) => STYLE_IDS.includes(id)));
    const suppliedThemes = window.CineauraTheme?.THEMES;
    const suppliedById = new Map(Array.isArray(suppliedThemes) ? suppliedThemes.map((theme) => [theme.id, theme]) : []);
    const themes = FALLBACK_THEMES.filter((theme) => allowedStyles.has(theme.id)).map((fallback) => ({
      ...fallback,
      ...(suppliedById.get(fallback.id) || {}),
    }));
    const copyFor = () => COPY[app.getLang?.() || document.documentElement.lang] || COPY.en;
    const tr = (key, fallback) => {
      const value = app.t?.(key);
      return typeof value === "string" && value !== key ? value : fallback;
    };

    if (!grid || !modeGroup || !themes.length) return;
    trigger.dataset.appearanceReady = "true";

    function renderThemes() {
      grid.replaceChildren();
      themes.forEach((theme) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "at-card";
        card.setAttribute("role", "radio");
        card.setAttribute("aria-checked", "false");
        card.dataset.style = theme.id;
        card.style.setProperty("--at-accent", theme.bar || theme.accent || "#01b4e4");
        card.setAttribute("aria-label", theme.label || theme.id);

        const preview = document.createElement("span");
        preview.className = "at-prev";
        preview.setAttribute("aria-hidden", "true");
        const bar = document.createElement("span");
        bar.className = "at-prev-bar";
        for (let i = 0; i < 3; i += 1) {
          const dot = document.createElement("span");
          dot.className = "at-prev-dot";
          bar.appendChild(dot);
        }
        const body = document.createElement("span");
        body.className = "at-prev-body";
        body.textContent = theme.icon || "Aa";
        preview.append(bar, body);

        const name = document.createElement("span");
        name.className = "at-name";
        name.textContent = theme.label || theme.id;
        card.append(preview, name);
        grid.appendChild(card);
      });
    }

    function sync() {
      const style = allowedStyles.has(app.getStyle?.()) ? app.getStyle() : "default";
      const mode = app.getTheme?.() === "day" ? "day" : "night";
      const selected = themes.find((theme) => theme.id === style) || themes[0];
      const copy = copyFor();
      const dot = $(".at-dot", trigger);
      if (dot) dot.style.background = selected.bar || selected.accent || "#01b4e4";

      trigger.setAttribute("aria-label", tr("set.theme", "Appearance"));
      trigger.title = tr("set.theme", "Appearance");
      $("#artheme-heading", panel).textContent = tr("set.theme", "Appearance");
      $(".at-close", panel).setAttribute("aria-label", tr("common.close", "Close"));
      modeGroup.setAttribute("aria-label", copy.mode);
      grid.setAttribute("aria-label", tr("set.style", "Theme style"));
      $(".at-reset", panel).textContent = copy.reset;

      panel.querySelectorAll(".at-card").forEach((card) => {
        const active = card.dataset.style === style;
        card.setAttribute("aria-checked", String(active));
        card.tabIndex = active ? 0 : -1;
      });
      modeGroup.querySelectorAll("button[data-mode]").forEach((button) => {
        const active = button.dataset.mode === mode;
        button.setAttribute("aria-checked", String(active));
        button.tabIndex = active ? 0 : -1;
      });

      const current = $(".at-cur", panel);
      if (current) current.textContent = `${copy.current} ${selected.label || selected.id} · ${tr(mode === "day" ? "set.light" : "set.dark", mode === "day" ? "Light" : "Dark")}`;
    }

    function patchProfile(prefs) {
      const session = app.getSession?.();
      if (!session?.member_id || typeof app.supabaseRequest !== "function" || typeof app.restValue !== "function") return;
      app.supabaseRequest(`/rest/v1/profiles?member_id=eq.${app.restValue(session.member_id)}`, {
        method: "PATCH",
        keepalive: true,
        body: JSON.stringify(prefs),
      }).catch(() => {});
    }

    function apply(prefs) {
      app.applyPrefs?.({ ...prefs, persist: true });
      patchProfile(prefs);
      sync();
    }

    function setPanelOpen(open, returnFocus = false) {
      panel.classList.toggle("open", open);
      panel.setAttribute("aria-hidden", String(!open));
      panel.inert = !open;
      trigger.setAttribute("aria-expanded", String(open));
      if (open) {
        sync();
        const focusTarget = $(`.at-card[aria-checked="true"]`, panel) || $(".at-mode button[aria-checked='true']", panel);
        requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
      } else if (returnFocus) {
        trigger.focus();
      }
    }

    function wireRadioArrowKeys(group, selector, applySelection) {
      group.addEventListener("keydown", (event) => {
        if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const buttons = [...group.querySelectorAll(selector)];
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement);
        let next = current < 0 ? 0 : current;
        if (event.key === "Home") next = 0;
        else if (event.key === "End") next = buttons.length - 1;
        else {
          const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp";
          next = (next + (backwards ? -1 : 1) + buttons.length) % buttons.length;
        }
        event.preventDefault();
        buttons[next].focus();
        applySelection(buttons[next]);
      });
    }

    renderThemes();
    sync();

    trigger.addEventListener("click", () => setPanelOpen(!panel.classList.contains("open")));
    $(".at-close", panel).addEventListener("click", () => setPanelOpen(false, true));
    grid.addEventListener("click", (event) => {
      const card = event.target.closest(".at-card");
      if (card && allowedStyles.has(card.dataset.style)) apply({ style: card.dataset.style });
    });
    modeGroup.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-mode]");
      if (button && (button.dataset.mode === "day" || button.dataset.mode === "night")) apply({ theme: button.dataset.mode });
    });
    $(".at-reset", panel).addEventListener("click", () => {
      apply({ style: "default", theme: "night" });
      app.toast?.(copyFor().resetDone);
    });
    wireRadioArrowKeys(grid, ".at-card", (card) => apply({ style: card.dataset.style }));
    wireRadioArrowKeys(modeGroup, "button[data-mode]", (button) => apply({ theme: button.dataset.mode }));

    document.addEventListener("click", (event) => {
      if (panel.classList.contains("open") && !panel.contains(event.target) && !trigger.contains(event.target)) setPanelOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (panel.classList.contains("open") && event.key === "Escape") {
        event.preventDefault();
        setPanelOpen(false, true);
      }
    });
    document.addEventListener("cineaura:prefs", sync);
    window.addEventListener("storage", (event) => {
      if (event.key === "cineaura_style" || event.key === "cineaura_theme" || event.key === "cineaura_lang" || event.key === null) sync();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
