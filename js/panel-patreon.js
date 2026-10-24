// Panel > Patreon — the buyers review (sql/patreon_review.sql).
// Patreon lets creators download the members/buyers list as a CSV. The owner
// uploads it here (the file never leaves the browser as-is — the rows are
// parsed locally and sent as JSON), then the review compares every claim the
// code-activation page issued with that list: a claim whose Patreon account is
// missing from it ("mismatch") and every extra claim of an account that
// claimed twice ("duplicate" — the earliest stays) are flagged. One click bans
// the flagged set (patreon_ban_flags): the claim dies, the unused serial goes
// back to the stock, and the site account that already spent the code is
// banned. Unban lifts it again (a reversible, panel-style ban).

(() => {
  "use strict";

  const PA = window.CineAuraPanelAdmin;
  if (!PA) return;
  const K = PA.kit;
  const C = window.CineAura;
  const { t, escapeHtml: esc, toast } = C;

  // ---------------------------------------------------------------- the CSV
  function parseCsv(text) {
    const rows = [];
    let cur = [], str = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { str += '"'; i++; } else q = false; } else str += ch;
        continue;
      }
      if (ch === '"') { q = true; continue; }
      if (ch === "," || ch === ";" || ch === "\t") { cur.push(str); str = ""; continue; } // Patreon exports comma; the two fallbacks cost nothing
      if (ch === "\n") { cur.push(str); rows.push(cur); cur = []; str = ""; continue; }
      if (ch === "\r") continue;
      str += ch;
    }
    if (str !== "" || cur.length) { cur.push(str); rows.push(cur); }
    return rows.filter((r) => r.some((c) => String(c || "").trim() !== ""));
  }

  const COLS = {
    uid: ["user id", "userid", "patreon id", "patron id", "id", "patreon user id"],
    email: ["email", "email address", "e-mail", "e-mail address", "mail"],
    first: ["first name", "given name", "firstname"],
    last: ["last name", "surname", "family name", "lastname"],
    name: ["name", "full name", "display name", "member", "buyer", "patron", "username"],
    product: ["product", "product name", "item", "tier", "title", "reward", "membership"],
    amount: ["amount", "price", "total", "pledge", "value", "payment", "sum"],
    currency: ["currency", "curr"],
  };

  function toRows(table) {
    if (!table.length) return [];
    const head = table[0].map((h) => String(h || "").trim().toLowerCase());
    const pick = (names) => names.map((n) => head.indexOf(n)).find((i) => i >= 0);
    const idx = {
      uid: pick(COLS.uid), email: pick(COLS.email), first: pick(COLS.first), last: pick(COLS.last),
      name: pick(COLS.name), product: pick(COLS.product), amount: pick(COLS.amount), currency: pick(COLS.currency),
    };
    const cell = (r, i) => (i == null || i < 0 ? "" : String(r[i] || "").trim());
    const money = (s) => {
      const n = Number(String(s || "").replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
      return Number.isFinite(n) ? Math.round(n * 100) : null;
    };
    const out = [];
    for (let r = 1; r < table.length; r++) {
      const row = table[r];
      const rec = {
        email: cell(row, idx.email),
        name: cell(row, idx.name) || [cell(row, idx.first), cell(row, idx.last)].filter(Boolean).join(" "),
        uid: cell(row, idx.uid),
        product: cell(row, idx.product),
        amount_cents: idx.amount != null && idx.amount >= 0 ? money(cell(row, idx.amount)) : null,
        currency: cell(row, idx.currency).slice(0, 3),
      };
      if (rec.email || rec.name || rec.uid) out.push(rec);
    }
    return out;
  }

  // ---------------------------------------------------------------- the board
  const cell = (label, value, extra = "") =>
    `<div class="pa-cell${extra}"><span>${esc(label)}</span><strong dir="ltr">${value}</strong></div>`;

  const table = (heads, rowsHtml, empty) => rowsHtml
    ? `<div style="overflow-x:auto"><table class="table"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`
    : `<p class="muted">${esc(empty)}</p>`;

  async function viewPatreon(main) {
    main.innerHTML = `
      ${K.head(t("panel.nav.patreon"), t("pc.title"), t("pc.lead"))}
      <div class="follow-pane pa-pane" id="pa-pane"><p class="muted">${esc(t("pa.loading"))}</p></div>`;
    const pane = main.querySelector("#pa-pane");
    const r = await K.rpc("patreon_review_admin", {});
    if (!pane.isConnected) return;
    const d = K.data(r);
    if (!d?.ok) {
      pane.innerHTML = `<p class="muted">${esc(t("pc.loadFail"))}</p>`;
      return;
    }
    const claims = d.claims || [];
    const flagged = d.flagged || [];
    const bannedCount = claims.filter((c) => c.banned).length;

    pane.innerHTML = `
      <div class="pa-strip pw-strip">
        ${cell(t("pc.stat.buyers"), K.num(d.buyers || 0))}
        ${cell(t("pc.stat.claims"), K.num(claims.length))}
        ${cell(t("pc.stat.banned"), K.num(bannedCount), bannedCount ? " warn" : "")}
        ${cell(t("pc.stat.flagged"), K.num(flagged.length), flagged.length ? " warn" : "")}
      </div>

      <section class="pa-box">
        <h3>${esc(t("pc.import.title"))}</h3>
        <p class="muted">${esc(t("pc.buyers.how"))}</p>
        <form class="pa-form-grid" id="pc-import" novalidate>
          <label class="wide"><span>${esc(t("pc.import.file"))}</span>
            <input name="file" type="file" accept=".csv,text/csv,text/plain" required /></label>
          <label><span>${esc(t("pc.import.source"))}</span>
            <input name="source" type="text" maxlength="80" dir="auto" placeholder="2026-10" /></label>
          <div class="wide acc-actions">
            <button class="btn btn-sm btn-primary" type="submit">${esc(t("pc.import.button"))}</button>
            <span class="muted" id="pc-imp-note"></span>
          </div>
        </form>
      </section>

      <section class="pa-box">
        <h3>${esc(t("pc.review.title"))}</h3>
        <p class="muted">${esc(t("pc.review.tip"))}</p>
        ${table(
          [t("pc.col.account"), t("pc.col.code"), t("pc.col.points"), t("pc.col.member"), t("pc.col.why")],
          flagged.map((f) => `
            <tr>
              <td dir="auto">${esc(f.account)}</td>
              <td dir="ltr">${esc(f.code)}</td>
              <td>${K.num(f.points)}</td>
              <td dir="ltr">${esc(f.member || "—")}</td>
              <td>${K.tag(t(`pc.why.${f.why}`), "st-open")}</td>
            </tr>`).join(""),
          t("pc.review.none")
        )}
        ${flagged.length ? `
          <div class="acc-actions">
            <button class="btn btn-sm btn-danger" id="pc-ban" type="button">${esc(t("pc.ban.all", { n: K.num(flagged.length) }))}</button>
          </div>` : ""}
      </section>

      <section class="pa-box">
        <h3>${esc(t("pc.claims.title"))}</h3>
        ${table(
          [t("pc.col.account"), t("pc.col.code"), t("pc.col.points"), t("pc.col.member"), t("pc.col.status"), t("pc.col.when"), ""],
          claims.map((c) => `
            <tr>
              <td dir="auto">${esc(c.account)}</td>
              <td dir="ltr">${esc(c.code)}</td>
              <td>${K.num(c.points)}</td>
              <td dir="ltr">${esc(c.member || "—")}</td>
              <td>${K.tag(t(c.banned ? "pc.st.banned" : "pc.st.ok"), c.banned ? "st-open" : "st-resolved")}</td>
              <td dir="ltr">${esc(String(c.created_at || "").slice(0, 10))}</td>
              <td>${c.banned ? `<button class="btn btn-sm btn-ghost pc-unban" data-id="${c.id}" type="button">${esc(t("pc.unban"))}</button>` : ""}</td>
            </tr>`).join(""),
          t("pc.claims.none")
        )}
      </section>`;

    // import
    const form = pane.querySelector("#pc-import");
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const file = form.elements.file.files?.[0];
      if (!file) return;
      const note = form.querySelector("#pc-imp-note");
      const reader = new FileReader();
      reader.onerror = () => { note.textContent = t("pc.loadFail"); };
      reader.onload = () => {
        const rows = toRows(parseCsv(String(reader.result || "")));
        if (!rows.length) { note.textContent = t("pc.import.empty"); return; }
        note.textContent = t("pc.import.rows", { n: K.num(rows.length) });
        K.busy(form, async () => {
          const r2 = await K.rpc("patreon_import", { rows, p_source: form.elements.source.value.trim() || file.name });
          const d2 = K.data(r2);
          if (!form.isConnected) return;
          if (d2?.ok) {
            toast(t("pc.import.done", { added: K.num(d2.added), updated: K.num(d2.updated), total: K.num(d2.total) }));
            viewPatreon(main);
          } else {
            toast(t("pc.loadFail"));
          }
        });
      };
      reader.readAsText(file);
    };

    // the one ban click
    const banBtn = pane.querySelector("#pc-ban");
    if (banBtn) banBtn.onclick = () => {
      if (!window.confirm(t("pc.ban.ask", { n: K.num(flagged.length) }))) return;
      K.busy(banBtn.parentElement, async () => {
        const r2 = await K.rpc("patreon_ban_flags", {});
        const d2 = K.data(r2);
        if (!banBtn.isConnected && !pane.isConnected) return;
        if (d2?.ok) {
          toast(t("pc.ban.done", { claims: K.num(d2.banned_claims), members: K.num(d2.banned_members), released: K.num(d2.released) }));
          viewPatreon(main);
        } else {
          toast(t("pc.loadFail"));
        }
      });
    };

    // unban
    pane.querySelectorAll(".pc-unban").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const r2 = await K.rpc("patreon_unban", { p_claim: Number(b.dataset.id) });
        const d2 = K.data(r2);
        if (!b.isConnected) return;
        if (d2?.ok) {
          toast(t("pc.unbanned"));
          viewPatreon(main);
        } else {
          b.disabled = false;
          toast(t("pc.loadFail"));
        }
      };
    });
  }

  PA.add("patreon", viewPatreon);
})();
