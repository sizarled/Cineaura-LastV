  // New article opens the one rich editor (article-Editor.html). Members reach it from
  // Create, the hub and the Studio; staff from the Panel — same page, same code.
  function articleForm(box) {
    if (!meId()) return (box.innerHTML = loginNote());
    box.innerHTML = `<div class="com-form glass" style="text-align:center">
        <p class="com-body">${esc(t("ae.redirect"))}</p>
        <a class="btn btn-primary" href="./article-Editor.html">${esc(t("ae.openEditor"))}</a>
      </div>`;
    location.href = "./article-Editor.html";
  }

/* CineAura — Community hub (js/community.js, sql/community.sql)
   The hub is for groups; Questions & Answers and Articles have dedicated pages.
   Public to browse; a signed-in member asks, answers, votes "helpful" and publishes articles.
   Q&A deep links: answers.html · #ask · ?id=123; old community.html Q&A hashes redirect.
   The profile renders its Community section through memberView(main, memberId). */
(() => {
  const C = () => window.CineAura;
  const esc = (v) =>
    C() && C().escapeHtml
      ? C().escapeHtml(v)
      : String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const t = (k, vars) => (C() && C().t ? C().t(k, vars) : k);
  const toast = (m) => (C() && C().toast ? C().toast(m) : alert(m));
  const req = (...args) => C().supabaseRequest(...args);
  const meId = () => C() && C().getSession ? C().getSession()?.member_id || "" : "";
  const idsIn = (ids) => ids.map((x) => String(x).replace(/[,"\\]/g, "")).join(",");

  // member_id -> @username, one REST round trip per batch.
  async function nameMap(ids) {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map();
    const res = await req(`/rest/v1/members?member_id=in.(${idsIn(uniq)})&select=member_id,username`);
    const rows = res.ok && Array.isArray(res.data) ? res.data : [];
    return new Map(rows.map((r) => [r.member_id, r.username]));
  }
  const who = (names, id) => (names.get(id) ? `@${names.get(id)}` : "");
  const when = (iso) => String(iso || "").slice(0, 16).replace("T", " ");
  // Group links stay in the hub; Q&A/article links go to their dedicated pages.
  const base = () => (document.getElementById("com-root") ? "" : "./community.html");
  const loginNote = () =>
    meId() ? "" : `<p class="com-note muted">${esc(t("com.login"))} <a class="btn btn-sm btn-primary" href="./login.html">${esc(t("nav.signin"))}</a></p>`;

  const gLink = (id) => (base() ? `${base()}?group=${id}` : `?group=${id}`);
  // Deep links always open the page that owns the content type (round 39).
  // Question and answer IDs share answers.html; kind=answer selects an answer.
  const DEEP_PAGE = { article: "articles", question: "answers", answer: "answers" };
  // Q&A always returns to its dedicated page; articles keep the hub's legacy
  // hash alias when opened there, otherwise they return to articles.html.
  const listHref = (kind) => {
    if (kind === "question" || kind === "answer") return "./answers.html";
    return document.getElementById("com-root") ? "#articles" : `./${DEEP_PAGE[kind]}.html`;
  };
  const dLink = (kind, id) => {
    const encoded = encodeURIComponent(id);
    if (kind === "question") return `./answers.html?id=${encoded}`;
    if (kind === "answer") return `./answers.html?id=${encoded}&kind=answer`;
    if (kind === "article")
      return document.getElementById("com-root") ? `#a/${encoded}` : `./articles.html?id=${encoded}`;
    return `./${DEEP_PAGE[kind] || "answers"}.html?id=${encoded}`;
  };
  const groupParam = () => new URLSearchParams(location.search).get("group");
  // Community.html?group=12345 picks the group page; plain Community.html picks
  // the list. #g/123 stays as a legacy alias so old links never break.
  const gTab = () => {
    const h = String(location.hash || "").replace(/^#/, "");
    return ["about", "members"].includes(h) ? h : "posts";
  };
  const hashRoute = () => {
    const gp = groupParam();
    if (gp) return { view: "group", id: Number(gp) };
    const h = String(location.hash || "").replace(/^#/, "");
    const m = h.match(/^(q|a|g)\/(\d+)$/);
    if (m) return { view: m[1] === "q" ? "question" : m[1] === "a" ? "article" : "group", id: Number(m[2]) };
    if (h === "ask") return { view: "ask" };
    if (h === "new-article") return { view: "newArticle" };
    if (h === "articles") return { view: "list", tab: "articles" };
    if (h === "questions") return { view: "list", tab: "questions" };
    if (h === "my-groups") return { view: "groups", tab: "my" };
    if (h === "new-group") return { view: "newGroup" };
    return { view: "groups", tab: "discover" };
  };

  // ─────────────────────────── write helpers ───────────────────────────
  async function insertRow(path, payload) {
    const res = await req(path, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    if (res.ok && Array.isArray(res.data) && res.data[0]) return res.data[0];
    toast(t("com.saveFail"));
    return null;
  }

  // Community question / answer files are public content. Keep storage names
  // random and extensionless; retain the original name only as escaped metadata.
  const QA_BUCKET = "community-attachments";
  const QA_MAX_FILES = 5;
  const QA_MAX_FILE_BYTES = 50 * 1024 * 1024;
  const QA_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
  const qaEncodePath = (path) => String(path || "").split("/").map(encodeURIComponent).join("/");
  const qaFileName = (name) => String(name || "").split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180) || "file";
  const qaSize = (size) => {
    const n = Math.max(0, Number(size) || 0);
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
  };
  function qaToken() {
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  const qaStorageUrl = (path) => `${String(C().SUPABASE_URL || "").replace(/\/+$/, "")}/storage/v1/object/${QA_BUCKET}/${qaEncodePath(path)}`;
  const qaPublicUrl = (path) => `${String(C().SUPABASE_URL || "").replace(/\/+$/, "")}/storage/v1/object/public/${QA_BUCKET}/${qaEncodePath(path)}`;
  const qaAuthHeaders = (extra) => ({
    apikey: C().SUPABASE_KEY,
    Authorization: `Bearer ${C().SUPABASE_KEY}`,
    ...(extra || {}),
  });

  async function removeQAFiles(paths) {
    await Promise.all((paths || []).map(async (path) => {
      try {
        await fetch(qaStorageUrl(path), { method: "DELETE", headers: qaAuthHeaders() });
      } catch {
        /* cleanup must not hide the original save error */
      }
    }));
  }

  async function uploadQAFiles(kind, files, statusNode) {
    if (!files.length) return [];
    if (!["questions", "answers"].includes(kind)) return null;
    const uploaded = [];
    const attachments = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const path = `${kind}/${qaToken()}`;
      if (statusNode) statusNode.textContent = t("com.uploadingFile", { current: i + 1, total: files.length });
      let res;
      try {
        res = await fetch(qaStorageUrl(path), {
          method: "POST",
          headers: qaAuthHeaders({
            "Content-Type": file.type || "application/octet-stream",
            "Cache-Control": "3600",
            "x-upsert": "false",
          }),
          body: file,
        });
      } catch {
        await removeQAFiles(uploaded);
        return null;
      }
      if (!res.ok) {
        await removeQAFiles(uploaded);
        return null;
      }
      uploaded.push(path);
      attachments.push({
        name: qaFileName(file.name),
        path,
        mime: file.type || "application/octet-stream",
        size: Number(file.size) || 0,
      });
    }
    return attachments;
  }

  function attachmentEntries(value, kind) {
    if (!Array.isArray(value)) return [];
    const prefix = kind === "question" ? "questions" : "answers";
    return value.slice(0, QA_MAX_FILES).reduce((items, item) => {
      const path = String(item?.path || "");
      if (!new RegExp(`^${prefix}/[a-f0-9]{32}$`, "i").test(path)) return items;
      items.push({
        path,
        name: qaFileName(item.name),
        mime: String(item.mime || "application/octet-stream").slice(0, 120).toLowerCase(),
        size: Number(item.size) || 0,
      });
      return items;
    }, []);
  }

  function attachmentHtml(value, kind) {
    const files = attachmentEntries(value, kind);
    if (!files.length) return "";
    const size = (file) => `<span class="com-attach-size">${esc(qaSize(file.size))}</span>`;
    const download = (file) => `${qaPublicUrl(file.path)}?download=${encodeURIComponent(file.name)}`;
    const cards = files.map((file) => {
      const url = qaPublicUrl(file.path);
      const href = download(file);
      if (/^image\/(jpeg|png|gif|webp|avif|bmp)$/i.test(file.mime))
        return `<figure class="com-attach-card com-attach-image">
          <a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" alt="${esc(file.name)}" loading="lazy" /></a>
          <figcaption><span class="com-attach-name">${esc(file.name)}</span>${size(file)}<a class="com-attach-download" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(t("com.download"))}</a></figcaption>
        </figure>`;
      if (/^video\/(mp4|webm|ogg|quicktime|x-matroska|3gpp)$/i.test(file.mime))
        return `<figure class="com-attach-card com-attach-video">
          <video controls playsinline preload="metadata" src="${esc(url)}"></video>
          <figcaption><span class="com-attach-name">${esc(file.name)}</span>${size(file)}<a class="com-attach-download" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(t("com.download"))}</a></figcaption>
        </figure>`;
      return `<div class="com-attach-file">
        <span class="com-attach-file-icon" aria-hidden="true">📎</span>
        <span class="com-attach-file-meta"><strong>${esc(file.name)}</strong>${size(file)}</span>
        <a class="btn btn-sm btn-ghost" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(t("com.download"))}</a>
      </div>`;
    });
    return `<div class="com-attachments" aria-label="${esc(t("com.attachFiles"))}">${cards.join("")}</div>`;
  }

  function attachmentPickerMarkup(id) {
    return `<div class="com-attach-field">
      <span class="com-field-label">${esc(t("com.attachFiles"))}</span>
      <label class="com-dropzone" data-com-dropzone>
        <input id="${id}" class="com-file-input" type="file" multiple />
        <span class="com-drop-icon" aria-hidden="true">📎</span>
        <span class="com-drop-copy"><strong>${esc(t("com.attachDrop"))}</strong><small>${esc(t("com.attachHint"))}</small></span>
      </label>
      <div class="com-selected-files" data-com-files aria-live="polite"></div>
    </div>`;
  }

  function bindAttachmentPicker(form, inputId) {
    let selected = [];
    const input = form.querySelector(`#${inputId}`);
    const drop = form.querySelector("[data-com-dropzone]");
    const list = form.querySelector("[data-com-files]");
    const render = () => {
      list.innerHTML = selected.map((file, index) => `<div class="com-selected-file">
        <span class="com-attach-file-icon" aria-hidden="true">${file.type.startsWith("image/") ? "🖼️" : file.type.startsWith("video/") ? "🎬" : "📎"}</span>
        <span class="com-attach-file-meta"><strong>${esc(qaFileName(file.name))}</strong><small>${esc(qaSize(file.size))}</small></span>
        <button type="button" class="com-remove-file" data-com-file-remove="${index}" aria-label="${esc(t("com.removeFile", { name: qaFileName(file.name) }))}">×</button>
      </div>`).join("");
      list.querySelectorAll("[data-com-file-remove]").forEach((button) => {
        button.onclick = () => {
          selected.splice(Number(button.dataset.comFileRemove), 1);
          render();
        };
      });
    };
    const addFiles = (incoming) => {
      for (const file of Array.from(incoming || [])) {
        if (selected.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) continue;
        if (selected.length >= QA_MAX_FILES) {
          toast(t("com.attachCountLimit", { max: QA_MAX_FILES }));
          break;
        }
        if (file.size > QA_MAX_FILE_BYTES) {
          toast(t("com.fileTooLarge", { max: "50 MB" }));
          continue;
        }
        const total = selected.reduce((sum, item) => sum + item.size, 0);
        if (total + file.size > QA_MAX_TOTAL_BYTES) {
          toast(t("com.attachTotalLimit", { max: "100 MB" }));
          continue;
        }
        selected.push(file);
      }
      render();
    };
    input.addEventListener("change", () => {
      addFiles(input.files);
      input.value = "";
    });
    drop.addEventListener("dragover", (event) => {
      event.preventDefault();
      drop.classList.add("is-dragover");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-dragover"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("is-dragover");
      addFiles(event.dataTransfer?.files);
    });
    return () => selected.slice();
  }

  // ─────────────────────────── questions ───────────────────────────
  async function listQuestions(box) {
    const [res, arts] = await Promise.all([
      req("/rest/v1/community_questions?select=*&order=created_at.desc&limit=80"),
      Promise.resolve(null),
    ]);
    const rows = res.ok && Array.isArray(res.data) ? res.data : [];
    if (!res.ok) return (box.innerHTML = `<p class="com-note">⚠ ${esc(t("com.loadFail"))}</p>`);
    if (!rows.length)
      return (box.innerHTML = `<p class="com-empty muted">${esc(t("com.emptyQ"))} <a class="btn btn-sm btn-primary" href="./answers.html#ask">${esc(t("com.ask"))}</a></p>`);
    const names = await nameMap(rows.map((r) => r.member_id));
    box.innerHTML = rows
      .map(
        (q) => `<a class="com-row glass" href="${dLink("question", q.id)}">
          <span class="com-row-main"><strong>${esc(q.title)}</strong>
          <span class="muted">${esc(who(names, q.member_id))} · ${esc(when(q.created_at))}</span></span>
          <span class="com-chip">💬 ${q.answers_count || 0} ${esc(t("com.answersN"))}</span>
        </a>`
      )
      .join("");
  }

  function askForm(box) {
    if (!meId()) return (box.innerHTML = loginNote());
    box.innerHTML = `<form id="com-ask" class="com-form com-qa-form glass">
      <header class="com-qa-head">
        <span class="com-qa-mark" aria-hidden="true">❓</span>
        <div><p class="eyebrow">${esc(t("com.ask"))}</p><h2>${esc(t("com.askHeading"))}</h2><p class="muted">${esc(t("com.askIntro"))}</p></div>
      </header>
      <div class="com-field">
        <label class="com-field-label" for="com-question-title">${esc(t("com.qTitle"))} <span class="com-required" aria-hidden="true">*</span></label>
        <input id="com-question-title" name="title" maxlength="200" required placeholder="${esc(t("com.qTitlePh"))}" />
      </div>
      <div class="com-field">
        <label class="com-field-label" for="com-question-details">${esc(t("com.questionText"))} <span class="com-required" aria-hidden="true">*</span></label>
        <textarea id="com-question-details" name="details" rows="7" maxlength="5000" required placeholder="${esc(t("com.detailsPh"))}"></textarea>
      </div>
      ${attachmentPickerMarkup("com-question-files")}
      <p class="com-form-status" data-com-status role="status" aria-live="polite"></p>
      <div class="com-form-actions">
        <button class="btn btn-primary" type="submit">${esc(t("com.postQ"))}</button>
        <button class="btn btn-ghost" type="button" data-com-cancel>${esc(t("common.cancel"))}</button>
      </div>
    </form>`;
    const form = box.querySelector("#com-ask");
    const selectedFiles = bindAttachmentPicker(form, "com-question-files");
    form.querySelector("[data-com-cancel]").onclick = () => {
      const page = document.getElementById("page-root");
      if (page?.dataset.kind === "questions" || document.getElementById("com-root")) location.href = "./answers.html";
      else location.href = "./profile.html?section=community";
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const title = String(fd.get("title") || "").trim();
      const details = String(fd.get("details") || "").trim();
      if (!title || !details) return toast(t("com.questionRequired"));
      const submit = form.querySelector('[type="submit"]');
      const status = form.querySelector("[data-com-status]");
      submit.disabled = true;
      status.textContent = t("com.saving");
      const files = selectedFiles();
      const attachments = await uploadQAFiles("questions", files, status);
      if (attachments === null) {
        submit.disabled = false;
        status.textContent = "";
        return toast(t("com.uploadFail"));
      }
      const row = await insertRow("/rest/v1/community_questions", {
        member_id: meId(),
        title,
        details,
        attachments,
      });
      if (!row) {
        await removeQAFiles(attachments.map((file) => file.path));
        submit.disabled = false;
        status.textContent = "";
        return;
      }
      toast(t("com.saved"));
      location.href = dLink("question", row.id);
    };
  }

  // ?answer=ID — the answer with its parent question (Round-60 spec).
  async function answerView(box, id) {
    const res = await req(`/rest/v1/community_answers?id=eq.${id}&select=*`);
    const a = res.ok && Array.isArray(res.data) ? res.data[0] : null;
    if (!a) return (box.innerHTML = `<p class="com-note">⚠ ${esc(t("ct.missing"))} <a href="${listHref("answer")}">${esc(t("ct.library"))}</a></p>`);
    questionView(box, a.question_id, a.id);
  }

  async function questionView(box, id, hlAnswerId) {
    const res = await req(`/rest/v1/community_questions?id=eq.${id}&select=*`);
    const q = res.ok && Array.isArray(res.data) ? res.data[0] : null;
    if (!q) return (box.innerHTML = `<p class="com-note">⚠ ${esc(t("com.loadFail"))} <a href="${listHref("question")}">${esc(t("com.backList"))}</a></p>`);
    const [ansRes, names] = await Promise.all([
      req(`/rest/v1/community_answers?question_id=eq.${id}&select=*&order=votes.desc,created_at.asc&limit=200`),
      nameMap([q.member_id]),
    ]);
    const answers = ansRes.ok && Array.isArray(ansRes.data) ? ansRes.data : [];
    const names2 = await nameMap(answers.map((a) => a.member_id));
    names2.forEach((v, k) => names.set(k, v));
    const me = meId();
    const ids = answers.map((a) => a.id);
    let mine = new Set();
    if (me && ids.length) {
      const vr = await req(`/rest/v1/community_answer_votes?member_id=eq.${encodeURIComponent(me)}&answer_id=in.(${idsIn(ids)})&select=answer_id`);
      if (vr.ok && Array.isArray(vr.data)) mine = new Set(vr.data.map((v) => v.answer_id));
    }
    box.innerHTML = `<a class="com-back" href="${listHref("question")}">← ${esc(t("com.backList"))}</a>
      <article class="com-q glass">
        <h2>${esc(q.title)}</h2>
        <p class="muted">${esc(who(names, q.member_id))} · ${esc(when(q.created_at))}</p>
        <p class="com-body">${esc(q.details || "")}</p>
        ${attachmentHtml(q.attachments, "question")}
      </article>
      <h3 class="com-h3">💬 ${answers.length} ${esc(t("com.answersN"))}</h3>
      <div id="com-answers">${answers
        .map(
          (a) => `<div class="com-answer glass${a.id === hlAnswerId ? " com-hl" : ""}" data-ans="${a.id}">
            <p class="com-body">${esc(a.body)}</p>
            ${attachmentHtml(a.attachments, "answer")}
            <div class="com-a-foot">
              <span class="muted">${esc(who(names2, a.member_id))} · ${esc(when(a.created_at))}</span>
              <button type="button" class="btn btn-sm ${mine.has(a.id) ? "btn-primary" : "btn-ghost"}" data-vote="${a.id}" ${me && a.member_id !== me ? "" : me ? "disabled" : "disabled"}>👍 ${a.votes || 0} ${esc(t("com.helpful"))}</button>
            </div>
          </div>`
        )
        .join("")}</div>
      ${
        me
          ? `<form id="com-answer" class="com-form com-qa-form com-answer-compose glass">
              <header class="com-qa-head">
                <span class="com-qa-mark" aria-hidden="true">↩</span>
                <div><h3>${esc(t("com.answerHeading"))}</h3><p class="muted">${esc(t("com.answerIntro"))}</p></div>
              </header>
              <div class="com-field">
                <label class="com-field-label" for="com-answer-body">${esc(t("com.questionTextAnswer"))} <span class="com-required" aria-hidden="true">*</span></label>
                <textarea id="com-answer-body" name="body" rows="5" maxlength="5000" required placeholder="${esc(t("com.write"))}"></textarea>
              </div>
              ${attachmentPickerMarkup("com-answer-files")}
              <p class="com-form-status" data-com-status role="status" aria-live="polite"></p>
              <div class="com-form-actions"><button class="btn btn-primary" type="submit">${esc(t("com.postA"))}</button></div>
            </form>`
          : loginNote()
      }`;
    box.querySelectorAll("[data-vote]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const aid = Number(b.dataset.vote);
        const has = mine.has(aid);
        const r = await req(
          has
            ? `/rest/v1/community_answer_votes?answer_id=eq.${aid}&member_id=eq.${encodeURIComponent(meId())}`
            : `/rest/v1/community_answer_votes?select=answer_id,member_id`,
          has
            ? { method: "DELETE" }
            : { method: "POST", body: JSON.stringify({ answer_id: aid, member_id: meId() }) }
        );
        if (!r.ok) toast(t("com.saveFail"));
        questionView(box, id);
      };
    });
    if (hlAnswerId) {
      const tur = box.querySelector(`[data-ans="${hlAnswerId}"]`);
      if (tur) tur.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    const f = box.querySelector("#com-answer");
    if (f) {
      const selectedFiles = bindAttachmentPicker(f, "com-answer-files");
      f.onsubmit = async (e) => {
        e.preventDefault();
        const body = String(new FormData(f).get("body") || "").trim();
        if (!body) return toast(t("com.answerRequired"));
        const submit = f.querySelector('[type="submit"]');
        const status = f.querySelector("[data-com-status]");
        submit.disabled = true;
        status.textContent = t("com.saving");
        const files = selectedFiles();
        const attachments = await uploadQAFiles("answers", files, status);
        if (attachments === null) {
          submit.disabled = false;
          status.textContent = "";
          return toast(t("com.uploadFail"));
        }
        const row = await insertRow("/rest/v1/community_answers", {
          question_id: id,
          member_id: meId(),
          body,
          attachments,
        });
        if (!row) {
          await removeQAFiles(attachments.map((file) => file.path));
          submit.disabled = false;
          status.textContent = "";
          return;
        }
        questionView(box, id);
      };
    }
  }

  // ─────────────────────────── articles ───────────────────────────
  // Reader queries deliberately select only display fields. In particular, never
  // return private_passwords as part of a public article-list response.
  const ARTICLE_SUMMARY_FIELDS = "id,member_id,title,description,body,language,categories,tags,thumb,views,created_at,publish_at,status,visibility,places";
  const ARTICLE_ACCESS_FIELDS = "id,member_id,status,publish_at,visibility,places";
  const ARTICLE_DETAIL_FIELDS = `${ARTICLE_SUMMARY_FIELDS},body_html`;
  const ARTICLE_AUTHOR_PROFILE_FIELDS = [
    "member_id", "username", "avatar_url", "bio", "followers", "following",
    "display_name", "membership_type", "language",
  ];
  const ARTICLE_VIEWER_PROFILE_FIELDS = ["member_id", "language", "country", "level", "tier"];

  function articleHasContentPlacement(row) {
    const places = String(row?.places ?? "content").trim().toLowerCase();
    if (!places) return true;
    return places.split(/[+,|\s]+/).some((place) => place === "content" || place === "both");
  }

  function articleIsReleased(row) {
    if (!row || String(row.status || "published").trim().toLowerCase() !== "published") return false;
    if (!row.publish_at) return true;
    const publishAt = Date.parse(row.publish_at);
    return Number.isFinite(publishAt) && publishAt <= Date.now();
  }

  function articleIsContentPublished(row) {
    return articleIsReleased(row) && articleHasContentPlacement(row);
  }

  // The public library, home page and recommendations expose only public,
  // published articles explicitly placed in Content (not drafts, Help-only or scheduled rows).
  function articleIsPublicNow(row) {
    return articleIsContentPublished(row) && String(row.visibility || "public").trim().toLowerCase() === "public";
  }

  function articleCategories(row) {
    return String(row?.categories || row?.tags || "")
      .split(/[,;|\n]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  function articlePlainText(row) {
    const A = window.CineAuraArticles;
    const safeHtml = A?.bodyHtml ? A.bodyHtml(row) : `<p>${esc(row?.body || "")}</p>`;
    const node = document.createElement("div");
    node.innerHTML = safeHtml;
    return String(node.textContent || "").replace(/\s+/g, " ").trim();
  }

  function articleReadMinutes(row) {
    const words = articlePlainText(row).split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  }

  function articleReadTimeLabel(minutes) {
    const lang = C()?.getLang?.() || "en";
    const labels = {
      ar: minutes === 1 ? "دقيقة قراءة" : "دقائق قراءة",
      en: "min read",
      fr: "min de lecture",
      es: "min de lectura",
      de: "Min. Lesezeit",
      nl: "min leestijd",
      it: "min di lettura",
    };
    return `${minutes} ${labels[lang] || labels.en}`;
  }

  function articleDate(value) {
    return C()?.formatDate ? C().formatDate(value) : when(value);
  }

  function articleNumber(value) {
    const number = Math.max(0, Number(value) || 0);
    try {
      return new Intl.NumberFormat(C()?.getLocale?.() || undefined, { notation: "compact", maximumFractionDigits: 1 }).format(number);
    } catch {
      return String(number);
    }
  }

  function safeArticleImageUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(raw)) return raw;
    try {
      const url = new URL(raw, location.href);
      if (url.protocol !== "https:" && url.protocol !== "http:") return "";
      return url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : url.href;
    } catch {
      return "";
    }
  }

  function articleImage(row) {
    const fromThumb = safeArticleImageUrl(row?.thumb);
    if (fromThumb) return fromThumb;
    const A = window.CineAuraArticles;
    const safeHtml = A?.bodyHtml ? A.bodyHtml(row) : `<p>${esc(row?.body || "")}</p>`;
    const parsed = new DOMParser().parseFromString(safeHtml, "text/html");
    return safeArticleImageUrl(parsed.querySelector("img")?.getAttribute("src"));
  }

  function articleCoverMarkup(row, className, alt = "") {
    const src = articleImage(row);
    return src
      ? `<img class="${className}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" />`
      : `<span class="${className} ar-cover-placeholder" aria-hidden="true">✍</span>`;
  }

  // The author display joins the safe public member fields and profile fields in
  // parallel; profilesByIds handles optional/older profile columns gracefully.
  async function articleAuthorsByIds(ids) {
    const uniq = [...new Set((ids || []).map((id) => String(id || "")).filter(Boolean))];
    if (!uniq.length) return new Map();
    const [members, profiles] = await Promise.all([
      req(`/rest/v1/members?member_id=in.(${idsIn(uniq)})&select=member_id,username,full_name`).catch(() => ({ ok: false, data: [] })),
      C()?.profilesByIds
        ? C().profilesByIds(uniq, ARTICLE_AUTHOR_PROFILE_FIELDS).catch(() => [])
        : Promise.resolve([]),
    ]);
    const memberRows = members?.ok && Array.isArray(members.data) ? members.data : [];
    const profileRows = Array.isArray(profiles) ? profiles : [];
    const memberMap = new Map(memberRows.map((row) => [String(row.member_id), row]));
    const profileMap = new Map(profileRows.map((row) => [String(row.member_id), row]));
    return new Map(uniq.map((id) => {
      const member = memberMap.get(id) || {};
      const profile = profileMap.get(id) || {};
      const username = String(profile.username || member.username || "").replace(/^@/, "");
      return [id, {
        ...member,
        ...profile,
        member_id: id,
        username,
        full_name: member.full_name || "",
        display_name: String(profile.display_name || member.full_name || username || "CineAura member"),
        avatar_url: profile.avatar_url || "",
      }];
    }));
  }

  function articleProfileHref(author) {
    const username = String(author?.username || "").replace(/^@/, "").trim();
    return username ? `./profile.html?@${encodeURIComponent(username)}` : "";
  }

  function articleAvatar(author, className = "ar-author-avatar") {
    const id = String(author?.member_id || "");
    const username = String(author?.username || "");
    const name = String(author?.display_name || author?.full_name || username || "CA");
    const Cn = C();
    const src = safeArticleImageUrl(author?.avatar_url) || Cn?.avatarSrc?.(id, username, name) || Cn?.initialsAvatar?.(name) || "";
    return `<img class="${className}" src="${esc(src)}" alt="" data-avatar-for="${esc(id)}" data-avatar-name="${esc(username || name)}" loading="lazy" />`;
  }

  function articleAuthorCard(author) {
    const profile = author || {};
    const href = articleProfileHref(profile);
    const open = href ? `<a class="ar-author-profile" href="${esc(href)}">` : `<div class="ar-author-profile">`;
    const close = href ? "</a>" : "</div>";
    const language = String(profile.language || "");
    const languageName = C()?.LANG_NAMES?.[language] || language;
    const membership = String(profile.membership_type || "");
    const stats = [];
    if (profile.followers != null) stats.push(`<span><b>${esc(articleNumber(profile.followers))}</b> ${esc(t("prof.followers"))}</span>`);
    if (profile.following != null) stats.push(`<span><b>${esc(articleNumber(profile.following))}</b> ${esc(t("prof.followingN"))}</span>`);
    return `<section class="ar-author-card glass" aria-label="${esc(t("nav.profile"))}">
      ${open}${articleAvatar(profile)}<span class="ar-author-copy">
        <strong class="ar-author-name">${esc(profile.display_name || profile.username || "CineAura member")}</strong>
        ${profile.username ? `<span class="ar-author-handle">@${esc(profile.username)}</span>` : ""}
      </span>${close}
      <div class="ar-author-details">
        ${membership ? `<span class="ar-author-badge">${esc(membership)}</span>` : ""}
        ${languageName ? `<span class="ar-author-badge">${esc(languageName)}</span>` : ""}
        ${profile.bio ? `<p class="ar-author-bio">${esc(profile.bio)}</p>` : ""}
        ${stats.length ? `<div class="ar-author-stats">${stats.join("")}</div>` : ""}
        ${href ? `<a class="btn btn-sm btn-ghost ar-author-open" href="${esc(href)}">${esc(t("nav.profile"))}</a>` : ""}
      </div>
    </section>`;
  }

  function articleExcerpt(row) {
    const summary = String(row?.description || "").trim() || articlePlainText(row);
    return summary.length > 190 ? `${summary.slice(0, 187).trimEnd()}…` : summary;
  }

  function articleListCard(row, authors) {
    const author = authors.get(String(row.member_id)) || { member_id: row.member_id, display_name: "CineAura member" };
    const profileHref = articleProfileHref(author);
    const authorTag = profileHref
      ? `<a class="ar-list-author" href="${esc(profileHref)}">${articleAvatar(author, "ar-list-avatar")}<span>${esc(author.display_name)}</span></a>`
      : `<span class="ar-list-author">${articleAvatar(author, "ar-list-avatar")}<span>${esc(author.display_name)}</span></span>`;
    const categories = articleCategories(row).slice(0, 3);
    const url = dLink("article", row.id);
    return `<article class="ar-list-card glass">
      <a class="ar-list-cover" href="${url}" aria-label="${esc(row.title || "")}">${articleCoverMarkup(row, "ar-list-cover-image", row.title || "")}</a>
      <div class="ar-list-copy">
        ${categories.length ? `<div class="ar-list-cats">${categories.map((category) => `<span class="ar-chip">${esc(category)}</span>`).join("")}</div>` : ""}
        <h2><a href="${url}">${esc(row.title || "")}</a></h2>
        <p class="ar-list-description">${esc(articleExcerpt(row))}</p>
        <div class="ar-list-meta">${authorTag}<span>${esc(articleDate(row.publish_at || row.created_at))}</span>
          <span>◷ ${esc(articleReadTimeLabel(articleReadMinutes(row)))}</span><span>👁 ${esc(articleNumber(row.views))}</span></div>
      </div>
    </article>`;
  }

  async function listArticles(box) {
    const res = await req(`/rest/v1/community_articles?select=${ARTICLE_SUMMARY_FIELDS}&status=eq.published&visibility=eq.public&order=created_at.desc&limit=80`);
    if (!res.ok) return (box.innerHTML = `<p class="com-note">⚠ ${esc(t("com.loadFail"))}</p>`);
    const rows = Array.isArray(res.data) ? res.data.filter(articleIsPublicNow) : [];
    if (!rows.length)
      return (box.innerHTML = `<p class="com-empty muted">${esc(t("com.emptyA"))} <a class="btn btn-sm btn-primary" href="./article-Editor.html">${esc(t("com.newArticle"))}</a></p>`);
    const authors = await articleAuthorsByIds(rows.map((row) => row.member_id));
    box.innerHTML = `<div class="ar-list-grid">${rows.map((row) => articleListCard(row, authors)).join("")}</div>`;
    C()?.hydrateAvatars?.(box);
  }

  function articleForm(box) {
    if (!meId()) return (box.innerHTML = loginNote());
    box.innerHTML = `<form id="com-art" class="com-form glass">
      <input name="title" maxlength="200" required placeholder="${esc(t("com.artTitle"))}" />
      <input name="tags" maxlength="120" placeholder="${esc(t("com.tagsPh"))}" />
      <textarea name="body" rows="10" required placeholder="${esc(t("com.bodyPh"))}"></textarea>
      <div><button class="btn btn-primary" type="submit">${esc(t("com.publish"))}</button>
      <button class="btn btn-ghost" type="button" onclick="location.hash='#articles'">${esc(t("common.cancel"))}</button></div>
    </form>`;
    box.querySelector("#com-art").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const row = await insertRow("/rest/v1/community_articles", {
        member_id: meId(),
        title: String(fd.get("title") || "").trim(),
        tags: String(fd.get("tags") || "").trim(),
        body: String(fd.get("body") || "").trim(),
      });
      if (row) {
        toast(t("com.saved"));
        location.hash = `#a/${row.id}`;
      }
    };
  }

  async function articleViewer(row) {
    const session = C()?.getSession?.();
    if (!session?.member_id) return null;
    const id = String(session.member_id);
    const [memberResult, profiles] = await Promise.all([
      req(`/rest/v1/members?member_id=eq.${encodeURIComponent(id)}&select=member_id,username,country`).catch(() => ({ ok: false, data: [] })),
      C()?.profilesByIds
        ? C().profilesByIds([id], ARTICLE_VIEWER_PROFILE_FIELDS).catch(() => [])
        : Promise.resolve([]),
    ]);
    const member = memberResult.ok && Array.isArray(memberResult.data) ? memberResult.data[0] || {} : {};
    const profile = Array.isArray(profiles) ? profiles[0] || {} : {};
    const viewer = {
      member_id: id,
      username: member.username || session.username || "",
      profile: {
        country: profile.country || member.country || "",
        language: profile.language || "",
        level: Number(profile.level || 0),
        tier: String(profile.tier || ""),
      },
    };
    const A = window.CineAuraArticles;
    const requiresFollow = A?.critOf?.(row)?.followers;
    if (requiresFollow && id !== String(row.member_id || "")) {
      const follow = await req(`/rest/v1/follows?follower_id=eq.${encodeURIComponent(id)}&following_id=eq.${encodeURIComponent(row.member_id)}&status=eq.accepted&select=id&limit=1`).catch(() => ({ ok: false, data: [] }));
      viewer.follows = Boolean(follow.ok && Array.isArray(follow.data) && follow.data.length);
    }
    return viewer;
  }

  function articleUnavailable(box, back, row, mine) {
    const released = articleIsContentPublished(row);
    const visibility = String(row?.visibility || "public").toLowerCase();
    const message = !mine && !released
      ? t("ae.notPublished")
      : visibility === "private" ? t("ae.privateGate") : t("ae.exclusiveGate");
    box.innerHTML = `<div class="ar-reader-grid ar-reader-grid--single">
      <section class="ar-reader-message glass"><a class="com-back" href="${esc(back)}">← ${esc(t("com.backList"))}</a>
        <div class="ar-reader-lock" aria-hidden="true">🔒</div><h2>${esc(message)}</h2>
      </section></div>`;
  }

  let articleProgressHandler = null;
  function bindArticleProgress(root) {
    if (articleProgressHandler) window.removeEventListener("scroll", articleProgressHandler);
    const fill = root.querySelector(".ar-read-progress > span");
    const body = root.querySelector("#ar-reader-body");
    if (!fill || !body) return;
    articleProgressHandler = () => {
      const rect = body.getBoundingClientRect();
      const total = Math.max(1, rect.height - window.innerHeight + 180);
      const progress = Math.max(0, Math.min(1, (150 - rect.top) / total));
      fill.style.transform = `scaleX(${progress})`;
    };
    window.addEventListener("scroll", articleProgressHandler, { passive: true });
    articleProgressHandler();
  }

  async function renderRelatedArticles(box, current) {
    if (!box) return;
    const res = await req(`/rest/v1/community_articles?select=${ARTICLE_SUMMARY_FIELDS}&status=eq.published&visibility=eq.public&order=created_at.desc&limit=80`);
    if (!res.ok) return (box.innerHTML = `<p class="muted">${esc(t("com.loadFail"))}</p>`);
    const currentId = String(current.id);
    const currentCats = new Set(articleCategories(current).map((value) => value.toLocaleLowerCase()));
    const rows = (Array.isArray(res.data) ? res.data : [])
      .filter((row) => String(row.id) !== currentId && articleIsPublicNow(row))
      .sort((a, b) => {
        const score = (row) => articleCategories(row).reduce((sum, value) => sum + Number(currentCats.has(value.toLocaleLowerCase())), 0);
        return score(b) - score(a) || Date.parse(b.publish_at || b.created_at || 0) - Date.parse(a.publish_at || a.created_at || 0);
      })
      .slice(0, 4);
    if (!rows.length) return (box.innerHTML = `<p class="muted">${esc(t("com.emptyA"))}</p>`);
    const authors = await articleAuthorsByIds(rows.map((row) => row.member_id));
    box.innerHTML = rows.map((row) => {
      const author = authors.get(String(row.member_id));
      const href = dLink("article", row.id);
      return `<a class="ar-suggested" href="${href}">
        ${articleCoverMarkup(row, "ar-suggested-image", row.title || "")}
        <span class="ar-suggested-copy"><strong>${esc(row.title || "")}</strong>
          <small>${esc(author?.display_name || author?.username || "CineAura member")} · ${esc(articleDate(row.publish_at || row.created_at))}</small>
        </span></a>`;
    }).join("");
    C()?.hydrateAvatars?.(box);
  }

  // The reader always loads the editor's real community_articles row. The body
  // is sanitised again, while release time, content placement and visibility are
  // checked before any private title, author or metadata is painted.
  async function articleView(box, id) {
    const A = window.CineAuraArticles;
    const back = listHref("article");
    // First read only the fields required to decide access; do not fetch article text or title yet.
    const gateRes = await req(`/rest/v1/community_articles?id=eq.${encodeURIComponent(id)}&select=${ARTICLE_ACCESS_FIELDS}&limit=1`);
    const gateRow = gateRes.ok && Array.isArray(gateRes.data) ? gateRes.data[0] : null;
    if (!gateRow) return (box.innerHTML = `<p class="com-note">⚠ ${esc(t("com.loadFail"))} <a href="${esc(back)}">${esc(t("com.backList"))}</a></p>`);

    const session = C()?.getSession?.();
    const mine = Boolean(session?.member_id && String(session.member_id) === String(gateRow.member_id));
    const visibility = String(gateRow.visibility || "public").trim().toLowerCase();
    let allowed = mine;
    if (!mine && articleIsContentPublished(gateRow)) {
      if (visibility === "public") allowed = true;
      else if (["private", "exclusive"].includes(visibility) && A?.canRead && session?.member_id) {
        try {
          // Do not fetch the article's private audience list for guests or public articles.
          const aclRes = await req(`/rest/v1/community_articles?id=eq.${encodeURIComponent(id)}&select=excl,private_users&limit=1`).catch(() => ({ ok: false, data: [] }));
          const acl = aclRes.ok && Array.isArray(aclRes.data) ? aclRes.data[0] : null;
          if (acl) {
            const accessRow = { ...gateRow, ...acl, visibility };
            const viewer = await articleViewer(accessRow);
            allowed = Boolean(A.canRead(accessRow, viewer, false));
          }
        } catch {
          allowed = false;
        }
      }
    }
    if (!allowed) return articleUnavailable(box, back, gateRow, mine);

    // Once permitted, load the author-facing fields and sanitized rich body.
    const detailRes = await req(`/rest/v1/community_articles?id=eq.${encodeURIComponent(id)}&select=${ARTICLE_DETAIL_FIELDS}&limit=1`);
    const detailRow = detailRes.ok && Array.isArray(detailRes.data) ? detailRes.data[0] : null;
    if (!detailRow) return (box.innerHTML = `<p class="com-note">⚠ ${esc(t("com.loadFail"))} <a href="${esc(back)}">${esc(t("com.backList"))}</a></p>`);
    const a = { ...gateRow, ...detailRow };
    if (!mine && !articleIsContentPublished(a)) return articleUnavailable(box, back, a, mine);

    const authors = await articleAuthorsByIds([a.member_id]);
    const author = authors.get(String(a.member_id)) || {
      member_id: a.member_id,
      username: "",
      display_name: "CineAura member",
    };
    const categories = articleCategories(a);
    const date = articleDate(a.publish_at || a.created_at);
    const readMinutes = articleReadMinutes(a);
    const viewCount = Number(a.views || 0) + (mine || !articleIsReleased(a) ? 0 : 1);
    const body = A?.bodyHtml ? A.bodyHtml(a) : `<p>${esc(a.body || "")}</p>`;
    const title = String(a.title || "");
    const share = C()?.shareRowHtml
      ? C().shareRowHtml(dLink("article", a.id), title, { compact: true, label: t("share.title") })
      : "";
    const edit = mine ? `<a class="btn btn-sm btn-ghost" href="./article-Editor.html?edit=${encodeURIComponent(a.id)}">${esc(t("ae.edit"))}</a>` : "";

    if (!mine && articleIsReleased(a)) {
      req(`/rest/v1/community_articles?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ views: Number(a.views || 0) + 1 }),
      }).catch(() => {});
    }

    document.title = `${title} — CineAura`;
    box.innerHTML = `<div class="ar-read-progress" aria-hidden="true"><span></span></div>
      <div class="ar-reader-grid">
        <article class="ar-reader-article glass">
          ${articleCoverMarkup(a, "ar-reader-cover", title)}
          <div class="ar-reader-content">
            <a class="com-back" href="${esc(back)}">← ${esc(t("com.backList"))}</a>
            <h1 class="ar-reader-title">${esc(title)}</h1>
            <div class="ar-reader-meta">
              <span>◷ ${esc(articleReadTimeLabel(readMinutes))}</span>
              <span>👁 ${esc(articleNumber(viewCount))}</span>
              <span>${esc(date)}</span>
              ${a.language ? `<span>${esc(C()?.LANG_NAMES?.[a.language] || a.language)}</span>` : ""}
            </div>
            ${categories.length ? `<div class="ar-reader-cats">${categories.map((category) => `<span class="ar-chip">${esc(category)}</span>`).join("")}</div>` : ""}
            ${a.description ? `<p class="ar-reader-lead">${esc(a.description)}</p>` : ""}
            <div class="ar-reader-body" id="ar-reader-body">${body}</div>
            <div class="ar-reader-actions">${share}${edit}</div>
            ${articleAuthorCard(author)}
          </div>
        </article>
        <aside class="ar-reader-sidebar">
          <section class="ar-sidebar-panel glass">
            <h2>${esc(t("help.related"))}</h2>
            <div id="ar-related"><p class="muted">${esc(t("common.loading"))}</p></div>
          </section>
          <section class="ar-sidebar-cta glass">
            <h2>${esc(t("ct.leadArticles"))}</h2>
            <a class="btn btn-sm btn-primary" href="./article-Editor.html">✍ ${esc(t("com.newArticle"))}</a>
          </section>
        </aside>
      </div>`;
    bindArticleProgress(box);
    C()?.hydrateAvatars?.(box);
    renderRelatedArticles(box.querySelector("#ar-related"), a);
  }

  // ─────────────────────────── groups ───────────────────────────
  async function listGroups(box, mine) {
    const me = meId();
    const res = mine && me
      ? await req(`/rest/v1/community_group_members?member_id=eq.${encodeURIComponent(me)}&select=group_id,community_groups(*)`)
      : await req(`/rest/v1/community_groups?is_public=eq.true&select=*&order=created_at.desc&limit=80`);
    if (!res.ok) return (box.innerHTML = `<p class="com-note">⚠ ${esc(t("grp.loadFail"))}</p>`);
    const rows = mine && me
      ? (Array.isArray(res.data) ? res.data.map((r) => r.community_groups).filter(Boolean) : [])
      : (Array.isArray(res.data) ? res.data : []);
    if (!rows.length)
      return (box.innerHTML = `<p class="com-empty muted">${esc(t(mine ? "grp.emptyMy" : "grp.empty"))} ${me ? `<a class="btn btn-sm btn-primary" href="#new-group">${esc(t("grp.create"))}</a>` : ""}</p>`);
    const names = await nameMap(rows.map((g) => g.owner_id));
    box.innerHTML = rows
      .map(
        (g) => `<a class="com-row glass" href="${gLink(g.id)}">
          ${g.cover ? `<img class="com-grp-cover" src="${esc(g.cover)}" alt="" loading="lazy" />` : `<span class="com-grp-cover com-grp-ph">👥</span>`}
          <span class="com-row-main"><strong>${esc(g.name)}</strong>
          <span class="muted">${esc(String(g.description || "").slice(0, 90))}</span>
          <span class="muted">${esc(t("grp.byOwner", { name: who(names, g.owner_id) }))}</span></span>
          <span class="com-chip">👥 ${g.members_count || 0} ${esc(t("grp.members"))}</span>
        </a>`
      )
      .join("");
  }

  // Create (no arg) or edit (an existing group row). Edits verify ownership when
  // the Save actually runs — hiding the button would not be a permission system.
  function groupForm(box, existing) {
    if (!meId()) return (box.innerHTML = loginNote());
    const g = existing || {};
    box.innerHTML = `<form id="com-grp" class="com-form glass">
      <input name="name" maxlength="120" required value="${esc(g.name || "")}" placeholder="${esc(t("grp.namePh"))}" />
      <textarea name="description" rows="3" placeholder="${esc(t("grp.descPh"))}">${esc(g.description || "")}</textarea>
      <textarea name="rules" rows="3" placeholder="${esc(t("grp.rulesPh"))}">${esc(g.rules || "")}</textarea>
      <input name="cover" maxlength="300" value="${esc(g.cover || "")}" placeholder="${esc(t("grp.coverPh"))}" />
      <label class="lang-chip"><input type="checkbox" name="is_public" ${g.is_public === false ? "" : "checked"} /> ${esc(t("grp.public"))}</label>
      <div><button class="btn btn-primary" type="submit">${esc(existing ? t("grp.update") : t("grp.createBtn"))}</button>
      <button class="btn btn-ghost" type="button" onclick="history.back()">${esc(t("common.cancel"))}</button></div>
    </form>`;
    box.querySelector("#com-grp").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const patch = {
        name: String(fd.get("name") || "").trim(),
        description: String(fd.get("description") || "").trim(),
        rules: String(fd.get("rules") || "").trim(),
        cover: String(fd.get("cover") || "").trim(),
        is_public: fd.get("is_public") === "on",
      };
      if (existing) {
        // ownership is re-read from the row at execution time, not from the UI
        const fresh = await req(`/rest/v1/community_groups?id=eq.${existing.id}&select=owner_id`);
        const owner = fresh.ok && Array.isArray(fresh.data) && fresh.data[0] ? fresh.data[0].owner_id : "";
        if (owner !== meId()) return toast(t("grp.notOwner"));
        const r = await req(`/rest/v1/community_groups?id=eq.${existing.id}`, { method: "PATCH", body: JSON.stringify(patch) });
        if (!r.ok) return toast(t("grp.saveFail"));
        toast(t("grp.saved"));
        location.href = gLink(existing.id);
        return;
      }
      const row = await insertRow("/rest/v1/community_groups", { owner_id: meId(), ...patch });
      if (!row) return;
      // seat the owner (so the member count and My Groups include it) then open the group
      req("/rest/v1/community_group_members?select=group_id,member_id", {
        method: "POST",
        body: JSON.stringify({ group_id: row.id, member_id: meId(), role: "owner" }),
      })
        .catch(() => {})
        .finally(() => {
          toast(t("grp.saved"));
          location.href = gLink(row.id);
        });
    };
  }

  async function groupView(box, id) {
    const res = await req(`/rest/v1/community_groups?id=eq.${id}&select=*`);
    const g = res.ok && Array.isArray(res.data) ? res.data[0] : null;
    if (!g) return (box.innerHTML = `<p class="com-note">⚠ ${esc(t("grp.loadFail"))} <a href="${base() || "community.html"}">${esc(t("com.backList"))}</a></p>`);
    const me = meId();
    let role = "";
    if (me) {
      const mr = await req(`/rest/v1/community_group_members?group_id=eq.${id}&member_id=eq.${encodeURIComponent(me)}&select=role`);
      role = mr.ok && Array.isArray(mr.data) && mr.data[0] ? mr.data[0].role || "member" : "";
    }
    const joined = !!role;
    const isOwner = g.owner_id === me || role === "owner";
    const names = await nameMap([g.owner_id]);
    const back = `<a class="com-back" href="${base() || "community.html"}">← ${esc(t("grp.backList"))}</a>`;
    // Private group, non-member: the gate is decided here, not by hiding buttons.
    if (!g.is_public && !joined) {
      box.innerHTML = `${back}
        ${g.cover ? `<img class="com-grp-hero" src="${esc(g.cover)}" alt="" loading="lazy" />` : ""}
        <h2>${esc(g.name)} 🔒</h2><p class="com-note">${esc(t("grp.privateText"))}</p>`;
      return;
    }
    const tab = gTab();
    const header = `${back}
      <article class="com-q com-grp glass">
        ${g.cover ? `<img class="com-grp-hero" src="${esc(g.cover)}" alt="" loading="lazy" />` : ""}
        <h2>${esc(g.name)} ${g.is_public ? "" : "🔒"}</h2>
        <p class="muted">${esc(t("grp.byOwner", { name: who(names, g.owner_id) }))} · 👥 ${g.members_count || 0} ${esc(t("grp.members"))} · 💬 ${g.posts_count || 0} ${esc(t("grp.postsN"))}</p>
        <div class="com-acts" style="margin-top:12px">
          ${me ? `<button type="button" class="btn btn-sm ${joined ? "btn-ghost" : "btn-primary"}" id="com-join">${joined ? esc(t("grp.leave")) : esc(t("grp.join"))}</button>` : ""}
          ${isOwner ? `<button type="button" class="btn btn-sm btn-ghost" id="com-gedit">✎ ${esc(t("grp.edit"))}</button>` : ""}
          ${me && !isOwner ? `<button type="button" class="btn btn-sm btn-ghost" id="com-greport">🚩 ${esc(t("grp.report"))}</button>` : ""}
          ${!me ? loginNote() : ""}
        </div>
        <div class="com-tabs" role="tablist" style="margin-top:14px">
          <button type="button" role="tab" class="follow-tab${tab === "posts" ? " active" : ""}" data-gviewtab="posts">💬 ${esc(t("grp.tab.posts"))}</button>
          <button type="button" role="tab" class="follow-tab${tab === "about" ? " active" : ""}" data-gviewtab="about">ℹ️ ${esc(t("grp.tab.about"))}</button>
          <button type="button" role="tab" class="follow-tab${tab === "members" ? " active" : ""}" data-gviewtab="members">👥 ${esc(t("grp.tab.members"))}</button>
        </div>
      </article>
      <div id="com-gbody"></div>`;
    box.innerHTML = header;
    box.querySelectorAll("[data-gviewtab]").forEach((b) => (b.onclick = () => (location.hash = b.dataset.gviewtab === "posts" ? "" : `#${b.dataset.gviewtab}`)));
    const jb = box.querySelector("#com-join");
    if (jb)
      jb.onclick = async () => {
        jb.disabled = true;
        // membership is re-checked from the row at execution time
        const chk = await req(`/rest/v1/community_group_members?group_id=eq.${id}&member_id=eq.${encodeURIComponent(me)}&select=role`);
        const has = chk.ok && Array.isArray(chk.data) && chk.data.length > 0;
        const r = await req(
          has
            ? `/rest/v1/community_group_members?group_id=eq.${id}&member_id=eq.${encodeURIComponent(me)}`
            : `/rest/v1/community_group_members?select=group_id,member_id`,
          has ? { method: "DELETE" } : { method: "POST", body: JSON.stringify({ group_id: id, member_id: me }) }
        );
        if (!r.ok) toast(t("grp.saveFail"));
        groupView(box, id);
      };
    const ed = box.querySelector("#com-gedit");
    if (ed) ed.onclick = () => groupViewEdit(box, id);
    const rp = box.querySelector("#com-greport");
    if (rp)
      rp.onclick = async () => {
        rp.disabled = true;
        const note = prompt(t("grp.reportPh") || "");
        if (note === null) return (rp.disabled = false);
        const r = await req("/rest/v1/community_group_reports?select=group_id,reporter_id", {
          method: "POST",
          body: JSON.stringify({ group_id: id, reporter_id: me, note: String(note || "").trim() }),
        });
        if (r.ok) toast(t("grp.reported"));
        else if (String(r.status) === "409") toast(t("grp.reported"));
        else toast(t("grp.saveFail"));
      };
    const body = box.querySelector("#com-gbody");
    if (tab === "about") return drawGroupAbout(body, g);
    if (tab === "members") return drawGroupMembers(body, g, isOwner, me);
    return drawGroupPosts(body, g, joined, isOwner, me);
  }

  function drawGroupAbout(body, g) {
    body.innerHTML = `<div class="com-grp glass" style="padding:18px;border-radius:18px">
      ${g.description ? `<p class="com-body">${esc(g.description)}</p>` : `<p class="muted">${esc(t("grp.noDesc"))}</p>`}
      ${g.rules ? `<h3 class="com-h3">${esc(t("grp.rulesTitle"))}</h3><p class="com-body">${esc(g.rules)}</p>` : ""}
      <p class="muted" style="margin-top:10px">${esc(when(g.created_at))}</p>
    </div>`;
  }

  async function drawGroupMembers(body, g, isOwner, me) {
    const res = await req(`/rest/v1/community_group_members?group_id=eq.${g.id}&select=*&order=created_at.asc&limit=200`);
    const rows = res.ok && Array.isArray(res.data) ? res.data : [];
    const names = await nameMap(rows.map((r) => r.member_id));
    body.innerHTML = rows.length
      ? rows
          .map(
            (r) => `<div class="com-mem-row glass">
              <span><strong>${esc(who(names, r.member_id) || r.member_id)}</strong>${r.role === "owner" ? ` <span class="com-chip">${esc(t("grp.ownerTag"))}</span>` : ""}</span>
              <span class="muted">${esc(when(r.created_at))}</span>
              ${isOwner && r.role !== "owner" ? `<button type="button" class="btn btn-sm btn-danger" data-mdel="${esc(r.member_id)}">🗑 ${esc(t("grp.remove"))}</button>` : ""}
            </div>`
          )
          .join("")
      : `<p class="com-empty muted">${esc(t("grp.noMembers"))}</p>`;
    body.querySelectorAll("[data-mdel]").forEach((b) => {
      b.onclick = async () => {
        // only the group owner may remove; the group row is the authority here
        if (g.owner_id !== me) return toast(t("grp.notOwner"));
        const r = await req(`/rest/v1/community_group_members?group_id=eq.${g.id}&member_id=eq.${encodeURIComponent(b.dataset.mdel)}`, { method: "DELETE" });
        if (!r.ok) return toast(t("grp.saveFail"));
        drawGroupMembers(body, g, isOwner, me);
      };
    });
  }

  async function drawGroupPosts(body, g, joined, isOwner, me) {
    const res = await req(`/rest/v1/community_group_posts?group_id=eq.${g.id}&select=*&order=created_at.desc&limit=100`);
    const rows = res.ok && Array.isArray(res.data) ? res.data : [];
    const names = await nameMap(rows.map((r) => r.member_id));
    body.innerHTML = `
      ${joined ? `<form id="com-gpost" class="com-form glass">
        <textarea name="body" rows="3" required placeholder="${esc(t("grp.postPh"))}"></textarea>
        <div><button class="btn btn-primary" type="submit">${esc(t("grp.postBtn"))}</button></div>
      </form>` : `<p class="com-note muted">${esc(t(me ? "grp.notMember" : "com.login"))}</p>`}
      ${rows.length
        ? rows
            .map(
              (p) => `<div class="com-answer glass">
                <p class="com-body">${esc(p.body)}</p>
                <div class="com-a-foot">
                  <span class="muted">${esc(who(names, p.member_id))} · ${esc(when(p.created_at))}</span>
                  ${(isOwner || p.member_id === me) ? `<button type="button" class="btn btn-sm btn-danger" data-pdel="${p.id}">🗑</button>` : ""}
                </div>
              </div>`
            )
            .join("")
        : `<p class="com-empty muted">${esc(t("grp.noPosts"))}</p>`}`;
    const f = body.querySelector("#com-gpost");
    if (f)
      f.onsubmit = async (e) => {
        e.preventDefault();
        // posting is members-only and the check happens now, at execution time
        const chk = await req(`/rest/v1/community_group_members?group_id=eq.${g.id}&member_id=eq.${encodeURIComponent(me)}&select=role`);
        if (!(chk.ok && Array.isArray(chk.data) && chk.data.length)) return toast(t("grp.notMember"));
        const txt = String(new FormData(f).get("body") || "").trim();
        if (!txt) return;
        const row = await insertRow("/rest/v1/community_group_posts", { group_id: g.id, member_id: me, body: txt });
        if (row) drawGroupPosts(body, g, joined, isOwner, me);
      };
    body.querySelectorAll("[data-pdel]").forEach((b) => {
      b.onclick = async () => {
        const pid = Number(b.dataset.pdel);
        // author or group owner — read the post from the row, then delete
        const pr = await req(`/rest/v1/community_group_posts?id=eq.${pid}&select=member_id`);
        const owner = pr.ok && Array.isArray(pr.data) && pr.data[0] ? pr.data[0].member_id : "";
        if (owner !== me && g.owner_id !== me) return toast(t("grp.notOwner"));
        const r = await req(`/rest/v1/community_group_posts?id=eq.${pid}`, { method: "DELETE" });
        if (!r.ok) return toast(t("grp.saveFail"));
        drawGroupPosts(body, g, joined, isOwner, me);
      };
    });
  }

  function groupViewEdit(box, id) {
    req(`/rest/v1/community_groups?id=eq.${id}&select=*`).then((res) => {
      const g = res.ok && Array.isArray(res.data) ? res.data[0] : null;
      if (!g) return toast(t("grp.loadFail"));
      box.innerHTML = `<a class="com-back" href="${gLink(id)}">← ${esc(g.name)}</a>`;
      groupForm(box, g);
    });
  }

  // Old Q&A fragments on community.html now open the dedicated Q&A page.
  // Check the hash before hashRoute() so even a stale ?group= value cannot
  // swallow #ask/#questions and leave the visitor on a group page.
  function redirectCommunityQARoute(root) {
    if (root !== document.getElementById("com-root")) return false;
    const hash = String(location.hash || "").replace(/^#/, "").toLowerCase();
    let target = "";
    if (hash === "ask") target = "./answers.html#ask";
    else if (hash === "questions") target = "./answers.html";
    else {
      const question = hash.match(/^q\/(\d+)$/);
      if (question) target = `./answers.html?id=${question[1]}`;
    }
    if (!target) return false;
    location.replace(target);
    return true;
  }

  // ─────────────────────────── hub shell ───────────────────────────
  function paint(root) {
    if (redirectCommunityQARoute(root)) return;
    const route = hashRoute();
    // Legacy content routes keep the Articles / Q&A tab bar; the hub's default
    // face is the Groups (Discover / My Groups / Create).
    const legacy = ["question", "article", "ask", "newArticle", "list"].includes(route.view);
    let inner;
    if (["question", "article", "ask", "newArticle", "group", "newGroup"].includes(route.view)) inner = `<div id="com-body"></div>`;
    else if (legacy)
      inner = `<div class="com-tabs" role="tablist">
          <button type="button" role="tab" class="follow-tab${route.tab === "questions" ? " active" : ""}" data-tab="questions">${esc(t("com.tab.questions"))}</button>
          <button type="button" role="tab" class="follow-tab${route.tab === "articles" ? " active" : ""}" data-tab="articles">${esc(t("com.tab.articles"))}</button>
        </div>
        <div id="com-acts">
          ${route.tab === "questions" ? `<a class="btn btn-sm btn-primary" href="./answers.html#ask">❓ ${esc(t("com.ask"))}</a>` : `<a class="btn btn-sm btn-primary" href="#new-article">✍ ${esc(t("com.newArticle"))}</a>`}
        </div>
        <div id="com-body"><p class="com-note muted">${esc(t("common.loading"))}</p></div>`;
    else
      inner = `<div class="com-tabs" role="tablist">
          <button type="button" role="tab" class="follow-tab${route.tab === "discover" ? " active" : ""}" data-gtab="discover">🔍 ${esc(t("grp.discover"))}</button>
          <button type="button" role="tab" class="follow-tab${route.tab === "my" ? " active" : ""}" data-gtab="my">👥 ${esc(t("grp.my"))}</button>
        </div>
        <div id="com-acts">${meId() ? `<a class="btn btn-sm btn-primary" href="#new-group">➕ ${esc(t("grp.create"))}</a>` : loginNote()}</div>
        <div id="com-body"><p class="com-note muted">${esc(t("common.loading"))}</p></div>`;
    const head = legacy
      ? `<p class="eyebrow">${esc(t("com.eyebrow"))}</p><h1>${esc(t("com.title"))}</h1><p class="com-lead muted">${esc(t("com.lead"))}</p>`
      : `<p class="eyebrow">${esc(t("com.eyebrow"))}</p><h1>${esc(t("grp.title"))}</h1><p class="com-lead muted">${esc(t("grp.lead"))}</p>`;
    root.innerHTML = head + inner;
    const body = root.querySelector("#com-body");
    root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => {
      location.href = b.dataset.tab === "articles" ? "./articles.html" : "./answers.html";
    }));
    root.querySelectorAll("[data-gtab]").forEach((b) => (b.onclick = () => (location.hash = b.dataset.gtab === "my" ? "#my-groups" : "#")));
    if (route.view === "question") return questionView(body, route.id);
    if (route.view === "article") return articleView(body, route.id);
    if (route.view === "ask") return askForm(body);
    if (route.view === "newArticle") return articleForm(body);
    if (route.view === "group") return groupView(body, route.id);
    if (route.view === "newGroup") return groupForm(body);
    if (route.view === "groups") return listGroups(body, route.tab === "my");
    return route.tab === "articles" ? listArticles(body) : listQuestions(body);
  }

  function viewCommunity(root) {
    paint(root);
  }

  // Profile > Community: the visited member's contributions (articles, their
  // questions, their answers), every row linking back into the hub.
  async function fetchContribs(memberId) {
    const [q, a, arts] = await Promise.all([
      req(`/rest/v1/community_questions?member_id=eq.${encodeURIComponent(memberId)}&select=*&order=created_at.desc&limit=100`),
      req(`/rest/v1/community_answers?member_id=eq.${encodeURIComponent(memberId)}&select=*&order=created_at.desc&limit=100`),
      req(`/rest/v1/community_articles?member_id=eq.${encodeURIComponent(memberId)}&status=eq.published&visibility=eq.public&select=id,member_id,title,created_at,views,publish_at,status,visibility,places&order=created_at.desc&limit=100`),
    ]);
    const qs = q.ok && Array.isArray(q.data) ? q.data : [];
    const ans = a.ok && Array.isArray(a.data) ? a.data : [];
    const ats = arts.ok && Array.isArray(arts.data) ? arts.data.filter(articleIsPublicNow) : [];
    const failed = !q.ok || !a.ok || !arts.ok;
    const qTitles = new Map();
    if (ans.length) {
      const ids = [...new Set(ans.map((x) => x.question_id))];
      const qr = await req(`/rest/v1/community_questions?id=in.(${idsIn(ids)})&select=id,title`);
      if (qr.ok && Array.isArray(qr.data)) qr.data.forEach((x) => qTitles.set(x.id, x.title));
    }
    return { qs, ans, ats, failed, qTitles };
  }

  const rowQ = (x) => `<a class="com-row-mini" href="${dLink("question", x.id)}">❓ ${esc(x.title)} <span class="muted">${esc(when(x.created_at))} · 💬 ${x.answers_count || 0}</span></a>`;
  const rowA = (x, qTitles) => `<a class="com-row-mini" href="${dLink("answer", x.id)}">↩ ${esc(String(x.body || "").slice(0, 90))} <span class="muted">${esc(qTitles.get(x.question_id) || "")} · 👍 ${x.votes || 0}</span></a>`;
  const rowArt = (x) => `<a class="com-row-mini" href="${dLink("article", x.id)}">✍ ${esc(x.title)} <span class="muted">${esc(when(x.created_at))} · 👁 ${x.views || 0}</span></a>`;
  const block = (title, rows, draw, emptyKey) =>
    `<section class="com-block"><h3>${title} <span class="muted">${rows.length}</span></h3>${rows.length ? rows.map(draw).join("") : `<p class="muted">${esc(t(emptyKey))}</p>`}</section>`;
  const KINDS = {
    articles: (d) => block(esc(t("com.tab.articles")), d.ats, rowArt, "com.noneArts"),
    questions: (d) => block(esc(t("com.tab.questions")), d.qs, rowQ, "com.noneQ"),
    answers: (d) => block("↩ " + esc(t("com.answersN")), d.ans, (x) => rowA(x, d.qTitles), "com.noneA"),
  };

  // One (or all) contribution blocks of a member — used standalone by memberView
  // and inside Profile > Your content by its type filter (js/profile.js).
  async function memberBlocks(box, memberId, kind) {
    const d = await fetchContribs(memberId);
    const draw = kind && KINDS[kind] ? [KINDS[kind]] : [KINDS.articles, KINDS.questions, KINDS.answers];
    box.innerHTML =
      (d.failed ? `<p class="com-note">⚠ ${esc(t("com.loadFail"))}</p>` : "") + draw.map((fn) => fn(d)).join("");
  }

  // Profile > Community-style view: the visited member's contributions with the
  // creation shortcuts and the link back to the hub.
  async function memberView(main, memberId) {
    main.innerHTML = `<p class="eyebrow">${esc(t("com.eyebrow"))}</p><h1>${esc(t("com.title"))}</h1>
      <div class="com-acts"><a class="btn btn-sm btn-primary" href="./answers.html#ask">❓ ${esc(t("com.ask"))}</a>
      <a class="btn btn-sm btn-primary" href="./community.html#new-article">✍ ${esc(t("com.newArticle"))}</a>
      <a class="btn btn-sm btn-ghost" href="./community.html">🌐 ${esc(t("com.openHub"))}</a></div>
      <div id="com-mb"><p class="com-note muted">${esc(t("common.loading"))}</p></div>`;
    await memberBlocks(main.querySelector("#com-mb"), memberId);
    if (window.CineAura && window.CineAura.hydrateAvatars) window.CineAura.hydrateAvatars(main);
  }

  // Profile > Community section: the groups this member created or joined. The
  // hub keeps discovery and the group pages themselves — this is only the
  // member's own corner of them. Rendered with neutral markup so it looks right
  // on the profile (which does not load community.css).
  async function memberGroups(box, memberId) {
    const id = encodeURIComponent(memberId);
    const [own, joined] = await Promise.all([
      req(`/rest/v1/community_groups?owner_id=eq.${id}&select=*&order=created_at.desc&limit=60`),
      req(`/rest/v1/community_group_members?member_id=eq.${id}&select=group_id,community_groups(*)&limit=60`),
    ]);
    if (!own.ok && !joined.ok)
      return (box.innerHTML = `<p class="empty">⚠ ${esc(t("grp.loadFail"))}</p>`);
    const seen = new Set();
    const rows = [];
    const push = (g) => {
      if (g && g.id != null && !seen.has(g.id)) {
        seen.add(g.id);
        rows.push(g);
      }
    };
    (Array.isArray(own.data) ? own.data : []).forEach(push);
    (Array.isArray(joined.data) ? joined.data : []).forEach((r) => push(r.community_groups));
    if (!rows.length) return (box.innerHTML = `<p class="empty">${esc(t("prof.grp.none"))}</p>`);
    const names = await nameMap(rows.map((g) => g.owner_id));
    box.innerHTML = rows
      .map(
        (g) => `<a class="glass pf-grp-row" href="${gLink(g.id)}">
          ${g.cover ? `<img class="pf-grp-cover" src="${esc(g.cover)}" alt="" loading="lazy" />` : `<span class="pf-grp-ph">👥</span>`}
          <span class="pf-grp-main"><strong>${esc(g.name)}</strong>
          <span class="muted">${esc(String(g.description || "").slice(0, 90))}</span>
          <span class="muted">${esc(t("grp.byOwner", { name: who(names, g.owner_id) }))}</span></span>
          <span class="chip">👥 ${g.members_count || 0} ${esc(t("grp.members"))}</span>
        </a>`
      )
      .join("");
  }

  // One composer entry for pages that are not the hub (Create > Studio draws the
  // same forms instead of linking away, so there is exactly one implementation).
  function openComposer(box, kind) {
    return kind === "article" ? articleForm(box) : askForm(box);
  }

  // ── The content pages (round 39) ───────────────────────────────────────────
  // content.html is the home that gathers the members' work; each type has its
  // own page and one id on it:
  //   articles.html?id=ID   one article   (no id: the articles list)
  //   answers.html?id=ID    one question or one answer (no id: the questions list)
  //   documents.html?id=ID  one document  (no id: the documents library)
  // video.html is the videos' own page and keeps its own code (js/content.js).
  const PAGE_TITLES = { articles: "com.tab.articles", questions: "com.tab.questions" };

  // One row of the home page: the newest articles or the newest questions, the
  // same rows the lists draw, so both always look and link the same way.
  async function homeRows(box, kind, limit) {
    const table = kind === "questions" ? "community_questions" : "community_articles";
    const take = Math.max(1, Number(limit) || 4);
    const fetchLimit = kind === "questions" ? take : Math.max(80, take);
    const query = kind === "questions"
      ? `/rest/v1/${table}?select=*&order=created_at.desc&limit=${fetchLimit}`
      : `/rest/v1/community_articles?select=${ARTICLE_SUMMARY_FIELDS}&status=eq.published&visibility=eq.public&order=created_at.desc&limit=${fetchLimit}`;
    const res = await req(query);
    const fetched = res.ok && Array.isArray(res.data) ? res.data : [];
    const rows = (kind === "questions" ? fetched : fetched.filter(articleIsPublicNow)).slice(0, take);
    if (!res.ok) return (box.innerHTML = `<p class="com-note">⚠ ${esc(t("com.loadFail"))}</p>`);
    if (!rows.length) return (box.innerHTML = `<p class="com-empty muted">${esc(t(kind === "questions" ? "com.emptyQ" : "com.emptyA"))}</p>`);
    const names = kind === "questions" ? await nameMap(rows.map((r) => r.member_id)) : null;
    const authors = kind === "questions" ? null : await articleAuthorsByIds(rows.map((r) => r.member_id));
    box.innerHTML = rows
      .map((r) =>
        kind === "questions"
          ? `<a class="com-row glass" href="${dLink("question", r.id)}">
          <span class="com-row-main"><strong>${esc(r.title)}</strong>
          <span class="muted">${esc(who(names, r.member_id))} · ${esc(when(r.created_at))}</span></span>
          <span class="com-chip">💬 ${r.answers_count || 0} ${esc(t("com.answersN"))}</span>
        </a>`
          : `<a class="com-row glass" href="${dLink("article", r.id)}">
          <span class="com-row-main"><strong>${esc(r.title)}</strong>
          <span class="muted">${esc(authors.get(String(r.member_id))?.display_name || "CineAura member")} · ${esc(articleDate(r.publish_at || r.created_at))}${articleCategories(r).length ? ` · ${esc(articleCategories(r).join(", "))}` : ""}</span></span>
          <span class="com-chip">👁 ${esc(articleNumber(r.views))}</span>
        </a>`
      )
      .join("");
    if (kind !== "questions") C()?.hydrateAvatars?.(box);
  }

  // The head of one type page: its name, what it holds, and the one action that
  // adds to it (the hub's own composers — no second form here).
  function pageHead(kind) {
    const isQ = kind === "questions";
    const intro = `<span class="eyebrow">${esc(t("ct.eyebrow"))}</span>
      <h1>${esc(t(PAGE_TITLES[kind]))}</h1>
      <p class="muted">${esc(t(isQ ? "ct.leadQuestions" : "ct.leadArticles"))}</p>`;
    return `<div class="pg-head${isQ ? " qa-page-head" : ""}">
        ${isQ ? `<div class="qa-page-head-copy">${intro}</div>` : intro}
        <div class="pg-acts${isQ ? " qa-page-actions" : ""}">
          ${isQ
            ? `<a class="btn btn-sm btn-primary" href="./answers.html#ask">❓ ${esc(t("com.ask"))}</a>`
            : `<a class="btn btn-sm btn-primary" href="./article-Editor.html">✍ ${esc(t("com.newArticle"))}</a>`}
          <a class="btn btn-sm btn-ghost" href="${isQ ? "./community.html" : "./community.html#articles"}">${esc(t("ct.hub"))}</a>
        </div>
      </div>`;
  }

  // content.html?article=ID and friends still arrive on a type page (see
  // CineAura.routeAliases); this reads the id either way.
  function pageId(params) {
    return String(params.get("id") || "").trim();
  }

  async function bootPage(root, kind) {
    if (!root) return false;
    const params = new URLSearchParams(location.search);
    const id = pageId(params);
    if (id) {
      if (!/^\d+$/.test(id)) {
        root.innerHTML = `<p class="com-note">⚠ ${esc(t("ct.invalid"))} <a class="btn btn-sm btn-primary" href="./${kind === "questions" ? "answers" : "articles"}.html">${esc(t("ct.library"))}</a></p>`;
        return true;
      }
      root.innerHTML = `<p class="com-note muted">${esc(t("common.loading"))}</p>`;
      if (kind === "documents") {
        const draw = () => {
          if (window.CineAuraDocs) window.CineAuraDocs.documentView(root, id);
          else root.innerHTML = `<p class="com-note">⚠ ${esc(t("doc.loadFail"))}</p>`;
        };
        if (window.CineAuraDocs) draw();
        else setTimeout(draw, 120);
      } else if (kind === "questions") {
        // ?kind=answer picks one answer; a bare id is a question
        if (String(params.get("kind") || "").toLowerCase() === "answer") answerView(root, Number(id));
        else questionView(root, Number(id));
      } else {
        articleView(root, Number(id));
      }
      return true;
    }
    if (kind === "questions" && String(location.hash || "").toLowerCase() === "#ask") {
      root.innerHTML = `${pageHead(kind)}<div id="pg-ask"></div>`;
      askForm(root.querySelector("#pg-ask"));
      return false;
    }
    if (kind === "documents") {
      root.innerHTML = `<div class="pg-head">
          <span class="eyebrow">${esc(t("ct.eyebrow"))}</span>
          <h1>${esc(t("doc.tab"))}</h1>
          <p class="muted">${esc(t("ct.leadDocuments"))}</p>
          <div class="pg-acts"><a class="btn btn-sm btn-primary" href="./profile.html?section=create">${esc(t("vid.hub.create"))}</a></div>
        </div><div id="pg-docs"><p class="com-note muted">${esc(t("common.loading"))}</p></div>`;
      const box = root.querySelector("#pg-docs");
      if (window.CineAuraDocs) window.CineAuraDocs.list(box);
      else box.innerHTML = `<p class="com-note">⚠ ${esc(t("doc.loadFail"))}</p>`;
      return false;
    }
    root.innerHTML = `${pageHead(kind)}<div id="pg-list"><p class="com-note muted">${esc(t("common.loading"))}</p></div>`;
    const box = root.querySelector("#pg-list");
    if (kind === "questions") listQuestions(box);
    else listArticles(box);
    return false;
  }

  window.CineAuraCommunity = { viewCommunity, memberView, memberBlocks, memberGroups, openComposer, bootPage, homeRows };

  window.addEventListener("hashchange", () => {
    const root = document.getElementById("com-root");
    if (root) paint(root);
  });
  // ?group= lives in the query string, so back/forward between a group and the
  // list travels through popstate, not hashchange.
  window.addEventListener("popstate", () => {
    const root = document.getElementById("com-root");
    if (root) paint(root);
  });
  // Auto-boot only where this file owns the page: the hub (#com-root) and the
  // type pages (#page-root). The profile embeds it for memberView only.
  const boot = () => {
    const root = document.getElementById("com-root");
    if (root) paint(root);
    const page = document.getElementById("page-root");
    if (page) bootPage(page, String(page.dataset.kind || "articles"));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
