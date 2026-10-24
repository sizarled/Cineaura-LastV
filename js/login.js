(() => {
  const {
    $,
    setupChrome,
    toast,
    t,
    hydratePrefsFromProfile,
    supabaseRequest,
    tmdb,
    imgUrl,
    restValue,
    initialsAvatar,
    primeAvatars,
    avatarUrlFor,
    profileHref,
    escapeHtml,
  } = window.CineAura;

  const { auth, loadAuthMember, authErrorText } = window.CineAura;

  function showAlert(type, html) {
    const el = $("#form-alert");
    el.className = `form-alert show ${type}`;
    el.innerHTML = html;
  }

  // ?next=dashboard.html%23iptv — only a dashboard section, the notifications
  // page (with its period) or a channel list (listchannels.html?free=1,
  // ?package=…) of this site is accepted as a target.
  function nextTarget() {
    const next = new URLSearchParams(location.search).get("next") || "";
    const ok = /^(dashboard\.html(#[a-z]+)?|notifications\.html(\?period=[a-z]+)?|[Ll]istchannels\.html\?[\w%.~*+=&-]*)$/.test(next);
    return ok ? "./" + next : "";
  }

  // The member's avatar and username above the welcome: a link to their profile.
  async function paintUser(member) {
    const link = $("#success-user");
    const username = String(member?.username || "").replace(/^@/, "");
    if (!link || !username) return;
    const img = $("#success-avatar");
    img.src = initialsAvatar(member.full_name || username);
    img.alt = `@${username}`;
    $("#success-handle").textContent = `@${username}`;
    $("#success-name").textContent = member.full_name || username;
    link.href = profileHref(username);
    link.setAttribute("aria-label", `${t("auth.viewProfile")}: @${username}`);
    link.hidden = false;
    let name = "";
    try {
      const res = await supabaseRequest(`/rest/v1/profiles?member_id=eq.${restValue(member.member_id || "")}&select=display_name,avatar_url`);
      const row = res.ok && Array.isArray(res.data) ? res.data[0] : null;
      name = String(row?.display_name || "").trim();
      if (row?.avatar_url) img.src = row.avatar_url;
      else {
        await primeAvatars([member.member_id], [username]);
        const url = avatarUrlFor(member.member_id, username);
        if (url) img.src = url;
      }
    } catch {
      /* the initials stay */
    }
    img.onerror = () => {
      img.onerror = null;
      img.src = initialsAvatar(member.full_name || username);
    };
    if (name) $("#success-name").textContent = name;
  }

  function showSuccess(member) {
    const target = nextTarget();
    if (target) {
      location.replace(target);
      return;
    }
    $("#login-form").hidden = true;
    $("#success-card").hidden = false;
    $("#success-lead").textContent = t("auth.signedAs", { name: member.full_name || member.username || t("auth.yourAccount") });
    paintUser(member);
    $("#success-card").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function onSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const button = $("#submit-btn");
    button.disabled = true;
    button.textContent = t("auth.signing");
    try {
      await auth.signIn(String(data.login || "").trim(), String(data.password || ""), Boolean(data.stay));
      const member = await loadAuthMember();
      await hydratePrefsFromProfile();
      form.reset();
      toast(t("auth.signedOk"));
      showSuccess(member);
    } catch (error) {
      if (["username_unavailable", "account_details_required", "invalid_age"].includes(error.code) && auth.peekSession()) {
        location.replace("./register.html?complete=1");
        return;
      }
      await auth.signOut();
      // No account enumeration and no credential/table fallback.
      showAlert("error", escapeHtml(authErrorText(error)));
    } finally {
      button.disabled = false;
      button.textContent = t("auth.signin");
    }
  }

  async function setVisual() {
    try {
      const data = await tmdb("/trending/tv/week");
      const hit = (data.results || []).find((x) => x.backdrop_path);
      if (!hit) return;
      $("#auth-visual").style.backgroundImage =
        `linear-gradient(180deg, rgba(7,15,24,.18), rgba(7,15,24,.78)), url('${imgUrl(hit.backdrop_path, "w1280")}')`;
    } catch {
      /* keep fallback */
    }
  }

  async function init() {
    setupChrome();
    $("#toggle-password").addEventListener("click", () => {
      const input = document.querySelector('input[name="password"]');
      input.type = input.type === "password" ? "text" : "password";
    });
    $("#login-form").addEventListener("submit", onSubmit);
    try {
      const callback = await auth.completeRedirect();
      if (callback) {
        if (!["signup", "email_change"].includes(callback.flow)) throw new window.CineAuraAuth.AuthError("invalid_auth_callback");
        const member = await loadAuthMember();
        await hydratePrefsFromProfile();
        showSuccess(member);
      } else if (auth.peekSession()) {
        // Revalidate the server binding/status; never welcome a cached identity alone.
        showSuccess(await loadAuthMember());
      }
    } catch (error) {
      if (["username_unavailable", "account_details_required", "invalid_age"].includes(error.code) && auth.peekSession()) {
        location.replace("./register.html?complete=1");
        return;
      }
      await auth.signOut();
      showAlert("error", escapeHtml(authErrorText(error)));
    }
    setVisual();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
