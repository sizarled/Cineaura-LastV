(() => {
  "use strict";
  const C = window.CineAura;
  const root = document.querySelector("#podcast-editor-form");
  const params = new URLSearchParams(location.search);
  const member = C.getSession();
  const kindLabel = (k) => C.t(k);
  const esc = C.escapeHtml;
  const hubId = Number(params.get("hub")) || Number(params.get("workspace")) || Number(localStorage.getItem("cw-hub-channel")) || 0;
  const editId = params.get("edit") || "";
  const extensions = new Set(["mp3", "m4a", "aac", "wav", "ogg", "opus", "flac", "aiff", "aif"]);
  const maxBytes = 250 * 1024 * 1024;
  const url = (p) => `${C.SUPABASE_URL}${p}`;
  const auth = (extra = {}) => ({ apikey: C.SUPABASE_KEY, Authorization: `Bearer ${C.SUPABASE_KEY}`, ...extra });
  const req = (path, options = {}) => C.supabaseRequest(path, options).catch(() => ({ ok: false, data: null }));
  let current = null;
  let pickedFile = null;
  let objectUrl = "";

  const shell = (message) => `<div class="cw-empty">${esc(message)}</div>`;
  async function init() {
    document.title = `${C.t("cw.podcastEditor")} — CineAura`;
    if (!member?.member_id) return (root.innerHTML = shell(C.t("cw.loginLead")));
    if (!hubId) return (root.innerHTML = `${shell(C.t("cw.chooseChannelFirst"))}<p style="text-align:center"><a class="btn btn-primary" href="./creator-dashboard.html?kind=channel">${esc(C.t("cw.channel"))}</a></p>`);
    const h = await req(`/rest/v1/creator_hubs?id=eq.${hubId}&kind=eq.channel&select=id,name,owner_id`);
    const hub = Array.isArray(h.data) ? h.data[0] : null;
    if (!h.ok || !hub) return (root.innerHTML = shell(C.t("cw.channelMissing")));
    if (editId) {
      const r = await req(`/rest/v1/creator_hub_items?hub_id=eq.${hubId}&content_type=eq.podcast&content_id=eq.${encodeURIComponent(editId)}&select=*`);
      current = Array.isArray(r.data) ? r.data[0] || null : null;
      if (!current) return (root.innerHTML = shell(C.t("cw.itemMissing")));
    }
    draw(hub);
  }
  function draw(hub) {
    root.innerHTML = `<form class="cw-form" id="podcast-form">
      <div class="cw-card wide" style="grid-column:1/-1"><span class="cw-chip">${esc(hub.name)}</span><p class="cw-muted">${esc(C.t("cw.podcastEditorLead"))}</p></div>
      <label>${esc(C.t("cw.name"))}<input name="title" maxlength="160" required value="${esc(current?.title || "")}" /></label>
      <label>${esc(C.t("cw.visibility"))}<select name="visibility">${["public","exclusive","private"].map((v) => `<option value="${v}"${(current?.visibility || "public") === v ? " selected" : ""}>${esc(({public:C.t("cw.public"),exclusive:C.t("cw.exclusive"),private:C.t("cw.private")})[v])}</option>`).join("")}</select></label>
      <label class="wide">${esc(C.t("cw.description"))}<textarea name="description" maxlength="5000">${esc(current?.description || "")}</textarea></label>
      <label>${esc(C.t("cw.thumbnail"))}<input name="thumb_url" type="url" maxlength="1000" value="${esc(current?.thumb_url || "")}" placeholder="https://…" /></label>
      <label class="wide">${esc(C.t("cw.audioFile"))}<input id="podcast-file" type="file" accept=".mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.aiff,.aif,audio/*" ${current ? "" : "required"} /><small class="cw-muted">${esc(C.t("cw.audioFileHint"))} · ${C.t("cw.maxAudioSize")}</small></label>
      <div class="wide" id="podcast-preview">${current?.file_path ? `<p class="cw-muted">${esc(current.file_name || "")}</p><button type="button" class="btn btn-sm btn-ghost" id="podcast-play-saved">${esc(C.t("cw.previewAudio"))}</button>` : ""}</div>
      <div class="wide"><div class="up-prog" id="podcast-prog" hidden><div class="up-prog-bar" id="podcast-bar"></div><span class="up-prog-n" id="podcast-status"></span></div><button class="btn btn-primary" id="podcast-save" type="submit">${esc(current ? C.t("cw.save") : C.t("cw.publishPodcast"))}</button> <a class="btn btn-ghost" href="./creator-dashboard.html?kind=channel&tab=podcasts&hub=${hubId}">${esc(C.t("cw.cancel"))}</a></div>
    </form>`;
    const form = root.querySelector("#podcast-form");
    const input = root.querySelector("#podcast-file");
    input.onchange = () => {
      pickedFile = input.files?.[0] || null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = pickedFile ? URL.createObjectURL(pickedFile) : "";
      if (!pickedFile) return;
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      audio.src = objectUrl;
      audio.onloadedmetadata = () => { root.dataset.duration = String(Math.round(audio.duration || 0)); };
      audio.onerror = () => C.toast(C.t("cw.audioReadFail"));
      root.querySelector("#podcast-preview").innerHTML = `<audio controls preload="metadata" src="${esc(objectUrl)}" style="width:100%"></audio><small class="cw-muted">${esc(pickedFile.name)} · ${formatSize(pickedFile.size)}</small>`;
    };
    root.querySelector("#podcast-play-saved")?.addEventListener("click", () => playSaved(current.file_path));
    form.onsubmit = save;
  }
  async function playSaved(path) {
    const res = await fetch(url(`/storage/v1/object/sign/creator-media/${path.split("/").map(encodeURIComponent).join("/")}`), { method: "POST", headers: auth({ "Content-Type":"application/json" }), body: JSON.stringify({ expiresIn: 60 }) });
    if (!res.ok) return C.toast(C.t("cw.audioReadFail"));
    const payload = await res.json().catch(() => ({}));
    const signed = payload.signedURL || payload.signedUrl || "";
    if (!signed) return C.toast(C.t("cw.audioReadFail"));
    root.querySelector("#podcast-preview").innerHTML = `<audio controls autoplay src="${esc(signed.startsWith("http") ? signed : url(`/storage/v1${signed}`))}" style="width:100%"></audio>`;
  }
  function formatSize(n) { return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`; }
  async function upload(file, path, status) {
    const res = await fetch(url(`/storage/v1/object/creator-media/${path.split("/").map(encodeURIComponent).join("/")}`), { method: "POST", headers: auth({ "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }), body: file });
    if (!res.ok) throw new Error(status);
  }
  async function save(e) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    if (pickedFile) {
      const ext = pickedFile.name.split(".").pop().toLowerCase();
      if (!extensions.has(ext) || !pickedFile.type.startsWith("audio/")) return C.toast(C.t("cw.audioFormatError"));
      if (pickedFile.size > maxBytes) return C.toast(C.t("cw.audioSizeError"));
    }
    if (!pickedFile && !current?.file_path) return C.toast(C.t("cw.audioNeedFile"));
    const fd = new FormData(form);
    const title = String(fd.get("title") || "").trim();
    const btn = form.querySelector("#podcast-save");
    const prog = form.querySelector("#podcast-prog");
    const status = form.querySelector("#podcast-status");
    btn.disabled = true; prog.hidden = false; status.textContent = C.t("cw.uploadingAudio");
    let filePath = current?.file_path || "";
    let fileName = current?.file_name || "";
    let mime = current?.file_mime || "";
    if (pickedFile) {
      const safeName = pickedFile.name.normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-100) || "audio";
      filePath = `${member.member_id}/${hubId}/${Date.now()}-${safeName}`;
      fileName = pickedFile.name; mime = pickedFile.type || `audio/${pickedFile.name.split(".").pop().toLowerCase()}`;
      try { await upload(pickedFile, filePath); } catch { btn.disabled = false; prog.hidden = true; return C.toast(C.t("cw.audioUploadFail")); }
    }
    const id = current?.content_id || `pod-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const body = { hub_id: hubId, content_type: "podcast", content_id: id, title, description: String(fd.get("description") || "").trim(), thumb_url: String(fd.get("thumb_url") || "").trim(), href: "", file_path: filePath, file_name: fileName, file_mime: mime, duration_seconds: Number(root.dataset.duration || current?.duration_seconds || 0), visibility: fd.get("visibility") || "public" };
    const path = current ? `/rest/v1/creator_hub_items?hub_id=eq.${hubId}&content_type=eq.podcast&content_id=eq.${encodeURIComponent(id)}` : "/rest/v1/creator_hub_items";
    const saved = await C.supabaseRequest(path, { method: current ? "PATCH" : "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(body) }).catch(() => ({ ok:false }));
    if (!saved.ok) { if (pickedFile) await deleteFile(filePath); btn.disabled = false; prog.hidden = true; return C.toast(C.t("cw.saveFailed")); }
    if (pickedFile && current?.file_path) await deleteFile(current.file_path);
    C.toast(C.t("cw.podcastSaved"));
    location.href = `./creator-dashboard.html?kind=channel&tab=podcasts&hub=${hubId}`;
  }
  async function deleteFile(path) {
    await fetch(url(`/storage/v1/object/creator-media/${path.split("/").map(encodeURIComponent).join("/")}`), { method:"DELETE", headers:auth() }).catch(() => {});
  }
  init().catch((e) => { console.error(e); root.innerHTML = shell(C.t("cw.loadFail")); });
})();
