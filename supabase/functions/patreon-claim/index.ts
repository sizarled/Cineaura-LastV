// Patreon OAuth → purchase verification → ONE POINTS code from the site stock.
// The site sells nothing but points codes on Patreon; with the default
// withdrawal rate a $5 tier hands back a 500-point serial (the money and the
// points are equal). The buyer then redeems the serial in Dashboard → Points
// and can buy his membership with those points right there.
// Deploy:  supabase functions deploy patreon-claim
// Secrets: supabase secrets set PATREON_CLIENT_ID=… PATREON_CLIENT_SECRET=… PATREON_CAMPAIGN_ID=…
// Optional PATREON_TIER_MAP='{"TIERID":{"points":500},"TIERID2":{"price_cents":1000}}'
//   · {"points":N}   pins the serial's value directly;
//   · {"price_cents":C} pins the money, the points follow the equality rule;
//   · a legacy {"kind":"membership","membership":"Gold"} entry is translated
//     to the plan's money price in points (Silver 500 · Gold 1000 · Diamond 2000).
//   With no mapping, the value comes from the amount Patreon reports the
//   patron is currently entitled to.
// (PATREON_DEFAULT_KIND is retired — every new claim is a points claim.)
//
// The browser never sees the OAuth client secret: the exchange with Patreon's
// API happens here, and Supabase itself injects SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY so the claim RPC keeps the stock atomic.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);

  let body: { code?: string; redirect_uri?: string; account?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "bad_json" }, 400);
  }
  const oauthCode = String(body.code || "").trim();
  const redirectUri = String(body.redirect_uri || "").trim();
  const account = String(body.account || "").trim().slice(0, 120);
  if (!oauthCode || !redirectUri) return json({ ok: false, reason: "missing" }, 400);

  const CLIENT_ID = Deno.env.get("PATREON_CLIENT_ID") || "";
  const CLIENT_SECRET = Deno.env.get("PATREON_CLIENT_SECRET") || "";
  const CAMPAIGN = Deno.env.get("PATREON_CAMPAIGN_ID") || "";
  if (!CLIENT_ID || !CLIENT_SECRET || !CAMPAIGN) {
    return json({ ok: false, reason: "not_configured" }, 500);
  }

  // 1 · OAuth code → access token -------------------------------------------------
  let token = "";
  try {
    const resp = await fetch("https://www.patreon.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: oauthCode,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
      }),
    });
    if (!resp.ok) return json({ ok: false, reason: "oauth", msg: await resp.text() }, 401);
    token = (await resp.json())?.access_token || "";
  } catch (e) {
    return json({ ok: false, reason: "oauth", msg: String(e) }, 502);
  }
  if (!token) return json({ ok: false, reason: "oauth" }, 401);

  // 2 · who are you, and are you OUR paying patron? -------------------------------
  let ident: any = null;
  try {
    const q = new URLSearchParams({
      include: "memberships.campaign,memberships.currently_entitled_tiers",
      "fields[user]": "email,full_name",
      "fields[member]": "patron_status,currently_entitled_amount_cents,last_charge_status",
      "fields[tier]": "title,amount_cents",
    });
    const resp = await fetch(`https://www.patreon.com/api/oauth2/v2/identity?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return json({ ok: false, reason: "identity", msg: await resp.text() }, 502);
    ident = await resp.json();
  } catch (e) {
    return json({ ok: false, reason: "identity", msg: String(e) }, 502);
  }

  const userId = String(ident?.data?.id || "");
  if (!userId) return json({ ok: false, reason: "identity" }, 502);
  const name = ident?.data?.attributes?.full_name || "";
  const email = ident?.data?.attributes?.email || "";

  const included: any[] = Array.isArray(ident?.included) ? ident.included : [];
  const membership = included.find(
    (x) =>
      x?.type === "member" &&
      x?.relationships?.campaign?.data?.id === CAMPAIGN,
  );
  if (!membership) return json({ ok: false, reason: "not_patron", name });

  const status = String(membership?.attributes?.patron_status || "");
  const lastCharge = String(membership?.attributes?.last_charge_status || "");
  if (status !== "active_patron" && lastCharge !== "Paid") {
    return json({ ok: false, reason: "not_active", name, status });
  }

  // 3 · which tier → WHICH POINTS value -------------------------------------------
  const tierIds: string[] = (membership?.relationships?.currently_entitled_tiers?.data || [])
    .map((t: any) => String(t?.id || ""))
    .filter(Boolean);
  const entitledCents = Number(membership?.attributes?.currently_entitled_amount_cents) || 0;

  let tierMap: Record<string, any> = {};
  try {
    tierMap = JSON.parse(Deno.env.get("PATREON_TIER_MAP") || "{}");
  } catch {
    tierMap = {};
  }
  let mapped: any = null;
  for (const tid of tierIds) {
    if (tierMap[tid]) {
      mapped = tierMap[tid];
      break;
    }
  }

  // Patreon sells POINTS codes only on this site. Determinism, in order:
  // explicit {"points":N} → pinned/mapped/legacy-plan money → what the patron pays.
  const planCents: Record<string, number> = { Silver: 500, Gold: 1000, Diamond: 2000 };
  let points = Number(mapped?.points) > 0 ? Number(mapped.points) : null;
  let priceCents: number | null = null;
  if (!points) {
    if (Number(mapped?.price_cents) > 0) {
      priceCents = Number(mapped.price_cents);
    } else if (mapped?.kind === "membership" && planCents[mapped?.membership]) {
      priceCents = planCents[mapped.membership]; // legacy tier maps keep working — as points now
    } else if (entitledCents > 0) {
      priceCents = entitledCents;
    }
  }

  // 4 · one serial out of the stock, atomically ------------------------------------
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/patreon_claim`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        p_user: userId,
        p_account: account || name || email,
        p_kind: "points",
        p_points: points,
        p_price_cents: priceCents,
      }),
    });
    if (!resp.ok && (await resp.text()).includes("patreon_claim")) {
      return json({ ok: false, reason: "sql_missing" }, 500);
    }
    const claim = await resp.json().catch(() => null);
    if (claim?.ok) {
      return json({ ...claim, name, email, tierIds });
    }
    return json({ ok: false, reason: claim?.reason || "claim", name }, 200);
  } catch (e) {
    return json({ ok: false, reason: "claim", msg: String(e) }, 502);
  }
});
