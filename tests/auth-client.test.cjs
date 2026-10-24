"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const { create, SESSION_KEY } = require("../js/auth.js");

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status });
const session = (suffix = "a", extra = {}) => ({
  access_token: `access-${suffix}`, refresh_token: `refresh-${suffix}`, expires_in: 3600,
  user: { id: `uuid-${suffix}`, email: `${suffix}@example.test` }, ...extra,
});
function harness(handler, options = {}) {
  const calls = [];
  const localStorage = options.localStorage || new MemoryStorage();
  const sessionStorage = options.sessionStorage || new MemoryStorage();
  const handlers = new Map();
  const env = {
    localStorage, sessionStorage, crypto: webcrypto,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    location: new URL(options.url || "https://cineaura.example/register.html"),
    history: { state: null, replaceState(_state, _title, value) { env.location = new URL(value, env.location); } },
    addEventListener(event, callback) { handlers.set(event, callback); },
  };
  const auth = create({
    url: "https://project.supabase.co", key: "sb_publishable_test", env,
    now: options.now || (() => 1_800_000_000_000),
    fetch: async (url, request) => {
      const call = { url: new URL(url), ...request, headers: new Headers(request.headers) };
      if (request.body && typeof request.body === "string") call.json = JSON.parse(request.body);
      calls.push(call);
      return handler(call, calls);
    },
  });
  return { auth, calls, env, localStorage, sessionStorage, handlers };
}

// These are transport/provider-fixture tests, NOT proof of live email delivery or
// cryptographic JWT verification. PostgreSQL role/RLS tests live in security-db.
test("guests send only the project API key, never an API key as a Bearer", async () => {
  const h = harness(() => reply([]));
  await h.auth.fetch("/rest/v1/member_directory", { headers: { Authorization: "Bearer forged", apikey: "wrong-project" } });
  assert.equal(h.calls[0].headers.get("Authorization"), null);
  assert.equal(h.calls[0].headers.get("apikey"), "sb_publishable_test");
  assert.equal(h.calls[0].redirect, "error");
});

test("password sign-in uses GoTrue, stores no password and honors session-only persistence", async () => {
  const h = harness(({ url }) => url.pathname.startsWith("/auth/") ? reply(session()) : reply([]));
  await h.auth.signIn("  A@EXAMPLE.TEST ", "not-stored-anywhere", false);
  assert.equal(h.calls[0].url.pathname, "/auth/v1/token");
  assert.equal(h.calls[0].url.searchParams.get("grant_type"), "password");
  assert.deepEqual(h.calls[0].json, { email: "a@example.test", password: "not-stored-anywhere" });
  assert.equal(h.localStorage.getItem(SESSION_KEY), null);
  assert.ok(h.sessionStorage.getItem(SESSION_KEY));
  assert.ok(!h.sessionStorage.getItem(SESSION_KEY).includes("not-stored-anywhere"));
  await h.auth.fetch("/rest/v1/rpc/member_auth_bind", { method: "POST", headers: { Authorization: "Bearer obsolete-key" } });
  assert.equal(h.calls[1].headers.get("Authorization"), "Bearer access-a");
});

test("legacy display metadata alone is not an Auth session", async () => {
  const h = harness(() => reply([]));
  h.localStorage.setItem("cineaura_session", JSON.stringify({ member_id: "ID1", role: "super" }));
  assert.equal(h.auth.peekSession(), null);
  assert.equal(await h.auth.accessToken(), null);
});

test("failed sign-in has no database/legacy fallback and creates no session", async () => {
  const h = harness(() => reply({ error_code: "invalid_credentials" }, 400));
  await assert.rejects(h.auth.signIn("a@example.test", "wrong-password"), { code: "invalid_credentials" });
  assert.equal(h.calls.length, 1);
  assert.equal(h.auth.peekSession(), null);
});

test("signup requires a strong password and an email, before making a request", async () => {
  const h = harness(() => reply({}));
  for (const password of ["short", "x".repeat(257)]) await assert.rejects(h.auth.signUp("a@example.test", password), { code: "weak_password" });
  await assert.rejects(h.auth.signIn("username-only", "password"), { code: "invalid_email" });
  assert.equal(h.calls.length, 0);
});

