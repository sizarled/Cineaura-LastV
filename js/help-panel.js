(() => {
  const $p = (s, r=document) => r.querySelector(s);
  const esc = (v) => window.CineAura && window.CineAura.escapeHtml ? window.CineAura.escapeHtml(v) : String(v||'').replace(/[&<>"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const t = (k, vars) => window.CineAura && window.CineAura.t ? window.CineAura.t(k,vars) : k;
  const toast = (m) => window.CineAura && window.CineAura.toast ? window.CineAura.toast(m) : alert(m);
  const supabaseRequest = (...args) => window.CineAura.supabaseRequest(...args);

  async function fetchAll(){
    const res = await supabaseRequest('/rest/v1/help_articles?select=*&order=updated_at.desc&limit=1000');
    if(res.ok && Array.isArray(res.data)) return res.data;
    return [];
  }

  async function fetchCats(){
    const res = await supabaseRequest('/rest/v1/help_categories?select=*&order=sort_order.asc');
    return res.ok && Array.isArray(res.data) ? res.data : [];
  }

  // ---- Articles tab (the classic Help Center manager) ----------------------
  function renderArticlesTab(host){
    host.innerHTML = `<div style="display:flex;gap:8px;align-items:center;margin-top:14px;flex-wrap:wrap">
      <input id="help-q" placeholder="${t('help.searchPh')||'Search articles…'}" style="min-width:220px" />
      <select id="help-filter-status"><option value="">${t('common.all')||'All'}</option><option value="published">${t('help.published')||'Published'}</option><option value="draft">${t('help.draft')||'Draft'}</option></select>
      <a class="btn btn-primary" href="./Article.html" id="help-add-btn">+ ${t('help.addArticle')||'Add Article'}</a>
    </div>
    <div id="help-panel-list" class="glass" style="margin-top:14px;overflow:auto"><p style="padding:18px">${t('common.loading')}</p></div>`;
    const render = async () => {
      const q = ($p('#help-q')?.value||'').toLowerCase().trim();
      const st = $p('#help-filter-status')?.value||'';
      const listEl = $p('#help-panel-list');
      listEl.innerHTML = `<p style="padding:18px">${t('common.loading')}</p>`;
      const articles = await fetchAll();
      const cats = await fetchCats();
      const catMap = new Map(cats.map(c=>[c.id, c]));
      let rows = articles;
      if(q) rows = rows.filter(a=> (a.title+' '+(a.summary||'')+ ' '+a.language).toLowerCase().includes(q));
      if(st) rows = rows.filter(a=> a.status===st);
      if(!rows.length){
        listEl.innerHTML = `<p style="padding:18px;color:var(--muted)">${t('help.noArticles')||'No articles.'} <a href="./Article.html" class="btn btn-sm btn-primary" style="margin-inline-start:8px">${t('help.addArticle')||'Add Article'}</a></p>`;
        return;
      }
      listEl.innerHTML = `<div style="overflow:auto"><table class="panel-table" style="width:100%;min-width:860px;border-collapse:collapse">
        <thead><tr style="text-align:start;border-bottom:1px solid var(--line)">
          <th style="padding:10px 12px;text-align:start">${t('help.colTitle')||'Title'}</th>
          <th style="padding:10px 8px">${t('common.language')||'Language'}</th>
          <th style="padding:10px 8px">👁 ${t('help.colReaders')||'Readers'}</th>
          <th style="padding:10px 8px">⏱ ${t('help.colReading')||'Reading time'}</th>
          <th style="padding:10px 8px">👍 ${t('help.colHelpful')||'Helpful'}</th>
          <th style="padding:10px 8px">👎 ${t('help.colUnhelpful')||'Not helpful'}</th>
          <th style="padding:10px 8px">💬 ${t('help.colComments')||'Comments'}</th>
          <th style="padding:10px 12px">${t('common.status')||'Status'}</th>
          <th style="padding:10px 12px">${t('common.actions')||'Actions'}</th>
        </tr></thead>
        <tbody>${rows.map(a=>{
          const cat = catMap.get(a.category_id);
          const statusBadge = a.status==='published' ? `<span style="background:rgba(144,206,161,.15);color:var(--green);padding:4px 8px;border-radius:999px;font-size:12px">${t('help.published')||'Published'}</span>` : `<span style="background:rgba(255,180,0,.12);color:#ffb400;padding:4px 8px;border-radius:999px;font-size:12px">${t('help.draft')||'Draft'}</span>`;
          return `<tr style="border-bottom:1px solid var(--line)">
            <td style="padding:10px 12px"><a href="./Article.html?id=${a.id}" style="font-weight:600;color:var(--cyan-2)">${esc(a.title)}</a><div style="font-size:12px;color:var(--muted)">${esc(cat? (cat.name_ar||cat.name):'') } · ${esc(a.country||'global')} · ${(a.slug||'')}</div></td>
            <td style="padding:10px 8px;text-align:center"><span class="help-chip">${esc((a.language||'en').toUpperCase())}</span></td>
            <td style="padding:10px 8px;text-align:center">${a.views||0}</td>
            <td style="padding:10px 8px;text-align:center">${a.reading_minutes||1}′</td>
            <td style="padding:10px 8px;text-align:center">${a.helpful_count||0}</td>
            <td style="padding:10px 8px;text-align:center">${a.unhelpful_count||0}</td>
            <td style="padding:10px 8px;text-align:center">${a.comments_count||0}</td>
            <td style="padding:10px 12px">${statusBadge}</td>
            <td style="padding:10px 12px;display:flex;gap:6px;flex-wrap:wrap">
              <a href="./Article.html?id=${a.id}" class="btn btn-sm btn-ghost">${t('common.edit')||'Edit'}</a>
              <button class="btn btn-sm ${a.status==='published'?'btn-ghost':'btn-primary'}" data-toggle="${a.id}" data-status="${a.status}" type="button">${a.status==='published'? (t('help.revertDraft')||'Revert to draft') : (t('help.publish')||'Publish')}</button>
              <button class="btn btn-sm btn-danger" data-del="${a.id}" type="button">${t('common.delete')||'Delete'}</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <div style="padding:10px 14px;color:var(--muted);font-size:13px">${rows.length} ${t('help.articlesFound')||'articles'} · ${articles.filter(a=>a.status==='published').length} published · ${articles.filter(a=>a.status==='draft').length} draft</div>`;
      // bind
      listEl.querySelectorAll('[data-toggle]').forEach(btn=> btn.addEventListener('click', async()=>{
        const id = btn.dataset.toggle;
        const cur = btn.dataset.status;
        const next = cur==='published' ? 'draft' : 'published';
        if(!confirm(next==='published' ? `Publish article ${id}?` : `Revert article ${id} to draft?`)) return;
        const payload = {status: next};
        if(next==='published') payload.published_at = new Date().toISOString();
        const res = await supabaseRequest(`/rest/v1/help_articles?id=eq.${id}`, {method:'PATCH', body: JSON.stringify(payload)});
        if(!res.ok) return toast('Failed. Run sql/help.sql');
        toast(next==='published' ? t('help.published') : t('help.reverted'));
        render();
      }));
      listEl.querySelectorAll('[data-del]').forEach(btn=> btn.addEventListener('click', async()=>{
        const id = btn.dataset.del;
        if(!confirm(t('help.confirmDelete')||'Delete this article permanently?')) return;
        // delete categories junction + votes + comments handled by cascade, but do explicit
        await supabaseRequest(`/rest/v1/help_article_comments?article_id=eq.${id}`, {method:'DELETE'}).catch(()=>{});
        await supabaseRequest(`/rest/v1/help_article_votes?article_id=eq.${id}`, {method:'DELETE'}).catch(()=>{});
        await supabaseRequest(`/rest/v1/help_article_categories?article_id=eq.${id}`, {method:'DELETE'}).catch(()=>{});
        const res = await supabaseRequest(`/rest/v1/help_articles?id=eq.${id}`, {method:'DELETE'});
        if(!res.ok) return toast('Delete failed');
        toast(t('help.deleted')||'Deleted');
        render();
      }));
    };
    render();
    $p('#help-q')?.addEventListener('input', ()=> { clearTimeout($p('#help-q')._t); $p('#help-q')._t=setTimeout(render,300); });
    $p('#help-filter-status')?.addEventListener('change', render);
  }

  // ---- Help Center view: tabs (Articles · Categories & sections) -----------
  function viewHelp(main, initialTab){
    main.dataset.view='help';
    const TAB_CSS = 'background:none;border:none;border-bottom:2px solid transparent;padding:10px 14px;cursor:pointer;font:inherit;font-size:15px;color:var(--muted)';
    const ACTIVE_CSS = 'border-bottom-color:var(--cyan-2);color:var(--cyan-2);font-weight:700';
    main.innerHTML = `<div class="pa-help-head">
      <div>
        <p class="eyebrow">${t('panel.nav.help')||'Help'}</p>
        <h1>${t('help.panelTitle')||'Help Center'}</h1>
        <p class="muted">${t('help.panelLead')||'Manage help articles and the categories they live in.'}</p>
      </div>
    </div>
    <div class="help-tabs" role="tablist" style="display:flex;gap:4px;margin-top:12px;border-bottom:1px solid var(--line)">
      <button type="button" role="tab" data-htab="articles" style="${TAB_CSS}">${t('help.tabArticles')||'Articles'}</button>
      <button type="button" role="tab" data-htab="cats" style="${TAB_CSS}">${t('panel.nav.helpcats')||'Categories & sections'}</button>
    </div>
    <div id="help-tab-body"></div>`;
    const body = $p('#help-tab-body', main);
    const paintActive = (name)=> main.querySelectorAll('[data-htab]').forEach(btn=>{
      btn.style.cssText = TAB_CSS + (btn.dataset.htab===name ? ';'+ACTIVE_CSS : '');
      btn.setAttribute('aria-selected', btn.dataset.htab===name ? 'true' : 'false');
    });
    const openTab = (name)=>{
      paintActive(name);
      body.innerHTML = '';
      if(name === 'cats'){
        if(window.CineAuraHelpCats && window.CineAuraHelpCats.viewHelpCats) window.CineAuraHelpCats.viewHelpCats(body);
        else body.innerHTML = `<p style="padding:18px;color:var(--muted)">${t('helpcats.loadFail')||'Categories panel not loaded'}.</p>`;
        return;
      }
      renderArticlesTab(body);
    };
    main.querySelectorAll('[data-htab]').forEach(btn=> btn.addEventListener('click', ()=> openTab(btn.dataset.htab)));
    openTab(initialTab === 'cats' ? 'cats' : 'articles');
  }

  // expose for panel.js
  window.CineAuraHelpPanel = { viewHelp };
})();
