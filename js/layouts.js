/* CineAura layouts engine — per-style presets + per-member custom ordering
   Pages: home, watch, content, market, dashboard, profile
   Presets mimic each appearance style's native section order.
   Persists: localStorage cineaura_layout (+ profiles.layout_config via supabase if logged in)
   Also handles: homepage pins (TMDB ids) and dashboard/profile shortcuts.
*/
(function(){
  "use strict";
  const LS_KEY = "cineaura_layout";
  const PIN_KEY = "cineaura_home_pins";
  const SHORT_KEY = "cineaura_shortcuts";
  const VALID_STYLES = ["default","facebook","youtube","instagram","netflix","prime","appletv","win7","win8","win10","win11","macos","android","ios"];

  // Canonical section IDs per page (order = site default)
  const HOME_BASE = ["hero","trust","search","live-updates","features","movies","series","iptv","points-levels","prizes","videos","home-market","app","plans","support","platforms"];
  const WATCH_BASE = ["title-info","directors-section","cast-section","watch-providers","player-wrap","link-detail","episode-bar","watch-share","watch-links","watch-social","collection-section","similar-section","related-section"];
  // content page (videos.html) : vw-search, vw-main, vw-side (with vw-offers, vw-sugg)
  const CONTENT_BASE = ["vw-search","vw-main","vw-side"];
  // market: mkt-hero, mkt-layout (contains mkt-side + mkt-main)
  const MARKET_BASE = ["mkt-hero","mkt-layout"];
  // dashboard: NAV_GROUPS in js/dashboard.js, groups included. The sidebar is not
  // a flat list — «Main», «Content», «Performance», «Earnings» and «Account» are
  // headings that own the buttons under them, and the order keeps them together.
  const DASH_GROUPS = [
    { key:"main",    ids:["overview","level","points"] },
    { key:"content", ids:["upload","articles","documents","links","codes","playlists","iptv"] },
    { key:"perf",    ids:["views","analytics","reports","history"] },
    { key:"earn",    ids:["withdraw","prizes"] },
    { key:"account", ids:["customize","settings"] },
  ];
  const DASH_BASE = DASH_GROUPS.flatMap((g)=>g.ids);
  // profile: NAV_SECTIONS in js/profile.js (Market and Community joined the column)
  const PROFILE_BASE = ["home","market","community","create","content","posts","messages","search","following","blocked","settings"];

  const BASES = { home:HOME_BASE, watch:WATCH_BASE, content:CONTENT_BASE, market:MARKET_BASE, dashboard:DASH_BASE, profile:PROFILE_BASE };

  // The saved order of the group headings (Main, Content, …), completed with any
  // group the config does not know yet so a new group can never disappear.
  function groupOrder(cfg){
    const saved=(cfg && cfg.groups && Array.isArray(cfg.groups.dashboard)) ? cfg.groups.dashboard : [];
    const out=saved.filter((k)=> DASH_GROUPS.some((g)=>g.key===k));
    DASH_GROUPS.forEach((g)=>{ if(!out.includes(g.key)) out.push(g.key); });
    return out;
  }

  /* Insert the sections a saved order is missing, next to the neighbours the
     site gives them — not at the end. A config saved before Articles and
     Documents existed therefore keeps its taste and gains them where they
     belong, and the same rule keeps every style preset complete. */
  function normalizeOrder(page, arr){
    const base=BASES[page]||[];
    const list=Array.isArray(arr)? arr.slice() : [];
    const kept=list.filter((id)=> base.includes(id) || (typeof id==="string" && id.startsWith("shortcut-")));
    base.forEach((id, i)=>{
      if(kept.includes(id)) return;
      let pos=-1;
      for(let j=i-1;j>=0;j--){ const at=kept.indexOf(base[j]); if(at>=0){ pos=at; break; } }
      if(pos<0) kept.unshift(id); else kept.splice(pos+1,0,id);
    });
    return kept;
  }

  // Presets per style — each "mimics" that platform/system's section priority
  const PRESETS = {
    default:{ home:HOME_BASE.slice(), watch:WATCH_BASE.slice(), content:CONTENT_BASE.slice(), market:MARKET_BASE.slice(), dashboard:DASH_BASE.slice(), profile:PROFILE_BASE.slice(), label:"الافتراضي — ترتيب CineAura المعتمد", desc:"الترتيب الأصلي للموقع" },
    facebook:{ home:["hero","live-updates","movies","series","features","videos","search","trust","home-market","iptv","prizes","points-levels","app","plans","support","platforms"], watch:["title-info","watch-providers","player-wrap","watch-links","watch-social","directors-section","cast-section","collection-section","similar-section","related-section"], dashboard:["overview","reports","messages","points","playlists","links","codes","iptv","views","analytics","prizes","withdraw","history","settings"], profile:["home","posts","messages","following","search","content","create","blocked","settings"], label:"فيسبوك — نفس ترتيب الأقسام في فيسبوك", desc:"الخلاصة أولاً ثم المجموعات" },
    youtube:{ home:["hero","live-updates","search","movies","series","videos","iptv","features","home-market","trust","points-levels","prizes","app","plans","support","platforms"], watch:["player-wrap","title-info","watch-providers","watch-links","watch-social","directors-section","cast-section","collection-section","similar-section","related-section"], dashboard:["overview","views","analytics","points","playlists","links","reports","codes","iptv","prizes","withdraw","history","settings"], profile:["content","posts","home","create","search","messages","following","blocked","settings"], label:"يوتيوب — نفس ترتيب يوتيوب", desc:"الفيديو والاقتراحات أولاً" },
    instagram:{ home:["hero","live-updates","movies","series","videos","home-market","search","features","trust","iptv","points-levels","prizes","app","plans","support","platforms"], watch:["player-wrap","title-info","watch-social","watch-links","directors-section","cast-section","watch-providers","collection-section","similar-section","related-section"], dashboard:["overview","points","prizes","playlists","views","analytics","links","reports","codes","iptv","withdraw","history","settings"], profile:["home","posts","create","search","following","messages","content","blocked","settings"], label:"انستغرام — شبكة مربعة", desc:"الصور/الفيديو ثم الاستكشاف" },
    netflix:{ home:["hero","live-updates","movies","series","iptv","videos","home-market","features","search","trust","points-levels","prizes","app","plans","support","platforms"], watch:["player-wrap","title-info","watch-links","watch-providers","watch-social","directors-section","cast-section","collection-section","similar-section","related-section"], dashboard:["overview","points","prizes","history","playlists","links","views","analytics","reports","codes","iptv","withdraw","settings"], profile:["home","posts","content","messages","following","search","create","blocked","settings"], label:"نتفليكس — صفوف سينمائية", desc:"صفوف أفلام أفقية أولاً" },
    prime:{ home:["trust","live-updates","search","hero","movies","series","videos","iptv","home-market","features","points-levels","prizes","app","plans","support","platforms"], watch:["watch-providers","player-wrap","title-info","watch-links","watch-social","directors-section","cast-section","collection-section","similar-section","related-section"], dashboard:["overview","points","prizes","playlists","links","views","analytics","iptv","codes","reports","withdraw","history","settings"], profile:["home","posts","content","messages","create","search","following","blocked","settings"], label:"أمازون برايم — متجر ومشاهدة", desc:"البحث والعروض أولاً" },
    appletv:{ home:["hero","live-updates","search","movies","series","videos","iptv","app","home-market","trust","points-levels","features","prizes","plans","support","platforms"], watch:["player-wrap","title-info","watch-providers","watch-links","watch-social","directors-section","cast-section","collection-section","similar-section","related-section"], dashboard:["overview","points","views","analytics","playlists","links","prizes","reports","codes","iptv","withdraw","history","settings"], profile:["home","content","posts","create","messages","search","following","blocked","settings"], label:"آبل تيفي — داكن بسيط", desc:"المحتوى المميز في الوسط" },
    win7:{ home:["search","live-updates","trust","hero","features","movies","series","videos","iptv","home-market","points-levels","prizes","app","plans","support","platforms"], watch:["title-info","player-wrap","watch-providers","watch-links","watch-social","directors-section","cast-section","collection-section","similar-section","related-section"], dashboard:["overview","points","views","analytics","playlists","links","reports","codes","iptv","prizes","withdraw","history","settings"], profile:["home","posts","content","create","search","messages","following","blocked","settings"], label:"ويندوز 7 — إيرو", desc:"شريط البحث ثم النافذة الوسطية" },
    win8:{ home:["hero","live-updates","features","movies","series","videos","search","iptv","home-market","trust","points-levels","prizes","app","plans","support","platforms"], watch:["player-wrap","title-info","watch-providers","watch-links","watch-social","directors-section","cast-section","collection-section","similar-section","related-section"], dashboard:["overview","points","playlists","links","reports","codes","iptv","views","analytics","prizes","withdraw","history","settings"], profile:["home","posts","content","messages","search","following","blocked","create","settings"], label:"ويندوز 8 — ميترو بلاطات", desc:"بلاطات مسطحة أولاً" },
    win10:{ home:["hero","live-updates","trust","search","features","movies","series","videos","iptv","home-market","points-levels","prizes","app","plans","support","platforms"], watch:["title-info","player-wrap","watch-links","watch-social","watch-providers","directors-section","cast-section","collection-section","similar-section","related-section"], dashboard:["overview","points","views","analytics","prizes","playlists","links","reports","codes","iptv","withdraw","history","settings"], profile:["home","posts","content","messages","search","following","create","blocked","settings"], label:"ويندوز 10 — فلوينت", desc:"القائمة الجانبية مع بحث" },
    win11:{ home:["hero","live-updates","search","trust","features","movies","series","videos","home-market","iptv","points-levels","prizes","app","plans","support","platforms"], watch:["title-info","player-wrap","watch-providers","watch-links","watch-social","directors-section","cast-section","collection-section","similar-section","related-section"], dashboard:["overview","points","views","analytics","playlists","links","reports","codes","iptv","prizes","withdraw","history","settings"], profile:["home","create","posts","content","search","messages","following","blocked","settings"], label:"ويندوز 11 — ميكا متوسط", desc:"موسّط ومستدير" },
    macos:{ home:["hero","live-updates","trust","search","features","movies","series","videos","iptv","home-market","points-levels","prizes","app","plans","support","platforms"], watch:["title-info","player-wrap","watch-providers","watch-links","watch-social","directors-section","cast-section","collection-section","similar-section","related-section"], dashboard:["overview","analytics","views","points","playlists","links","reports","codes","iptv","prizes","withdraw","history","settings"], profile:["home","posts","content","create","messages","search","following","blocked","settings"], label:"ماك أو إس — شفاف", desc:"شريط علوي شفاف" },
    android:{ home:["hero","live-updates","search","movies","series","videos","features","iptv","home-market","trust","points-levels","prizes","app","plans","support","platforms"], watch:["player-wrap","title-info","watch-links","watch-social","watch-providers","directors-section","cast-section","collection-section","similar-section","related-section"], dashboard:["overview","points","playlists","links","reports","codes","iptv","views","analytics","prizes","withdraw","history","settings"], profile:["home","posts","content","create","search","messages","following","blocked","settings"], label:"أندرويد — ماتريال", desc:"درج جانبي" },
    ios:{ home:["hero","live-updates","search","movies","series","videos","trust","features","home-market","iptv","points-levels","prizes","app","plans","support","platforms"], watch:["player-wrap","title-info","watch-providers","watch-links","watch-social","directors-section","cast-section","collection-section","similar-section","related-section"], dashboard:["overview","points","views","playlists","links","prizes","reports","codes","iptv","analytics","withdraw","history","settings"], profile:["home","posts","create","content","search","messages","following","blocked","settings"], label:"آي أو إس — بلور سفلي", desc:"تبويب سفلي" },
  };

  function getStyle(){ try{const s=localStorage.getItem("cineaura_style"); if(VALID_STYLES.includes(s)) return s;}catch{} return "default"; }
  function mergeMissing(cfg){
    // Auto-upgrade saved config when new sections (Articles, Documents, …) appear
    if(!cfg || !cfg.pages) return cfg;
    for(const page of Object.keys(BASES)){
      if(!cfg.pages[page] || !Array.isArray(cfg.pages[page])) continue;
      cfg.pages[page]=normalizeOrder(page, cfg.pages[page]);
    }
    return cfg;
  }
  function loadConfig(){
    // Preview override: if blob preview injected via window.__CINEAURA_PREVIEW__ or sessionStorage cineaura_preview, use it (no persist)
    try{
      if(window.__CINEAURA_PREVIEW__ && window.__CINEAURA_PREVIEW__.pages) return mergeMissing(JSON.parse(JSON.stringify(window.__CINEAURA_PREVIEW__)));
    }catch{}
    try{
      const pv=sessionStorage.getItem('cineaura_preview');
      if(pv){ const j=JSON.parse(pv); if(j&&j.pages) return mergeMissing(j); }
    }catch{}
    try{
      const sp=new URLSearchParams(location.search);
      if(sp.has('cine_preview')){
        const pv2=sessionStorage.getItem('cineaura_preview');
        if(pv2){ const j2=JSON.parse(pv2); if(j2&&j2.pages) return mergeMissing(j2); }
      }
    }catch{}
    try{ const raw=localStorage.getItem(LS_KEY); if(raw){ const j=JSON.parse(raw); if(j&&j.pages) return mergeMissing(j); } }catch{}
    // fallback to preset for current style
    const st=getStyle();
    const preset=PRESETS[st]||PRESETS.default;
    return mergeMissing({ preset:st, pages:{ home:preset.home.slice(), watch:preset.watch.slice(), content:preset.content.slice(), market:preset.market.slice(), dashboard:preset.dashboard.slice(), profile:preset.profile.slice() }, shortcuts:{}, pins:[] });
  }
  function saveConfig(cfg){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(cfg)); }catch{}
    // also push to profiles.layout_config if logged in (best-effort)
    try{
      const C=window.CineAura; const s=C&&C.getSession&&C.getSession(); if(s&&s.member_id && C.supabaseRequest && C.restValue){
        C.supabaseRequest(`/rest/v1/profiles?member_id=eq.${C.restValue(s.member_id)}`,{method:"PATCH", body:JSON.stringify({ layout_config:cfg }) }).catch(()=>{});
      }
    }catch{}
  }
  function resetToPreset(styleId){
    styleId = VALID_STYLES.includes(styleId)? styleId : getStyle();
    const p=PRESETS[styleId]||PRESETS.default;
    const cfg=mergeMissing({ preset:styleId, pages:{ home:p.home.slice(), watch:p.watch.slice(), content:p.content.slice(), market:p.market.slice(), dashboard:p.dashboard.slice(), profile:p.profile.slice() }, shortcuts:{}, pins:[] });
    saveConfig(cfg);
    return cfg;
  }
  function resetToDefault(){ return resetToPreset("default"); }

  // Apply ordering to DOM
  function ensureShortcutElements(container, order){
    order.forEach(id=>{
      if(!id || !id.startsWith("shortcut-")) return;
      if(document.getElementById(id)) return;
      // parse shortcut-source-sid
      const parts=id.split("-");
      // shortcut-dashboard-overview-xyz -> source=parts[1], sid=parts[2]
      const source=parts[1]||"dashboard", sid=parts[2]||"shortcut";
      const sec=document.createElement("section");
      sec.id=id;
      sec.className="section";
      sec.innerHTML=`
        <div class="container">
          <div class="section-head">
            <div><div class="kicker"><span class="kicker-num">↗</span><span class="eyebrow">${source}</span></div><h2>اختصار ${sid}</h2></div>
          </div>
          <div class="glass" style="padding:16px">
            <p>اختصار من <b>${source}</b> • <b>${sid}</b></p>
            <a class="btn btn-sm btn-primary" href="./${source==="dashboard"?"dashboard.html": source==="profile"?"profile.html": source==="market"?"market.html": source==="iptv"?"index.html#iptv": source+".html"}#${sid}">فتح</a>
          </div>
        </div>`;
      container.appendChild(sec);
    });
  }
  function applyHomeOrder(order){
    let main=document.querySelector("main.page-main") || document.querySelector("main");
    if(!main) return;
    ensureShortcutElements(main, order);
    // Collect direct section/div children that contain known IDs
    const byId={};
    const others=[];
    [...main.children].forEach(ch=>{
      const id=ch.id;
      if(id && order.includes(id)) byId[id]=ch;
      else if(ch.classList.contains("trust") && order.includes("trust")) byId["trust"]=ch;
      else others.push(ch);
    });
    // Also handle #hero section special (id hero)
    // Re-append in order — but only when the sequence truly differs (text
    // selection dies the moment a node is re-parented, even into place).
    const desired=order.filter(id=>byId[id]);
    if(!sequenceMatches(main, desired, (ch)=>{
      if(ch.id && order.includes(ch.id)) return ch.id;
      if(ch.classList.contains("trust") && order.includes("trust")) return "trust";
      return null;
    })){
      order.forEach(id=>{
        const el=byId[id];
        if(el) main.appendChild(el);
      });
    }
    // Ensure trust handled (it is a div not section, class trust)
    // If order contains trust but not found as id, find .trust
    if(order.includes("trust")){
      const trustEl=document.querySelector(".trust");
      if(trustEl) {
        // place after hero if hero exists
        const hero=document.getElementById("hero");
        // Move according to order: we already appended via byId if trust was identified
      }
    }
  }
  function applyWatchOrder(order){
    const root=document.getElementById("watch-root");
    if(!root) return;
    ensureShortcutElements(root, order);
    const map={};
    [...root.children].forEach(ch=>{ if(ch.id) map[ch.id]=ch; });
    // player-wrap is a div without id, containing #player
    const playerWrap=document.querySelector(".player-wrap");
    if(playerWrap) map["player-wrap"]=playerWrap;
    // also handle shortcut ids
    [...root.children].forEach(ch=>{ if(ch.id && ch.id.startsWith("shortcut-")) map[ch.id]=ch; });
    // Only move when the order differs (moving a node kills text selection).
    const wanted=order.filter(id=>map[id]);
    if(!sequenceMatches(root, wanted, (ch)=>{
      if(ch.classList && ch.classList.contains("player-wrap") && order.includes("player-wrap")) return "player-wrap";
      return (ch.id && map[ch.id]===ch && order.includes(ch.id)) ? ch.id : null;
    })){
      order.forEach(id=>{
        const el=map[id];
        if(el) root.appendChild(el);
      });
    }
  }
  function applyGenericOrder(containerSel, order, idAttr){
    const cont=document.querySelector(containerSel);
    if(!cont) return;
    ensureShortcutElements(cont, order);
    const map={};
    [...cont.children].forEach(ch=>{
      const key=ch.id || ch.getAttribute(idAttr)||"";
      if(key && order.includes(key)) map[key]=ch;
      if(ch.id && ch.id.startsWith("shortcut-")) map[ch.id]=ch;
    });
    // Only move when the order differs (moving a node kills text selection).
    const wanted=order.filter(id=>map[id]);
    if(!sequenceMatches(cont, wanted, (ch)=>{
      const key=ch.id || ch.getAttribute(idAttr)||"";
      return (key && map[key]===ch && order.includes(key)) ? key : null;
    })){
      order.forEach(id=>{
        const el=map[id];
        if(el) cont.appendChild(el);
      });
    }
  }

  function injectSideShortcuts(page, cfg){
    if(!cfg || !cfg.shortcuts) return;
    // Generic: key = source_in_target  (e.g. dashboard_in_profile)
    Object.entries(cfg.shortcuts).forEach(([key, ids])=>{
      if(!Array.isArray(ids) || !ids.length) return;
      const m=key.match(/^(.+)_in_(.+)$/);
      if(!m) return;
      const source=m[1], target=m[2];
      if(target!==page) return;
      // target is current page, inject ids from source
      let nav=null;
      if(target==="dashboard") nav=document.querySelector("#dash-root .side-nav");
      else if(target==="profile") nav=document.querySelector("#prof-root .prof-side nav, #prof-root nav");
      else if(target==="home") nav=null; // home has no side nav, skip side injection (handled as section shortcuts)
      if(!nav) return;
      // clear previous injected shortcuts for this source
      nav.querySelectorAll(`[data-shortcut-source="${source}"]`).forEach(el=> el.remove());
      const C=window.CineAura;
      // helper to get username for profile links
      let username="";
      try{
        if(C&&C.getSession){
          const s=C.getSession(); if(s&&s.username) username=s.username;
          if(!username){ const st=localStorage.getItem("cineaura_session"); if(st){ const j=JSON.parse(st); username=j.username||j.user||""; } }
        }
      }catch{}
      ids.forEach(sid=>{
        // avoid duplicating if target already has this id as normal item (order already contains it)
        // create shortcut element
        let el;
        if(target==="dashboard"){
          // profile/market/iptv shortcut in dashboard → link to that page
          let href="#";
          if(source==="profile") href = username ? `./profile.html?@${encodeURIComponent(username)}#${sid}` : `./profile.html#${sid}`;
          else if(source==="market") href = `./market.html#${sid}`;
          else if(source==="iptv") href = `./index.html#${sid}`;
          else href = `./${source}.html#${sid}`;
          el=document.createElement("a");
          el.href=href;
          el.className="shortcut-link";
          el.setAttribute("data-shortcut-source", source);
          el.setAttribute("data-shortcut-id", sid);
          el.style.cssText="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;border:1px dashed rgba(1,180,228,.35);background:rgba(1,180,228,.08);font-size:13px;font-weight:600;color:inherit;text-decoration:none;";
          const icon = C&&C.navIcon ? C.navIcon(sid) : "↗";
          const label = C&&C.t ? C.t(`dash.nav.${sid}`) : sid;
          el.innerHTML=`${icon}<span style="flex:1">${label !== `dash.nav.${sid}` ? label : sid} <small style="opacity:.6;font-size:10px">↗ ${source}</small></span>`;
        } else if(target==="profile"){
          // dashboard/market/iptv shortcut in profile → link to dashboard etc
          let href="#";
          if(source==="dashboard") href=`./dashboard.html#${sid}`;
          else if(source==="market") href=`./market.html#${sid}`;
          else if(source==="iptv") href=`./index.html#${sid}`;
          else href=`./${source}.html#${sid}`;
          el=document.createElement("a");
          el.href=href;
          el.className="shortcut-link";
          el.setAttribute("data-shortcut-source", source);
          el.setAttribute("data-shortcut-id", sid);
          el.style.cssText="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;border:1px dashed rgba(144,206,161,.45);background:rgba(144,206,161,.08);font-size:13px;font-weight:600;color:inherit;text-decoration:none;";
          const icon = C&&C.navIcon ? C.navIcon(sid) : "↗";
          const label = C&&C.t ? C.t(`prof.${sid}`) : sid;
          // profile uses button style: we adapt to <a> but keep similar
          const lbl = label !== `prof.${sid}` ? label : sid;
          el.innerHTML=`${icon}<span style="flex:1">${lbl} <small style="opacity:.6;font-size:10px">↗ ${source}</small></span>`;
        }
        if(el) nav.appendChild(el);
      });
    });
  }
  function applyDashboardOrder(order, groups){
    const nav=document.querySelector("#dash-root .side-nav");
    if(!nav) return;
    const btns={}, heads={};
    [...nav.children].forEach((el)=>{
      const sec=el.getAttribute("data-section");
      if(sec) btns[sec]=el;
      const grp=el.getAttribute("data-grp");
      if(grp) heads[grp]=el;
    });
    // the arrangement the member saved, then any heading the page renders that
    // the config does not know (a group added after the config was saved)
    const gOrder=(Array.isArray(groups)? groups : []).filter((k)=> DASH_GROUPS.some((g)=>g.key===k));
    DASH_GROUPS.forEach((g)=>{ if(heads[g.key] && !gOrder.includes(g.key)) gOrder.push(g.key); });

    // one sequence of nodes: heading, then the buttons that belong under it.
    // A button whose group is unknown (a future section) keeps its place at the end.
    const seq=[];
    gOrder.forEach((key)=>{
      const def=DASH_GROUPS.find((g)=>g.key===key);
      if(!def) return;
      if(heads[key]) seq.push({ tag:"#"+key, el:heads[key] });
      const wanted=(order||[]).filter((id)=> def.ids.includes(id) && btns[id]);
      def.ids.forEach((id)=>{ if(btns[id] && !wanted.includes(id)) wanted.push(id); });
      wanted.forEach((id)=> seq.push({ tag:id, el:btns[id] }));
    });
    const placed=new Set(seq.map((x)=>x.el).filter(Boolean));
    [...nav.children].forEach((el)=>{ if(!placed.has(el)) seq.push({ tag:null, el }); });

    // Skip the DOM work when the nav is already in that order — moving nodes
    // collapses any text selection the member has on the page.
    const current=[...nav.children].map((el)=>{
      const g=el.getAttribute("data-grp");
      if(g) return "#"+g;
      return el.getAttribute("data-section") || null;
    });
    const same = seq.length===current.length && seq.every((x,i)=> x.tag===current[i]);
    if(!same){
      const frag=document.createDocumentFragment();
      seq.forEach((x)=>{ if(x.el) frag.appendChild(x.el); });
      nav.appendChild(frag);
    }
    try{ const cfg=loadConfig(); injectSideShortcuts("dashboard", cfg); }catch{}
  }

  function applyProfileOrder(order){
    const nav=document.querySelector("#prof-root .prof-side nav, #prof-root nav");
    if(!nav) return;
    const map={};
    [...nav.querySelectorAll("button[data-sec]")].forEach(b=> map[b.dataset.sec]=b);
    // No-op when the nav already matches — re-parenting kills text selection.
    const current=[...nav.querySelectorAll("button[data-sec]")].map(b=> b.dataset.sec);
    const wanted=order.filter(k=> map[k]);
    const same= wanted.length===current.length && wanted.every((k,i)=> k===current[i]);
    if(!same){
      order.forEach(k=>{ const el=map[k]; if(el) nav.appendChild(el); });
    }
    try{ const cfg=loadConfig(); injectSideShortcuts("profile", cfg); }catch{}
  }

  /* Selection-safe DOM moves: removing and re-appending a node collapses any
     text selection anchored in it. Before any reorder, compare the current
     sequence with the target one and touch the DOM only when it differs. */
  function sequenceMatches(container, desired, keyOf){
    if(!container) return false;
    const keys=[];
    for(const ch of container.children){
      const k=keyOf(ch);
      if(k!=null) keys.push(k);
    }
    if(keys.length!==desired.length) return false;
    for(let i=0;i<desired.length;i++){ if(keys[i]!==desired[i]) return false; }
    return true;
  }
  function applyHidden(cfg, page){
    // Respect hidden sections saved via editor: hide them outside edit mode
    try{
      const hidden = (cfg.hidden && cfg.hidden[page]) || JSON.parse(localStorage.getItem("cineaura_hidden_sections")||"{}")[page] || [];
      if(!hidden || !hidden.length) return;
      hidden.forEach(id=>{
        const el=document.getElementById(id);
        if(el && !el.hidden) { el.hidden=true; el.style.display="none"; }
      });
    }catch{}
  }
  function hasActiveSelection(){
    try{
      const sel=window.getSelection&&window.getSelection();
      if(!sel||sel.isCollapsed||!sel.rangeCount) return false;
      const txt=sel.toString().trim();
      return txt.length>0;
    }catch{ return false; }
  }
  function isSelectionInside(container){
    try{
      const sel=window.getSelection&&window.getSelection();
      if(!sel||!sel.rangeCount||sel.isCollapsed) return false;
      const anchor=sel.anchorNode&&sel.anchorNode.parentElement;
      const focus=sel.focusNode&&sel.focusNode.parentElement;
      if(anchor&&container&&container.contains(anchor)) return true;
      if(focus&&container&&container.contains(focus)) return true;
      return false;
    }catch{ return false; }
  }
  // Global guard: prevent auto-scroll that destroys selection / jumps to top on button clicks
  try{
    const _origScrollIntoView=Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView=function(opts){
      try{
        // Allow explicit anchor navigations (e.g., #comments) and back-to-top with data-allow-scroll
        if(this.hasAttribute&&this.hasAttribute('data-allow-scroll')) return _origScrollIntoView.apply(this, arguments);
        // If user is selecting text, never scroll
        if(hasActiveSelection()) return;
        // Prevent watch page generic hash links that scroll watch to top (handled elsewhere)
        if(location.pathname.toLowerCase().includes('watch') && this.id==='watch-root') return;
      }catch{}
      return _origScrollIntoView.apply(this, arguments);
    };
    const _origScrollTo=window.scrollTo.bind(window);
    window.scrollTo=function(a,b){
      try{
        if(hasActiveSelection()) return;
      }catch{}
      return _origScrollTo(a,b);
    };
    // Also guard window.scroll (alias)
    const _origScroll=window.scroll.bind(window);
    window.scroll=function(a,b){
      try{ if(hasActiveSelection()) return; }catch{}
      return _origScroll(a,b);
    };
  }catch{}
  function applyAll(cfg){
    cfg=cfg||loadConfig();
    // Do not destroy user text selection — skip DOM reorder while selecting
    try{
      if(hasActiveSelection()){
        const watchRoot=document.getElementById('watch-root');
        const main=document.querySelector('main.page-main')||document.querySelector('main');
        if((watchRoot&&isSelectionInside(watchRoot))||(main&&isSelectionInside(main))) return;
      }
      // If a native <select> dropdown is open (Region selector on watch), don't reorder — it causes jump + close
      const _aeSel=document.activeElement;
      if(_aeSel && _aeSel.tagName==='SELECT'){
        const watchRoot=document.getElementById('watch-root');
        const main=document.querySelector('main.page-main')||document.querySelector('main');
        if((watchRoot && watchRoot.contains(_aeSel)) || (main && main.contains(_aeSel))) return;
      }
    }catch{}
    // Scroll-lock: prevent jump-to-top during reorder (no animated bounce)
    const _sx=window.scrollX, _sy=window.scrollY;
    const _ae=document.activeElement;
    const _isSelectOpen=_ae && _ae.tagName==='SELECT';
    const page = detectPage();
    if(page==="home") applyHomeOrder(cfg.pages.home||PRESETS.default.home);
    if(page==="watch") applyWatchOrder(cfg.pages.watch||PRESETS.default.watch);
    if(page==="content") applyGenericOrder("#vw-root .vw-layout", cfg.pages.content||PRESETS.default.content, "id");
    if(page==="market") applyGenericOrder("#mkt-root", cfg.pages.market||PRESETS.default.market, "id");
    if(page==="dashboard") applyDashboardOrder(cfg.pages.dashboard||PRESETS.default.dashboard, groupOrder(cfg));
    if(page==="profile") applyProfileOrder(cfg.pages.profile||PRESETS.default.profile);
    // Apply hidden (skip when in edit mode — editor handles its own visibility)
    if(!document.documentElement.classList.contains("ce-editing-root")){
      applyHidden(cfg, page);
    }
    // Apply homepage pins (add extra rail)
    applyPins(cfg.pins||[]);
    // If DOM reorder caused a jump, restore silently without triggering menu-close scroll handlers
    try{
      if(!_isSelectOpen && (Math.abs(window.scrollY-_sy)>2||Math.abs(window.scrollX-_sx)>2)){
        // Use instant restore and suppress the scroll event that would close native <select> / menus
        window._lzScrollLock=true;
        window.scrollTo({left:_sx, top:_sy, behavior:'instant'});
        setTimeout(()=>{ window._lzScrollLock=false; }, 50);
      }
    }catch{}
    // Shortcuts: handled inside profile/dashboard render via event
    document.dispatchEvent(new CustomEvent("cineaura:layout-applied",{detail:{cfg,page}}));
  }

  function detectPage(){
    if(document.getElementById("hero")) return "home";
    if(document.getElementById("watch-root")) return "watch";
    if(document.getElementById("vw-root")) return "content";
    if(document.getElementById("mkt-root")) return "market";
    if(document.getElementById("dash-root")) return "dashboard";
    if(document.getElementById("prof-root")) return "profile";
    return "unknown";
  }

  function getPins(){ try{ const r=localStorage.getItem(PIN_KEY); return r?JSON.parse(r):[] }catch{return []} }
  function setPins(arr){ try{ localStorage.setItem(PIN_KEY, JSON.stringify(arr)); }catch{} 
    const cfg=loadConfig(); cfg.pins=arr; saveConfig(cfg);
  }
  function addPin(tmdbId){ const a=getPins(); if(!a.includes(tmdbId)){ a.push(tmdbId); setPins(a); } }
  function removePin(tmdbId){ let a=getPins().filter(x=>x!==tmdbId); setPins(a); }

  function applyPins(pins){
    // homepage rails only: main.page-main is also #dash-root and #prof-root
    if(detectPage()!=="home") return;
    const main=document.querySelector("main.page-main");
    if(!main || !pins || !pins.length) return;
    let rail=document.getElementById("home-pins-rail");
    if(!rail){
      rail=document.createElement("section");
      rail.id="home-pins-rail";
      rail.className="section";
      rail.innerHTML=`<div class="container"><div class="section-head"><div><div class="kicker"><span class="kicker-num">★</span><span class="eyebrow">مخصص</span></div><h2>أفلامك المثبتة</h2></div></div><div class="marquee-wrap"><div class="marquee" id="home-pins-track"></div></div></div>`;
      // Insert after hero
      const hero=document.getElementById("hero");
      if(hero && hero.nextSibling) main.insertBefore(rail, hero.nextSibling.nextSibling);
      else main.prepend(rail);
    }
    const track=document.getElementById("home-pins-track");
    if(!track) return;
    // Render pins as simple poster placeholders; real TMDB fetch will be done if js/main.js provides helper
    // We attempt to fetch via TMDB if window.CineAura.tmdb available
    (async()=>{
      const C=window.CineAura;
      if(!C||!C.tmdb) {
        track.innerHTML=pins.map(id=>`<a class="poster-card" href="./watch.html?tmdb=${id}"><div class="poster-media"><img alt="" src="" /></div><div class="poster-info"><h3>#${id}</h3></div></a>`).join("");
        return;
      }
      track.innerHTML="";
      for(const id of pins){
        try{
          const res=await C.tmdb(`/movie/${id}`);
          const m=res.data||{};
          const img=m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : "";
          const a=document.createElement("a");
          a.className="poster-card";
          a.href=`./watch.html?tmdb=${id}`;
          a.innerHTML=`<div class="poster-media"><img alt="${(m.title||"").replace(/"/g,'&quot;')}" src="${img}" loading="lazy"></div><div class="poster-info"><h3>${(m.title||"Film #"+id)}</h3><div class="poster-sub">${(m.release_date||"").slice(0,4)}</div></div>`;
          track.appendChild(a);
        }catch{}
      }
    })();
  }

  // hydrate from supabase profile if available
  async function hydrateFromProfile(){
    try{
      const C=window.CineAura; const s=C&&C.getSession&&C.getSession(); if(!s||!s.member_id) return;
      const res=await C.supabaseRequest(`/rest/v1/profiles?member_id=eq.${C.restValue(s.member_id)}&select=layout_config`);
      const p=res.data&&res.data[0];
      if(p&&p.layout_config && p.layout_config.pages){
        // don't override if local is newer (local has preset+timestamp?) For now if profile has config and local is default preset, adopt profile
        const local=loadConfig();
        // if local is default preset for current style and profile preset differs, adopt profile
        localStorage.setItem(LS_KEY, JSON.stringify(p.layout_config));
      }
    }catch{}
  }

  // Init
  function init(){
    // Try hydrate then apply
    hydrateFromProfile().finally(()=> applyAll());
    // The dashboard paints its sidebar asynchronously; when it says so, the saved
    // order is applied at once instead of waiting for the MutationObserver.
    document.addEventListener("cineaura:dash-nav", ()=>{
      try{ applyAll(); }catch{}
    });
    // Re-apply on style change
    document.addEventListener("cineaura:prefs", (e)=>{
      if(e.detail && e.detail.style){
        // if user hasn't customized (local preset equals default for old style), migrate to new preset
        const cfg=loadConfig();
        // if cfg preset still old, we could auto-switch to new preset's ordering unless user has custom pins/shortcuts
        // For now, if no custom flag, adopt new preset
        if(cfg && !cfg.customized){
          const np=PRESETS[e.detail.style];
          if(np){
            cfg.preset=e.detail.style;
            cfg.pages.home=np.home.slice();
            cfg.pages.watch=np.watch.slice();
            // keep others
            saveConfig(cfg);
          }
        }
        applyAll(cfg);
      }
    });
    // Also observe DOM ready for dashboard/profile which render async — but never during text selection or when user is typing
    const obs=new MutationObserver(()=>{
      try{
        if(window._lzScrollLock) return;
        if(hasActiveSelection()) return;
        const ae=document.activeElement;
        if(ae && (ae.tagName==='INPUT'||ae.tagName==='SELECT'||ae.tagName==='TEXTAREA'||ae.isContentEditable)) return;
      }catch{}
      // debounce apply
      clearTimeout(window._lzApplyTimer);
      window._lzApplyTimer=setTimeout(()=>applyAll(), 300);
    });
    obs.observe(document.documentElement,{childList:true, subtree:true});
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.CineAuraLayouts={ PRESETS, HOME_BASE, WATCH_BASE, CONTENT_BASE, MARKET_BASE, DASH_BASE, DASH_GROUPS, PROFILE_BASE, BASES, normalizeOrder, groupOrder, getStyle, loadConfig, saveConfig, resetToPreset, resetToDefault, applyAll, detectPage, getPins, setPins, addPin, removePin, VALID_STYLES };

})();
