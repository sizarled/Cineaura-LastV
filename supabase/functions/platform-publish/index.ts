// platform-publish — the scheduled sender of Panel > Platforms (sql/platforms.sql).
//
//   Deploy with the Supabase Edge Function connector / CLI. The gateway JWT check
//   is disabled because pg_cron signs each request with a short-lived HMAC bucket;
//   the function validates that proof through a service-role-only SQL RPC before
//   reading the queue. The secret itself is generated and retained in Supabase Vault.
//   `sql/platform_publish_schedule.sql` installs the verifier and daily 09:00 UTC job.
//   Do not expose this function without the HMAC verifier below.

//
// WHAT A RUN DOES
//   reads platform_posts (pending/failed, oldest first, ≤20) + platform_settings,
//   and for every selected network that is DUE today — its own publish_day
//   (or the post's forced day, or every run when null) and not already ok —
//   publishes the post:
//     • webhook_url set → the whole payload is POSTed there (Zapier / Make / n8n):
//       this is also the ONLY path for quora, rumble, odysee, bilibili, snapchat
//       (no public posting APIs — automations bridge them);
//     • otherwise the network's own API with the stored credentials:
//       YouTube · Facebook (page photo/video) · Instagram (business container) ·
//       TikTok (Pull-from-URL) · Telegram · Reddit · Pinterest · Tumblr ·
//       Vimeo (pull) · X (text tweet) · Threads.
//   Per-network results (ok / detail / at) land back in the row; the state
//   becomes published / partial / failed, and the row waits for the next run
//   whenever nothing was due.
// API credentials are read by the service role only; they never reach a browser.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SELF = { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Creds = Record<string, string>;
type Row = {
  id: string; title: string; description: string; tags: string[]; media_type: string;
  media_url: string; platforms: string[]; state: string; results: Record<string, { ok?: boolean; detail?: string; at?: string }>;
  publish_day: number | null;
};
type Setting = { platform: string; enabled: boolean; publish_day: number | null; credentials: Creds };

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...SELF, Prefer: "return=representation", ...(init.headers || {}) } });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

const caption = (r: Row) =>
  [r.title, r.description, ...(r.tags || []).map((t) => (t.startsWith("#") ? t : `#${t}`))].filter(Boolean).join("\n\n");

async function postJSON(url: string, body: unknown, headers: Record<string, string> = {}, timeoutMs = 25000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data, text };
  } finally { clearTimeout(timer); }
}
const form = (obj: Record<string, string>) => new URLSearchParams(obj).toString();

/* ┌────────── per-network publishers ──────────┐ */

async function pubWebhook(c: Creds, r: Row, key: string) {
  const url = String(c.webhook_url || "");
  if (!url) return { ok: false, detail: "no credentials" };
  const res = await postJSON(url, {
    platform: key, title: r.title, description: r.description, tags: r.tags,
    media_type: r.media_type, media_url: r.media_url, post_id: r.id, at: new Date().toISOString(),
  });
  return res.ok ? { ok: true, detail: `webhook ${res.status}` } : { ok: false, detail: `webhook ${res.status}: ${String(res.text || "").slice(0, 160)}` };
}

async function pubTelegram(c: Creds, r: Row) {
  const bot = String(c.bot_token || ""), chat = String(c.chat_id || "");
  if (!bot || !chat) return { ok: false, detail: "missing bot_token/chat_id" };
  const base = `https://api.telegram.org/bot${bot}`;
  const cap = caption(r).slice(0, 1024);
  let res;
  if (r.media_type === "image" && r.media_url) res = await postJSON(`${base}/sendPhoto`, { chat_id: chat, photo: r.media_url, caption: cap });
  else if (r.media_type === "video" && r.media_url) res = await postJSON(`${base}/sendVideo`, { chat_id: chat, video: r.media_url, caption: cap, supports_streaming: true });
  else res = await postJSON(`${base}/sendMessage`, { chat_id: chat, text: caption(r).slice(0, 4096), disable_web_page_preview: false });
  const d = res.data as { ok?: boolean; description?: string } | null;
  return res.ok && d?.ok !== false ? { ok: true, detail: "sent" } : { ok: false, detail: d?.description || `HTTP ${res.status}` };
}

async function pubPinterest(c: Creds, r: Row) {
  const tok = String(c.access_token || ""), board = String(c.board_id || "");
  if (!tok || !board) return { ok: false, detail: "missing access_token/board_id" };
  if (r.media_type !== "image" || !r.media_url) return { ok: false, detail: "pins need an image" };
  const res = await postJSON("https://api.pinterest.com/v5/pins", {
    board_id: board, title: r.title.slice(0, 100), description: caption(r).slice(0, 500),
    media_source: { source_type: "image_url", url: r.media_url },
  }, { Authorization: `Bearer ${tok}` });
  return res.ok ? { ok: true, detail: "pinned" } : { ok: false, detail: `http ${res.status}: ${res.text.slice(0, 140)}` };
}

