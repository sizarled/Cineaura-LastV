// content.html: the search box can look on YouTube too (scope chip over the box).
// The YouTube Data API key stays on the server; the page gets back a clean list of
// results (id, title, channel, thumb) and plays each one in the YouTube iframe
// embedter, without ever leaving the videos page.
//
// Deploy:  supabase functions deploy youtube-search
// Secret:  supabase secrets set YOUTUBE_API_KEY=AIza…      (Data API v3 key)
// Without the secret the function answers { ok: false, reason: "not_configured" }
// and the page says so honestly instead of pretending a broken search.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

type YtItem = {
  id?: { videoId?: string | null } | null;
  snippet?: {
    title?: string | null;
    channelTitle?: string | null;
    publishedAt?: string | null;
    thumbnails?: { medium?: { url?: string | null } | null } | null;
  } | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);

  let body: { q?: string; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "bad_json" }, 400);
  }
  const q = String(body.q || "").trim().slice(0, 120);
  const limit = Math.min(Math.max(Number(body.limit) || 12, 1), 20);
  if (!q) return json({ ok: false, reason: "missing" }, 400);

  const KEY = Deno.env.get("YOUTUBE_API_KEY") || "";
  if (!KEY) return json({ ok: false, reason: "not_configured" }, 500);

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: String(limit),
    safeSearch: "moderate",
    q,
    key: KEY,
  }).toString();

  let data: { items?: YtItem[] | null; error?: { errors?: Array<{ reason?: string }> } | null } = {};
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const why = j?.error?.errors?.[0]?.reason || "";
      return json(
        { ok: false, reason: /quota/i.test(why) ? "quota" : "upstream", status: res.status },
        /quota/i.test(why) ? 429 : 502,
      );
    }
    data = await res.json();
  } catch {
    return json({ ok: false, reason: "upstream" }, 502);
  }

  const seen = new Set<string>();
  const items = (Array.isArray(data.items) ? data.items : [])
    .map((x) => ({
      id: String(x?.id?.videoId || ""),
      title: String(x?.snippet?.title || "").slice(0, 180),
      channel: String(x?.snippet?.channelTitle || "").slice(0, 80),
      thumb: String(x?.snippet?.thumbnails?.medium?.url || "").slice(0, 600),
      at: String(x?.snippet?.publishedAt || ""),
    }))
    .filter((x) => {
      if (!/^[A-Za-z0-9_-]{11}$/.test(x.id) || seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    });

  return json({ ok: true, q, items });
});
