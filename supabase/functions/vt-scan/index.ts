// CineAura — VirusTotal gate for uploaded documents.
//
// Deploy:  supabase functions deploy vt-scan --no-verify-jwt
// Secret:  supabase secrets set VIRUSTOTAL_API_KEY=...   (NEVER put the key in this repo)
//
// Why a function: the VirusTotal key is a server secret. Any key shipped inside
// the site's JavaScript is readable by every visitor, so the browser only ever
// talks to this endpoint.
//
// Flow
//   1. SHA-256 lookup (GET /files/{hash}) — free, instant when VT knows the file.
//   2. Unknown file: upload it (POST /files, ≤ 32 MB) and poll the analysis.
//   3. Answer: { verdict, stats, source, sha256 }.
// The caller must treat anything other than "clean" as "do not store this file".

const VT = "https://www.virustotal.com/api/v3";
const MAX_BYTES = 32 * 1024 * 1024; // VirusTotal's own limit for a direct upload
const POLL_MS = 4000;
const POLL_TRIES = 12; // ~48 s, under the edge function wall clock

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

const KEY = () => Deno.env.get("VIRUSTOTAL_API_KEY") || "";

type Stats = Record<string, number>;

function verdictOf(stats: Stats | null | undefined): string {
  if (!stats) return "unknown";
  if (Number(stats.malicious || 0) > 0) return "malicious";
  if (Number(stats.suspicious || 0) > 0) return "suspicious";
  return "clean";
}

async function vtGet(path: string) {
  return fetch(`${VT}${path}`, { headers: { "x-apikey": KEY() } });
}

async function hashLookup(sha256: string) {
  const res = await vtGet(`/files/${encodeURIComponent(sha256)}`);
  if (res.status === 404) return { known: false as const };
  if (res.status === 429) return { known: false as const, rate: true };
  if (!res.ok) return { known: false as const };
  const body = await res.json().catch(() => null);
  const stats: Stats | null = body?.data?.attributes?.last_analysis_stats || null;
  return { known: true as const, stats };
}

async function uploadAndAnalyse(file: File) {
  const form = new FormData();
  form.append("file", file, file.name || "document");
  const up = await fetch(`${VT}/files`, { method: "POST", headers: { "x-apikey": KEY() }, body: form });
  if (up.status === 429) return { rate: true as const };
  if (!up.ok) return { failed: true as const };
  const upBody = await up.json().catch(() => null);
  const analysisId = upBody?.data?.id;
  if (!analysisId) return { failed: true as const };

  for (let i = 0; i < POLL_TRIES; i += 1) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const st = await vtGet(`/analyses/${encodeURIComponent(analysisId)}`);
    if (!st.ok) continue;
    const body = await st.json().catch(() => null);
    const attrs = body?.data?.attributes;
    if (attrs?.status === "completed") {
      return { stats: (attrs.stats || null) as Stats | null, done: true as const };
    }
  }
  // still queued: report what we know rather than waiting forever
  return { stats: null, done: false as const };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ verdict: "error", reason: "method" }, 405);
  if (!KEY()) return json({ verdict: "error", reason: "not_configured" }, 503);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ verdict: "error", reason: "body" }, 400);
  }
  const file = form.get("file");
  const givenHash = String(form.get("sha256") || "").toLowerCase();

  if (!(file instanceof File)) {
    // A hash-only call is allowed (the client already computed it).
    if (!/^[a-f0-9]{64}$/.test(givenHash)) return json({ verdict: "error", reason: "nofile" }, 400);
    const known = await hashLookup(givenHash);
    if ("rate" in known) return json({ verdict: "rate_limited", sha256: givenHash }, 429);
    if (!known.known) return json({ verdict: "unknown", sha256: givenHash });
    return json({ verdict: verdictOf(known.stats), stats: known.stats, source: "hash", sha256: givenHash });
  }

  if (file.size > MAX_BYTES) return json({ verdict: "error", reason: "too_large" }, 413);

  // 1) the cheapest question first: does VT already know these bytes?
  const sha256 = givenHash || (await sha256Of(file));
  const known = await hashLookup(sha256);
  if ("rate" in known) return json({ verdict: "rate_limited", sha256 }, 429);
  if (known.known) {
    return json({ verdict: verdictOf(known.stats), stats: known.stats, source: "hash", sha256 });
  }

  // 2) first submission: upload the bytes and read the report
  const scan = await uploadAndAnalyse(file);
  if ("rate" in scan) return json({ verdict: "rate_limited", sha256 }, 429);
  if ("failed" in scan) return json({ verdict: "error", reason: "vt", sha256 }, 502);
  return json({
    verdict: scan.stats ? verdictOf(scan.stats) : "unknown",
    stats: scan.stats || null,
    source: scan.stats ? "analysis" : "queued",
    sha256,
  });
});

async function sha256Of(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