async function pubTumblr(c: Creds, r: Row) {
  const tok = String(c.access_token || ""), blog = String(c.blog_identifier || "");
  if (!tok || !blog) return { ok: false, detail: "missing access_token/blog_identifier" };
  const content: Array<Record<string, unknown>> = [{ type: "text", text: `${r.title}\n\n${r.description}`.trim() }];
  if (r.media_url) content.push({ type: r.media_type === "video" ? "video" : "image", media: [{ type: r.media_type === "video" ? "video/mp4" : "image/jpeg", url: r.media_url }] });
  const res = await postJSON(`https://api.tumblr.com/v2/blog/${encodeURIComponent(blog)}/posts`, { content, tags: r.tags }, { Authorization: `Bearer ${tok}` });
  return res.ok || res.status === 201 ? { ok: true, detail: "posted" } : { ok: false, detail: `http ${res.status}: ${res.text.slice(0, 140)}` };
}

async function pubFacebook(c: Creds, r: Row) {
  const page = String(c.page_id || ""), tok = String(c.page_access_token || "");
  const group = String(c.group_id || "");
  if (!tok || !(page || group)) return { ok: false, detail: "missing page_id/page_access_token" };
  const target = group || page;
  const u = new URL(`https://graph.facebook.com/v19.0/${target}/${r.media_type === "video" ? "videos" : r.media_type === "image" ? "photos" : "feed"}`);
  const params: Record<string, string> = { access_token: tok, description: caption(r), message: caption(r) };
  if (r.media_type !== "none" && r.media_url) { params[r.media_type === "video" ? "file_url" : "url"] = r.media_url; }
  const res = await postJSON(u.toString(), params);
  const d = res.data as { id?: string; error?: { message?: string } } | null;
  return (res.ok && d?.id) ? { ok: true, detail: `id ${d.id}` } : { ok: false, detail: d?.error?.message || `http ${res.status}` };
}

async function pubInstagram(c: Creds, r: Row) {
  const ig = String(c.ig_user_id || ""), tok = String(c.access_token || "");
  if (!ig || !tok) return { ok: false, detail: "missing ig_user_id/access_token" };
  if (r.media_type === "none" || !r.media_url) return { ok: false, detail: "instagram needs a media" };
  const create = await postJSON(`https://graph.facebook.com/v19.0/${ig}/media`, {
    [r.media_type === "video" ? "video_url" : "image_url"]: r.media_url,
    media_type: r.media_type === "video" ? "REELS" : undefined as unknown as string,
    caption: caption(r).slice(0, 2200), access_token: tok,
  });
  const created = (create.data as { id?: string } | null)?.id;
  if (!created) return { ok: false, detail: `container failed: ${create.text.slice(0, 140)}` };
  const pub = await postJSON(`https://graph.facebook.com/v19.0/${ig}/media_publish`, { creation_id: created, access_token: tok });
  return pub.ok ? { ok: true, detail: `id ${(pub.data as { id?: string } | null)?.id || created}` } : { ok: false, detail: `publish: ${pub.text.slice(0, 140)}` };
}

async function pubVimeo(c: Creds, r: Row) {
  const tok = String(c.access_token || "");
  if (!tok) return { ok: false, detail: "missing access_token" };
  if (r.media_type !== "video" || !r.media_url) return { ok: false, detail: "vimeo needs a video URL" };
  const res = await postJSON("https://api.vimeo.com/me/videos", {
    upload: { approach: "pull", link: r.media_url, size: undefined as unknown as string },
    name: r.title, description: caption(r),
  }, { Authorization: `bearer ${tok}` });
  return res.ok || res.status === 201 ? { ok: true, detail: "pull started" } : { ok: false, detail: `http ${res.status}: ${res.text.slice(0, 140)}` };
}

async function oauthRefresh(tokenUrl: string, c: Creds, extra: Record<string, string> = {}) {
  const res = await postJSON(tokenUrl, form({ grant_type: "refresh_token", refresh_token: String(c.refresh_token || ""), client_id: String(c.client_id || ""), client_secret: String(c.client_secret || ""), ...extra }), { "Content-Type": "application/x-www-form-urlencoded" });
  return { ok: res.ok, token: String((res.data as { access_token?: string } | null)?.access_token || ""), detail: res.text.slice(0, 140) };
}

