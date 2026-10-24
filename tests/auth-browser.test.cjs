"use strict";
// Actual static pages in Chromium. ALL requests (including Supabase/Auth/email
// providers) are intercepted. No live account, message or payment is touched.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium: playwright } = require("playwright-core");
const ROOT = path.resolve(__dirname, "..");
const BASE = "https://cineaura.test";
const IDENTITY = "10000000-0000-4000-8000-000000000001";
const member = { auth_user_id: IDENTITY, member_id: "ID101", username: "fixture_member", full_name: "Fixture Member", email: "fixture@example.test", status: "active", membership_type: "Free" };
const providerSession = () => ({ access_token: "fixture-access-token", refresh_token: "fixture-refresh-token", expires_in: 3600, user: { id: IDENTITY, email: member.email } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
const json = (route, value, status = 200) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(value) });
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };

(async () => {
  let launch = { headless: true };
  if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  else {
    const chromium = require("@sparticuz/chromium");
    const binaryRoot = path.resolve(path.dirname(require.resolve("@sparticuz/chromium")), "../bin");
    await chromium.inflate(path.join(binaryRoot, "al2023.tar.br"));
    chromium.setupLambdaEnvironment("/tmp/al2023/lib");
    launch = {
      ...launch, executablePath: await chromium.default.executablePath(),
      args: chromium.default.args.filter((arg) => !arg.startsWith("--disable-web-security") && !arg.startsWith("--allow-running-insecure-content") && arg !== "--single-process" && arg !== "--disable-site-isolation-trials")
        .map((arg) => arg.startsWith("--disable-features=") ? "--disable-features=AudioServiceOutOfProcess" : arg),
    };
  }
  let browser = null;
  let browserVersion = "";
  let passed = 0;
  async function check(name, callback, options = {}) {
    if (process.env.AUTH_SCENARIO && !name.includes(process.env.AUTH_SCENARIO)) return;
    // A fresh process prevents serverless Chromium context-lifecycle crashes from
    // contaminating later scenarios. Cookies/storage are isolated as well.
    browser = await playwright.launch(launch);
    browserVersion = browser.version();
    const context = await browser.newContext({ serviceWorkers: "block", locale: options.language === "ar" ? "ar-MA" : "en-US", viewport: options.mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
    const requests = [];
    const pageErrors = [];
    const fixture = { bindReason: null, bindFailures: 0, stubDestination: false };
    await context.addInitScript(({ storage, language }) => {
      if (location.origin !== "https://cineaura.test") return;
      if (!localStorage.getItem("auth-test-initialized")) {
        localStorage.setItem("auth-test-initialized", "yes");
        localStorage.setItem("cineaura_settings_welcomed", "1");
        localStorage.setItem("cineaura_lang", language);
        for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
      }
    }, { storage: options.storage || {}, language: options.language || "en" });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (url.origin === BASE) {
        if (fixture.stubDestination && url.pathname === "/dashboard.html") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Auth redirect test destination</title>" });
        const file = path.resolve(ROOT, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
        if (!file.startsWith(ROOT + path.sep) || !mime[path.extname(file)]) return route.fulfill({ status: 404, body: "Not found" });
        try { return await route.fulfill({ contentType: mime[path.extname(file)], body: await fs.readFile(file) }); }
        catch { return route.fulfill({ status: 404, body: "Not found" }); }
      }
      if (url.hostname.endsWith(".supabase.co")) {
        const body = request.postDataJSON();
        const call = { path: url.pathname, url, method: request.method(), headers: request.headers(), body };
        requests.push(call);
        if (url.pathname === "/auth/v1/token") {
          if (body.password === "wrong-password") return json(route, { error_code: "invalid_credentials" }, 400);
          return json(route, providerSession());
        }
        if (url.pathname === "/auth/v1/signup") return json(route, { id: IDENTITY, email: body.email });
        if (["/auth/v1/recover", "/auth/v1/logout"].includes(url.pathname)) return json(route, {});
        if (url.pathname === "/auth/v1/user") return json(route, { id: IDENTITY, email: member.email });
        if (url.pathname === "/rest/v1/rpc/member_auth_bind") {
          if (call.headers.authorization !== "Bearer fixture-access-token") return json(route, { message: "JWT required" }, 401);
          if (fixture.bindReason && fixture.bindFailures !== 0) {
            fixture.bindFailures -= 1;
            return json(route, { ok: false, reason: fixture.bindReason });
          }
          return json(route, { ok: true, member });
        }
        if (url.pathname === "/rest/v1/profile_directory") return json(route, [{ member_id: member.member_id, username: member.username, language: "en", theme: "night", style: "default", avatar_url: "", display_name: member.full_name }]);
        if (url.pathname === "/rest/v1/member_directory") return json(route, [member]);
        if (url.pathname.includes("/rpc/")) return json(route, { ok: false, reason: "fixture_unused_rpc" });
        return json(route, []);
      }
      if (request.resourceType() === "stylesheet") return route.fulfill({ contentType: "text/css", body: "" });
      if (request.resourceType() === "script") return route.fulfill({ contentType: "application/javascript", body: "" });
      if (request.resourceType() === "image") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>' });
      if (url.hostname.includes("themoviedb.org")) return json(route, { results: [], genres: [], cast: [], crew: [], credits: { cast: [], crew: [] } });
      return json(route, { country_code: "MA", countryCode: "MA", country: "MA" });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(15000);
    try {
      await callback({ page, context, requests, fixture });
      assert.deepEqual(pageErrors, [], "no unhandled browser errors");
      passed += 1;
      console.log(`ok ${passed} - ${name}`);
    } catch (error) {
      console.error("Auth scenario diagnostics:", name, page.url(), pageErrors);
      console.error(await page.evaluate(() => ({ state: document.readyState, title: document.title, alert: document.querySelector("#form-alert")?.textContent })));
      throw error;
    } finally {
      try { await context.close(); } finally { await browser.close(); browser = null; }
    }
  }
  try {
    await check("a forged legacy localStorage member is not signed in", async ({ page }) => {
      await page.goto(`${BASE}/login.html`);
      assert.equal(await page.evaluate(() => CineAura.getSession()), null);
      assert.equal(await page.locator("body").evaluate((body) => body.classList.contains("is-guest")), true);
      assert.equal(await page.locator("#success-card").isVisible(), false);
      assert.equal(await page.locator('input[name="login"]').getAttribute("type"), "email");
    }, { storage: { cineaura_session: JSON.stringify({ member_id: "ID999", role: "super" }) } });

    await check("a failed native login does not fall back to public credential rows or legacy RPCs", async ({ page, requests }) => {
      await page.goto(`${BASE}/login.html`);
      await page.locator('input[name="login"]').fill(member.email);
      await page.locator('input[name="password"]').fill("wrong-password");
      await page.locator("#submit-btn").click();
      await page.waitForFunction(() => document.querySelector("#form-alert").classList.contains("error"));
      assert.equal(await page.locator("#success-card").isVisible(), false);
      assert.equal(await page.evaluate(() => CineAura.auth.peekSession()), null);
      assert.ok(!requests.some((request) => /login_member|reset_password_with_recovery|\/members$/.test(request.path)));
    });

    await check("native sign-in binds the server member and honors session-only login", async ({ page, requests }) => {
      await page.goto(`${BASE}/login.html`);
      await page.locator('input[name="login"]').fill(member.email);
      await page.locator('input[name="password"]').fill("fixture-long-password");
      await page.locator('input[name="stay"]').uncheck();
      await page.locator("#submit-btn").click();
      await page.locator("#success-card").waitFor({ state: "visible" });
      const cached = await page.evaluate(() => ({ member: CineAura.getSession(), persistent: localStorage.getItem("cineaura_auth_v1"), temporary: sessionStorage.getItem("cineaura_auth_v1") }));
      assert.equal(cached.member.member_id, "ID101");
      assert.equal(cached.member.auth_user_id, IDENTITY);
      assert.equal(cached.persistent, null);
      assert.ok(cached.temporary);
      assert.equal(await page.locator('input[name="password"]').inputValue(), "");
      assert.equal(requests.find((request) => request.path.endsWith("/member_auth_bind")).headers.authorization, "Bearer fixture-access-token");
    });

    await check("legacy migration waits for email PKCE verification, then retains the original member id", async ({ page, requests }) => {
      await page.goto(`${BASE}/register.html?migrate=1`);
      assert.equal(await page.locator('input[name="username"]').isVisible(), false);
      await page.locator('input[name="email"]').fill(member.email);
      await page.locator('input[name="password"]').fill("fixture-new-password");
      await page.locator("#submit-btn").click();
      await page.locator("#success-card").waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => CineAura.getSession()), null);
      const signup = requests.find((request) => request.path === "/auth/v1/signup");
      assert.deepEqual(signup.body.data, { legacy_account: true });
      assert.ok(!requests.some((request) => request.path.endsWith("/member_auth_bind")));
      const callback = new URL(signup.url.searchParams.get("redirect_to"));
      callback.searchParams.set("code", "fixture-pkce-code");
      await page.goto(callback.href);
      await page.locator("#success-card").waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => CineAura.getSession().member_id), "ID101");
      assert.equal(new URL(page.url()).searchParams.has("code"), false);
      const exchange = requests.find((request) => request.url.searchParams.get("grant_type") === "pkce");
      assert.ok(exchange.body.code_verifier);
    });

    await check("a verified new user can correct an unavailable username without a second signup", async ({ page, requests, fixture }) => {
      fixture.bindReason = "username_unavailable";
      fixture.bindFailures = 1;
      fixture.stubDestination = true;
      await page.goto(`${BASE}/register.html`);
      await page.locator('input[name="full_name"]').fill("Fixture New Member");
      await page.locator('input[name="username"]').fill("taken_username");
      await page.locator('input[name="email"]').fill(member.email);
      await page.locator('input[name="password"]').fill("fixture-new-password");
      await page.locator('input[name="birth_date"]').fill("1990-01-01");
      await page.locator('input[name="gender"][value="male"]').locator("..").click();
      await page.waitForFunction(() => Boolean(document.querySelector("#country").value) || !document.querySelector("#country").readOnly);
      if (!(await page.locator("#country").inputValue())) await page.locator("#country").fill("Morocco");
      await page.locator("#submit-btn").click();
      await page.locator("#success-card").waitFor({ state: "visible" });
      const signup = requests.find((request) => request.path === "/auth/v1/signup");
      const callback = new URL(signup.url.searchParams.get("redirect_to"));
      callback.searchParams.set("code", "fixture-pkce-code");
      await page.goto(callback.href);
      await page.waitForURL(`${BASE}/register.html?complete=1`);
      await page.locator('input[name="username"]').fill("available_username");
      await page.locator('input[name="full_name"]').fill("Fixture New Member");
      await page.locator('input[name="birth_date"]').fill("1990-01-01");
      await page.locator('input[name="gender"][value="male"]').locator("..").click();
      await page.waitForFunction(() => Boolean(document.querySelector("#country").value) || !document.querySelector("#country").readOnly);
      if (!(await page.locator("#country").inputValue())) await page.locator("#country").fill("Morocco");
      assert.equal(await page.locator('input[name="password"]').isVisible(), false);
      assert.equal(await page.locator('input[name="email"]').inputValue(), member.email);
      await page.locator("#submit-btn").click();
      await page.waitForURL(`${BASE}/dashboard.html`);
      assert.equal(requests.filter((request) => request.path === "/auth/v1/signup").length, 1);
      const completion = requests.find((request) => request.path === "/auth/v1/user");
      assert.equal(completion.body.data.username, "available_username");
      assert.equal(completion.body.password, undefined);
    });

    await check("password reset needs a verified email callback and uses the native credential endpoint", async ({ page, requests }) => {
      await page.goto(`${BASE}/rest.html`);
      assert.equal(await page.locator("#password-form").isVisible(), false);
      await page.evaluate(() => document.querySelector("#password-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      assert.ok(!requests.some((request) => request.path === "/auth/v1/user"));
      await page.locator("#recovery-email").fill(member.email);
      await page.locator("#code-btn").click();
      await page.waitForFunction(() => document.querySelector("#code-alert").classList.contains("ok"));
      const recovery = requests.find((request) => request.path === "/auth/v1/recover");
      const callback = new URL(recovery.url.searchParams.get("redirect_to"));
      callback.searchParams.set("code", "fixture-recovery-code");
      await page.goto(callback.href);
      await page.locator("#password-form").waitFor({ state: "visible" });
      await page.locator("#new-password").fill("fixture-reset-password");
      await page.locator("#confirm-password").fill("different-password");
      await page.locator("#save-btn").click();
      assert.ok(!requests.some((request) => request.path === "/auth/v1/user"));
      await page.locator("#confirm-password").fill("fixture-reset-password");
      await page.locator("#save-btn").click();
      await page.locator("#success-card").waitFor({ state: "visible" });
      const update = requests.find((request) => request.path === "/auth/v1/user");
      assert.deepEqual(update.body, { password: "fixture-reset-password" });
      assert.equal(update.headers.authorization, "Bearer fixture-access-token");
      assert.equal(await page.evaluate(() => CineAura.auth.peekSession()), null);
      assert.ok(!requests.some((request) => request.path.includes("reset_password_with_recovery")));
    });

    await check("a banned server binding is refused even after a valid native password login", async ({ page, fixture }) => {
      fixture.bindReason = "banned";
      fixture.bindFailures = 1;
      await page.goto(`${BASE}/login.html`);
      await page.locator('input[name="login"]').fill(member.email);
      await page.locator('input[name="password"]').fill("fixture-long-password");
      await page.locator("#submit-btn").click();
      await page.waitForFunction(() => document.querySelector("#form-alert").classList.contains("error"));
      assert.equal(await page.evaluate(() => CineAura.getSession()), null);
      assert.equal(await page.locator("#success-card").isVisible(), false);
    });

    await check("Arabic mobile migration labels use verified email, not legacy recovery codes", async ({ page }) => {
      await page.goto(`${BASE}/register.html?migrate=1`);
      await page.waitForFunction(() => document.querySelector("#register-form h1").textContent.includes("اربط"));
      assert.equal(await page.locator('input[name="username"]').isVisible(), false);
      assert.ok((await page.locator("#register-form .lead").textContent()).includes("النقاط"));
      await page.goto(`${BASE}/rest.html`);
      assert.equal(await page.locator("#recovery-input").count(), 0);
      assert.equal(await page.locator("#recovery-email").getAttribute("type"), "email");
    }, { language: "ar", mobile: true });
    console.log(`\n${passed} Chromium auth scenarios passed (${browserVersion}; every network request intercepted).`);
  } finally { if (browser) await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