test("signup is PKCE/email-confirmed and never creates a premature member session", async () => {
  const h = harness(() => reply({ id: "auth-created-but-unconfirmed" }));
  const result = await h.auth.signUp("a@example.test", "long-new-password", { username: "cinefan" });
  assert.deepEqual(result, { confirmationRequired: true });
  const call = h.calls[0];
  const redirect = new URL(call.url.searchParams.get("redirect_to"));
  assert.equal(redirect.origin, "https://cineaura.example");
  assert.equal(redirect.pathname, "/login.html");
  const state = redirect.searchParams.get("auth_state");
  assert.match(state, /^[A-Za-z0-9_-]{24}$/);
  const tx = JSON.parse(h.localStorage.getItem("cineaura_auth_pkce_" + state));
  assert.equal(tx.flow, "signup");
  assert.equal(call.json.code_challenge_method, "s256");
  const expected = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(tx.verifier))).toString("base64url");
  assert.equal(call.json.code_challenge, expected);
  assert.equal(h.auth.peekSession(), null);
  assert.ok(![...h.localStorage.values.values()].join("").includes("long-new-password"));
});

test("an accidentally auto-confirming signup is refused rather than trusting it", async () => {
  const h = harness(() => reply(session()));
  await assert.rejects(h.auth.signUp("a@example.test", "long-new-password"), { code: "email_confirmation_required" });
  assert.equal(h.auth.peekSession(), null);
  assert.equal(h.localStorage.values.size, 0);
});

test("PKCE recovery works across tabs in the requesting browser and removes URL credentials", async () => {
  const first = harness(() => reply({}));
  await first.auth.requestRecovery("a@example.test");
  const redirect = new URL(first.calls[0].url.searchParams.get("redirect_to"));
  assert.equal(redirect.pathname, "/rest.html");
  redirect.searchParams.set("code", "one-time-auth-code");
  const second = harness(() => reply(session()), { localStorage: first.localStorage, url: redirect.href });
  assert.deepEqual(await second.auth.completeRedirect(), { flow: "recovery" });
  assert.equal(second.calls.length, 1);
  assert.equal(second.calls[0].url.searchParams.get("grant_type"), "pkce");
  assert.equal(second.calls[0].json.auth_code, "one-time-auth-code");
  assert.ok(second.calls[0].json.code_verifier);
  assert.equal(second.env.location.search, "");
  assert.equal(second.auth.peekSession().user.id, "uuid-a");
  await second.auth.completeRedirect();
  assert.equal(second.calls.length, 1, "duplicate callback handlers share one exchange");
});

test("injected, missing-verifier, expired and future-dated callbacks are rejected", async () => {
  const implicit = harness(() => reply(session()), { url: "https://cineaura.example/login.html#access_token=attacker&refresh_token=x" });
  await assert.rejects(implicit.auth.completeRedirect(), { code: "unsupported_auth_callback" });
  assert.equal(implicit.auth.peekSession(), null);
  for (const age of [null, 3_600_001, -1000]) {
    const state = "a".repeat(24);
    const h = harness(() => reply(session()), { url: `https://cineaura.example/login.html?code=x&auth_state=${state}` });
    if (age !== null) h.localStorage.setItem("cineaura_auth_pkce_" + state, JSON.stringify({ flow: "signup", verifier: "a".repeat(43), created: 1_800_000_000_000 - age }));
    await assert.rejects(h.auth.completeRedirect(), { code: "invalid_auth_callback" });
    assert.equal(h.calls.length, 0);
    assert.equal(h.env.location.search, "");
  }
});


test("malformed PKCE transaction metadata cannot produce a provider exchange", async () => {
  const state = "b".repeat(24);
  const valid = { flow: "signup", verifier: "a".repeat(43), created: 1_800_000_000_000 };
  for (const override of [{ flow: "injected" }, { verifier: "short" }, { created: "1800000000000" }, { created: null }]) {
    const h = harness(() => reply(session()), { url: `https://cineaura.example/login.html?code=x&auth_state=${state}` });
    h.localStorage.setItem("cineaura_auth_pkce_" + state, JSON.stringify({ ...valid, ...override }));
    await assert.rejects(h.auth.completeRedirect(), { code: "invalid_auth_callback" });
    assert.equal(h.calls.length, 0);
    assert.equal(h.localStorage.getItem("cineaura_auth_pkce_" + state), null);
  }
});

test("tokens are not attached to another origin or a non-API project URL", async () => {
  const h = harness(() => reply(session()));
  await h.auth.signIn("a@example.test", "long-password");
  for (const path of ["https://attacker.example/rest/v1/members", "//attacker.example/rest/v1/members", "https://project.supabase.co.evil.test/rest/v1/", "/not-an-api"]) {
    await assert.rejects(h.auth.fetch(path), { code: "invalid_auth_endpoint" });
  }
  assert.equal(h.calls.length, 1);
});