async function pubYouTube(c: Creds, r: Row) {
  if (r.media_type !== "video" || !r.media_url) return { ok: false, detail: "youtube needs a video URL" };
  const o = await oauthRefresh("https://oauth2.googleapis.com/token", c);
  if (!o.token) return { ok: false, detail: `oauth: ${o.detail}` };
  // resumable upload: the init reply carries the upload URL in its location header
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { Authorization: `Bearer ${o.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ snippet: { title: r.title.slice(0, 100), description: `${r.description}\n\n${(r.tags || []).map((t) => `#${t}`).join(" ")}` }, status: { privacyStatus: "public" } }),
  });
  const uploadUrl = init.headers.get("location");
  if (!init.ok || !uploadUrl) return { ok: false, detail: `upload init: http ${init.status}` };
  const media = await fetch(r.media_url);
  if (!media.ok || !media.body) return { ok: false, detail: `media fetch: http ${media.status}` };
  const up = await fetch(uploadUrl, { method: "PUT", body: media.body });
  return up.ok || up.status === 201 ? { ok: true, detail: "uploaded" } : { ok: false, detail: `upload: http ${up.status}` };
}

async function pubReddit(c: Creds, r: Row) {
  const basic = btoa(`${String(c.client_id || "")}:${String(c.client_secret || "")}`);
  const o = await postJSON("https://www.reddit.com/api/v1/access_token", form({ grant_type: "refresh_token", refresh_token: String(c.refresh_token || "") }),
    { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "CineAuraBot/1.0" });
  const tok = (o.data as { access_token?: string } | null)?.access_token;
  if (!tok) return { ok: false, detail: `oauth: ${o.text.slice(0, 120)}` };
  const sub = String(c.subreddit || "").replace(/^r\//i, "");
  if (!sub) return { ok: false, detail: "missing subreddit" };
  const params: Record<string, string> = { title: r.title.slice(0, 300), sr: sub, api_type: "json" };
  if (r.media_type !== "none" && r.media_url) { params.kind = "link"; params.url = r.media_url; }
  else { params.kind = "self"; params.text = `${caption(r)}${r.media_url ? `\n\n${r.media_url}` : ""}`; }
  const res = await postJSON("https://oauth.reddit.com/api/submit", form(params), { Authorization: `bearer ${tok}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "CineAuraBot/1.0" });
  const errs = (res.data as { json?: { errors?: unknown[] } } | null)?.json?.errors || [];
  return res.ok && !errs.length ? { ok: true, detail: "submitted" } : { ok: false, detail: JSON.stringify(errs).slice(0, 140) || `http ${res.status}` };
}

async function pubThreads(c: Creds, r: Row) {
  const tok = String(c.access_token || ""), uid = String(c.user_id || "");
  if (!tok || !uid) return { ok: false, detail: "missing access_token/user_id" };
  const body: Record<string, string> = { media_type: r.media_type === "video" ? "VIDEO" : r.media_type === "image" ? "IMAGE" : "TEXT", text: caption(r).slice(0, 500), access_token: tok };
  if (r.media_type === "image" && r.media_url) body.image_url = r.media_url;
  if (r.media_type === "video" && r.media_url) body.video_url = r.media_url;
  const created = await postJSON(`https://graph.threads.net/v1.0/${uid}/threads`, body);
  const id = (created.data as { id?: string } | null)?.id;
  if (!id) return { ok: false, detail: `container: ${created.text.slice(0, 120)}` };
  const pub = await postJSON(`https://graph.threads.net/v1.0/${uid}/threads_publish`, { creation_id: id, access_token: tok });
  return pub.ok ? { ok: true, detail: `id ${(pub.data as { id?: string } | null)?.id || id}` } : { ok: false, detail: `publish: ${pub.text.slice(0, 120)}` };
}

async function pubTikTok(c: Creds, r: Row) {
  const tok = String(c.access_token || "");
  if (!tok) return { ok: false, detail: "missing access_token" };
  if (!r.media_url) return { ok: false, detail: "tiktok needs a media URL" };
  const kind = r.media_type === "video" ? "video" : "photo";
  const body: Record<string, unknown> = kind === "video"
    ? { post_info: { title: caption(r).slice(0, 90) }, source_info: { source: "PULL_FROM_URL", video_url: r.media_url } }
    : { post_info: { title: caption(r).slice(0, 90) }, source_info: { source: "PULL_FROM_URL", photos: [r.media_url] } };
  const res = await postJSON(`https://open.tiktokapis.com/v2/post/publish/${kind === "video" ? "video/init/" : "content/init/"}`, body,
    { Authorization: `Bearer ${tok}` });
  const d = res.data as { data?: { publish_id?: string }; error?: { message?: string; code?: string } } | null;
  return d?.error && d.error.code !== "ok" ? { ok: false, detail: d.error.message || `http ${res.status}` } : { ok: true, detail: d?.data?.publish_id || "queued" };
}

