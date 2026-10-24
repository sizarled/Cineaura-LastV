(() => {
  const C = window.CineAura;
  const { $, setupChrome, t } = C;
  let verifiedRecovery = false;

  function alertAt(selector, type, message) {
    const alert = $(selector);
    alert.className = `form-alert show ${type}`;
    alert.textContent = message;
  }

  async function onEmail(event) {
    event.preventDefault();
    const button = $("#code-btn");
    button.disabled = true;
    try {
      await C.auth.requestRecovery($("#recovery-email").value);
      alertAt("#code-alert", "ok", t("auth.secure.recoverySent"));
    } catch (error) {
      alertAt("#code-alert", "error", C.authErrorText(error));
    } finally { button.disabled = false; }
  }

  async function onPassword(event) {
    event.preventDefault();
    if (!verifiedRecovery) return alertAt("#password-alert", "error", t("auth.secure.needRecovery"));
    const password = $("#new-password").value;
    if (password !== $("#confirm-password").value) return alertAt("#password-alert", "error", t("rest.mismatch"));
    const button = $("#save-btn");
    button.disabled = true;
    try {
      await C.auth.updateUser({ password });
      // A recovery-link session also provides fresh, signed email ownership
      // for an existing Auth user securely claiming a legacy member record.
      let memberWarning = "";
      try { await C.loadAuthMember(); } catch (error) {
        if (["legacy_claim_review_required", "legacy_account_already_claimed"].includes(error.code)) memberWarning = C.authErrorText(error);
      }
      verifiedRecovery = false;
      await C.auth.signOut();
      $("#password-form").reset();
      $("#password-form").hidden = true;
      $("#success-card").hidden = false;
      if (memberWarning) {
        const note = document.createElement("p");
        note.textContent = memberWarning;
        $("#success-card").append(note);
      }
    } catch (error) {
      alertAt("#password-alert", "error", C.authErrorText(error));
    } finally { button.disabled = false; }
  }

  async function init() {
    setupChrome();
    $("#code-form").addEventListener("submit", onEmail);
    $("#password-form").addEventListener("submit", onPassword);
    $("#toggle-password").addEventListener("click", () => {
      const input = $("#new-password");
      input.type = input.type === "password" ? "text" : "password";
    });
    try {
      const callback = await C.auth.completeRedirect();
      if (!callback) return;
      if (callback.flow !== "recovery") throw new window.CineAuraAuth.AuthError("invalid_auth_callback");
      verifiedRecovery = true;
      $("#code-form").hidden = true;
      $("#password-form").hidden = false;
    } catch (error) {
      await C.auth.signOut();
      alertAt("#code-alert", "error", C.authErrorText(error));
    }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
