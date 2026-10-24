/* CineAura — Documents (the fifth content type).

   Files live in the PRIVATE storage bucket `documents` (sql/community_documents.sql);
   only short-lived signed links are ever handed to a browser, so a shared path
   stops working after a minute. Metadata (owner, title, kind, size, visibility,
   counters) lives in public.community_documents.

   Public API
     CineAuraDocs.renderUpload(host, { member })   Studio › Create content › Document
     CineAuraDocs.renderManage(box, memberId)      Studio › Manage content › Documents
     CineAuraDocs.list(box)                        documents.html (the library)
     CineAuraDocs.documentView(box, id)            documents.html?id=ID
     CineAuraDocs.homeRows(box, limit)             the newest documents on content.html
*/
(() => {
  "use strict";
  const C = () => window.CineAura;
  const t = (...a) => C().t(...a);
  const esc = (...a) => C().escapeHtml(...a);
  const req = (...args) => C().supabaseRequest(...args);
  const meId = () => (C() && C().getSession ? C().getSession()?.member_id || "" : "");

  // Public documents live in the public `source` bucket under Documents/ (where
  // the project keeps them). Private and exclusive ones go to the private
  // `documents` bucket, because a public URL cannot be un-shared.
  const PUBLIC_BUCKET = "source";
  const PRIVATE_BUCKET = "documents";
  const PUBLIC_FOLDER = "Documents";
  const BUCKET = (rowOrName) => (typeof rowOrName === "string" ? rowOrName : rowOrName?.bucket) || PRIVATE_BUCKET;
  const MAX_BYTES = 25 * 1024 * 1024; // one document (VirusTotal accepts 32 MB)
  const MAX_PER_MEMBER = 100; // documents a member may hold
  const SIGN_SECONDS = 60; // link lifetime for a download / preview
  const SCAN_FN = "vt-scan"; // the edge function that holds the VirusTotal key

  // One catalogue for the picker, the validator and the badges. `exts` is the
  // allow-list; `kind` decides the badge and whether a preview makes sense.
  const FORMATS = [
    { kind: "pdf", label: "PDF", exts: ["pdf"], preview: true },
    { kind: "word", label: "Word", exts: ["doc", "docx", "odt", "rtf", "txt"], preview: false },
    { kind: "sheet", label: "Excel / CSV", exts: ["xls", "xlsx", "xlsm", "ods", "csv"], preview: false },
    { kind: "slides", label: "PowerPoint", exts: ["ppt", "pptx", "odp"], preview: false },
    { kind: "database", label: "Access Database", exts: ["mdb", "accdb"], preview: false },
    { kind: "other", label: "Other supported formats", exts: ["epub", "json", "xml", "md", "markdown"], preview: false },
  ];
  const ALL_EXTS = FORMATS.flatMap((f) => f.exts);
  const KIND_OF_EXT = (ext) => (FORMATS.find((f) => f.exts.includes(ext)) || {}).kind || "";
  const KIND_LABEL = (kind) => (FORMATS.find((f) => f.kind === kind) || {}).label || kind;
  const CAN_PREVIEW = (kind) => Boolean((FORMATS.find((f) => f.kind === kind) || {}).preview);

  const extOf = (name) => String(name || "").split(".").pop().toLowerCase();
  const sizeText = (n) => {
    const b = Number(n || 0);
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    if (b >= 1024) return `${Math.round(b / 1024)} KB`;
    return `${b} B`;
  };

  /* ---------- content checks -------------------------------------------------
     The extension alone proves nothing: a .pdf that is really an executable has
     a .pdf name. We read the first bytes and compare the family they reveal with
     the family the extension claims. What this cannot do is an antivirus scan —
     that has to run on server-side bytes before a file is offered for download
     (see the note in the upload panel and in sql/community_documents.sql). */
  const starts = (bytes, sig) => sig.every((b, i) => bytes[i] === b);
  const ascii = (bytes, from, to) => String.fromCharCode(...bytes.slice(from, to));

  async function sniff(file) {
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    const zip = starts(head, [0x50, 0x4b, 0x03, 0x04]) || starts(head, [0x50, 0x4b, 0x05, 0x06]);
    const ole = starts(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const pdf = ascii(head, 0, 4) === "%PDF";
    const rtf = ascii(head, 0, 5) === "{\\rtf";
    const hasNul = head.includes(0);
    const texty = !zip && !ole && !pdf && !hasNul;
    const looksJson = texty && /^[\s\uFEFF]*[[{]/.test(ascii(head, 0, 64));
    const looksXml = texty && /^[\s\uFEFF]*</.test(ascii(head, 0, 64));
    return { zip, ole, pdf, rtf, texty, hasNul, looksJson, looksXml };
  }

  // true when the bytes agree with the extension's family
  function agrees(ext, s) {
    if (ext === "pdf") return s.pdf;
    if (["docx", "xlsx", "xlsm", "pptx", "odt", "odp", "ods", "epub"].includes(ext)) return s.zip;
    if (["doc", "xls", "ppt", "mdb", "accdb"].includes(ext)) return s.ole;
    if (ext === "rtf") return s.rtf || s.texty;
    if (["txt", "csv", "md", "markdown"].includes(ext)) return s.texty;
    if (ext === "json") return s.looksJson;
    if (ext === "xml") return s.looksXml || s.texty;
    return false;
  }

  /* ---------- storage ------------------------------------------------------- */
  const encPath = (path) => String(path).split("/").map(encodeURIComponent).join("/");
  const objectUrl = (path, bucket = PRIVATE_BUCKET) => `${C().SUPABASE_URL}/storage/v1/object/${bucket}/${encPath(path)}`;
  const publicUrl = (path, bucket = PUBLIC_BUCKET) => `${C().SUPABASE_URL}/storage/v1/object/public/${bucket}/${encPath(path)}`;
  const signUrl = (bucket = PRIVATE_BUCKET) => `${C().SUPABASE_URL}/storage/v1/object/sign/${bucket}`;
  const authHeaders = (extra) => ({
    apikey: C().SUPABASE_KEY,
    Authorization: `Bearer ${C().SUPABASE_KEY}`,
    ...(extra || {}),
  });

  // A one-minute link, minted only after the caller was allowed to see the row.
  // A public-bucket document is already public by design, so it needs no mint.
  async function signedLink(row) {
    const bucket = BUCKET(row);
    if (bucket === PUBLIC_BUCKET) return publicUrl(row.storage_path, bucket);
    const res = await fetch(`${signUrl(bucket)}/${encPath(row.storage_path)}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: SIGN_SECONDS }),
    });
    if (!res.ok) return "";
    let body = null;
    try {
      body = await res.json();
    } catch {
      return "";
    }
    const signed = body?.signedURL || body?.signedUrl || "";
    if (!signed) return "";
    return signed.startsWith("http") ? signed : `${C().SUPABASE_URL}/storage/v1${signed}`;
  }

  async function putFile(path, file, mime, bucket = PRIVATE_BUCKET) {
    const res = await fetch(objectUrl(path, bucket), {
      method: "POST",
      headers: authHeaders({
        "Content-Type": mime || "application/octet-stream",
        "x-upsert": "false",
        // downloads must land as a file, never render as a page
        "Cache-Control": "max-age=0",
      }),
      body: file,
    });
    return res.ok;
  }

  async function removeFile(path, bucket = PRIVATE_BUCKET) {
    try {
      await fetch(objectUrl(path, bucket), { method: "DELETE", headers: authHeaders() });
    } catch {
      /* the row is gone either way */
    }
  }

  /* ---------- VirusTotal gate ----------------------------------------------
     The key never reaches the browser: it lives as a Supabase secret and the
     `vt-scan` function calls the API (see supabase/functions/vt-scan/DEPLOY.md).

     Fail-closed on purpose — a file that could not be proven clean is not
     stored. That is the whole point of scanning before an upload. */
  async function sha256Of(file) {
    try {
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buf);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      return "";
    }
  }

  // -> { verdict, stats, sha256, reason }
  async function vtScan(file, sha256) {
    const form = new FormData();
    form.append("file", file, file.name || "document");
    if (sha256) form.append("sha256", sha256);
    let res;
    try {
      res = await fetch(`${C().SUPABASE_URL}/functions/v1/${SCAN_FN}`, {
        method: "POST",
        headers: { apikey: C().SUPABASE_KEY, Authorization: `Bearer ${C().SUPABASE_KEY}` },
        body: form,
      });
    } catch {
      return { verdict: "unreachable", sha256 };
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    // An undeployed function answers 404 with no JSON: say so plainly.
    if (!body) return { verdict: res.status === 404 ? "not_deployed" : "unreachable", sha256 };
    return { verdict: String(body.verdict || "error"), stats: body.stats || {}, sha256: body.sha256 || sha256, reason: body.reason };
  }

  const scanClean = (r) => r && r.verdict === "clean";
  function scanMessage(r) {
    if (!r) return t("doc.scan.unreachable");
    if (r.verdict === "malicious" || r.verdict === "suspicious") {
      const n = Number(r.stats?.malicious || 0) + Number(r.stats?.suspicious || 0);
      return t("doc.scan.bad", { n });
    }
    if (r.verdict === "rate_limited") return t("doc.scan.busy");
    if (r.verdict === "not_deployed") return t("doc.scan.notDeployed");
    if (r.verdict === "unknown") return t("doc.scan.unknown");
    return t("doc.scan.unreachable");
  }

  /* ---------- shared bits --------------------------------------------------- */
  const visLabel = (v) => t(`pm.vis.${v || "public"}`);
  const when = (iso) => String(iso || "").slice(0, 16).replace("T", " ");
  const canSee = (row, me) => {
    if (!row) return false;
    if (row.visibility === "public") return true;
    if (me && row.member_id === me) return true;
    if (row.visibility === "exclusive") return Boolean(me); // members with an account
    return false; // private: only the owner
  };
  const badge = (kind) => `<span class="doc-badge doc-${esc(kind)}">${esc(KIND_LABEL(kind))}</span>`;

  async function nameMap(ids) {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map();
    const res = await req(`/rest/v1/members?member_id=in.(${uniq.map((x) => String(x).replace(/[,"\\]/g, "")).join(",")})&select=member_id,username,full_name`);
    const rows = res.ok && Array.isArray(res.data) ? res.data : [];
    return new Map(rows.map((r) => [r.member_id, r]));
  }

  function bump(id, column) {
    // fire-and-forget counter: the page never waits for a statistic
    req(`/rest/v1/rpc/doc_bump`, { method: "POST", body: JSON.stringify({ p_id: Number(id), p_col: column }) }).catch(() => null);
  }

  /* ---------- Studio › Create content › Document ---------------------------
     The file picker is real: title + format + description + visibility + tags,
     then the checks run before anything is uploaded. */
  function renderUpload(host, ctx = {}) {
    const me = ctx.member || C().getSession();
    if (!me) return (host.innerHTML = `<p class="com-note">${esc(t("com.login"))}</p>`);
    host.innerHTML = `
      <form class="stack" id="doc-form" novalidate>
        <label class="field-label" for="doc-title">${esc(t("doc.titleLabel"))}</label>
        <input id="doc-title" maxlength="160" required placeholder="${esc(t("doc.titlePh"))}" />

        <label class="field-label" for="doc-kind">${esc(t("doc.formatLabel"))}</label>
        <select id="doc-kind">
          ${FORMATS.map((f) => `<option value="${f.kind}">${esc(f.label)} (${f.exts.map((e) => "." + e).join(", ")})</option>`).join("")}
        </select>

        <label class="field-label" for="doc-desc">${esc(t("doc.descLabel"))}</label>
        <textarea id="doc-desc" rows="3" maxlength="2000" placeholder="${esc(t("doc.descPh"))}"></textarea>

        <label class="field-label" for="doc-tags">${esc(t("doc.tagsLabel"))}</label>
        <input id="doc-tags" maxlength="200" placeholder="${esc(t("doc.tagsPh"))}" />

        <label class="field-label" for="doc-vis">${esc(t("doc.visLabel"))}</label>
        <select id="doc-vis">
          <option value="public">${esc(t("doc.vis.public"))}</option>
          <option value="exclusive">${esc(t("doc.vis.exclusive"))}</option>
          <option value="private">${esc(t("doc.vis.private"))}</option>
        </select>

        <label class="field-label" for="doc-file">${esc(t("doc.fileLabel"))}</label>
        <input id="doc-file" type="file" accept="${ALL_EXTS.map((e) => "." + e).join(",")}" required />
        <p class="muted">${esc(t("doc.fileHint", { max: sizeText(MAX_BYTES) }))}</p>
        <p class="muted">${esc(t("doc.scanNote"))}</p>

        <div class="up-prog" id="doc-prog" hidden><div class="up-prog-bar" id="doc-bar"></div><span class="up-prog-n" id="doc-n">0%</span></div>
        <button class="btn btn-primary" id="doc-save" type="submit">${esc(t("doc.upload"))}</button>
      </form>`;

    const f = host.querySelector("#doc-form");
    f.onsubmit = async (e) => {
      e.preventDefault();
      const title = host.querySelector("#doc-title").value.trim();
      const kind = host.querySelector("#doc-kind").value;
      const desc = host.querySelector("#doc-desc").value.trim();
      const tags = host.querySelector("#doc-tags").value.trim();
      const vis = host.querySelector("#doc-vis").value;
      const file = host.querySelector("#doc-file").files?.[0];
      if (!title) return C().toast(t("doc.needTitle"));
      if (!file) return C().toast(t("doc.needFile"));

      const ext = extOf(file.name);
      if (!ALL_EXTS.includes(ext)) return C().toast(t("doc.badExt", { ext: ext || "?" }));
      if (KIND_OF_EXT(ext) !== kind) return C().toast(t("doc.extMismatch", { ext, kind: KIND_LABEL(kind) }));
      if (file.size > MAX_BYTES) return C().toast(t("doc.tooBig", { max: sizeText(MAX_BYTES) }));

      // one row per member-cap check, so the limit cannot be bypassed in the tab
      const mine = await req(`/rest/v1/community_documents?member_id=eq.${encodeURIComponent(me.member_id)}&select=id`);
      if (mine.ok && Array.isArray(mine.data) && mine.data.length >= MAX_PER_MEMBER)
        return C().toast(t("doc.tooMany", { max: MAX_PER_MEMBER }));

      // real bytes vs claimed extension
      let sig;
      try {
        sig = await sniff(file);
      } catch {
        return C().toast(t("doc.readFail"));
      }
      if (!agrees(ext, sig)) return C().toast(t("doc.fakeFile", { ext }));

      const btn = host.querySelector("#doc-save");
      btn.disabled = true;
      const bar = host.querySelector("#doc-prog");
      const fill = host.querySelector("#doc-bar");
      const num = host.querySelector("#doc-n");
      bar.hidden = false;
      fill.style.width = "8%";
      num.textContent = t("doc.scan.running");

      // ── VirusTotal BEFORE anything is stored ─────────────────────────────
      const sha256 = await sha256Of(file);
      const scan = await vtScan(file, sha256);
      if (!scanClean(scan)) {
        // fail-closed: a file that cannot be proven clean is never uploaded
        btn.disabled = false;
        bar.hidden = true;
        return C().toast(scanMessage(scan));
      }
      fill.style.width = "45%";
      num.textContent = "45%";

      const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      // public → the public bucket (Documents/…, as the project keeps them);
      // private / exclusive → the private bucket, so only signed links open them
      const bucket = vis === "public" ? PUBLIC_BUCKET : PRIVATE_BUCKET;
      const folder = bucket === PUBLIC_BUCKET ? `${PUBLIC_FOLDER}/${me.member_id}` : me.member_id;
      const path = `${folder}/${stamp}.${ext}`;
      const okPut = await putFile(path, file, file.type || "", bucket);
      if (!okPut) {
        btn.disabled = false;
        bar.hidden = true;
        return C().toast(t("doc.uploadFail"));
      }
      fill.style.width = "80%";
      num.textContent = "80%";

      const row = await req("/rest/v1/community_documents", {
        method: "POST",
        body: JSON.stringify({
          member_id: me.member_id,
          title,
          description: desc,
          tags,
          kind,
          ext,
          mime: file.type || "",
          size_bytes: file.size,
          storage_path: path,
          bucket,
          visibility: vis,
          sha256: scan.sha256 || sha256,
          scan_status: scan.verdict,
          scan_engine: "virustotal",
          scan_stats: scan.stats || {},
          scanned_at: new Date().toISOString(),
        }),
      });
      if (!row.ok) {
        await removeFile(path, bucket); // never leave an orphan file behind
        btn.disabled = false;
        bar.hidden = true;
        return C().toast(t("doc.saveFail"));
      }
      fill.style.width = "100%";
      num.textContent = "100%";
      const created = Array.isArray(row.data) ? row.data[0] : null;
      C().toast(t("doc.uploaded"));
      ctx.onDone?.(created);
      host.innerHTML = `<p class="com-note">${esc(t("doc.uploaded"))}
        ${created ? `<a class="btn btn-sm btn-primary" href="./documents.html?id=${encodeURIComponent(created.id)}">${esc(t("doc.open"))}</a>` : ""}</p>`;
    };
  }

  /* ---------- documents.html — the library --------------------------------- */
  async function list(box, opts = {}) {
    box.innerHTML = `<p class="com-note muted">${esc(t("common.loading"))}</p>`;
    const kind = FORMATS.some((f) => f.kind === opts.kind) ? opts.kind : "";
    const q = String(opts.q || "").trim();
    let url = "/rest/v1/community_documents?select=*&visibility=eq.public&order=created_at.desc&limit=60";
    if (kind) url += `&kind=eq.${encodeURIComponent(kind)}`;
    // PostgREST ilike: * is the wildcard, so a "%" in the query stays literal
    if (q) url += `&title=ilike.${encodeURIComponent("*" + q.replace(/[%_]/g, (m) => "\\" + m) + "*")}`;
    const res = await req(url);
    if (!res.ok) return (box.innerHTML = `<p class="com-note">⚠ ${esc(t("doc.loadFail"))}</p>`);
    const rows = Array.isArray(res.data) ? res.data : [];

    const filters = `<div class="doc-filters" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <button class="btn btn-sm ${kind ? "btn-ghost" : "btn-primary"}" type="button" data-dk="">${esc(t("doc.all"))}</button>
        ${FORMATS.map((f) => `<button class="btn btn-sm ${kind === f.kind ? "btn-primary" : "btn-ghost"}" type="button" data-dk="${f.kind}">${esc(f.label)}</button>`).join("")}
        <input id="doc-q" type="search" value="${esc(q)}" placeholder="${esc(t("doc.searchPh"))}" style="margin-inline-start:auto;min-width:180px" />
      </div>`;

    if (!rows.length)
      return (box.innerHTML =
        filters +
        `<p class="com-empty muted">${esc(q || kind ? t("doc.emptyFilter") : t("doc.empty"))}</p>`);

    // newest first, grouped by day so a long list stays readable
    const names = await nameMap(rows.map((r) => r.member_id));
    box.innerHTML =
      filters +
      rows
        .map((r) => {
          const u = names.get(r.member_id);
          return `<a class="doc-row glass" href="./documents.html?id=${encodeURIComponent(r.id)}">
            ${badge(r.kind)}
            <span class="doc-row-main">
              <strong>${esc(r.title)}</strong>
              <span class="muted">${esc(String(r.description || "").slice(0, 120))}</span>
              <span class="muted">${u ? `@${esc(u.username)}` : ""} · ${esc(when(r.created_at))} · ${esc(sizeText(r.size_bytes))}</span>
            </span>
            <span class="doc-row-stats muted">👁 ${r.views || 0} · ⬇ ${r.downloads || 0} · ♥ ${r.likes || 0}</span>
          </a>`;
        })
        .join("");

    box.querySelectorAll("[data-dk]").forEach((b) => (b.onclick = () => list(box, { kind: b.dataset.dk, q })));
    const input = box.querySelector("#doc-q");
    if (input)
      input.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          list(box, { kind, q: input.value });
        }
      };
    input?.addEventListener("search", () => list(box, { kind, q: input.value }));
  }

  /* ---------- documents.html?id=ID ----------------------------------------- */
  async function documentView(box, id) {
    box.innerHTML = `<p class="com-note muted">${esc(t("common.loading"))}</p>`;
    const res = await req(`/rest/v1/community_documents?id=eq.${encodeURIComponent(id)}&select=*`);
    const row = res.ok && Array.isArray(res.data) ? res.data[0] : null;
    if (!row)
      return (box.innerHTML = `<p class="com-note">⚠ ${esc(t("doc.missing"))} <a class="btn btn-sm btn-primary" href="./documents.html">${esc(t("ct.library"))}</a></p>`);

    const me = meId();
    if (!canSee(row, me))
      return (box.innerHTML = `<p class="com-note">🔒 ${esc(t("doc.private"))} <a class="btn btn-sm btn-primary" href="./documents.html">${esc(t("ct.library"))}</a></p>`);

    const names = await nameMap([row.member_id]);
    const author = names.get(row.member_id) || null;
    const isOwner = me && me === row.member_id;
    bump(row.id, "views");

    let liked = false;
    if (me) {
      const lk = await req(
        `/rest/v1/community_document_likes?document_id=eq.${encodeURIComponent(row.id)}&member_id=eq.${encodeURIComponent(me)}&select=document_id`
      );
      liked = Boolean(lk.ok && Array.isArray(lk.data) && lk.data.length);
    }

    box.innerHTML = `
      <div class="doc-page">
        <div class="doc-head">
          ${badge(row.kind)}
          <h2 class="doc-title">${esc(row.title)}</h2>
          <p class="muted">${esc(t("doc.meta", { kind: KIND_LABEL(row.kind), size: sizeText(row.size_bytes), ext: (row.ext || "").toUpperCase(), vis: visLabel(row.visibility) }))}</p>
          ${row.scan_status ? `<p class="doc-scan ${row.scan_status === "clean" ? "ok" : "warn"}">🛡 ${esc(t("doc.scan.label", { status: t("doc.scan." + row.scan_status), engine: row.scan_engine || "VirusTotal" }))}</p>` : ""}
          <div class="doc-author">
            <img class="doc-avatar" src="" alt="" loading="lazy"
                 data-avatar-for="${esc(row.member_id)}"
                 data-avatar-name="${esc(author?.username || "CA")}" />
            <span><b>${author ? "@" + esc(author.username) : esc(t("doc.unknownAuthor"))}</b>
            <span class="muted"> · ${esc(when(row.created_at))}</span></span>
          </div>
        </div>

        ${row.description ? `<p class="doc-desc">${esc(row.description)}</p>` : ""}
        ${row.tags ? `<p class="doc-tags">${row.tags.split(/[,\s]+/).filter(Boolean).slice(0, 12).map((x) => `<span class="doc-tag">#${esc(String(x).replace(/^#/, ""))}</span>`).join(" ")}</p>` : ""}

        <div class="doc-actions">
          <button class="btn btn-primary" type="button" id="doc-dl">⬇ ${esc(t("doc.download"))}</button>
          <button class="btn btn-ghost ${liked ? "btn-primary" : ""}" type="button" id="doc-like">♥ ${row.likes || 0}</button>
          <button class="btn btn-ghost" type="button" id="doc-share">🔗 ${esc(t("doc.share"))}</button>
          <button class="btn btn-ghost" type="button" id="doc-report">🚩 ${esc(t("doc.report"))}</button>
          <a class="btn btn-ghost" href="./documents.html">← ${esc(t("ct.library"))}</a>
        </div>
        <p class="muted doc-counts">👁 ${row.views || 0} ${esc(t("doc.views"))} · ⬇ ${row.downloads || 0} ${esc(t("doc.downloads"))}</p>

        ${CAN_PREVIEW(row.kind) ? `<div class="doc-preview glass" id="doc-preview"><p class="muted">${esc(t("doc.previewLoading"))}</p></div>` : `<p class="doc-nopreview muted">${esc(t("doc.noPreview", { ext: (row.ext || "").toUpperCase() }))}</p>`}
        ${isOwner ? `<p class="muted">${esc(t("doc.ownerNote"))}</p>` : ""}
        <div id="doc-comments"></div>
      </div>`;

    // avatar through the shared helper (it fills [data-avatar-for] images)
    try {
      C().hydrateAvatars?.(box);
    } catch {
      /* initials stay */
    }

    const preview = box.querySelector("#doc-preview");
    if (preview) {
      const link = await signedLink(row);
      preview.innerHTML = link
        ? `<iframe class="doc-frame" src="${esc(link)}" title="${esc(row.title)}" loading="lazy"></iframe>
           <p class="muted">${esc(t("doc.previewNote"))}</p>`
        : `<p class="muted">${esc(t("doc.previewFail"))}</p>`;
    }

    box.querySelector("#doc-dl").onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const link = await signedLink(row);
      btn.disabled = false;
      if (!link) return C().toast(t("doc.previewFail"));
      bump(row.id, "downloads");
      window.open(link, "_blank", "noopener,noreferrer");
    };

    box.querySelector("#doc-like").onclick = async (e) => {
      if (!me) return C().toast(t("doc.loginToVote"));
      const btn = e.currentTarget;
      btn.disabled = true;
      const has = btn.classList.contains("btn-primary");
      const r = await req(
        has
          ? `/rest/v1/community_document_likes?document_id=eq.${encodeURIComponent(row.id)}&member_id=eq.${encodeURIComponent(me)}`
          : "/rest/v1/community_document_likes",
        has
          ? { method: "DELETE" }
          : { method: "POST", body: JSON.stringify({ document_id: Number(row.id), member_id: me }) }
      );
      if (!r.ok) C().toast(t("com.saveFail"));
      documentView(box, id);
    };

    box.querySelector("#doc-share").onclick = async () => {
      const url = location.href;
      try {
        if (navigator.share) await navigator.share({ title: row.title, url });
        else {
          await navigator.clipboard.writeText(url);
          C().toast(t("doc.linkCopied"));
        }
      } catch {
        /* the member dismissed the sheet */
      }
    };

    box.querySelector("#doc-report").onclick = async () => {
      if (!me) return C().toast(t("doc.loginToVote"));
      const reason = window.prompt(t("doc.reportAsk"), "");
      if (reason === null) return;
      const r = await req("/rest/v1/community_document_reports", {
        method: "POST",
        body: JSON.stringify({ document_id: Number(row.id), member_id: me, reason: String(reason).slice(0, 500) }),
      });
      C().toast(r.ok ? t("doc.reportOk") : t("com.saveFail"));
    };
  }

  /* ---------- Studio › Manage content › Documents --------------------------- */
  async function renderManage(box, memberId, opts = {}) {
    const me = meId();
    const res = await req(
      `/rest/v1/community_documents?member_id=eq.${encodeURIComponent(memberId)}&select=*&order=created_at.desc&limit=200`
    );
    if (!res.ok) return (box.innerHTML = `<p class="empty">⚠ ${esc(t("doc.loadFail"))}</p>`);
    let rows = Array.isArray(res.data) ? res.data : [];
    // the studio's Sort by drives this list too (newest / oldest / views)
    if (opts.sort === "oldest") rows = rows.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    if (opts.sort === "views") rows = rows.slice().sort((a, b) => Number(b.views || 0) - Number(a.views || 0));
    if (!rows.length) {
      box.innerHTML = `<p class="empty">${esc(t("doc.noneMine"))}
        <button class="btn btn-sm btn-primary" type="button" id="doc-goto-create">${esc(t("doc.createOne"))}</button></p>`;
      bindGoto(box);
      return;
    }

    box.innerHTML =
      `<p class="muted">${esc(t("doc.manageNote", { n: rows.length, max: MAX_PER_MEMBER }))}</p>` +
      rows
        .map(
          (r) => `<article class="glass doc-mrow">
            ${badge(r.kind)}
            <span class="doc-mrow-main">
              <strong>${esc(r.title)}</strong>
              <span class="muted">${esc(t("pm.vis." + (r.visibility || "public")))} · ${esc(sizeText(r.size_bytes))} · ${esc(when(r.created_at))} · 👁 ${r.views || 0} · ⬇ ${r.downloads || 0} · ♥ ${r.likes || 0}</span>
            </span>
            <a class="btn btn-sm btn-ghost" href="./documents.html?id=${encodeURIComponent(r.id)}">${esc(t("manage.open"))}</a>
            ${me === r.member_id ? `<button class="btn btn-sm btn-danger" type="button" data-docdel="${esc(r.id)}" data-path="${esc(r.storage_path)}">${esc(t("manage.del"))}</button>` : ""}
          </article>`
        )
        .join("");

    box.querySelectorAll("[data-docdel]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (!confirm(t("manage.confirm"))) return;
          b.disabled = true;
          // ownership re-read at execution time, from the row itself
          const chk = await req(`/rest/v1/community_documents?id=eq.${encodeURIComponent(b.dataset.docdel)}&select=member_id,storage_path,bucket`);
          const row = chk.ok && Array.isArray(chk.data) ? chk.data[0] : null;
          if (!row || row.member_id !== me) {
            b.disabled = false;
            return C().toast(t("manage.forbidden"));
          }
          const del = await req(`/rest/v1/community_documents?id=eq.${encodeURIComponent(b.dataset.docdel)}`, { method: "DELETE" });
          if (!del.ok) {
            b.disabled = false;
            return C().toast(t("manage.delFail"));
          }
          await removeFile(row.storage_path || b.dataset.path, BUCKET(row));
          C().toast(t("manage.delOk"));
          opts.onRemoved?.(b.dataset.docdel);
          renderManage(box, memberId, opts);
        })
    );
  }

  function bindGoto(box) {
    const b = box.querySelector("#doc-goto-create");
    if (b)
      b.onclick = () => {
        const host = document.querySelector("#studio-body");
        if (host) renderUpload(host, { member: C().getSession() });
      };
  }

  /* ---------- Your content › Documents (the visitor-facing shelf) ----------- */
  async function memberDocuments(box, memberId, isOwner) {
    const res = await req(
      `/rest/v1/community_documents?member_id=eq.${encodeURIComponent(memberId)}&select=*&order=created_at.desc&limit=60`
    );
    if (!res.ok) return (box.innerHTML = `<p class="empty">⚠ ${esc(t("doc.loadFail"))}</p>`);
    const me = meId();
    // a visitor only sees what the visibility allows; the owner sees everything
    const rows = (Array.isArray(res.data) ? res.data : []).filter((r) => canSee(r, me));
    if (!rows.length)
      return (box.innerHTML = `<p class="empty">${esc(t("prof.ct.none"))}${
        isOwner ? ` <a class="btn btn-sm btn-primary" href="?section=create">${esc(t("prof.studio.open"))}</a>` : ""
      }</p>`);
    box.innerHTML = rows
      .map(
        (r) => `<a class="doc-row glass" href="./documents.html?id=${encodeURIComponent(r.id)}">
          ${badge(r.kind)}
          <span class="doc-row-main">
            <strong>${esc(r.title)}</strong>
            <span class="muted">${esc(String(r.description || "").slice(0, 110))}</span>
            <span class="muted">${esc(sizeText(r.size_bytes))} · ${esc(when(r.created_at))} · ${esc(visLabel(r.visibility))}</span>
          </span>
          <span class="doc-row-stats muted">👁 ${r.views || 0} · ⬇ ${r.downloads || 0} · ♥ ${r.likes || 0}</span>
        </a>`
      )
      .join("");
  }

  // One row of the content home (content.html): the newest documents, drawn
  // with the same .doc-row the library uses, each one a link to its page.
  async function homeRows(box, limit) {
    const res = await req(`/rest/v1/community_documents?select=*&visibility=eq.public&order=created_at.desc&limit=${Math.max(1, Number(limit) || 4)}`);
    if (!res.ok) return (box.innerHTML = `<p class="com-note">⚠ ${esc(t("doc.loadFail"))}</p>`);
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) return (box.innerHTML = `<p class="com-empty muted">${esc(t("doc.empty"))}</p>`);
    const names = await nameMap(rows.map((r) => r.member_id));
    box.innerHTML = rows
      .map((r) => {
        const u = names.get(r.member_id);
        return `<a class="doc-row glass" href="./documents.html?id=${encodeURIComponent(r.id)}">
          ${badge(r.kind)}
          <span class="doc-row-main">
            <strong>${esc(r.title)}</strong>
            <span class="muted">${u ? `@${esc(u.username)}` : ""} · ${esc(when(r.created_at))} · ${esc(sizeText(r.size_bytes))}</span>
          </span>
          <span class="doc-row-stats muted">👁 ${r.views || 0} · ⬇ ${r.downloads || 0} · ♥ ${r.likes || 0}</span>
        </a>`;
      })
      .join("");
  }

  window.CineAuraDocs = { list, documentView, renderUpload, renderManage, memberDocuments, homeRows, FORMATS, MAX_BYTES, MAX_PER_MEMBER };
})();
