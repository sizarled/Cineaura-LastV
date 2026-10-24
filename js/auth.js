/* Supabase Auth, without a client-side identity/credential fallback.
 * All authorization belongs to verified JWTs + database policies, never the UI cache.
 * Kept dependency-free so the static site and node:test use the same implementation.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.CineAuraAuth = factory;
})(typeof globalThis !== "undefined" ? globalThis : this, (() => {
  "use strict";
  const SESSION_KEY = "cineaura_auth_v1";
  const PKCE_PREFIX = "cineaura_auth_pkce_";
  const PKCE_TTL = 60 * 60 * 1000;
  const MIN_PASSWORD_LENGTH = 12;

  class AuthError extends Error {
    constructor(code, status = 0) {
      super(code);
      this.name = "AuthError";
      this.code = code;
      this.status = status;
    }
  }

  function create(config) {
    const env = config.env || globalThis;
    const fetcher = config.fetch || env.fetch.bind(env);
    const base = new URL(config.url);
    const now = config.now || Date.now;
    const persistent = config.localStorage || env.localStorage;
    const temporary = config.sessionStorage || env.sessionStorage;
    let refreshing = null;
    let callbackPromise = null;
    let revision = 0;
    const listeners = new Set();

    function read(storage, key) {
      try { return JSON.parse(storage.getItem(key) || "null"); } catch { return null; }
    }
    function stored() {
      return read(temporary, SESSION_KEY) || read(persistent, SESSION_KEY);
    }
    function peekSession() {
      const value = stored();
      if (!value || !value.access_token || !value.refresh_token || !value.user?.id) return null;
      return value;
    }
    function emit() {
      for (const listener of listeners) listener(peekSession());
    }
    function clear() {
      revision += 1;
      persistent.removeItem(SESSION_KEY);
      temporary.removeItem(SESSION_KEY);
      emit();
    }
    function save(data, stay) {
      if (!data?.access_token || !data.refresh_token || !data.user?.id) throw new AuthError("invalid_auth_session");
      // Supabase's server response is the only source of token/session state.
      const value = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Number(data.expires_at) || Math.floor(now() / 1000) + Number(data.expires_in || 3600),
        user: { id: data.user.id, email: data.user.email || "" },
        stay: Boolean(stay),
      };
      persistent.removeItem(SESSION_KEY);
      temporary.removeItem(SESSION_KEY);
      (stay ? persistent : temporary).setItem(SESSION_KEY, JSON.stringify(value));
      emit();
      return value;
    }
    function endpoint(path) {
      const url = new URL(path, base);
      // Tokens must NEVER leave this project's API, including through a caller's URL.
      if (url.origin !== base.origin || !/^\/(auth|rest|storage|functions)\/v1(?:\/|$)/.test(url.pathname)) {
        throw new AuthError("invalid_auth_endpoint");
      }
      return url.href;
    }
    async function json(response) {
      const text = await response.text();
      try { return text ? JSON.parse(text) : null; } catch { return null; }
    }
    async function authRequest(path, body, options = {}) {
      const headers = { apikey: config.key, "Content-Type": "application/json", Accept: "application/json" };
      if (options.token) headers.Authorization = `Bearer ${options.token}`;
      const response = await fetcher(endpoint(`/auth/v1/${path}`), {
        method: options.method || "POST", headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // Do not forward credentials to a redirect, even on misconfigured infrastructure.
        redirect: "error",
      });
      const data = await json(response);
      if (!response.ok) throw new AuthError(data?.error_code || data?.code || "auth_request_failed", response.status);
      return data;
    }
    async function refresh(force = false) {
      const current = peekSession();
      if (!current) return null;
      if (!force && current.expires_at * 1000 > now() + 60000) return current;
      if (refreshing) return refreshing;
      const startRevision = revision;
      refreshing = (async () => {
        try {
          const data = await authRequest("token?grant_type=refresh_token", { refresh_token: current.refresh_token });
          if (startRevision !== revision) return peekSession(); // logout/sign-in wins over a late refresh
          if (data?.user?.id !== current.user.id) throw new AuthError("invalid_auth_session", 401);
          return save(data, current.stay);
        } catch (error) {
          // A transient outage must not destroy a recoverable session.
          if (startRevision === revision && (error.status === 400 || error.status === 401 || error.status === 403)) clear();
          throw error;
        } finally { refreshing = null; }
      })();
      return refreshing;
    }
    async function accessToken() { return (await refresh())?.access_token || null; }
    async function headers(extra = {}) {
      const result = new Headers(extra);
      // Ignore stale/forged Bearers supplied by legacy page code.
      result.delete("Authorization");
      result.set("apikey", config.key);
      const token = await accessToken();
      if (token) result.set("Authorization", `Bearer ${token}`);
      return result;
    }
    async function apiFetch(path, options = {}) {
      const url = endpoint(path); // validate BEFORE looking up tokens
      const requestRevision = revision;
      const requestIdentity = peekSession()?.user.id || null;
      const firstToken = await accessToken();
      if (requestRevision !== revision || (peekSession()?.user.id || null) !== requestIdentity) {
        throw new AuthError("auth_request_cancelled");
      }
      const requestHeaders = new Headers(options.headers || {});
      requestHeaders.delete("Authorization");
      requestHeaders.set("apikey", config.key);
      if (firstToken) requestHeaders.set("Authorization", `Bearer ${firstToken}`);
      let response = await fetcher(url, { ...options, headers: requestHeaders, redirect: "error" });
      const method = String(options.method || "GET").toUpperCase();
      const mayRetry = !new URL(url).pathname.startsWith("/functions/v1/") || ["GET", "HEAD"].includes(method);
      if (response.status === 401 && firstToken && mayRetry && requestRevision === revision
          && peekSession()?.user.id === requestIdentity) {
        // Retry a rejected API JWT once, never a failed write on 5xx/network
        // failure or a side-effecting Edge call. An Edge 401 may come from its
        // provider after work was already done. Never replay as another user.
        let renewed = peekSession();
        if (renewed?.access_token === firstToken) renewed = await refresh(true);
        if (renewed && requestRevision === revision && renewed.user.id === requestIdentity) {
          requestHeaders.set("Authorization", `Bearer ${renewed.access_token}`);
          response = await fetcher(url, { ...options, headers: requestHeaders, redirect: "error" });
        }
      }
      return response;
    }
    function validPassword(password) {
      if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH || password.length > 256) {
        throw new AuthError("weak_password");
      }
      return password;
    }
    function email(value) {
      const result = String(value || "").trim().toLowerCase();
      if (result.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new AuthError("invalid_email");
      return result;
    }
    function base64url(bytes) {
      return env.btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    async function transaction(flow, callback, stay) {
      const target = new URL(callback, env.location.href);
      if (target.origin !== env.location.origin) throw new AuthError("invalid_redirect");
      const verifier = base64url(env.crypto.getRandomValues(new Uint8Array(32)));
      const state = base64url(env.crypto.getRandomValues(new Uint8Array(18)));
      const challenge = base64url(new Uint8Array(await env.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      // Local storage intentionally supports an email link opened in a new tab.
      // Only the verifier is stored here, never a password or legacy recovery code.
      persistent.setItem(PKCE_PREFIX + state, JSON.stringify({ verifier, flow, stay, created: now() }));
      target.searchParams.set("auth_state", state);
      return { state, challenge, redirect: target.href };
    }
    async function signIn(address, password, stay = true) {
      revision += 1;
      const startRevision = revision;
      const data = await authRequest("token?grant_type=password", { email: email(address), password: String(password || "") });
      if (startRevision !== revision) throw new AuthError("auth_request_cancelled");
      return save(data, stay);
    }
    async function signUp(address, password, metadata = {}, stay = true) {
      validPassword(password);
      const tx = await transaction("signup", "./login.html", stay);
      try {
        const data = await authRequest(`signup?redirect_to=${encodeURIComponent(tx.redirect)}`, {
          email: email(address), password,
          // This is only registration input. SQL independently validates it and
          // NEVER accepts an id, role, points, plan or status from user_metadata.
          data: metadata, code_challenge: tx.challenge, code_challenge_method: "s256",
        });
        if (data?.access_token) {
          // Refuse an accidentally configured auto-confirm deployment. Email
          // ownership is mandatory for claiming any legacy account.
          throw new AuthError("email_confirmation_required");
        }
        return { confirmationRequired: true };
      } catch (error) {
        persistent.removeItem(PKCE_PREFIX + tx.state);
        throw error;
      }
    }
    async function requestRecovery(address) {
      const tx = await transaction("recovery", "./rest.html", true);
      try {
        await authRequest(`recover?redirect_to=${encodeURIComponent(tx.redirect)}`, {
          email: email(address), code_challenge: tx.challenge, code_challenge_method: "s256",
        });
        return { confirmationRequired: true };
      } catch (error) {
        persistent.removeItem(PKCE_PREFIX + tx.state);
        throw error;
      }
    }
    function completeRedirect() {
      if (callbackPromise) return callbackPromise;
      callbackPromise = (async () => {
        const url = new URL(env.location.href);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const state = url.searchParams.get("auth_state") || "";
        // Do not import implicit-flow access tokens from a URL: that enables
        // login-CSRF/session injection. This client accepts our PKCE flows only.
        if (/(?:^#|&)access_token=/.test(url.hash)) {
          env.history.replaceState(env.history.state, "", `${url.pathname}${url.search}`);
          throw new AuthError("unsupported_auth_callback");
        }
        if (!code && !error) return null;
        const tx = /^[A-Za-z0-9_-]{24}$/.test(state) ? read(persistent, PKCE_PREFIX + state) : null;
        // Remove short-lived credentials and provider error text from history.
        for (const key of ["code", "auth_state", "error", "error_code", "error_description"]) url.searchParams.delete(key);
        env.history.replaceState(env.history.state, "", `${url.pathname}${url.search}${url.hash}`);
        if (error || !tx || !["signup", "recovery", "email_change"].includes(tx.flow)
            || !/^[A-Za-z0-9_-]{43}$/.test(tx.verifier || "") || !Number.isFinite(tx.created)
            || now() - tx.created < 0 || now() - tx.created > PKCE_TTL) {
          if (state) persistent.removeItem(PKCE_PREFIX + state);
          throw new AuthError("invalid_auth_callback");
        }
        persistent.removeItem(PKCE_PREFIX + state);
        const startRevision = ++revision;
        const data = await authRequest("token?grant_type=pkce", { auth_code: code, code_verifier: tx.verifier });
        if (startRevision !== revision) throw new AuthError("auth_request_cancelled");
        save(data, tx.stay);
        return { flow: tx.flow };
      })();
      return callbackPromise;
    }
    async function updateUser(changes) {
      const allowed = {};
      if (changes.password !== undefined) allowed.password = validPassword(changes.password);
      if (changes.email !== undefined) allowed.email = email(changes.email);
      if (changes.data !== undefined) allowed.data = changes.data;
      const token = await accessToken();
      if (!token) throw new AuthError("authentication_required", 401);
      const current = peekSession();
      const startRevision = revision;
      let tx = null;
      let path = "user";
      if (allowed.email) {
        tx = await transaction("email_change", "./login.html", current.stay);
        allowed.code_challenge = tx.challenge;
        allowed.code_challenge_method = "s256";
        path += `?redirect_to=${encodeURIComponent(tx.redirect)}`;
      }
      try {
        const data = await authRequest(path, allowed, { method: "PUT", token });
        const latest = peekSession();
        if (startRevision === revision && latest?.user.id === current.user.id) {
          // Do not overwrite tokens rotated by a concurrent refresh.
          save({ ...latest, user: data }, latest.stay);
        }
        return data;
      } catch (error) {
        if (tx) persistent.removeItem(PKCE_PREFIX + tx.state);
        throw error;
      }
    }
    async function reauthenticate(password) {
      const current = peekSession();
      if (!current?.user.email) throw new AuthError("authentication_required", 401);
      const startRevision = ++revision;
      const data = await authRequest("token?grant_type=password", { email: email(current.user.email), password: String(password || "") });
      if (startRevision !== revision) throw new AuthError("auth_request_cancelled");
      // A cached old email may have been reassigned after an email change.
      // Reauthentication must NEVER silently switch to that email's new owner.
      if (data?.user?.id !== current.user.id) throw new AuthError("authentication_identity_changed", 401);
      return save(data, current.stay);
    }
    async function signOut() {
      const token = peekSession()?.access_token;
      clear(); // revoke UI credentials immediately, even offline
      if (token) {
        try { await authRequest("logout?scope=global", undefined, { token }); }
        catch { /* local logout still succeeds; access tokens expire server-side */ }
      }
    }
    if (env.addEventListener) env.addEventListener("storage", (event) => {
      if (event.key === SESSION_KEY) { revision += 1; emit(); }
    });
    return {
      peekSession, accessToken, headers, fetch: apiFetch, signIn, signUp,
      requestRecovery, completeRedirect, updateUser, reauthenticate, signOut,
      onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      MIN_PASSWORD_LENGTH,
    };
  }
  return { create, AuthError, SESSION_KEY, MIN_PASSWORD_LENGTH };
})());
