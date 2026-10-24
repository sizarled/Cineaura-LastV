# Patreon code delivery — setup

The page `codeactivation.html` asks a buyer for his Patreon account, walks him
through Patreon's own OAuth sign-in, confirms the paid **membership (tier)** of
your campaign with Patreon's API, and hands him one unused activation code
(membership) or points serial. The same Patreon account coming back later gets
the same code again — the stock cannot be farmed by re-verifying.

## 0 · What Patreon's API can and cannot verify — read this first

Patreon's public API exposes **memberships/tiers** (the recurring
subscriptions), members, posts, campaigns and member webhooks. It does **not**
expose **shop storefront one-time product purchases** — that is the official,
current answer from Patreon ([their staff, 2025](https://www.patreondevelopers.com/t/inquiry-about-retrieving-shop-products-via-patreon-api/10109);
confirmed again in
[2026](https://www.patreondevelopers.com/t/how-to-get-sales-one-time-purchases-gifts-data-from-api/11371)).
So this page **cannot check a "Golden membership activation code · 6 months"
shop listing purchase**, and never will — that endpoint simply does not exist.

**What this site sells on Patreon: points codes — and nothing else.**
Memberships are bought with points inside the dashboard (section 6), so every
Patreon purchase is a POINTS code whose value equals the money paid: at the
default withdrawal rate (100 points per 1 currency unit) a $5 tier delivers a
500-point serial.

Sell them in a way the API *can* verify — **sell each points tier as a
Patreon tier** (e.g. "500 points · $5", "1000 points · $10"): a paid tier
shows up in `identity?include=memberships` as `active_patron` with the
entitled tier and its `currently_entitled_amount_cents` — exactly what
`patreon-claim` verifies, and that amount is what sizes the serial when the
tier map doesn't pin one. The buyer pays the first charge, cancels whenever,
and the claims journal below guarantees he only ever receives the code once
(re-subscribing never hands a second — the same account always gets its own
code back).

Legacy tier maps that still say `{"kind":"membership","membership":"Gold"}`
keep working on their own: the money price of the plan is translated into the
equally many points (Silver 500 · Gold 1000 · Diamond 2000), and the stock
touched is `point_codes` only.

If later Patreon opens an Orders API, this same edge function grows it behind
the door: the claims journal and the stock plumbing stay exactly as they are.

## 1 · Database

Run `sql/patreon.sql` in the Supabase SQL editor **once** (idempotent).
It creates the claims journal `patreon_claims`, the `reserved_by` /
`reserved_at` columns on the points stock, and the atomic `patreon_claim()`
function. Only the edge function (service role) may run it. New claims are
always `kind = 'points'`; codes a patron claimed before the points-only
switch keep coming back to him exactly as they were.

## 2 · Edge function

```bash
supabase functions deploy patreon-claim
supabase secrets set \
  PATREON_CLIENT_ID=2sNmjkMRCpWrpSkHCx3x5RRPXdN2mQb4lhQTycevlklvLW_XMWZ7DnfQ0ZAvJXfI \
  PATREON_CLIENT_SECRET=<paste-your-client-secret> \
  PATREON_CAMPAIGN_ID=<your campaign id, from the Patreon developer portal>
```

Optional behavior knob — `PATREON_TIER_MAP`, a JSON string mapping tier ids →
the value pinned to them:

```json
{
  "22123456": { "points": 500 },
  "22123457": { "price_cents": 1000 },
  "22123458": { "kind": "membership", "membership": "Gold" }
}
```

- `{"points": N}` pins the serial's value directly;
- `{"price_cents": C}` pins the money — the delivered points follow the
  ×rate equality;
- a **legacy** membership entry keeps working, translated: Gold becomes a
  1,000-point serial (the plan's money price in points).
- Tiers missing from the map (or a map entirely absent) → the amount Patreon
  reports the patron is entitled to (`currently_entitled_amount_cents`) sizes
  the serial. Every new claim is a point claim; `PATREON_DEFAULT_KIND` is
  retired.

The tier id of each tier lives in the Patreon developer portal (Tiers section)
or in the identity response under `included[]/type=tier`.

## 3 · Patreon client settings

In <https://www.patreon.com/portal/registration/register-clients> open your
client ("Ceneaura") and add this **exact** redirect URI — it must match the
page URL one-to-one:

```
https://<your-domain>/codeactivation.html
```

The page prints it to the DevTools console every load, so the registerings
host are always in scope.

The OAuth flow uses the scopes `identity identity.memberships identity[email]`
so Patreon can prove the buyer is an active, paid-up member of **your**
campaign — and nothing else.

## 4 · Filling the stock

Only points serials are handed out here — the rows of `point_codes` (see
`sql/point_codes.sql`):

```sql
select * from public.point_codes_generate(10, 500,  'Patreon - 500 points');
select * from public.point_codes_generate(10, 1000, 'Patreon - 1000 points');
select * from public.point_codes_generate(10, 2000, 'Patreon - 2000 points');
```

Keep the values matched to your Patreon tier prices (1 point = 1 cent at the
default rate → a $5 tier wants 500-point serials in stock). The claim picks
the exact value the tier settled on (`tier map points → tier map price_cents →
currently_entitled_amount_cents`, converted by the same ×rate equality the
dashboard shop uses) — with no numbers pinned, any available serial goes.
When the stock runs out the buyer sees “sold out — contact support”, and
`patreon_claims` tells you exactly who claimed which code.

## 5 · Security notes

- The OAuth **client secret** must never live in the site's files: the browser
  would hand it to everyone. It lives only in the edge function's environment.
  Because the secret was pasted in chat once, consider rotating it in the
  Patreon portal (Client settings → rotate), then `supabase secrets set` the
  new value — the page itself needs no change (it only ever uses the public
  client id).
- Reservation is a separate `reserved_by` flag, so a delivered serial stays a
  perfectly normal code for `points_code_redeem` — the buyer redeems it in
  Dashboard → Points exactly like any other member, and the same section
  sells memberships for the points he just got.

# 6 · Memberships bought with POINTS (sql/membership_points.sql)

The reward points themselves buy the membership, straight in Dashboard →
Points ("Buy a membership with points"): three plan cards showing the money
price, the points price, and Buy/Extend. **The points price simply equals the
money price** — plan price in points = the plan's dollar price (Silver $5 /
3 mo · Gold $10 / 6 mo · Diamond $20 / 12 mo) × the withdrawal rate (points
per 1 unit of the currency, default 100 → 1 point = 1 cent), so a $5 Silver
is 500 points and a $20 Diamond is 2,000.

- The purchase spends through `_spend_prize` (the same locked check-and-deduct
  the prizes use; every buy is journaled in `point_spends` +
  `membership_purchases`) and activates through `_account_set_plan` (the
  activation codes' own helper) — a plan still running **stacks** the months
  onto its expiry.
- Custom prices: set `membership_points_prices` (JSON, e.g.
  `{"Silver":450,"Gold":900,"Diamond":1800}`) on the `panel_settings` row;
  any plan missing from it falls back to the ×rate equality.
- The shop section hides itself (and every RPC returns
  `{ok:false,reason:'setup'}`) when `prize_secure.sql`/`packages.sql` are not
  in yet, so the file is safe regardless of setup order.

Run `sql/membership_points.sql` in the SQL editor after those two files — the
site picks the new section up with no further change.

**The activation page itself sells the upgrade.** `activate.html` applies the
gate both sides: the very first activation of an account is **Free only**
(`account_code_redeem` refuses activate-mode codes above Free with
`reason: 'first_free'` — rerun `sql/packages.sql` to ship it). Once activated,
the "Activate" tile on the page turns into **Upgrade**, Free never shows
again, and the three premium plans are sold right on the page — the same
points-buy the dashboard uses, one tap — alongside the classic code path.
Reactivation stays available for every plan, Free included.

---

# Social publishing — setup (sql/platforms.sql + platform-publish)

1. Run `sql/platforms.sql` in the Supabase SQL editor **once** (idempotent). It
   creates `platform_settings` (per network: enabled, page URL, publish day,
   API credentials — staff-only through RPCs) and `platform_posts` (the queue),
   and seeds your 13 accounts from Platforms.txt.
2. Panel > **Settings > Social platforms API**: paste the network's API
   credentials (write-only) and, when you want, dedicate a weekday. Networks
   without a public posting API (Quora, Rumble, Odysee, bilibili, Snapchat)
   work through the **Webhook URL** field — Zapier / Make / n8n receives the
   full payload and bridges them — and every other network may use a webhook
   instead of native credentials.
3. Panel > **Platforms**: title, description, tags, a media URL — or upload
   straight there; images land in `source/Platforms/Photos`, videos in
   `source/Platforms/Videos`, both public, ready for the networks to pull.
4. The footer of the home page shows the enabled networks (`platforms_public()`).
5. Deploy the sender **without gateway JWT verification**; the function validates a
   short-lived HMAC proof against a secret held in Supabase Vault before it can
   read or publish queue rows. Do not remove that in-function check:

```bash
supabase functions deploy platform-publish --no-verify-jwt
```

6. Run `sql/platform_publish_schedule.sql` once after deploying the function. It
   enables `pg_net`, creates a random signing secret directly in Vault, grants
   the verifier RPC to `service_role` only, and installs/replaces the daily 09:00
   UTC `pg_cron` job. It does not put a service-role key or signing secret in the
   SQL file or cron command. Supabase injects its standard URL/service key into
   Edge Functions; do not copy those values into the repository.

The endpoint rejects unsigned requests. The cron job calls it with a rotating
five-minute proof and publishes at most 20 due posts per run. Only platforms
with valid credentials (or a webhook URL) can publish; others report their
credential/API error in Panel > Platforms.


Native publishers: YouTube (OAuth refresh token), Facebook page/group
(photo & video), Instagram Business (container), TikTok (Pull-from-URL),
Telegram bot, Reddit (OAuth), Pinterest, Tumblr (NPF), Vimeo (pull), Threads —
X stays on the webhook until OAuth1 media uploading lands. A network is due
on its `publish_day` (or every run when empty); results land back per network
in each queue row and Panel > Platforms shows them.
