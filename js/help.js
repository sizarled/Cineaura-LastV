(() => {
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = (v) => (window.CineAura && window.CineAura.escapeHtml) ? window.CineAura.escapeHtml(v) : String(v||'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const t = (k, vars) => (window.CineAura && window.CineAura.t) ? window.CineAura.t(k, vars) : k;
  const supabaseRequest = window.CineAura ? window.CineAura.supabaseRequest : null;
  const getLang = () => (window.CineAura && window.CineAura.getLang) ? window.CineAura.getLang() : (document.documentElement.lang || 'en');
  const toast = (m) => window.CineAura && window.CineAura.toast ? window.CineAura.toast(m) : console.log(m);
  const getSession = () => window.CineAura && window.CineAura.getSession ? window.CineAura.getSession() : null;

  let categories = [];
  let articles = [];
  let filtered = [];
  let currentId = null;

  function qParams(){ return new URLSearchParams(location.search); }

  async function fetchCategories(){
    if(!supabaseRequest) return [];
    const res = await supabaseRequest('/rest/v1/help_categories?select=*&order=sort_order.asc&order=created_at.asc');
    if(res.ok && Array.isArray(res.data)) return res.data;
    return [];
  }
  async function fetchArticles(){
    if(!supabaseRequest) return [];
    const lang = getLang();
    // try language filter with fallback to all
    const res = await supabaseRequest('/rest/v1/help_articles?status=eq.published&select=*&order=updated_at.desc&limit=500');
    if(res.ok && Array.isArray(res.data)) return res.data;
    return [];
  }

  function readingLabel(n){ return (n||2) + ' ' + t('common.minutes'); }

  function buildTree(cats){
    const byParent = new Map();
    cats.forEach(c=> {
      const p = c.parent_id || 'root';
      if(!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(c);
    });
    return byParent;
  }

  function renderToc(byParent, openSlug){
    const roots = byParent.get('root') || [];
    if(!roots.length) return '<p style="padding:16px;color:var(--muted)">No sections yet.</p>';
    return roots.map(cat=>{
      const subs = byParent.get(cat.id) || [];
      const catArticles = articles.filter(a=> a.category_id===cat.id || subs.some(s=> s.id===a.category_id));
      // also need article linked via junction – will show via category_id for now
      const isOpen = openSlug ? (cat.slug===openSlug || subs.some(s=> s.slug===openSlug)) : true;
      return `<div class="help-cat ${isOpen?'open':''}">
        <button class="help-cat-btn" type="button" data-cat="${esc(cat.slug)}">
          <span>${esc(getLang()==='ar' && cat.name_ar ? cat.name_ar : cat.name)}</span>
          <small>${catArticles.length}</small>
        </button>
        <div class="help-subs">
          ${subs.length ? subs.map(s=>{
            const n = articles.filter(a=> a.category_id===s.id).length;
            return `<a class="help-sub ${openSlug===s.slug?'active':''}" href="#" data-sub="${esc(s.slug)}">${esc(getLang()==='ar' && s.name_ar ? s.name_ar : s.name)} <small style="opacity:.6">· ${n}</small></a>`;
          }).join('') : `<button class="help-sub" data-sub="${esc(cat.slug)}">${esc(t('common.all'))}</button>`}
        </div>
      </div>`;
    }).join('');
  }

  function renderList(filterSlug, query){
    const container = $('#help-main');
    if(!container) return;
    let list = filtered;
    if(filterSlug){
      const cat = categories.find(c=> c.slug===filterSlug);
      if(cat){
        const childSlugs = categories.filter(c=> c.parent_id===cat.id).map(c=> c.id);
        const ids = [cat.id, ...childSlugs];
        list = list.filter(a=> ids.includes(a.category_id) );
      }
    }
    if(query){
      const q = query.toLowerCase();
      list = list.filter(a=> (a.title+' '+(a.summary||'')+' '+(a.content_html||'')).toLowerCase().includes(q));
    }
    if(!list.length){
      container.innerHTML = `<div class="help-empty"><h3>${t('help.noResults')}</h3><p>${t('help.noResultsP')}</p></div>`;
      return;
    }
    // group by main category for display
    const byParent = buildTree(categories);
    const roots = byParent.get('root') || [];
    let html = '';
    if(filterSlug || query){
      // flat list
      html += `<div class="help-grid">${list.map(articleCard).join('')}</div>`;
    } else {
      roots.forEach(cat=>{
        const subs = byParent.get(cat.id) || [];
        const catIds = [cat.id, ...subs.map(s=> s.id)];
        const catArts = list.filter(a=> catIds.includes(a.category_id));
        if(!catArts.length) return;
        html += `<div class="help-section-card">
          <h2>${esc(getLang()==='ar' && cat.name_ar ? cat.name_ar : cat.name)} <em>${catArts.length} ${t('common.titles')}</em></h2>
          <p class="help-section-lead">${esc(t('help.sectionLead'))}</p>
          <div class="help-articles">${catArts.slice(0,12).map(articleCard).join('')}</div>
        </div>`;
        // subsections blocks
        subs.forEach(s=>{
          const sArts = list.filter(a=> a.category_id===s.id);
          if(!sArts.length) return;
          html += `<div class="help-section-card" style="margin-top:12px">
            <h2 style="font-size:17px">${esc(getLang()==='ar' && s.name_ar ? s.name_ar : s.name)} <em>${sArts.length}</em></h2>
            <div class="help-articles" style="margin-top:8px">${sArts.map(articleCard).join('')}</div>
          </div>`;
        });
      });
      if(!html) html = `<div class="help-grid">${list.map(articleCard).join('')}</div>`;
    }
    container.innerHTML = html;
    // bind clicks
    $$('.help-item', container).forEach(el=>{
      el.addEventListener('click', (e)=>{
        if(e.target.closest('a')) return;
        const id = el.dataset.id;
        openArticle(id);
      });
    });
  }

  function articleCard(a){
    const lang = (a.language||'en').toUpperCase();
    return `<article class="help-item" data-id="${a.id}" style="cursor:pointer">
      <div style="flex:1;min-width:0">
        <h3>${esc(a.title)}</h3>
        <p>${esc(a.summary|| stripHtml(a.content_html).slice(0,120))}</p>
        <div class="help-item-meta">
          <span class="help-chip">${esc(lang)} · ${esc(a.country||'global')}</span>
          <span>👁 ${a.views||0} · ⏱ ${a.reading_minutes||2}′ · 👍 ${a.helpful_count||0} · 👎 ${a.unhelpful_count||0} · 💬 ${a.comments_count||0}</span>
        </div>
      </div>
      <span style="font-size:18px">›</span>
    </article>`;
  }

  function stripHtml(html){
    const d=document.createElement('div'); d.innerHTML=html||''; return d.textContent||d.innerText||'';
  }

  function openArticle(id){
    const url = new URL(location.href);
    url.searchParams.set('id', id);
    history.pushState({},'',url);
    showArticle(id);
  }

  async function showArticle(id){
    const art = articles.find(a=> String(a.id)===String(id)) || null;
    if(!art){
      // fetch single
      if(supabaseRequest){
        const res = await supabaseRequest(`/rest/v1/help_articles?id=eq.${id}&select=*`);
        if(res.ok && res.data && res.data[0]) { articles.push(res.data[0]); currentId=id; renderArticle(res.data[0]); return; }
      }
      toast('Article not found');
      return;
    }
    currentId = id;
    renderArticle(art);
    // increment view
    if(supabaseRequest) supabaseRequest(`/rpc/help_increment_view`, {method:'POST', body: JSON.stringify({p_id: Number(id)})}).catch(()=>{});
    // update views locally
    art.views = (art.views||0)+1;
  }

  function renderArticle(a){
    $('#help-list-view').hidden = true;
    $('#help-article-view').hidden = false;
    const related = articles.filter(x=> x.id!==a.id && x.category_id===a.category_id).slice(0,8);
    const cats = categories;
    const cat = cats.find(c=> c.id===a.category_id);
    const parent = cat && cat.parent_id ? cats.find(c=> c.id===cat.parent_id) : null;
    const breadcrumb = [
      `<a href="./help.html">${t('help.kicker')}</a>`,
      parent ? `<a href="#" data-bc="${esc(parent.slug)}">${esc(getLang()==='ar'&&parent.name_ar?parent.name_ar:parent.name)}</a>` : '',
      cat ? `<a href="#" data-bc="${esc(cat.slug)}">${esc(getLang()==='ar'&&cat.name_ar?cat.name_ar:cat.name)}</a>` : '',
      `<span>${esc(a.title)}</span>`
    ].filter(Boolean).join(' <span style="opacity:.4">›</span> ');

    $('#help-article').innerHTML = `
      <div class="help-article-head">
        <nav class="help-breadcrumb">${breadcrumb}</nav>
        <h1>${esc(a.title)}</h1>
        <div class="help-article-meta">
          <span>🌐 ${esc(a.language)} · ${esc(a.country)}</span>
          <span>👁 ${a.views||0} ${t('common.viewers')}</span>
          <span>⏱ ${a.reading_minutes||2} ${t('common.minutes')}</span>
          <span>${a.published_at ? new Date(a.published_at).toLocaleDateString(getLang()==='ar'?'ar-EG':'en-US') : ''}</span>
        </div>
      </div>
      ${a.image ? `<img class="help-article-hero" src="${esc(a.image)}" alt="" loading="lazy" />` : ''}
      <div class="help-article-body" id="help-body"></div>
      <div class="help-vote" id="help-vote-box">
        <p>${t('help.wasHelpful')}</p>
        <button type="button" data-vote="helpful" class="helpful-btn">👍 ${t('help.helpful')} (${a.helpful_count||0})</button>
        <button type="button" data-vote="unhelpful" class="bad">👎 ${t('help.notHelpful')} (${a.unhelpful_count||0})</button>
        <small id="help-vote-msg"></small>
      </div>
    `;
    const bodyEl = $('#help-body');
    // inject HTML + CSS
    if(a.content_css){
      const style = document.createElement('style');
      style.textContent = a.content_css;
      bodyEl.appendChild(style);
    }
    const content = document.createElement('div');
    content.innerHTML = a.content_html || `<p>${esc(a.summary||'')}</p>`;
    bodyEl.appendChild(content);
    // sanitize links open in new tab? keep
    bodyEl.querySelectorAll('a').forEach(al=> { if(al.host!==location.host) al.target='_blank'; al.rel='noopener'; });

    // related
    $('#help-related').innerHTML = `<div class="help-related-card">
      <h4>${t('help.related')}</h4>
      ${related.length ? related.map(r=> `<a href="#" data-rel="${r.id}"><b>${esc(r.title)}</b><span>${esc(r.summary||'') } · 👁 ${r.views||0}</span></a>`).join('') : `<p style="color:var(--muted);font-size:13px">${t('help.noRelated')}</p>`}
      <div style="margin-top:10px"><a class="btn btn-sm btn-ghost" href="./help.html" style="width:100%;text-align:center">${t('help.backToList')}</a></div>
    </div>`;

    // comments
    loadComments(a.id);
    loadVoteState(a.id);

    // bind breadcrumb
    $('#help-article').querySelectorAll('[data-bc]').forEach(el=> el.addEventListener('click', (e)=>{ e.preventDefault(); const slug=el.dataset.bc; history.pushState({},'', './help.html?cat='+encodeURIComponent(slug)); showList(slug); }));
    $('#help-related').querySelectorAll('[data-rel]').forEach(el=> el.addEventListener('click', (e)=>{ e.preventDefault(); openArticle(el.dataset.rel); }));

    // vote handlers
    $('#help-article').querySelectorAll('[data-vote]').forEach(btn=> btn.addEventListener('click', ()=> doVote(a.id, btn.dataset.vote==='helpful')));

    // scroll top
    window.scrollTo({top:0, behavior:'smooth'});
  }

  async function loadVoteState(articleId){
    const sess = getSession();
    if(!sess || !supabaseRequest) return;
    const res = await supabaseRequest(`/rest/v1/help_article_votes?article_id=eq.${articleId}&member_id=eq.${encodeURIComponent(sess.member_id)}&select=helpful`);
    if(res.ok && res.data && res.data[0]){
      const helpful = res.data[0].helpful;
      const box = $('#help-vote-box');
      if(box){
        box.querySelectorAll('[data-vote]').forEach(b=>{
          b.classList.toggle('active', (helpful && b.dataset.vote==='helpful') || (!helpful && b.dataset.vote==='unhelpful'));
        });
      }
    }
  }

  async function doVote(articleId, helpful){
    const sess = getSession();
    if(!sess){
      toast(t('help.signToVote'));
      return;
    }
    const btn = document.querySelector(`[data-vote="${helpful?'helpful':'unhelpful'}"]`);
    if(btn) btn.disabled = true;
    try{
      if(supabaseRequest){
        const res = await supabaseRequest('/rpc/help_vote', {method:'POST', body: JSON.stringify({p_article: Number(articleId), p_member: String(sess.member_id), p_helpful: helpful})});
        if(!res.ok) throw new Error('vote fail');
        // update counters locally
        const art = articles.find(a=> String(a.id)===String(articleId));
        if(art){
          // refetch article counts
          const r2 = await supabaseRequest(`/rest/v1/help_articles?id=eq.${articleId}&select=helpful_count,unhelpful_count,views`);
          if(r2.ok && r2.data && r2.data[0]){
            art.helpful_count = r2.data[0].helpful_count;
            art.unhelpful_count = r2.data[0].unhelpful_count;
          }
        }
        toast(helpful ? t('help.votedHelpful') : t('help.votedUnhelpful'));
        // re-render vote counts without full reload
        const box = $('#help-vote-box');
        if(box && art){
          box.querySelector('[data-vote="helpful"]').textContent = `👍 ${t('help.helpful')} (${art.helpful_count||0})`;
          box.querySelector('[data-vote="unhelpful"]').textContent = `👎 ${t('help.notHelpful')} (${art.unhelpful_count||0})`;
          await loadVoteState(articleId);
        }
      }
    } catch(e){
      toast('Vote failed');
    } finally {
      if(btn) btn.disabled=false;
    }
  }

  async function loadComments(articleId){
    const el = $('#help-comments');
    if(!el) return;
    el.innerHTML = `<h3>💬 ${t('help.comments')} (<span id="hc-count">…</span>)</h3><div class="help-cmt-form"><textarea id="hc-input" placeholder="${t('help.writeComment')}" rows="2"></textarea><button class="btn btn-sm btn-primary" id="hc-send" type="button">${t('common.send')}</button></div><div id="hc-list"><p style="color:var(--muted)">${t('common.loading')}</p></div>`;
    const listEl = $('#hc-list');
    const countEl = $('#hc-count');
    async function fetchComments(){
      if(!supabaseRequest) return [];
      const res = await supabaseRequest(`/rest/v1/help_article_comments?article_id=eq.${articleId}&order=created_at.desc&select=*&limit=100`);
      if(res.ok && Array.isArray(res.data)) return res.data;
      return [];
    }
    const comments = await fetchComments();
    countEl.textContent = String(comments.length);
    // update article count
    const art = articles.find(a=> String(a.id)===String(articleId));
    if(art) art.comments_count = comments.length;
    if(!comments.length){
      listEl.innerHTML = `<p style="color:var(--muted);padding:10px">${t('help.noComments')}</p>`;
    } else {
      listEl.innerHTML = comments.map(c=> `<div class="help-cmt">
        <div class="help-cmt-head"><img src="${esc(c.avatar_url||'')}" onerror="this.src='https://via.placeholder.com/28'" alt="" /><b>${esc(c.username|| c.member_id)}</b><span>${new Date(c.created_at).toLocaleString()}</span></div>
        <p>${esc(c.body)}</p>
      </div>`).join('');
    }
    $('#hc-send').addEventListener('click', async()=>{
      const sess = getSession();
      if(!sess){ toast(t('help.signToComment')); return; }
      const inp = $('#hc-input');
      const body = inp.value.trim();
      if(!body) return;
      if(body.length>3000) { toast('Too long'); return; }
      const btn = $('#hc-send'); btn.disabled=true;
      try{
        const payload = { article_id: Number(articleId), member_id: String(sess.member_id), username: String(sess.username|| sess.member_id), body, avatar_url: '' };
        // try get avatar
        if(window.CineAura && window.CineAura.avatarUrlFor){
          try{ payload.avatar_url = window.CineAura.avatarUrlFor(sess.member_id) || ''; }catch{}
        }
        const res = await supabaseRequest('/rest/v1/help_article_comments', {method:'POST', body: JSON.stringify(payload)});
        if(!res.ok) throw new Error('comment fail');
        inp.value='';
        // update count
        await supabaseRequest(`/rest/v1/help_articles?id=eq.${articleId}`, {method:'PATCH', body: JSON.stringify({comments_count: comments.length+1})}).catch(()=>{});
        // reload
        const fresh = await fetchComments();
        countEl.textContent = String(fresh.length);
        listEl.innerHTML = fresh.map(c=> `<div class="help-cmt"><div class="help-cmt-head"><img src="${esc(c.avatar_url||'')}" onerror="this.src='https://via.placeholder.com/28'" alt="" /><b>${esc(c.username||c.member_id)}</b><span>${new Date(c.created_at).toLocaleString()}</span></div><p>${esc(c.body)}</p></div>`).join('');
        toast(t('help.commentAdded'));
      } catch(e){
        toast('Could not post. Run sql/help.sql');
      } finally { btn.disabled=false; }
    });
  }

  function showList(filterSlug){
    $('#help-list-view').hidden = false;
    $('#help-article-view').hidden = true;
    const q = ($('#help-search')?.value || '').trim();
    renderList(filterSlug, q);
    const total = filtered.length;
    $('#help-meta').textContent = total ? `${total} ${t('help.articlesFound')}` : '';
    window.scrollTo({top:0, behavior:'smooth'});
  }

  async function init(){
    categories = await fetchCategories();
    articles = await fetchArticles();
    filtered = [...articles];
    const params = qParams();
    const id = params.get('id') || params.get('article');
    const cat = params.get('cat');
    const q = params.get('q');

    // render toc
    const byParent = buildTree(categories);
    $('#help-toc').innerHTML = `<div class="help-toc-head"><strong>${t('help.sections')}</strong><span style="font-size:12px;color:var(--muted)">${articles.length}</span></div>${renderToc(byParent, cat)}<div style="padding:10px"><a class="btn btn-sm btn-ghost" href="#" id="help-clear" style="width:100%">${t('common.all')}</a></div>`;
    // bind toc
    $$('#help-toc [data-cat]').forEach(btn=> btn.addEventListener('click', ()=>{
      const slug = btn.dataset.cat;
      btn.closest('.help-cat').classList.toggle('open');
    }));
    $$('#help-toc [data-sub]').forEach(a=> a.addEventListener('click', (e)=>{ e.preventDefault(); const slug=a.dataset.sub; history.pushState({},'','./help.html?cat='+encodeURIComponent(slug)); showList(slug); // highlight
      $$('#help-toc .help-sub').forEach(x=> x.classList.remove('active')); a.classList.add('active');
    }));
    $('#help-clear').addEventListener('click', (e)=>{ e.preventDefault(); history.pushState({},'','./help.html'); $$('#help-toc .help-sub').forEach(x=> x.classList.remove('active')); showList(null); $('#help-search').value=''; });

    // search
    const searchInput = $('#help-search');
    const doSearch = ()=>{
      const qv = searchInput.value.trim();
      const url = new URL(location.href);
      if(qv) url.searchParams.set('q', qv); else url.searchParams.delete('q');
      history.replaceState({},'',url);
      showList(cat);
    };
    searchInput.addEventListener('input', ()=>{
      clearTimeout(searchInput._t);
      searchInput._t = setTimeout(doSearch, 300);
    });
    $('#help-search-btn').addEventListener('click', doSearch);
    if(q) searchInput.value = q;
    // initial view
    if(cat) showList(cat); else showList(null);
    if(id){
      // need ensure articles loaded
      setTimeout(()=> showArticle(id), 200);
    }

    // translate
    if(window.CineAura && window.CineAura.translateDom) window.CineAura.translateDom(document);
  }

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('popstate', ()=>{
    const p = qParams();
    const id = p.get('id');
    const cat = p.get('cat');
    if(id) showArticle(id); else showList(cat);
  });
})();
