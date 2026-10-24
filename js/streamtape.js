// CineAura × Streamtape (api.streamtape.com): member video uploads.
//
// Every member has one folder on the site's Streamtape account, named by their
// member id (Users/ID482175022), with five fixed subfolders that mirror what
// the site publishes:
//
//   Market  → the videos of the member's products,      VID - {productId} - {n}        (n ascends 0,1,2…)
//   Movies  → films uploaded from a watch page,          {QUALITY} - Movie - {tmdbId}   (same film+quality once, site-wide)
//   TV      → episodes uploaded from a watch page,       TV - {tmdbId} - S{s} - Ep{e} - {QUALITY}
//   Videos  → videos the member creates (Your content),  Video - {contentId}
//   Posts   → videos attached to profile posts,          Post - {postId}
//
// The rules of the account: upload and delete INSIDE your own folder only,
// the folders themselves are never deleted, and the client never descends into
// another member's folder. A row in public.media_uploads (sql/uploads.sql)
// registers every upload, so the site knows the file id of each video, blocks
// duplicate films/episodes site-wide, and cleans up when its owner deletes
// the link / product / post / video it belongs to.
(() => {
  "use strict";

  const BASE = "https://api.streamtape.com";
  const LOGIN = "010abc21eb8af8b77b42";
  const KEY = "120GYLeBYluelxJ";
  const ROOT_NAME = "Users";
  const SUB_FOLDERS = ["Market", "Movies", "TV", "Videos", "Posts"];
  const FOLDER_KEY = { market: "Market", movies: "Movies", tv: "TV", videos: "Videos", posts: "Posts" };
  const CACHE_PREFIX = "cineaura_st_tree_v1:";
  const MAX_BYTES = 3 * 1024 * 1024 * 1024; // one sanity ceiling per file (3 GB)

  const C = () => window.CineAura || {};

  /* ── low level ─────────────────────────────────────────────────────── */

  async function apiCall(path, params = {}) {
    const q = new URLSearchParams({ login: LOGIN, key: KEY, ...params });
    let res;
    try {
      res = await fetch(`${BASE}${path}?${q.toString()}`, { method: "GET" });
    } catch (e) {
      return { ok: false, offline: true, status: 0, msg: String(e) };
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    const status = Number(data?.status ?? res.status) || 0;
    return { ok: status === 200, status, msg: String(data?.msg || ""), data: data?.result };
  }

  async function listFolder(folderId = "") {
    const res = await apiCall("/file/listfolder", folderId ? { folder: folderId } : {});
    if (!res.ok || !res.data || typeof res.data !== "object") return { ok: false, msg: res.msg, folders: [], files: [] };
    return {
      ok: true,
      folders: Array.isArray(res.data.folders) ? res.data.folders : [],
      files: Array.isArray(res.data.files) ? res.data.files : [],
    };
  }

  async function createFolder(name, pid = "") {
    const res = await apiCall("/file/createfolder", pid ? { name, pid } : { name });
    if (!res.ok) return { ok: false, msg: res.msg };
    const id = res.data?.folderid || res.data?.id || "";
    return { ok: true, id };
  }

  /* Get the id of the folder `name` directly inside `pid` (pid "" = the account
     root), creating it when missing. Deletion of folders is never offered. */
  async function folderChild(pid, name) {
    const list = await listFolder(pid);
    if (!list.ok) return { ok: false, msg: list.msg };
    const found = list.folders.find((f) => String(f.name || "") === name);
    if (found?.id) return { ok: true, id: String(found.id) };
    return createFolder(name, pid);
  }

  /* ── the member's tree ─────────────────────────────────────────────── */

  function cacheRead(memberId) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + memberId);
      if (!raw) return null;
      const m = JSON.parse(raw);
      if (m && m.root && m.market && m.movies && m.tv && m.videos && m.posts) return m;
    } catch { /* corrupted ids: rebuilt below */ }
    return null;
  }

  function cacheWrite(memberId, map) {
    try { localStorage.setItem(CACHE_PREFIX + memberId, JSON.stringify(map)); } catch { /* private mode */ }
  }

  /* Build the folders the first upload needs, once per member: Users, then the
     member id inside it, then its five fixed subfolders. From the member
     folder on, we never list or touch a folder that is theirs. */
  async function ensureMemberTree(memberId) {
    const cached = cacheRead(memberId);
    if (cached) return { ok: true, map: cached };
    const users = await folderChild("", ROOT_NAME);
    if (!users.ok) return { ok: false, msg: users.msg };
    const root = await folderChild(users.id, String(memberId));
    if (!root.ok) return { ok: false, msg: root.msg };
    const map = { users: users.id, root: root.id, created_at: Date.now() };
    for (const key of Object.keys(FOLDER_KEY)) {
      const sub = await folderChild(root.id, FOLDER_KEY[key]);
      if (!sub.ok) return { ok: false, msg: sub.msg };
      map[key] = sub.id;
    }
    cacheWrite(memberId, map);
    return { ok: true, map };
  }

  /* A folder id on Streamtape can change (name renames, account events): when
     the cached upload path fails, the tree is rebuilt once. */
  async function folderFor(memberId, folder) {
    let tree = await ensureMemberTree(memberId);
    if (!tree.ok) return tree;
    return { ok: true, map: tree.map, id: tree.map[folder] };
  }

  function invalidateTree(memberId) {
    try { localStorage.removeItem(CACHE_PREFIX + memberId); } catch { /* */ }
  }

  /* ── file naming (the contract of every folder) ────────────────────── */

  function extOf(filename) {
    const m = String(filename || "").match(/\.([A-Za-z0-9]{2,5})$/);
    return m ? `.${m[1].toLowerCase()}` : ".mp4";
  }

  const names = {
    movie: (quality, tmdbId) => `${quality} - Movie - ${tmdbId}`,
    tv: (tmdbId, season, episode, quality) => `TV - ${tmdbId} - S${season} - Ep${episode} - ${quality}`,
    video: (contentId) => `Video - ${contentId}`,
    post: (postId) => `Post - ${postId}`,
    market: (productId, ordinal) => `VID - ${productId} - ${ordinal}`,
  };

  /* ── upload / rename / delete ──────────────────────────────────────── */

  /* One file into one of the member's five folders, renamed to the folder's
     own name (its extension is kept). `onProgress(0..100)` paints the meter. */
  async function uploadNamed(memberId, folder, file, baseName, onProgress) {
    if (!(file instanceof File)) return { ok: false, reason: "nofile" };
    if (file.size > MAX_BYTES) return { ok: false, reason: "toobig" };
    const loc = await folderFor(memberId, folder);
    if (!loc.ok) return { ok: false, reason: "tree", msg: loc.msg };
    const target = `${baseName}${extOf(file.name)}`;

    const up = await apiCall("/file/ul", { folder: loc.id });
    if (!up.ok || !up.data?.url) {
      invalidateTree(memberId);
      return { ok: false, reason: "prepare", msg: up.msg };
    }

    const posted = await new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", up.data.url);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && typeof onProgress === "function") {
            onProgress(Math.max(1, Math.round((e.loaded / e.total) * 100)));
          }
        };
        xhr.onload = () => {
          let data = null;
          try { data = JSON.parse(xhr.responseText); } catch { /* */ }
          resolve(data);
        };
        xhr.onerror = () => resolve(null);
        const form = new FormData();
        form.append("file1", file, file.name || target);
        xhr.send(form);
      } catch {
        resolve(null);
      }
    });
    const entry = Array.isArray(posted?.result) ? posted.result[0] : posted?.result;
    const fileId = String(entry?.id || "");
    if (!fileId) return { ok: false, reason: "upload", msg: posted?.msg || "" };

    const named = await apiCall("/file/rename", { file: fileId, name: target });
    return {
      ok: true,
      fileId,
      name: named.ok ? target : String(entry?.name || target),
      pageUrl: `https://streamtape.com/v/${fileId}`,
      embedUrl: `https://streamtape.com/e/${fileId}`,
    };
  }

  async function renameFile(fileId, name) {
    const res = await apiCall("/file/rename", { file: fileId, name });
    return { ok: res.ok, msg: res.msg };
  }

  async function deleteFile(fileId) {
    const res = await apiCall("/file/delete", { file: fileId });
    return { ok: res.ok, msg: res.msg };
  }

  /* The file ids inside the member's Streamtape folder — the source of truth
     for the market ordinals and a hint for name clashes. */
  async function folderFiles(memberId, folder) {
    const loc = await folderFor(memberId, folder);
    if (!loc.ok) return { ok: false, files: [] };
    const list = await listFolder(loc.id);
    return { ok: list.ok, files: list.files };
  }

  /* ── the registry (public.media_uploads, sql/uploads.sql) ─────────────
     The folder rules the API cannot enforce — a film or an episode at one
     quality only once site-wide, the ascending ordinals of the products — are
     rows here, unique-indexed in the database. */

  /* The video's own picture lives under Home/Thumbnails: an image file that
     carries the very same name as the video file (without its extension).
     Returns { fileId, pageUrl } or null when the folder or the file is not
     there yet. */
  let thumbs = null;
  async function thumbFor(baseName) {
    const stem = String(baseName || "").replace(/\.[a-z0-9]+$/i, "").trim();
    if (!stem) return null;
    if (thumbs === null) {
      thumbs = [];
      try {
        const root = await apiCall("/file/listfolder", {});
        if (!root.ok) return null;
        const folders = Array.isArray(root.data?.folders) ? root.data.folders : [];
        const hit = folders.find((f) => /^thumbnails$/i.test(String(f.name || "").trim()));
        if (!hit) return null;
        thumbs = await folderFiles(String(hit.id));
      } catch {
        thumbs = null;
        return null;
      }
    }
    const low = stem.toLowerCase();
    const file = (thumbs || []).find((f) => String(f.name || "").replace(/\.[a-z0-9]+$/i, "").toLowerCase() === low);
    if (!file) return null;
    return { fileId: String(file.linkid || file.link_id || file.linkID || ""), pageUrl: `https://streamtape.com/v/${file.linkid || file.link_id || file.linkID}`, name: file.name };
  }

  async function registerUpload(row) {
    /* A registry row can also carry the video's thumbnail: drop those two
       columns gracefully when the graved-table version has not run yet. */
    const payload = { ...row };
    try {
      if (payload.thumb_url || payload.thumb_file_id) {
        const probe = await C().supabaseRequest("/rest/v1/media_uploads?select=thumb_url&limit=1");
        if (probe?.data?.code === "PGRST204" || probe?.data?.code === "42703" || !probe.ok) {
          delete payload.thumb_url;
          delete payload.thumb_file_id;
        }
      }
    } catch {
      delete payload.thumb_url;
      delete payload.thumb_file_id;
    }
    const res = await C().supabaseRequest("/rest/v1/media_uploads", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { Prefer: "return=representation" },
    });
    if (res.ok) return { ok: true, data: Array.isArray(res.data) ? res.data[0] : res.data };
    if (res?.data?.code === "PGRST205") return { ok: false, reason: "sql" };
    if (res?.data?.code === "23505" || /duplicate/i.test(JSON.stringify(res.data || {}))) {
      return { ok: false, reason: "dup" };
    }
    return { ok: false, reason: "error", msg: res?.data?.message || res?.msg || "" };
  }

  /* One quality of one film / one episode may exist only once for the whole
     site: the guard runs before the upload itself. */
  async function movieQualityTaken(quality, tmdbId) {
    const res = await C().supabaseRequest(
      `/rest/v1/media_uploads?folder=eq.movies&tmdb_id=eq.${Number(tmdbId)}&quality=ilike.${encodeURIComponent(String(quality))}&select=file_id,owner_username&limit=1`
    );
    if (res?.data?.code === "PGRST205") return [];
    return res.ok && Array.isArray(res.data) ? res.data : [];
  }

  async function tvQualityTaken(tmdbId, season, episode, quality) {
    const res = await C().supabaseRequest(
      `/rest/v1/media_uploads?folder=eq.tv&tmdb_id=eq.${Number(tmdbId)}&season=eq.${Number(season)}&episode=eq.${Number(episode)}&quality=ilike.${encodeURIComponent(String(quality))}&select=file_id,owner_username&limit=1`
    );
    if (res?.data?.code === "PGRST205") return [];
    return res.ok && Array.isArray(res.data) ? res.data : [];
  }

  async function uploadsByRef(folder, refId) {
    if (!refId) return [];
    const res = await C().supabaseRequest(
      `/rest/v1/media_uploads?folder=eq.${folder}&ref_id=eq.${encodeURIComponent(String(refId))}&select=*&order=created_at.asc&limit=100`
    );
    return res.ok && Array.isArray(res.data) ? res.data : [];
  }

  async function removeUploadRows(filter) {
    return C().supabaseRequest(`/rest/v1/media_uploads?${filter}`, { method: "DELETE" });
  }

  /* Delete everything a product / post / video uploaded, whoever deletes it:
     the files on Streamtape first, then their rows. Only the folder content
     ever goes — never a folder. */
  async function dropRefUploads(folder, refId, ownerId = "") {
    let rows = await uploadsByRef(folder, refId);
    if (ownerId) rows = rows.filter((r) => !ownerId || r.owner_id === ownerId || !r.owner_id);
    for (const r of rows) {
      try { if (r.file_id) await deleteFile(r.file_id); } catch { /* best effort */ }
    }
    if (rows.length) {
      await removeUploadRows(`folder=eq.${folder}&ref_id=eq.${encodeURIComponent(String(refId))}`);
    }
    return rows.length;
  }

  /* One upload by its file id (the watch-link deletion path). */
  async function dropFileUpload(ownerId, fileId) {
    if (!fileId) return false;
    const res = await C().supabaseRequest(
      `/rest/v1/media_uploads?file_id=eq.${encodeURIComponent(String(fileId))}&owner_id=eq.${encodeURIComponent(String(ownerId))}&select=id&limit=1`
    );
    if (!res.ok || !Array.isArray(res.data) || !res.data.length) return false;
    try { await deleteFile(fileId); } catch { /* best effort */ }
    await removeUploadRows(`file_id=eq.${encodeURIComponent(String(fileId))}`);
    return true;
  }

  /* ── browsing the member's own folder (Dashboard > Upload) ───────── */

  const fileEntry = (f) => {
    const id = String(f?.linkid ?? f?.link_id ?? f?.linkID ?? f?.id ?? "");
    return {
      id,
      name: String(f?.name || ""),
      size: Number(f?.size) || 0,
      pageUrl: id ? `https://streamtape.com/v/${id}` : "",
    };
  };

  /* What is actually in the member's five folders, right now:
     -> { ok, groups: [{ key, folder, id, files: [fileEntry], error }] }
     The walk never leaves Users/{memberId}: the tree itself stops there. */
  async function browseMemberFolders(memberId) {
    const tree = await ensureMemberTree(memberId);
    if (!tree.ok) return { ok: false, msg: tree.msg || "", groups: [] };
    const groups = [];
    for (const key of Object.keys(FOLDER_KEY)) {
      const id = tree.map[key];
      const list = await listFolder(id);
      groups.push({
        key,
        folder: FOLDER_KEY[key],
        id,
        files: list.ok ? list.files.map(fileEntry).filter((f) => f.id) : [],
        error: list.ok ? "" : String(list.msg || ""),
      });
    }
    return { ok: true, groups };
  }

  /* Delete one file the browse list shows — registry or not: the storage file
     first, then every registry row that names it for this member. */
  async function dropMyFile(memberId, fileId) {
    if (!fileId) return false;
    const del = await deleteFile(fileId);
    try {
      await C().supabaseRequest(
        `/rest/v1/media_uploads?file_id=eq.${encodeURIComponent(String(fileId))}&owner_id=eq.${encodeURIComponent(String(memberId))}`,
        { method: "DELETE" }
      );
    } catch { /* the row is a bonus: the file is gone anyway */ }
    return del.ok;
  }

  /* ── url helpers ───────────────────────────────────────────────────── */

  function fileIdFromUrl(url) {
    const m = String(url || "").match(/streamtape\.(?:com|net)|streamta\.pe/i);
    if (!m) return "";
    const id = String(url).match(/\/[ve]\/([\w-]{6,40})/);
    return id ? id[1] : "";
  }

  const toEmbedUrl = (url) => {
    const id = fileIdFromUrl(url);
    return id ? `https://streamtape.com/e/${id}` : String(url || "");
  };

  window.Streamtape = {
    FOLDER_KEY,
    names,
    ensureMemberTree,
    folderFiles,
    uploadNamed,
    renameFile,
    deleteFile,
    browseMemberFolders,
    dropMyFile,
    registerUpload,
    movieQualityTaken,
    tvQualityTaken,
    uploadsByRef,
    dropRefUploads,
    dropFileUpload,
    fileIdFromUrl,
    toEmbedUrl,
    thumbFor,
  };
})();
