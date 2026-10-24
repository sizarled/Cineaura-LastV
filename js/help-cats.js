/* Help center — categories & sections manager (panel tab "helpcats").
   Renders into #panel-main. Tables: help_categories (+ join counts from
   help_article_categories and help_articles.category_id). v1→v2 bridge is
   sql/help.sql — this view shows a clear inline error if it has not run. */
(() => {
  const $p = (s, r = document) => r.querySelector(s);
  const esc = (v) => (window.CineAura && window.CineAura.escapeHtml ? window.CineAura.escapeHtml(v) : String(v || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const t = (k, vars) => (window.CineAura && window.CineAura.t ? window.CineAura.t(k, vars) : k);
  const toast = (m) => (window.CineAura && window.CineAura.toast ? window.CineAura.toast(m) : alert(m));
  const supabaseRequest = (...args) => window.CineAura.supabaseRequest(...args);

  const slugify = (s) => String(s || '').toLowerCase().trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
  const restErr = (r) => String((r && r.data && (r.data.message || r.data.hint || r.data.details)) || r.status || 'network');

  let loadError = '';

  async function fetchCats() {
    loadError = '';
    const res = await supabaseRequest('/rest/v1/help_categories?select=*&order=sort_order.asc&order=created_at.asc');
    if (res.ok && Array.isArray(res.data)) return res.data;
    loadError = restErr(res);
    return [];
  }
  async function countMap(url, key) {
    const res = await supabaseRequest(url);
    const m = new Map();
    if (res.ok && Array.isArray(res.data)) res.data.forEach((r) => { const k = r[key]; if (k != null) m.set(k, (m.get(k) || 0) + 1); });
    return m;
  }

  function rowHTML(c, subs, artCounts, isSub) {
    const kids = subs.get(c.id) || [];
    const arts = artCounts.get(c.id) || 0;
    return `<div class="hc-row ${isSub ? 'hc-subrow' : ''}" data-id="${c.id}">
      <div class="hc-row-main">
        <span class="hc-icon">${esc(c.icon || '📁')}</span>
        <span class="hc-names"><strong>${esc(c.name)}</strong><small>${esc(c.name_ar || '')}</small></span>
        <code class="hc-slug">${esc(c.slug)}</code>
        <span class="hc-sort">#${c.sort_order}</span>
      </div>
      <div class="hc-row-stats">
        <span class="hc-chip" title="${esc(t('helpcats.arts') || 'articles')}">📄 ${arts}</span>
        ${!isSub ? `<span class="hc-chip" title="${esc(t('helpcats.subs') || 'subsections')}">🗂 ${kids.length}</span>` : ''}
      </div>
      <div class="hc-row-actions">
        ${!isSub ? `<button type="button" class="btn btn-sm btn-ghost" data-act="sub">＋ ${esc(t('helpcats.addSub') || 'Add subsection')}</button>` : ''}
        <button type="button" class="btn btn-sm btn-ghost" data-act="edit">✎ ${esc(t('helpcats.edit') || 'Edit')}</button>
        <button type="button" class="btn btn-sm btn-ghost hc-del" data-act="del" data-subs="${kids.length}" data-arts="${arts}" data-name="${esc(c.name)}">🗑 ${esc(t('helpcats.delete') || 'Delete')}</button>
      </div>
      <form class="hc-form" data-form="edit" hidden>
        <input name="name" value="${esc(c.name)}" placeholder="${esc(t('helpcats.mainPh') || 'English name')}" required />
        <input name="name_ar" value="${esc(c.name_ar || '')}" placeholder="${esc(t('helpcats.arPh') || 'الاسم بالعربية')}" dir="rtl" />
        <input name="icon" value="${esc(c.icon || '')}" placeholder="${esc(t('helpcats.iconPh') || 'Icon (emoji, optional)')}" maxlength="8" />
        <input name="sort_order" type="number" value="${c.sort_order}" placeholder="${esc(t('helpcats.sortPh') || 'Order')}" style="width:90px" />
        <button type="submit" class="btn btn-sm btn-primary">${esc(t('helpcats.save') || 'Save')}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="cancel">${esc(t('helpcats.cancel') || 'Cancel')}</button>
      </form>
      <form class="hc-form" data-form="sub" hidden>
        <input name="name" placeholder="${esc(t('helpcats.mainPh') || 'English name')}" required />
        <input name="name_ar" placeholder="${esc(t('helpcats.arPh') || 'الاسم بالعربية')}" dir="rtl" />
        <input name="icon" placeholder="${esc(t('helpcats.iconPh') || 'Icon (emoji, optional)')}" maxlength="8" />
        <input name="sort_order" type="number" value="${(kids.length || 0) + 1}" placeholder="${esc(t('helpcats.sortPh') || 'Order')}" style="width:90px" />
        <button type="submit" class="btn btn-sm btn-primary">${esc(t('helpcats.add') || 'Add')}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="cancel">${esc(t('helpcats.cancel') || 'Cancel')}</button>
      </form>
    </div>
    ${kids.map((k) => rowHTML(k, subs, artCounts, true)).join('')}`;
  }

  function viewHelpCats(main) {
    main.dataset.view = 'helpcats';
    main.innerHTML = `<div class="hc-toolbar" style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:14px">
      <p class="muted" style="margin:0;max-width:640px">${t('helpcats.lead')}</p>
      <div style="display:flex;gap:8px;align-items:center">
        <button type="button" class="btn btn-ghost" id="hc-refresh">⟳ ${t('helpcats.refresh') || 'Refresh'}</button>
        <button type="button" class="btn btn-primary" id="hc-new-toggle">＋ ${t('helpcats.addMain') || 'Add section'}</button>
      </div>
    </div>
    <form class="hc-form glass" id="hc-new" hidden style="margin-top:12px">
      <input name="name" placeholder="${esc(t('helpcats.mainPh') || 'English name')}" required />
      <input name="name_ar" placeholder="${esc(t('helpcats.arPh') || 'الاسم بالعربية')}" dir="rtl" />
      <input name="icon" placeholder="${esc(t('helpcats.iconPh') || 'Icon (emoji, optional)')}" maxlength="8" />
      <input name="sort_order" type="number" value="99" placeholder="${esc(t('helpcats.sortPh') || 'Order')}" style="width:90px" />
      <button type="submit" class="btn btn-primary">${esc(t('helpcats.add') || 'Add')}</button>
      <button type="button" class="btn btn-ghost" id="hc-new-cancel">${esc(t('helpcats.cancel') || 'Cancel')}</button>
    </form>
    <div id="hc-list" class="glass" style="margin-top:14px"><p style="padding:18px">${t('helpcats.loading') || 'Loading categories…'}</p></div>
    <style>
      .hc-form { display:flex; flex-wrap:wrap; gap:8px; padding:12px; align-items:center; }
      .hc-form input { flex:0 1 190px; padding:8px 10px; border-radius:10px; border:1px solid var(--line); background:var(--surface); color:var(--text); font:inherit; }
      .hc-row { border-top:1px solid var(--line); }
      .hc-row-main { display:flex; align-items:center; gap:12px; padding:12px 14px 6px; flex-wrap:wrap; }
      .hc-icon { font-size:20px; }
      .hc-names { display:flex; flex-direction:column; min-width:180px; }
      .hc-names small { color:var(--muted); }
      .hc-slug { font-size:11px; background:var(--surface); border:1px solid var(--line); padding:2px 8px; border-radius:99px; color:var(--muted); }
      .hc-sort { color:var(--muted); font-size:12px; }
      .hc-row-stats, .hc-row-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:0 14px 10px; }
      .hc-chip { background:var(--surface); border:1px solid var(--line); border-radius:99px; padding:3px 10px; font-size:12px; }
      .hc-subrow { background:rgba(255,255,255,0.02); }
      .hc-subrow .hc-row-main { padding-inline-start:44px; }
      .hc-del:hover { color:#fa383e; }
      .hc-error { padding:16px 18px; color:#f7b928; }
      .hc-error code { display:block; margin-top:6px; font-size:12px; color:var(--muted); }
    </style>`;

    const listEl = $p('#hc-list');

    async function render() {
      listEl.innerHTML = `<p style="padding:18px">${t('helpcats.loading') || 'Loading categories…'}</p>`;
      const cats = await fetchCats();
      if (loadError) {
        listEl.innerHTML = `<div class="hc-error">⚠ ${esc(t('helpcats.loadFail') || 'Categories could not be loaded.')} ${esc(t('helpcats.loadFailHint') || 'Run sql/help.sql in the Supabase SQL editor, then retry.')}<code>${esc(loadError)}</code>
          <button type="button" class="btn btn-sm btn-ghost" id="hc-retry" style="margin-top:10px">⟳ ${esc(t('helpcats.refresh') || 'Refresh')}</button></div>`;
        $p('#hc-retry')?.addEventListener('click', render);
        return;
      }
      if (!cats.length) {
        listEl.innerHTML = `<p style="padding:18px;color:var(--muted)">${t('helpcats.empty') || 'No categories yet — add the first one.'}</p>`;
        return;
      }
      const [ac, direct] = await Promise.all([
        countMap('/rest/v1/help_article_categories?select=category_id', 'category_id'),
        countMap('/rest/v1/help_articles?category_id=not.is.null&select=category_id', 'category_id'),
      ]);
      const artCounts = new Map();
      ac.forEach((v, k) => artCounts.set(k, (artCounts.get(k) || 0) + v));
      direct.forEach((v, k) => artCounts.set(k, (artCounts.get(k) || 0) + v));
      const subs = new Map();
      cats.filter((c) => c.parent_id).forEach((c) => {
        if (!subs.has(c.parent_id)) subs.set(c.parent_id, []);
        subs.get(c.parent_id).push(c);
      });
      const mains = cats.filter((c) => !c.parent_id);
      listEl.innerHTML = mains.map((c) => rowHTML(c, subs, artCounts, false)).join('');
    }

    async function submitCat(form, parentId) {
      const name = form.name.value.trim();
      if (!name) { toast(t('helpcats.nameReq') || 'A name is required'); return; }
      const body = {
        name,
        name_ar: form.name_ar.value.trim(),
        icon: form.icon.value.trim(),
        sort_order: Number(form.sort_order.value || 0),
      };
      if (parentId) body.parent_id = parentId;
      const slugs = await fetchCats();
      let slug = slugify(name);
      const taken = new Set(slugs.map((c) => c.slug));
      let i = 2;
      while (taken.has(slug)) slug = `${slugify(name)}-${i++}`;
      body.slug = slug;
      const r = await supabaseRequest('/rest/v1/help_categories', { method: 'POST', body: JSON.stringify(body) });
      if (r.ok) { toast(t('helpcats.saved') || 'Saved ✓'); await render(); }
      else toast(`${t('helpcats.saveFail') || 'Could not save'} — ${restErr(r)}`);
    }

    listEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const row = btn.closest('.hc-row');
      const id = row.dataset.id;
      const act = btn.dataset.act;
      if (act === 'cancel') { row.querySelectorAll('form.hc-form').forEach((f) => (f.hidden = true)); return; }
      if (act === 'sub' || act === 'edit') {
        row.querySelectorAll('form.hc-form').forEach((f) => (f.hidden = true));
        row.querySelector(`form[data-form="${act}"]`).hidden = false;
        return;
      }
      if (act === 'del') {
        if (Number(btn.dataset.subs || 0) > 0) { toast(t('helpcats.hasSubs') || 'Delete its subsections first.'); return; }
        const arts = Number(btn.dataset.arts || 0);
        const msg = arts
          ? (t('helpcats.confirmDelArts') || 'Delete «{name}»? its {n} article links are freed (articles stay).').replace('{name}', btn.dataset.name).replace('{n}', arts)
          : (t('helpcats.confirmDel') || 'Delete «{name}»?').replace('{name}', btn.dataset.name);
        if (!confirm(msg)) return;
        const r = await supabaseRequest(`/rest/v1/help_categories?id=eq.${id}`, { method: 'DELETE' });
        if (r.ok) { toast(t('helpcats.deleted') || 'Deleted ✓'); await render(); }
        else toast(`${t('helpcats.delFail') || 'Could not delete'} — ${restErr(r)}`);
      }
    });

    listEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target.closest('form.hc-form');
      if (!form) return;
      const row = form.closest('.hc-row');
      if (form.dataset.form === 'sub') { await submitCat(form, Number(row.dataset.id)); return; }
      if (form.dataset.form === 'edit') {
        const name = form.name.value.trim();
        if (!name) { toast(t('helpcats.nameReq') || 'A name is required'); return; }
        const r = await supabaseRequest(`/rest/v1/help_categories?id=eq.${row.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            name_ar: form.name_ar.value.trim(),
            icon: form.icon.value.trim(),
            sort_order: Number(form.sort_order.value || 0),
          }),
        });
        if (r.ok) { toast(t('helpcats.saved') || 'Saved ✓'); await render(); }
        else toast(`${t('helpcats.saveFail') || 'Could not save'} — ${restErr(r)}`);
      }
    });

    $p('#hc-new-toggle').addEventListener('click', () => { $p('#hc-new').hidden = !$p('#hc-new').hidden; if (!$p('#hc-new').hidden) $p('#hc-new').name.focus(); });
    $p('#hc-new-cancel').addEventListener('click', () => { $p('#hc-new').hidden = true; });
    $p('#hc-new').addEventListener('submit', async (e) => { e.preventDefault(); await submitCat(e.target, null); e.target.hidden = true; e.target.reset(); });
    $p('#hc-refresh').addEventListener('click', render);

    render();
  }

  window.CineAuraHelpCats = { viewHelpCats };
})();