test("expired sessions refresh once for concurrent requests and rotate refresh tokens", async () => {
  let renewals = 0;
  const h = harness(async ({ url }) => {
    if (url.pathname === "/auth/v1/token") {
      if (url.searchParams.get("grant_type") === "password") return reply(session("a", { expires_in: 10 }));
      renewals += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return reply(session("renewed", { user: session("a").user }));
    }
    return reply([]);
  });
  await h.auth.signIn("a@example.test", "long-password");
  await Promise.all(Array.from({ length: 12 }, () => h.auth.fetch("/rest/v1/messages")));
  assert.equal(renewals, 1);
  assert.equal(h.auth.peekSession().refresh_token, "refresh-renewed");
  for (const call of h.calls.filter((c) => c.url.pathname.startsWith("/rest/"))) assert.equal(call.headers.get("Authorization"), "Bearer access-renewed");
});

test("a rejected JWT is refreshed/retried once, not indefinitely", async () => {
  let tokenCalls = 0;
  const h = harness(({ url }) => {
    if (url.pathname === "/auth/v1/token") return reply(session(String(++tokenCalls), { user: session("a").user }));
    return reply({ message: "JWT rejected" }, 401);
  });
  await h.auth.signIn("a@example.test", "password");
  const response = await h.auth.fetch("/rest/v1/messages");
  assert.equal(response.status, 401);
  assert.equal(tokenCalls, 2);
  assert.equal(h.calls.filter((call) => call.url.pathname === "/rest/v1/messages").length, 2);
});

test("failed writes are never replayed on 5xx or network failures", async () => {
  for (const failure of ["server", "network"]) {
    const h = harness(({ url }) => {
      if (url.pathname.startsWith("/auth/")) return reply(session());
      if (failure === "network") throw new Error("offline");
      return reply({}, 503);
    });
    await h.auth.signIn("a@example.test", "password");
    const write = h.auth.fetch("/rest/v1/rpc/membership_buy_with_points", { method: "POST", body: "{}" });
    if (failure === "network") await assert.rejects(write, /offline/);
    else assert.equal((await write).status, 503);
    assert.equal(h.calls.length, 2);
  }
});

test("invalid refresh logs out; transient outages keep a recoverable session", async () => {
  for (const status of [400, 503]) {
    const h = harness(({ url }) => url.searchParams.get("grant_type") === "password" ? reply(session("a", { expires_in: 1 })) : reply({}, status));
    await h.auth.signIn("a@example.test", "password");
    await assert.rejects(h.auth.accessToken());
    assert.equal(Boolean(h.auth.peekSession()), status === 503);
  }
});

test("logout clears immediately even offline and a late refresh cannot resurrect it", async () => {
  let release;
  const h = harness(({ url }) => {
    if (url.searchParams.get("grant_type") === "password") return reply(session("a", { expires_in: 1 }));
    if (url.searchParams.get("grant_type") === "refresh_token") return new Promise((resolve) => { release = () => resolve(reply(session("late"))); });
    throw new Error("offline");
  });
  await h.auth.signIn("a@example.test", "password");
  const renewal = h.auth.accessToken();
  await new Promise((resolve) => setImmediate(resolve));
  await h.auth.signOut();
  assert.equal(h.auth.peekSession(), null);
  release();
  assert.equal(await renewal, null);
  assert.equal(h.auth.peekSession(), null);
});

test("native credential updates use the verified user endpoint, not member-table PATCH", async () => {
  const h = harness(({ url }) => url.pathname === "/auth/v1/user" ? reply({ id: "uuid-a", email: "a@example.test", email_change_sent_at: "now" }) : reply(session()));
  await h.auth.signIn("a@example.test", "password");
  await h.auth.updateUser({ password: "new-long-password", email: "new@example.test", member_id: "ID999", role: "super" });
  const call = h.calls[1];
  assert.equal(call.url.pathname, "/auth/v1/user");
  assert.equal(call.method, "PUT");
  assert.equal(call.headers.get("Authorization"), "Bearer access-a");
  assert.equal(call.json.password, "new-long-password");
  assert.equal(call.json.email, "new@example.test");
  assert.equal(call.json.code_challenge_method, "s256");
  assert.ok(call.json.code_challenge);
  assert.equal(call.json.role, undefined);
  assert.equal(call.json.member_id, undefined);
  assert.equal(new URL(call.url.searchParams.get("redirect_to")).pathname, "/login.html");
  assert.equal(h.auth.peekSession().user.email, "a@example.test", "unconfirmed address is not promoted in the cache");
});