// X: OAuth1 user-context media upload is deliberately left to a worker upgrade —
// a text tweet via OAuth2 app-only can't post; webhook covers it meanwhile.
async function pubX(_c: Creds, _r: Row) {
  return { ok: false, detail: "use the webhook for X (OAuth1 media flow pending)" };
}

export const PUBLISHERS: Record<string, (c: Creds, r: Row, key: string) => Promise<{ ok: boolean; detail: string }>> = {
  youtube: pubYouTube, facebook: pubFacebook, instagram: pubInstagram, tiktok: pubTikTok,
  telegram: pubTelegram, reddit: pubReddit, pinterest: pubPinterest, tumblr: pubTumblr,
  vimeo: pubVimeo, threads: pubThreads, x: pubX,
};

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, reason: "not_configured" }, 500);
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);

  // Supabase's edge gateway is configured with verify_jwt=false so pg_cron can
  // invoke this endpoint without holding a service-role JWT. Instead, the DB job
  // sends a five-minute bucket and its SHA-256 proof. The secret stays in Vault;
  // this RPC exposes only a boolean and is executable only by service_role.
  const bucketText = req.headers.get("x-cineaura-publish-bucket") || "";
  const signature = req.headers.get("x-cineaura-publish-signature") || "";
  if (!/^[0-9]{1,12}$/.test(bucketText) || !/^[a-f0-9]{64}$/i.test(signature)) {
    return json({ ok: false, reason: "unauthorized" }, 401);
  }

  let authorization;
  try {
    authorization = await rest("rpc/platform_publish_authorize", {
      method: "POST",
      body: JSON.stringify({ p_bucket: Number(bucketText), p_signature: signature.toLowerCase() }),
    });
  } catch {
    return json({ ok: false, reason: "auth_check_unavailable" }, 503);
  }
  if (!authorization.ok || authorization.data !== true) {
    return json({ ok: false, reason: "unauthorized" }, 401);
  }

  const settings = await rest(`platform_settings?select=*`);
  if (!settings.ok) return json({ ok: false, reason: "settings_read", detail: settings.data }, 500);
  const byPlat: Record<string, Setting> = {};
  (Array.isArray(settings.data) ? settings.data : []).forEach((s: Setting) => (byPlat[s.platform] = s));

  const posts = await rest(`platform_posts?state=in.(pending,failed)&order=created_at.asc&limit=20&select=*`);
  if (!posts.ok) return json({ ok: false, reason: "posts_read", detail: posts.data }, 500);

  const todayUtc = new Date().getUTCDay(); // 0 = Sunday
  const report: Array<Record<string, unknown>> = [];

  for (const r of (Array.isArray(posts.data) ? posts.data : []) as Row[]) {
    const results = { ...(r.results || {}) };
    let done = 0, failed = 0, attempted = 0;
    for (const key of r.platforms || []) {
      if (results[key]?.ok) { done++; continue; }
      const s = byPlat[key];
      if (!s || s.enabled === false) { results[key] = { ok: false, detail: "platform off", at: new Date().toISOString() }; failed++; continue; }
      const day = r.publish_day ?? s.publish_day;
      if (day !== null && day !== undefined && Number(day) !== todayUtc) continue; // not this network's day
      attempted++;
      const creds = s.credentials || {};
      const pub = String(creds.webhook_url || "") ? pubWebhook : PUBLISHERS[key];
      if (!pub) { results[key] = { ok: false, detail: "webhook only", at: new Date().toISOString() }; failed++; continue; }
      try {
        const out = await pub(creds, r, key);
        results[key] = { ok: out.ok, detail: out.detail, at: new Date().toISOString() };
        out.ok ? done++ : failed++;
      } catch (e) {
        results[key] = { ok: false, detail: String(e).slice(0, 160), at: new Date().toISOString() };
        failed++;
      }
    }
    const total = (r.platforms || []).length;
    const state = done >= total ? "published" : done > 0 ? "partial" : attempted || failed ? "failed" : r.state; // nothing due → keep waiting
    if (attempted || failed || state !== r.state) {
      await rest(`platform_posts?id=eq.${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ results, state, last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
    }
    report.push({ id: r.id, title: r.title, state, attempted, results });
  }

  return json({ ok: true, ran: new Date().toISOString(), weekday: todayUtc, posts: report });
});
