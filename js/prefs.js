(() => {
  try {
    const langs = ["en", "ar", "fr", "de", "es", "nl", "it"];
    const html = document.documentElement;
    let theme = localStorage.getItem("cineaura_theme");
    if (theme !== "day" && theme !== "night") theme = "night";
    // A language is stored only when the visitor picks one (header menu / settings).
    // Until then the page follows the browser's language list, first supported match.
    let lang = localStorage.getItem("cineaura_lang");
    // The default language is the browser's. The country still comes from the IP
    // (Site Settings shows it); only a language the visitor picks is stored.
    if (!langs.includes(lang)) {
      lang = "en";
      const list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
      for (const raw of list) {
        const code = String(raw || "").toLowerCase().split("-")[0];
        if (langs.includes(code)) {
          lang = code;
          break;
        }
      }
    }
    if (!localStorage.getItem("cineaura_theme")) localStorage.setItem("cineaura_theme", theme);
    html.dataset.theme = theme;
    // Appearance themes (default glass + 13 platform/OS presets) — orthogonal to day/night
    try{
      const VALID_STYLE = ["default","facebook","youtube","instagram","netflix","prime","appletv","win7","win8","win10","win11","macos","android","ios"];
      let style = localStorage.getItem("cineaura_style");
      if(!VALID_STYLE.includes(style)) style = "default";
      html.dataset.style = style;
      // ensure css/themes.css present early (redundant with js/themes.js)
      if(!document.querySelector('link[href="css/themes.css"]')){
        const l=document.createElement("link"); l.rel="stylesheet"; l.href="css/themes.css"; document.head.appendChild(l);
      }
      // also ensure js/themes.js helper loaded (non-blocking)
      if(!document.querySelector('script[src="js/themes.js"]')){
        const s=document.createElement("script"); s.src="js/themes.js"; s.defer=true; document.head.appendChild(s);
      }
      // Help Center look (the default appearance) — scoped to data-style="default"
      if(!document.querySelector('link[href="css/help-look.css"]')){
        const lh=document.createElement("link"); lh.rel="stylesheet"; lh.href="css/help-look.css"; document.head.appendChild(lh);
      }
      // customizer engine + styles
      if(!document.querySelector('link[href="css/customizer.css"]')){
        const lc=document.createElement("link"); lc.rel="stylesheet"; lc.href="css/customizer.css"; document.head.appendChild(lc);
      }
      if(!document.querySelector('script[src="js/layouts.js"]')){
        const sl=document.createElement("script"); sl.src="js/layouts.js"; sl.defer=true; document.head.appendChild(sl);
      }
      if(!document.querySelector('script[src="js/customizer.js"]')){
        const sc=document.createElement("script"); sc.src="js/customizer.js"; sc.defer=true; document.head.appendChild(sc);
      }
    }catch{}
    html.lang = lang;
    html.dir = lang === "ar" ? "rtl" : "ltr";
    // Load the language pack (lang/<language>.js) before the page scripts run.
    const files = { ar: "arabic", fr: "french", de: "german", es: "spanish", nl: "dutch", it: "italian" };
    if (files[lang] && document.readyState === "loading") {
      document.write('<script src="lang/' + files[lang] + '.js"><\/script>');
    }
  } catch {
    /* keep markup defaults */
  }
})();