test("payout reauthentication verifies the current Auth user's password with GoTrue", async () => {
  const h = harness(() => reply(session()));
  await h.auth.signIn("a@example.test", "password", false);
  await h.auth.reauthenticate("fresh-password");
  assert.deepEqual(h.calls[1].json, { email: "a@example.test", password: "fresh-password" });
  assert.equal(h.auth.peekSession().stay, false);
});


test("side-effecting Edge requests are not replayed on a provider's 401", async () => {
  const h = harness(({ url }) => url.pathname.startsWith("/auth/") ? reply(session()) : reply({ reason: "provider_auth" }, 401));
  await h.auth.signIn("a@example.test", "password");
  const response = await h.auth.fetch("/functions/v1/patreon-claim", { method: "POST", body: JSON.stringify({ code: "single-use-oauth-code" }) });
  assert.equal(response.status, 401);
  assert.equal(h.calls.length, 2);
});

test("a rejected request cannot be replayed under a different signed-in identity", async () => {
  let release;
  const h = harness(({ url, json }) => {
    if (url.pathname.startsWith("/auth/")) return reply(session(json.email.startsWith("b@") ? "b" : "a"));
    return new Promise(resolve => { release = () => resolve(reply({}, 401)); });
  });
  await h.auth.signIn("a@example.test", "password");
  const write = h.auth.fetch("/rest/v1/rpc/member_account_update", { method: "POST", body: JSON.stringify({ p_full_name: "Account A name" }) });
  await new Promise(resolve => setImmediate(resolve));
  await h.auth.signIn("b@example.test", "other-password");
  release();
  assert.equal((await write).status, 401);
  assert.equal(h.calls.filter(call => call.url.pathname.startsWith("/rest/")).length, 1);
  assert.equal(h.auth.peekSession().user.id, "uuid-b");
});

test("identity changes during preflight refresh cancel a write before it is sent", async () => {
  let release;
  const h = harness(({ url, json }) => {
    if (url.searchParams.get("grant_type") === "refresh_token") return new Promise(resolve => { release = () => resolve(reply(session("late-a"))); });
    if (url.pathname.startsWith("/auth/")) return reply(session(json.email.startsWith("b@") ? "b" : "a", { expires_in: json.email.startsWith("b@") ? 3600 : 1 }));
    return reply({});
  });
  await h.auth.signIn("a@example.test", "password");
  const write = h.auth.fetch("/rest/v1/rpc/member_account_update", { method: "POST", body: "{}" });
  await new Promise(resolve => setImmediate(resolve));
  await h.auth.signIn("b@example.test", "other-password");
  release();
  await assert.rejects(write, { code: "auth_request_cancelled" });
  assert.equal(h.calls.filter(call => call.url.pathname.startsWith("/rest/")).length, 0);
  assert.equal(h.auth.peekSession().user.id, "uuid-b");
});

test("identity changes during a 401 refresh prevent replay and preserve the new session", async () => {
  let release;
  const h = harness(({ url, json }) => {
    if (url.searchParams.get("grant_type") === "refresh_token") return new Promise(resolve => { release = () => resolve(reply(session("late-a"))); });
    if (url.pathname.startsWith("/auth/")) return reply(session(json.email.startsWith("b@") ? "b" : "a"));
    return reply({}, 401);
  });
  await h.auth.signIn("a@example.test", "password");
  const write = h.auth.fetch("/rest/v1/rpc/member_account_update", { method: "POST", body: "{}" });
  await new Promise(resolve => setImmediate(resolve));
  await h.auth.signIn("b@example.test", "other-password");
  release();
  assert.equal((await write).status, 401);
  assert.equal(h.calls.filter(call => call.url.pathname.startsWith("/rest/")).length, 1);
  assert.equal(h.auth.peekSession().user.id, "uuid-b");
});

test("payout reauthentication cannot change identity when a cached email has a new owner", async () => {
  let logins = 0;
  const h = harness(() => reply(session(++logins === 1 ? "a" : "b")));
  await h.auth.signIn("a@example.test", "password");
  await assert.rejects(h.auth.reauthenticate("password"), { code: "authentication_identity_changed" });
  assert.equal(h.auth.peekSession().user.id, "uuid-a");
});


test("token refresh cannot substitute another Auth identity", async () => {
  const h = harness(({ url }) => url.searchParams.get("grant_type") === "password" ? reply(session("a", { expires_in: 1 })) : reply(session("b")));
  await h.auth.signIn("a@example.test", "password");
  await assert.rejects(h.auth.accessToken(), { code: "invalid_auth_session" });
  assert.equal(h.auth.peekSession(), null);
});
