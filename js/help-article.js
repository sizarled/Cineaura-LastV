/**
 * CineAura — Article Editor (Article.html)
 * A full-screen writing app, in the spirit of the WordPress block editor:
 * one top bar, a sticky formatting ribbon, a wide writing sheet and a document
 * sidebar (status, cover image, categories, permalink, excerpt, custom CSS).
 *
 * Storage: sql/help.sql tables (help_articles + help_article_categories).
 * Images: uploaded to Supabase Storage (bucket source, folder Articles) through
 * signed upload tickets (public.help_upload, sql/help_upload.sql), resized in
 * the browser first (CineAura.fitPicture). Without the SQL installed, picked
 * files fall back to embedded data-URLs so nothing is lost.
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) =>
    window.CineAura && window.CineAura.escapeHtml
      ? window.CineAura.escapeHtml(String(v || ""))
      : String(v || "").replace(/[&<>"']/g, (c) => ({
          "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
        }[c]));
  const t = (k, vars) => (window.CineAura && window.CineAura.t ? window.CineAura.t(k, vars) : k);
  const toast = (m) => (window.CineAura && window.CineAura.toast ? window.CineAura.toast(m) : alert(m));
  const supabaseRequest = window.CineAura ? window.CineAura.supabaseRequest : null;
  const getSession = () =>
    window.CineAura && window.CineAura.getSession ? window.CineAura.getSession() : null;

  const LANGS = ["en", "ar", "fr", "de", "es", "nl", "it"];
  const COUNTRIES = ["global", "MA", "FR", "US", "DE", "ES", "IT", "NL", "GB", "SA", "EG", "DZ", "TN", "TR", "IN", "BR", "CA", "AE", "QA", "KW", "LB", "JO", "IQ", "YE", "SD", "LY", "OM", "BH"];
  const PANEL_KEY = "cineaura_panel"; // the Panel session (js/panel.js) holds the staff token
  const IMG_FOLDER = "Articles"; // sql/help_upload.sql grants tickets inside this folder

  let articleId = null;
  let coverUrl = ""; // the saved cover image of the article
  let isDirty = false;
  let saveLock = false;
  let savedSelection = null;
  let featCtrl = null; // the cover picture-field controller

  /* ---------------- small helpers ---------------- */
  const qId = () => new URLSearchParams(location.search).get("id");
  const slugify = (title) =>
    String(title || "").toLowerCase().trim()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
      || "article-" + Date.now().toString(36);
  const plainText = (html) => String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = (html) => { const x = plainText(html); return x ? x.split(" ").filter(Boolean).length : 0; };
  const readingMinutes = (html) => Math.max(1, Math.ceil(wordCount(html) / 200));
  const panelToken = () => {
    try {
      const o = JSON.parse(sessionStorage.getItem(PANEL_KEY) || localStorage.getItem(PANEL_KEY) || "null");
      return (o && o.token) || "";
    } catch { return ""; }
  };

  let lastCatsErr = "";
  async function fetchCategories() {
    lastCatsErr = "";
    if (!supabaseRequest) return [];
    const res = await supabaseRequest("/rest/v1/help_categories?select=*&order=sort_order.asc");
    if (res.ok && Array.isArray(res.data)) return res.data;
    lastCatsErr = String((res.data && (res.data.message || res.data.hint || res.data.details)) || res.status || "network");
    return [];
  }
  async function fetchArticle(id) {
    if (!id || !supabaseRequest) return null;
    const res = await supabaseRequest(`/rest/v1/help_articles?id=eq.${id}&select=*`);
    return res.ok && res.data && res.data[0] ? res.data[0] : null;
  }
  async function fetchArticleCats(id) {
    if (!id || !supabaseRequest) return [];
    const res = await supabaseRequest(`/rest/v1/help_article_categories?article_id=eq.${id}&select=category_id`);
    return res.ok && Array.isArray(res.data) ? res.data.map((r) => r.category_id) : [];
  }

  /* ---------------- selection / execCommand ---------------- */
  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedSelection = sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection() {
    if (!savedSelection) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedSelection);
  }
  function markDirty() {
    isDirty = true;
    const el = $("#ed-save-state");
    if (el) el.textContent = "\u2022 " + (t("help.unsaved") || "Unsaved changes");
  }
  function exec(cmd, val = null) {
    document.execCommand(cmd, false, val);
    const canvas = $("#ed-canvas");
    if (canvas) canvas.focus();
    markDirty();
    updateWordCount();
  }
  function insertHTML(html) {
    restoreSelection();
    document.execCommand("insertHTML", false, html);
    markDirty();
    updateWordCount();
  }
  function updateWordCount() {
    const canvas = $("#ed-canvas");
    if (!canvas) return;
    const wc = wordCount(canvas.innerHTML);
    const el = $("#wp-wordcount");
    if (el) el.textContent = `${wc} ${t("help.words") || "words"} · ${readingMinutes(canvas.innerHTML)} ${t("common.minutes") || "min"}`;
  }

  /* ---------------- image uploads (Storage tickets) ---------------- */
  // Ticket for a batch of image names of one article (sql/help_upload.sql).
  async function helpTicket(slug) {
    return async (names) => {
      const r = await supabaseRequest("/rest/v1/rpc/help_upload", {
        method: "POST",
        body: JSON.stringify({ p_token: panelToken(), p_slug: slug, p_names: names }),
      });
      return r.ok && r.data && r.data.ok === true;
    };
  }
  // Upload one picked file as Articles/<base>.jpg -> its public url, or null (setup missing).
  async function pushArticleImage(slug, file, base) {
    const fit = window.CineAura.fitPicture;
    const up = window.CineAura.uploadPictures;
    if (!fit || !up || !supabaseRequest) return null;
    let blob;
    try { blob = await fit(file, { maxSide: 1800 }); } catch { return null; }
    const ctrl = {
      box: { dataset: { max: "1" } },
      items: [{ kind: "file", blob }],
      list() { return this.items; },
      urls() { return this.items.filter((i) => i.kind === "url").map((i) => i.url); },
      redraw() {},
    };
    const res = await up(ctrl, { folder: IMG_FOLDER, id: base, ticket: await helpTicket(slug) });
    return res.ok && res.urls && res.urls[0] ? res.urls[0] : null;
  }
  // Try Storage first; keep the image embedded only when the upload is not possible
  // (tickets not installed yet), and say so once.
  let fallbackNoted = false;
  async function imageSourceFor(slug, file, base, fallbackDataUrl) {
    const url = await pushArticleImage(slug, file, base);
    if (url) return url;
    if (!fallbackNoted) {
      fallbackNoted = true;
      toast(t("help.uploadFail") || "Image upload is not set up — image kept inside the article.");
    }
    return fallbackDataUrl;
  }
  const fileToDataUrl = (file) =>
    new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });

  function articleSlugNow() {
    const s1 = $("#ed-slug")?.value.trim();
    const s2 = $("#ed-slug2")?.value.trim();
    return s1 || s2 || slugify($("#ed-title")?.value || "");
  }
  function figureHtml(url, alt, caption, width) {
    let html = `<figure><img src="${esc(url)}" alt="${esc(alt)}"${width ? ` style="width:${esc(width)}"` : ""} />`;
    if (caption) html += `<figcaption>${esc(caption)}</figcaption>`;
    return html + "</figure>";
  }

  /* ---------------- categories tree ---------------- */
  function catTreeHTML(categories, checkedIds) {
    const roots = categories.filter((c) => !c.parent_id);
    let html = "";
    roots.forEach((root) => {
      const subs = categories.filter((c) => c.parent_id === root.id);
      html += `<div class="wp-cat-group"><div class="wp-cat-head"><strong>${esc(root.name_ar || root.name)}</strong><span class="wp-cat-count">${subs.length || 1}</span></div>`;
      if (!subs.length) {
        html += `<label class="wp-cat-item"><input type="checkbox" name="cats" value="${root.id}" ${checkedIds.includes(root.id) ? "checked" : ""}> <span>${esc(root.name_ar || root.name)}</span></label>`;
      } else {
        subs.forEach((s) => {
          html += `<label class="wp-cat-item"><input type="checkbox" name="cats" value="${s.id}" ${checkedIds.includes(s.id) ? "checked" : ""}> <span>${esc(s.name_ar || s.name)}</span><small>${esc(s.slug)}</small></label>`;
        });
      }
      html += `</div>`;
    });
    if (!roots.length && categories.length) {
      categories.forEach((c) => {
        html += `<label class="wp-cat-item"><input type="checkbox" name="cats" value="${c.id}" ${checkedIds.includes(c.id) ? "checked" : ""}> <span>${esc(c.name_ar || c.name)}</span></label>`;
      });
    }
    return html || `<p class="wp-empty">${t("help.noCategories") || "No categories yet — create them in the Panel."}</p>`;
  }

  /* ---------------- the editor markup ---------------- */
  function renderEditor(categories, data, extraCatIds) {
    const isNew = !data;
    const checkedIds = [...extraCatIds];
    if (data && data.category_id && !checkedIds.includes(data.category_id)) checkedIds.push(data.category_id);
    const titleVal = esc(data?.title || "");
    const slugVal = esc(data?.slug || "");
    const summaryVal = esc(data?.summary || "");
    const langVal = data?.language || "en";
    const countryVal = data?.country || "global";
    const statusVal = data?.status || "draft";
    const contentHtml = data?.content_html || `<p>${t("help.startWriting") || "Start writing — ابدأ الكتابة هنا، ثم استخدم شريط الأدوات أو زر «+ إضافة كتلة»."}</p>`;
    const contentCss = data?.content_css || "";
    coverUrl = data?.image || "";
    const catHTML = catTreeHTML(categories, checkedIds);
    const author = data?.author_name || getSession()?.username || "";
    const publishLabel = statusVal === "published" ? (t("common.update") || "Update") : (t("help.publish") || "Publish");

    return `
    <div class="wp-editor" id="wp-editor">
      <header class="wp-bar">
        <div class="wp-bar-left">
          <a href="./panel.html#help" class="wp-back" title="${t("help.backPanel") || "Back to Panel"}">‹</a>
          <span class="wp-logo" aria-hidden="true">CA</span>
          <div class="wp-bar-title">
            <strong id="wp-title-display">${titleVal ? titleVal.slice(0, 32) : (t("help.newArticle") || "New Article")}</strong>
            <small id="ed-save-state">${isNew ? (t("help.new") || "New — not saved") : (t("help.saved") || "Saved")}</small>
          </div>
        </div>
        <nav class="wp-tabs" aria-label="editor tabs">
          <button type="button" class="wp-tab active" data-wp-tab="edit">✎ ${t("help.tabVisual") || "Edit"}</button>
          <button type="button" class="wp-tab" data-wp-tab="code">&lt;/&gt; ${t("help.tabCode") || "Code"}</button>
          <button type="button" class="wp-tab" data-wp-tab="preview">👁 ${t("help.preview") || "Preview"}</button>
        </nav>
        <div class="wp-bar-right">
          <span class="wp-count" id="wp-wordcount">0 ${t("help.words") || "words"}</span>
          <button type="button" class="wp-icon" id="wp-fullscreen" title="Fullscreen / focus">⛶</button>
          <button type="button" class="wp-btn" id="btn-save">${t("common.save") || "Save Draft"}</button>
          <button type="button" class="wp-btn wp-btn-primary" id="btn-publish">${publishLabel}</button>
          <button type="button" class="wp-icon" id="wp-settings-toggle" title="${t("help.settings") || "Settings"}">⚙</button>
        </div>
      </header>

      <div class="wp-layout">
        <main class="wp-main">
          <div class="wp-sheet">
            <div class="wp-title-wrap">
              <input id="ed-title" class="wp-title-input" type="text" placeholder="${t("help.titlePlaceholder") || "Add title — أضف العنوان"}" value="${titleVal}" />
              <div class="wp-permalink">
                <span>${t("help.permalink") || "Permalink:"}</span>
                <span class="wp-permalink-url">help.html?id=<b id="wp-slug-preview">${esc(slugVal || slugify(titleVal) || "…")}</b></span>
                <button type="button" class="wp-link-btn" id="wp-edit-slug-btn">${t("common.edit") || "Edit"}</button>
                <span class="wp-slug-edit" id="wp-slug-edit" hidden>
                  <input id="ed-slug" type="text" placeholder="auto-from-title" value="${slugVal}" />
                  <button type="button" id="wp-slug-save" class="wp-btn wp-btn-xs wp-btn-primary">OK</button>
                </span>
              </div>
            </div>

            <div class="wp-toolbar" id="ed-toolbar" role="toolbar">
              <div class="wp-tool-group">
                <button type="button" data-cmd="undo" title="Undo (Ctrl+Z)">↩</button>
                <button type="button" data-cmd="redo" title="Redo (Ctrl+Y)">↪</button>
              </div>
              <div class="wp-tool-group">
                <select id="tb-block" title="Paragraph / Heading">
                  <option value="p">¶ Paragraph</option>
                  <option value="h1">H1</option>
                  <option value="h2">H2</option>
                  <option value="h3">H3</option>
                  <option value="h4">H4</option>
                  <option value="pre">Pre</option>
                  <option value="blockquote">❝ Quote</option>
                </select>
              </div>
              <div class="wp-tool-group">
                <button type="button" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
                <button type="button" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
                <button type="button" data-cmd="underline" title="Underline"><u>U</u></button>
                <button type="button" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
              </div>
              <div class="wp-tool-group">
                <select id="tb-font" title="Font">
                  <option value="">🔤</option>
                  <option value="Outfit, sans-serif">Outfit</option>
                  <option value="Cairo, sans-serif">Cairo</option>
                  <option value="Georgia, serif">Georgia</option>
                  <option value="'Courier New', monospace">Mono</option>
                </select>
                <select id="tb-size" title="Size">
                  <option value="">Aa</option>
                  <option value="13px">13</option><option value="15px">15</option><option value="17px">17</option>
                  <option value="19px">19</option><option value="22px">22</option><option value="26px">26</option><option value="30px">30</option>
                </select>
                <label class="wp-color" title="Text color"><input type="color" id="tb-color" value="#1d2327" /></label>
                <label class="wp-color wp-color-hi" title="Highlight"><input type="color" id="tb-hilite" value="#fff59d" /></label>
              </div>
              <div class="wp-tool-group">
                <button type="button" data-cmd="justifyLeft" title="Start">⯇</button>
                <button type="button" data-cmd="justifyCenter" title="Center">≡</button>
                <button type="button" data-cmd="justifyRight" title="End">⯈</button>
                <button type="button" data-cmd="justifyFull" title="Justify">≣</button>
                <button type="button" id="tb-ltr" title="Left to right">LTR</button>
                <button type="button" id="tb-rtl" title="Right to left">RTL</button>
              </div>
              <div class="wp-tool-group">
                <button type="button" data-cmd="insertUnorderedList" title="Bullet list">•≡</button>
                <button type="button" data-cmd="insertOrderedList" title="Numbered list">1≡</button>
                <button type="button" id="tb-outdent" title="Outdent">⇤</button>
                <button type="button" id="tb-indent" title="Indent">⇥</button>
                <button type="button" data-cmd="removeFormat" title="Clear formatting">⌫</button>
              </div>
              <div class="wp-tool-group">
                <button type="button" id="tb-link" title="Link (Ctrl+K)">🔗</button>
                <button type="button" id="tb-image" title="Image">🖼</button>
                <button type="button" id="tb-gallery" title="Gallery">▦</button>
                <button type="button" id="tb-video" title="Video / embed">▶</button>
                <button type="button" id="tb-table" title="Table">▭</button>
                <button type="button" id="tb-button" title="Button">⬔</button>
                <button type="button" id="tb-hr" title="Separator">―</button>
                <button type="button" id="tb-code" title="Code block">&lt;/&gt;</button>
              </div>
            </div>

            <div id="tab-visual">
              <div id="ed-canvas" class="wp-canvas" contenteditable="true" dir="auto" data-placeholder="${t("help.canvasPlaceholder") || "Type / choose a block, or start writing… — اكتب مقالك هنا"}">${contentHtml}</div>
              <div class="wp-inserter">
                <button type="button" id="wp-add-block" class="wp-inserter-btn">＋ ${t("help.addBlock") || "Add block"}</button>
                <div id="wp-block-menu" class="wp-block-menu" hidden>
                  <button type="button" data-block="paragraph"><span>¶</span>${t("help.blockParagraph") || "Paragraph"}</button>
                  <button type="button" data-block="h2"><span>H2</span>${t("help.blockHeading") || "Heading"}</button>
                  <button type="button" data-block="list"><span>•</span>${t("help.blockList") || "List"}</button>
                  <button type="button" data-block="quote"><span>❝</span>${t("help.blockQuote") || "Quote"}</button>
                  <button type="button" data-block="image"><span>🖼</span>${t("help.blockImage") || "Image"}</button>
                  <button type="button" data-block="gallery"><span>▦</span>${t("help.blockGallery") || "Gallery"}</button>
                  <button type="button" data-block="video"><span>▶</span>${t("help.blockVideo") || "Video"}</button>
                  <button type="button" data-block="table"><span>▭</span>${t("help.blockTable") || "Table"}</button>
                  <button type="button" data-block="code"><span>&lt;/&gt;</span>${t("help.blockCode") || "Code"}</button>
                  <button type="button" data-block="separator"><span>―</span>${t("help.blockSeparator") || "Separator"}</button>
                  <button type="button" data-block="button"><span>⬔</span>${t("help.blockButton") || "Button"}</button>
                </div>
              </div>
            </div>

            <div id="tab-code" hidden>
              <div class="wp-code-area">
                <div class="wp-code-col"><label>HTML</label><textarea id="ed-html" spellcheck="false" placeholder="<h2>Title</h2><p>…"></textarea></div>
                <div class="wp-code-col"><label>CSS</label><textarea id="ed-css" spellcheck="false" placeholder=".my-class { color: … }"></textarea></div>
              </div>
              <div class="wp-code-actions">
                <button class="wp-btn" id="btn-apply-code" type="button">↓ ${t("help.applyToEditor") || "Apply to editor"}</button>
                <button class="wp-btn" id="btn-extract-code" type="button">↑ ${t("help.extractFromEditor") || "Extract from editor"}</button>
                <span class="wp-hint">${t("help.codeHint") || "Custom CSS is scoped to this article."}</span>
              </div>
            </div>

            <div id="tab-preview" hidden>
              <article class="wp-preview-box">
                <h1 class="wp-preview-title" id="wp-preview-title"></h1>
                <div id="ed-preview" class="wp-preview"></div>
              </article>
            </div>

            <footer class="wp-statusbar">
              <span id="wp-last-edited">${author ? "✍ " + esc(author) + " · " : ""}${data?.updated_at ? new Date(data.updated_at).toLocaleString() : (isNew ? (t("help.newDraft") || "New draft") : "")}</span>
              <span id="wp-status-msg" class="wp-status-msg"></span>
              <span class="wp-status-actions">
                <a href="./help.html" class="wp-link">${t("help.viewHelp") || "View Help"}</a>
                <span>·</span>
                <a href="./panel.html#help" class="wp-link">${t("help.backPanel") || "Back to Panel"}</a>
              </span>
            </footer>
          </div>
        </main>

        <aside class="wp-sidebar" id="wp-sidebar">
          <div class="wp-sidebar-head"><strong>${t("help.tabDocument") || "Document"}</strong></div>
          <div class="wp-sidebar-body">
            <details class="wp-panel" open>
              <summary>${t("help.panelStatus") || "Status & visibility"}</summary>
              <div class="wp-panel-body">
                <label class="wp-label" for="ed-status">${t("common.status") || "Status"}</label>
                <select id="ed-status" class="wp-select">
                  <option value="draft" ${statusVal === "draft" ? "selected" : ""}>${t("help.draft") || "Draft"}</option>
                  <option value="published" ${statusVal === "published" ? "selected" : ""}>${t("help.published") || "Published"}</option>
                </select>
                <label class="wp-check"><input type="checkbox" id="ed-autosave" checked /> ${t("help.autosave") || "Autosave"} <small>4s</small></label>
                <div class="wp-meta-grid">
                  <span>${t("help.author") || "Author"}</span><b>${esc(author || "—")}</b>
                  <span>${t("help.created") || "Created"}</span><b>${data?.created_at ? new Date(data.created_at).toLocaleDateString() : "—"}</b>
                  <span>${t("help.updated") || "Updated"}</span><b>${data?.updated_at ? new Date(data.updated_at).toLocaleDateString() : "—"}</b>
                  <span>${t("help.views") || "Views"}</span><b>${data?.views || 0}</b>
                </div>
                <div class="wp-2col">
                  <label class="wp-label">${t("common.language") || "Language"}
                    <select id="ed-lang" class="wp-select">${LANGS.map((l) => `<option value="${l}" ${langVal === l ? "selected" : ""}>${l.toUpperCase()}</option>`).join("")}</select>
                  </label>
                  <label class="wp-label">${t("common.country") || "Country"}
                    <select id="ed-country" class="wp-select">${COUNTRIES.map((c) => `<option value="${c}" ${countryVal === c ? "selected" : ""}>${c === "global" ? (t("help.global") || "Global") : c}</option>`).join("")}</select>
                  </label>
                </div>
              </div>
            </details>

            <details class="wp-panel" open>
              <summary>${t("help.coverImage") || "Cover image"}</summary>
              <div class="wp-panel-body">
                <div id="ed-featured"></div>
                <small class="wp-note">${t("help.coverHint") || "Shown at the top of the article and on its cards."}</small>
              </div>
            </details>

            <details class="wp-panel" open>
              <summary>${t("help.categories") || "Categories"}</summary>
              <div class="wp-panel-body">
                <input type="search" id="wp-cat-search" placeholder="${t("help.searchPh") || "Search categories…"}" class="wp-search" />
                <div id="ed-cats" class="wp-cats">${catHTML}</div>
                ${lastCatsErr ? `<div class="wp-note wp-cats-err">⚠ ${esc((t("help.catsLoadFail") || "Categories could not be loaded ({err}) — retry, or run sql/help.sql in the SQL editor.").replace("{err}", lastCatsErr))} <button type="button" class="btn btn-sm btn-ghost" id="ed-cats-retry">${esc(t("help.retry") || "Retry")}</button></div>` : (!categories.length && catHTML.includes("wp-empty") ? `<p class="wp-note" style="margin-top:6px"><a class="wp-link" href="./panel.html?section=helpcats">${esc(t("help.goManage") || "Manage sections from the Panel → Categories tab")}</a></p>` : "")}
                <small class="wp-note">${t("help.catHint") || "Choose one or more sections."}</small>
              </div>
            </details>

            <details class="wp-panel">
              <summary>${t("help.permalink") || "Permalink"}</summary>
              <div class="wp-panel-body">
                <span class="wp-permalink-preview">help.html?id=<b id="wp-slug-preview2">${esc(slugVal || "…")}</b></span>
                <div class="wp-field-inline"><input id="ed-slug2" type="text" value="${slugVal}" placeholder="auto-from-title" /></div>
                <small class="wp-note">${t("help.slugHint") || "Leave empty to generate it from the title."}</small>
              </div>
            </details>

            <details class="wp-panel">
              <summary>${t("help.summary") || "Excerpt"}</summary>
              <div class="wp-panel-body">
                <textarea id="ed-summary" rows="4" maxlength="160" placeholder="${t("help.summaryPh") || "Short summary for cards and search…"}" class="wp-textarea">${summaryVal}</textarea>
                <small class="wp-note"><span id="wp-excerpt-count">${summaryVal.length}</span>/160</small>
              </div>
            </details>

            <details class="wp-panel">
              <summary>${t("help.customCss") || "Custom CSS"}</summary>
              <div class="wp-panel-body">
                <textarea id="ed-css-panel" rows="6" spellcheck="false" placeholder=".my-class { color: … }" class="wp-textarea code">${esc(contentCss)}</textarea>
              </div>
            </details>

            <div class="wp-panel-actions">
              <button class="wp-btn wp-btn-lg wp-btn-primary" id="btn-save-2" type="button">${t("common.save") || "Save Draft"}</button>
              <button class="wp-btn wp-btn-lg" id="btn-publish-2" type="button">${publishLabel}</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
    <div id="wp-modal" class="wp-modal" hidden><div class="wp-modal-box" id="wp-modal-box"></div></div>`;
  }

  /* ---------------- modal ---------------- */
  function openModal(html) {
    const modal = $("#wp-modal");
    const box = $("#wp-modal-box");
    if (!modal || !box) return;
    box.innerHTML = html;
    modal.hidden = false;
  }
  function closeModal() {
    const modal = $("#wp-modal");
    if (modal) modal.hidden = true;
  }
  function inModal(html, onOpen) {
    openModal(html);
    const box = $("#wp-modal-box");
    onOpen && onOpen(box);
  }

  /* ---------------- field helpers for modals ---------------- */
  const fld = (id, label, ph, extra = "") => `
    <label class="wp-field"><span>${label}</span><input id="${id}" type="text" placeholder="${ph}" ${extra} /></label>`;

  /* ---------------- bindings ---------------- */
  function bindWP() {
    const canvas = $("#ed-canvas");
    if (!canvas) return;

    /* cover image field (the site's own picture field) */
    const host = $("#ed-featured");
    if (host && window.CineAura && window.CineAura.pictureFieldHtml) {
      host.innerHTML = window.CineAura.pictureFieldHtml({
        id: "ed-cover",
        label: t("help.coverImage") || "Cover image",
        hint: "",
        values: coverUrl ? [coverUrl] : [],
        max: 1,
        shape: "wide",
      });
      featCtrl = window.CineAura.wirePictureField(host.querySelector("[data-pcf]"), { maxSide: 1800 });
      const onChange = () => markDirty();
      host.addEventListener("input", onChange);
      host.addEventListener("change", onChange);
    }

    /* title / slug syncing */
    const titleInput = $("#ed-title");
    const slugInput = $("#ed-slug");
    const slugInput2 = $("#ed-slug2");
    function syncTitle() {
      const title = titleInput.value.trim();
      const disp = $("#wp-title-display");
      if (disp) disp.textContent = title ? title.slice(0, 32) : (t("help.newArticle") || "New Article");
      if (!slugInput.value.trim() || slugInput.dataset.auto !== "0") {
        const s = slugify(title);
        slugInput.value = s; slugInput2.value = s;
        $("#wp-slug-preview").textContent = s || "…";
        $("#wp-slug-preview2").textContent = s || "…";
      }
      document.title = (title ? title + " — " : "") + (t("help.editorTitle") || "Edit Article");
      markDirty();
    }
    titleInput.addEventListener("input", syncTitle);
    const syncSlug = (e) => {
      const v = e.target.value.trim() || slugify(titleInput.value);
      $("#wp-slug-preview").textContent = v;
      $("#wp-slug-preview2").textContent = v;
      if (e.target.id === "ed-slug") slugInput2.value = e.target.value; else slugInput.value = e.target.value;
      e.target.dataset.auto = "0";
      markDirty();
    };
    slugInput.addEventListener("input", syncSlug);
    slugInput2.addEventListener("input", syncSlug);
    $("#wp-edit-slug-btn").addEventListener("click", () => {
      const el = $("#wp-slug-edit");
      el.hidden = !el.hidden;
      if (!el.hidden) slugInput.focus();
    });
    $("#wp-slug-save").addEventListener("click", () => { $("#wp-slug-edit").hidden = true; });

    canvas.addEventListener("input", () => { markDirty(); updateWordCount(); });
    $("#ed-summary").addEventListener("input", () => {
      markDirty();
      const c = $("#wp-excerpt-count");
      if (c) c.textContent = String($("#ed-summary").value.length);
    });
    $("#wp-cat-search").addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      $$("#ed-cats .wp-cat-item").forEach((label) => {
        label.style.display = label.textContent.toLowerCase().includes(q) ? "" : "none";
      });
    });
    $("#ed-cats").addEventListener("change", markDirty);
    $("#ed-cats-retry")?.addEventListener("click", async (btn) => {
      btn.currentTarget.disabled = true;
      const cats = await fetchCategories();
      if (cats.length) {
        $("#ed-cats").innerHTML = catTreeHTML(cats, [...document.querySelectorAll('#ed-cats input[name="cats"]:checked')].map((i) => Number(i.value)));
        const err = $(".wp-cats-err");
        if (err) err.remove();
      } else {
        const msg = $(".wp-cats-err");
        if (msg) msg.textContent = (t("help.catsLoadFail") || "Categories could not be loaded ({err}) — retry, or run sql/help.sql in the SQL editor.").replace("{err}", lastCatsErr || "?");
      }
      btn.currentTarget.disabled = false;
    });
    $("#wp-settings-toggle").addEventListener("click", () => $("#wp-sidebar").classList.toggle("is-hidden"));
    $("#wp-fullscreen").addEventListener("click", () => {
      document.documentElement.classList.toggle("wp-fullscreen");
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    });

    /* toolbar */
    $("#tb-block").addEventListener("change", (e) => {
      const v = e.target.value;
      if (v === "p") exec("formatBlock", "<p>");
      else if (v === "pre") insertHTML("<pre><code>code here</code></pre>");
      else exec("formatBlock", `<${v}>`);
      e.target.value = "p";
    });
    $$("#ed-toolbar [data-cmd]").forEach((b) =>
      b.addEventListener("click", () => { saveSelection(); exec(b.dataset.cmd); })
    );
    $("#tb-font").addEventListener("change", (e) => {
      if (!e.target.value) return;
      saveSelection(); exec("fontName", e.target.value);
      e.target.value = "";
    });
    $("#tb-size").addEventListener("change", (e) => {
      if (!e.target.value) return;
      saveSelection();
      exec("fontSize", "7");
      canvas.querySelectorAll('font[size="7"]').forEach((f) => {
        f.removeAttribute("size");
        f.style.fontSize = e.target.value;
      });
      e.target.value = "";
      markDirty();
    });
    $("#tb-color").addEventListener("input", (e) => { saveSelection(); exec("foreColor", e.target.value); });
    $("#tb-hilite").addEventListener("input", (e) => { saveSelection(); exec("hiliteColor", e.target.value); });
    $("#tb-ltr").addEventListener("click", () => { canvas.dir = "ltr"; markDirty(); });
    $("#tb-rtl").addEventListener("click", () => { canvas.dir = "rtl"; markDirty(); });
    $("#tb-indent").addEventListener("click", () => exec("indent"));
    $("#tb-outdent").addEventListener("click", () => exec("outdent"));

    /* insert modals */
    $("#tb-link").addEventListener("click", () => {
      saveSelection();
      const selText = window.getSelection()?.toString() || "";
      inModal(`<h3>${t("help.insertLink") || "Insert link"}</h3>
        ${fld("wp-link-url", "URL", "https://example.com", 'type="url"')}
        ${fld("wp-link-text", t("help.linkText") || "Text", t("help.linkText") || "Link text", `value="${esc(selText)}"`)}
        <label class="wp-check"><input type="checkbox" id="wp-link-blank" checked /> ${t("help.newTab") || "Open in a new tab"}</label>
        <div class="wp-modal-actions"><button class="wp-btn" data-close-modal>${t("common.cancel") || "Cancel"}</button><button class="wp-btn wp-btn-primary" id="wp-link-insert">${t("common.add") || "Insert"}</button></div>`,
        (box) => {
          box.querySelector("#wp-link-insert").addEventListener("click", () => {
            const url = box.querySelector("#wp-link-url").value.trim();
            const txt = box.querySelector("#wp-link-text").value.trim();
            const blank = box.querySelector("#wp-link-blank").checked;
            if (!url) return closeModal();
            if (window.getSelection()?.toString()) {
              exec("createLink", url);
              setTimeout(() => {
                canvas.querySelectorAll('a[href="' + CSS.escape(url) + '"]').forEach((a) => {
                  if (blank) { a.target = "_blank"; a.rel = "noopener"; }
                });
              }, 10);
            } else {
              insertHTML(`<a href="${esc(url)}" ${blank ? 'target="_blank" rel="noopener"' : ""}>${esc(txt || url)}</a>`);
            }
            closeModal();
          });
        });
    });

    const imageModal = () => {
      saveSelection();
      inModal(`<h3>${t("help.insertImage") || "Insert image"}</h3>
        <div class="wp-mini-tabs">
          <button type="button" class="wp-tab active" data-img-tab="upload">${t("help.uploadTab") || "Upload"}</button>
          <button type="button" class="wp-tab" data-img-tab="url">URL</button>
        </div>
        <div id="wp-img-upload-pane">
          <label class="wp-field"><span>${t("help.chooseFile") || "Choose file"}</span><input id="wp-img-file" type="file" accept="image/*" /></label>
          <div id="wp-img-preview" class="wp-img-preview"></div>
        </div>
        <div id="wp-img-url-pane" hidden>
          ${fld("wp-img-url", "URL", "https://…/image.jpg", 'type="url"')}
        </div>
        ${fld("wp-img-alt", "Alt", t("help.altPh") || "Describe the image…")}
        ${fld("wp-img-caption", t("help.caption") || "Caption", t("help.optional") || "optional")}
        <label class="wp-field"><span>${t("help.width") || "Width"}</span>
          <select id="wp-img-width"><option value="">${t("help.auto") || "Auto"}</option><option value="100%">100%</option><option value="50%">50%</option><option value="320px">320px</option></select>
        </label>
        <div class="wp-modal-actions"><button class="wp-btn" data-close-modal>${t("common.cancel") || "Cancel"}</button><button class="wp-btn wp-btn-primary" id="wp-img-insert">${t("common.add") || "Insert"}</button></div>`,
        (box) => {
          box.querySelectorAll("[data-img-tab]").forEach((btn) =>
            btn.addEventListener("click", () => {
              box.querySelectorAll("[data-img-tab]").forEach((b) => b.classList.remove("active"));
              btn.classList.add("active");
              const tab = btn.dataset.imgTab;
              box.querySelector("#wp-img-url-pane").hidden = tab !== "url";
              box.querySelector("#wp-img-upload-pane").hidden = tab !== "upload";
            })
          );
          let picked = null; let previewUrl = "";
          box.querySelector("#wp-img-file").addEventListener("change", (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 12 * 1024 * 1024) { toast(t("pic.errBig") || "Image too large"); e.target.value = ""; return; }
            picked = file;
            previewUrl = URL.createObjectURL(file);
            box.querySelector("#wp-img-preview").innerHTML = `<img src="${previewUrl}" alt="" />`;
          });
          box.querySelector("#wp-img-insert").addEventListener("click", async () => {
            const alt = box.querySelector("#wp-img-alt").value.trim();
            const caption = box.querySelector("#wp-img-caption").value.trim();
            const width = box.querySelector("#wp-img-width").value;
            const go = box.querySelector("#wp-img-insert");
            let src = box.querySelector("#wp-img-url").value.trim();
            if (picked) {
              go.disabled = true;
              go.textContent = t("help.uploading") || "Uploading…";
              const fallback = previewUrl ? await fileToDataUrl(picked) : "";
              src = (await imageSourceFor(articleSlugNow(), picked, `${articleSlugNow()}-i${Date.now().toString(36)}`, fallback)) || fallback;
              previewUrl && URL.revokeObjectURL(previewUrl);
            }
            if (!src) { go.disabled = false; toast(t("help.needImageUrl") || "Pick a file or paste a URL"); return; }
            insertHTML(figureHtml(src, alt, caption, width));
            closeModal();
          });
        });
    };
    $("#tb-image").addEventListener("click", imageModal);

    $("#tb-gallery").addEventListener("click", () => {
      saveSelection();
      inModal(`<h3>${t("help.insertGallery") || "Insert gallery"}</h3>
        <label class="wp-field"><span>URLs — ${t("help.onePerLine") || "one per line"}</span><textarea id="wp-gallery-urls" rows="4" placeholder="https://…/1.jpg&#10;https://…/2.jpg"></textarea></label>
        <label class="wp-field"><span>${t("help.orFiles") || "or pick files"}</span><input id="wp-gallery-files" type="file" accept="image/*" multiple /></label>
        <div class="wp-modal-actions"><button class="wp-btn" data-close-modal>${t("common.cancel") || "Cancel"}</button><button class="wp-btn wp-btn-primary" id="wp-gallery-insert">${t("common.add") || "Insert"}</button></div>`,
        (box) => {
          box.querySelector("#wp-gallery-insert").addEventListener("click", async () => {
            const go = box.querySelector("#wp-gallery-insert");
            go.disabled = true;
            const slug = articleSlugNow();
            const urls = box.querySelector("#wp-gallery-urls").value.split("\n").map((s) => s.trim()).filter(Boolean);
            let html = `<div class="wp-gallery">`;
            urls.forEach((u) => { html += `<img src="${esc(u)}" alt="" />`; });
            const files = [...(box.querySelector("#wp-gallery-files").files || [])];
            for (const file of files) {
              const fallback = await fileToDataUrl(file);
              const u = await imageSourceFor(slug, file, `${slug}-g${Date.now().toString(36)}${files.indexOf(file)}`, fallback);
              html += `<img src="${esc(u || fallback)}" alt="" />`;
            }
            html += "</div>";
            if (urls.length || files.length) insertHTML(html);
            closeModal();
          });
        });
    });

    $("#tb-video").addEventListener("click", () => {
      saveSelection();
      inModal(`<h3>${t("help.insertVideo") || "Insert video / embed"}</h3>
        ${fld("wp-video-url", "URL", "https://youtube.com/watch?v=… / .mp4", 'type="url"')}
        <div class="wp-modal-actions"><button class="wp-btn" data-close-modal>${t("common.cancel") || "Cancel"}</button><button class="wp-btn wp-btn-primary" id="wp-video-insert">${t("common.add") || "Insert"}</button></div>`,
        (box) => {
          box.querySelector("#wp-video-insert").addEventListener("click", () => {
            const url = box.querySelector("#wp-video-url").value.trim();
            if (!url) return closeModal();
            let embed = "";
            if (/youtube\.com|youtu\.be/.test(url)) {
              let id = "";
              try {
                const u = new URL(url);
                id = u.searchParams.get("v") || u.pathname.slice(1);
                if (id.includes("/")) id = id.split("/").pop();
              } catch {}
              if (id) embed = `<figure><iframe src="https://www.youtube.com/embed/${esc(id)}" allowfullscreen loading="lazy"></iframe></figure>`;
            } else if (url.includes("vimeo.com")) {
              embed = `<figure><iframe src="https://player.vimeo.com/video/${esc(url.split("/").pop())}" allowfullscreen loading="lazy"></iframe></figure>`;
            } else {
              embed = `<video controls src="${esc(url)}"></video>`;
            }
            if (embed) insertHTML(embed);
            closeModal();
          });
        });
    });

    $("#tb-table").addEventListener("click", () => {
      saveSelection();
      inModal(`<h3>${t("help.insertTable") || "Insert table"}</h3>
        <div class="wp-2col">
          <label class="wp-field"><span>${t("help.rows") || "Rows"}</span><input id="wp-table-rows" type="number" min="1" max="20" value="3" /></label>
          <label class="wp-field"><span>${t("help.cols") || "Columns"}</span><input id="wp-table-cols" type="number" min="1" max="10" value="3" /></label>
        </div>
        <label class="wp-check"><input type="checkbox" id="wp-table-head" checked /> ${t("help.tableHeader") || "Header row"}</label>
        <div class="wp-modal-actions"><button class="wp-btn" data-close-modal>${t("common.cancel") || "Cancel"}</button><button class="wp-btn wp-btn-primary" id="wp-table-insert">${t("common.add") || "Insert"}</button></div>`,
        (box) => {
          box.querySelector("#wp-table-insert").addEventListener("click", () => {
            const rows = Math.max(1, Math.min(20, Number(box.querySelector("#wp-table-rows").value) || 3));
            const cols = Math.max(1, Math.min(10, Number(box.querySelector("#wp-table-cols").value) || 3));
            const head = box.querySelector("#wp-table-head").checked;
            let html = "<table>";
            for (let r = 0; r < rows; r++) {
              html += "<tr>";
              for (let c = 0; c < cols; c++) {
                const tag = r === 0 && head ? "th" : "td";
                html += `<${tag}>${r === 0 && head ? "…" : ""}</${tag}>`;
              }
              html += "</tr>";
            }
            insertHTML(html + "</table>");
            closeModal();
          });
        });
    });

    $("#tb-button").addEventListener("click", () => {
      saveSelection();
      inModal(`<h3>${t("help.insertButton") || "Insert button"}</h3>
        ${fld("wp-btn-text", t("help.linkText") || "Text", t("help.clickHere") || "Click here", 'value="' + esc(t("help.clickHere") || "Click here") + '"')}
        ${fld("wp-btn-url", "URL", "https://…", 'type="url"')}
        <label class="wp-field"><span>${t("help.style") || "Style"}</span>
          <select id="wp-btn-style"><option value="primary">Primary</option><option value="ghost">Ghost</option></select>
        </label>
        <div class="wp-modal-actions"><button class="wp-btn" data-close-modal>${t("common.cancel") || "Cancel"}</button><button class="wp-btn wp-btn-primary" id="wp-btn-insert">${t("common.add") || "Insert"}</button></div>`,
        (box) => {
          box.querySelector("#wp-btn-insert").addEventListener("click", () => {
            const txt = box.querySelector("#wp-btn-text").value.trim() || "Button";
            const url = box.querySelector("#wp-btn-url").value.trim() || "#";
            const style = box.querySelector("#wp-btn-style").value;
            insertHTML(`<p class="wp-cta"><a href="${esc(url)}" class="wp-cta-${style}">${esc(txt)}</a></p>`);
            closeModal();
          });
        });
    });

    $("#tb-hr").addEventListener("click", () => insertHTML("<hr />"));
    $("#tb-code").addEventListener("click", () => insertHTML("<pre><code>code here</code></pre>"));

    /* block inserter */
    const blockMenu = $("#wp-block-menu");
    $("#wp-add-block").addEventListener("click", (e) => {
      e.stopPropagation();
      blockMenu.hidden = !blockMenu.hidden;
    });
    document.addEventListener("click", (e) => {
      if (!blockMenu.hidden && !blockMenu.contains(e.target) && e.target.id !== "wp-add-block") blockMenu.hidden = true;
    });
    $$("#wp-block-menu [data-block]").forEach((btn) =>
      btn.addEventListener("click", () => {
        blockMenu.hidden = true;
        const block = btn.dataset.block;
        switch (block) {
          case "paragraph": insertHTML("<p>¶</p>"); break;
          case "h2": insertHTML("<h2>Heading</h2>"); break;
          case "list": insertHTML("<ul><li>…</li><li>…</li></ul>"); break;
          case "quote": insertHTML("<blockquote>❝</blockquote>"); break;
          case "image": imageModal(); break;
          case "gallery": $("#tb-gallery").click(); break;
          case "video": $("#tb-video").click(); break;
          case "table": $("#tb-table").click(); break;
          case "code": insertHTML("<pre><code>code here</code></pre>"); break;
          case "separator": insertHTML("<hr />"); break;
          case "button": $("#tb-button").click(); break;
          default: insertHTML("<p>…</p>");
        }
      })
    );

    /* tabs */
    $$(".wp-tabs .wp-tab").forEach((btn) =>
      btn.addEventListener("click", () => {
        $$(".wp-tabs .wp-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.wpTab;
        $("#tab-visual").hidden = tab !== "edit";
        $("#tab-code").hidden = tab !== "code";
        $("#tab-preview").hidden = tab !== "preview";
        $("#ed-toolbar").hidden = tab !== "edit";
        if (tab === "preview") {
          const css = $("#ed-css-panel").value || $("#ed-css").value || "";
          $("#wp-preview-title").textContent = titleInput.value.trim() || (t("help.newArticle") || "New Article");
          $("#ed-preview").innerHTML = (css ? `<style>${css}</style>` : "") + canvas.innerHTML;
        }
        if (tab === "code") {
          $("#ed-html").value = canvas.innerHTML;
          $("#ed-css").value = $("#ed-css-panel").value || "";
        }
      })
    );
    $("#ed-css-panel").addEventListener("input", () => markDirty());
    $("#btn-apply-code").addEventListener("click", () => {
      const html = $("#ed-html").value;
      if (html.trim()) canvas.innerHTML = html;
      $("#ed-css-panel").value = $("#ed-css").value;
      toast(t("help.applied") || "Applied");
      markDirty();
    });
    $("#btn-extract-code").addEventListener("click", () => {
      $("#ed-html").value = canvas.innerHTML;
      $("#ed-css").value = $("#ed-css-panel").value || "";
      toast(t("help.extracted") || "Extracted");
    });

    /* drag&drop / paste images */
    canvas.addEventListener("dragover", (e) => { e.preventDefault(); canvas.classList.add("is-drop"); });
    canvas.addEventListener("dragleave", () => canvas.classList.remove("is-drop"));
    canvas.addEventListener("drop", async (e) => {
      e.preventDefault();
      canvas.classList.remove("is-drop");
      const slug = articleSlugNow();
      for (const file of [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"))) {
        const fallback = await fileToDataUrl(file);
        const u = await imageSourceFor(slug, file, `${slug}-d${Date.now().toString(36)}`, fallback);
        insertHTML(figureHtml(u || fallback, file.name, "", ""));
      }
    });
    canvas.addEventListener("paste", async (e) => {
      const items = [...e.clipboardData.items].filter((i) => i.type.startsWith("image/"));
      if (!items.length) return;
      const slug = articleSlugNow();
      for (const item of items) {
        e.preventDefault();
        const file = item.getAsFile();
        const fallback = await fileToDataUrl(file);
        const u = await imageSourceFor(slug, file, `${slug}-p${Date.now().toString(36)}`, fallback);
        insertHTML(figureHtml(u || fallback, "", "", ""));
      }
    });

    /* global keys */
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveArticle(false);
        return;
      }
      if (e.key === "Escape") {
        closeModal();
        blockMenu.hidden = true;
        return;
      }
      if (e.target !== canvas) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); exec("bold"); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") { e.preventDefault(); exec("italic"); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#tb-link").click(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); exec("undo"); }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); exec("redo"); }
    });

    /* modal closing: X click on backdrop or any [data-close-modal] button */
    document.addEventListener("click", (e) => {
      const modal = $("#wp-modal");
      if (modal && !modal.hidden && (e.target === modal || e.target.closest("[data-close-modal]"))) closeModal();
    });
  }

  /* ---------------- save ---------------- */
  async function saveArticle(publish = false, opts = {}) {
    const quiet = opts.quiet === true;
    if (saveLock) return null;
    if (!supabaseRequest) return null;
    const titleEl = $("#ed-title");
    const canvas = $("#ed-canvas");
    const title = titleEl.value.trim();
    if (!title) {
      if (!quiet) toast(t("help.needTitle") || "Title required");
      if (!quiet) titleEl.focus();
      return null;
    }
    const slug = articleSlugNow();
    const status = publish ? "published" : ($("#ed-status").value || "draft");
    let content_html = canvas.innerHTML.trim();
    if (!$("#tab-code").hidden && $("#ed-html").value.trim()) {
      content_html = $("#ed-html").value.trim();
      canvas.innerHTML = content_html;
    }
    const content_css = ($("#ed-css-panel")?.value || $("#ed-css")?.value || "").trim();
    const summary = $("#ed-summary").value.trim();
    const checkedCats = [...document.querySelectorAll('#ed-cats input[name="cats"]:checked')].map((i) => Number(i.value));
    if (!checkedCats.length) {
      if (!quiet) toast(t("help.needCategory") || "Pick at least one category");
      return null;
    }
    saveLock = true;
    try {
      /* cover: upload picked files first, then its public URL */
      let image = coverUrl;
      if (featCtrl) {
        if (featCtrl.pending() > 0) {
          const msg = $("#wp-status-msg");
          if (msg) msg.textContent = t("help.uploading") || "Uploading image…";
          const res = await window.CineAura.uploadPictures(featCtrl, {
            folder: IMG_FOLDER, id: slug, ticket: await helpTicket(slug),
          });
          if (res.ok && res.urls && res.urls[0]) image = res.urls[0];
          else if (!quiet) toast(t("help.uploadFail") || "Cover upload failed — article saved without it.");
        } else {
          image = featCtrl.urls()[0] || "";
        }
      }
      const sess = getSession();
      const payload = {
        slug,
        title,
        summary,
        content_html,
        content_css,
        language: $("#ed-lang").value,
        country: $("#ed-country").value,
        status,
        category_id: checkedCats[0],
        reading_minutes: readingMinutes(content_html),
      };
      if (sess) {
        payload.author_id = String(sess.member_id || "");
        payload.author_name = String(sess.username || "");
      }
      if (status === "published") payload.published_at = new Date().toISOString();
      if (image) payload.image = image;

      const attempt = async (body) =>
        articleId
          ? supabaseRequest(`/rest/v1/help_articles?id=eq.${articleId}`, { method: "PATCH", body: JSON.stringify(body) })
          : supabaseRequest("/rest/v1/help_articles", { method: "POST", body: JSON.stringify(body) });
      let res = await attempt(payload);
      // the image column is recent (sql/help_upload.sql): save without it when missing
      if (!res.ok && payload.image && /image/i.test(String(res.data?.message || res.data || ""))) {
        delete payload.image;
        res = await attempt(payload);
      }
      if (!res.ok) throw new Error(String(res.status));
      if (!articleId) {
        const created = Array.isArray(res.data) ? res.data[0] : res.data;
        if (created && created.id) {
          articleId = created.id;
          history.replaceState({}, "", `Article.html?id=${articleId}`);
        }
      }
      await supabaseRequest(`/rest/v1/help_article_categories?article_id=eq.${articleId}`, { method: "DELETE" });
      for (const cid of checkedCats) {
        await supabaseRequest("/rest/v1/help_article_categories", {
          method: "POST",
          body: JSON.stringify({ article_id: articleId, category_id: cid }),
        });
      }
      coverUrl = image || coverUrl;
      isDirty = false;
      const stamp = new Date().toLocaleTimeString();
      const label = publish ? (t("help.published") || "Published \u2713") : opts.autosaved ? (t("help.autosaved") || "Autosaved") : (t("help.saved") || "Saved");
      const saveState = $("#ed-save-state");
      if (saveState) saveState.textContent = `${label} · ${stamp}`;
      const msg = $("#wp-status-msg");
      if (msg) {
        msg.textContent = label;
        setTimeout(() => { if (msg.textContent === label) msg.textContent = ""; }, 2600);
      }
      if (publish) {
        $("#ed-status").value = "published";
        const btnLabel = t("common.update") || "Update";
        ["#btn-publish", "#btn-publish-2"].forEach((s) => { const b = $(s); if (b) b.textContent = btnLabel; });
      }
      if (!quiet) toast(label);
      return articleId;
    } catch (e) {
      console.error(e);
      if (!quiet) toast(t("help.saveFailed") || "Save failed — run sql/help.sql in the SQL editor.");
      return null;
    } finally {
      saveLock = false;
    }
  }

  function setupAutosave() {
    setInterval(() => {
      if ($("#ed-autosave")?.checked && isDirty && !saveLock) {
        if (!$("#ed-title")?.value.trim()) return; // nothing to save yet — no nagging toasts
        saveArticle(false, { quiet: true, autosaved: true });
      }
    }, 4000);
    window.addEventListener("beforeunload", (e) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  /* ---------------- init ---------------- */
  async function init() {
    document.body.classList.add("editor-app");
    articleId = qId();
    const cats = await fetchCategories();
    let data = null, extra = [];
    if (articleId) {
      data = await fetchArticle(articleId);
      if (data) extra = await fetchArticleCats(articleId);
      else articleId = null;
    }
    $("#editor-root").innerHTML = renderEditor(cats, data, extra);
    if (data) {
      $("#ed-html").value = data.content_html || "";
      $("#ed-css").value = data.content_css || "";
    }
    bindWP();
    setupAutosave();
    $("#btn-save").addEventListener("click", () => saveArticle(false));
    $("#btn-save-2").addEventListener("click", () => saveArticle(false));
    $("#btn-publish").addEventListener("click", () => saveArticle(true));
    $("#btn-publish-2").addEventListener("click", () => saveArticle(true));
    if (window.CineAura && window.CineAura.translateDom) window.CineAura.translateDom(document);
    if (!data) $("#ed-title")?.focus();
    updateWordCount();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
