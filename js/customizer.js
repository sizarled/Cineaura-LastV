/* Customizer overlay — Templates / Styles / Icons backed by storage bucket source */
(function(){
  "use strict";
  const BUCKET="source";
  const PREFIX_TMPL="Themes/Template";
  const PREFIX_STYLE="Themes/Style";
  const PREFIX_ICONS="Themes/Icons";

  let overlay=null, activePage="home", activeTab="templates";

  const PAGE_DEFS={
    home:{ label:"الصفحة الرئيسية", ids:()=> window.CineAuraLayouts? window.CineAuraLayouts.HOME_BASE : [] },
    watch:{ label:"المشاهدة", ids:()=> window.CineAuraLayouts? window.CineAuraLayouts.WATCH_BASE : [] },
    content:{ label:"المحتوى", ids:()=> ["vw-search","vw-main","vw-side"] },
    market:{ label:"المتجر", ids:()=> ["mkt-hero","mkt-layout"] },
    dashboard:{ label:"الداشبورد", ids:()=> window.CineAuraLayouts? window.CineAuraLayouts.DASH_BASE : [] },
    profile:{ label:"البروفايل", ids:()=> window.CineAuraLayouts? window.CineAuraLayouts.PROFILE_BASE : [] },
  };

  function t(k, fb){ const C=window.CineAura; return C&&C.t? C.t(k): fb||k; }

  // The reorder list used to print raw ids ("articles", "documents"). Name them
  // with the same strings the sidebar uses, so the new sections are readable.
  const PREFIX={ home:"", watch:"", content:"vid.", market:"mkt.", dashboard:"dash.nav.", profile:"prof." };
  function labelFor(page, id){
    const C=window.CineAura;
    if(!id || id.startsWith("shortcut-")) return id;
    if(!C || !C.t) return id;
    const tries=[];
    if(page==="dashboard") tries.push("dash.nav."+id);
    if(page==="profile") tries.push("prof."+id, "prof.nav."+id);
    if(page==="watch") tries.push("watch."+id);
    tries.push(id);
    for(const k of tries){ const v=C.t(k); if(v && v!==k) return v; }
    return id;
  }

  function buildOverlay(){
    if(overlay) return overlay;
    overlay=document.createElement("div");
    overlay.className="lz-overlay";
    overlay.hidden=true;
    overlay.innerHTML=`
      <div class="lz-card" role="dialog" aria-modal="true" aria-labelledby="lz-title">
        <div class="lz-head">
          <div>
            <h2 id="lz-title">تخصيص الموقع</h2>
            <p>رتّب الأقسام، ثبّت أفلامًا، وأنشئ ألوانًا وأيقوناتك الخاصة</p>
          </div>
          <div class="lz-actions">
            <button class="btn btn-sm" id="lz-preview" type="button" style="border:1px solid var(--cyan);color:var(--cyan)">👁 معاينة قبل التطبيق</button>
            <button class="btn btn-sm btn-ghost" id="lz-preset-save" type="button">حفظ كقالب</button>
            <button class="btn btn-sm btn-primary" id="lz-apply" type="button">تطبيق</button>
            <button class="btn btn-sm btn-ghost lz-x" type="button" aria-label="Close">✕</button>
          </div>
        </div>
        <div class="lz-body">
          <aside class="lz-side">
            <h3>الصفحات</h3>
            <div class="lz-nav" id="lz-pages"></div>
            <h3 style="margin-top:14px">الأنماط الجاهزة</h3>
            <div class="lz-presets" id="lz-presets-mini" style="grid-template-columns:1fr;gap:6px"></div>
            <div style="margin-top:12px;display:grid;gap:6px">
              <button class="btn btn-sm btn-ghost" id="lz-reset-preset" type="button">تطبيق تنسيق الصفحة حسب المظهر المختار</button>
              <button class="btn btn-sm btn-ghost" id="lz-reset-default" type="button">العودة إلى الوضع الافتراضي</button>
            </div>
          </aside>
          <div class="lz-main">
            <div class="lz-tabs" role="tablist">
              <button type="button" data-tab="templates" class="active">الترتيب والقوالب</button>
              <button type="button" data-tab="styles">الألوان والتنسيقات</button>
              <button type="button" data-tab="icons">الأيقونات</button>
              <button type="button" data-tab="pins">اختصارات وتثبيتات</button>
            </div>
            <div id="lz-panels"></div>
          </div>
        </div>
        <div class="lz-foot">
          <small class="lz-hint">يُحفظ تلقائيًا في جهازك وحسابك. ملفاتك في <code>source/Themes/...</code></small>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-sm" id="lz-preview-foot" type="button" style="border:1px solid var(--cyan);color:var(--cyan)">👁 معاينة</button>
            <button class="btn btn-sm btn-ghost" id="lz-close" type="button">إغلاق</button>
            <button class="btn btn-sm btn-primary" id="lz-save" type="button">حفظ التعديلات</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll(".lz-x, #lz-close").forEach(b=> b.addEventListener("click", close));
    overlay.addEventListener("mousedown", e=>{ if(e.target===overlay) { if(previewActive) cancelPreview(); close(); }});
    // page nav — preview-first workflow (visual editor removed 2026-10-19 per user request)
    const nav=overlay.querySelector("#lz-pages");
    Object.keys(PAGE_DEFS).forEach(k=>{
      const wrap=document.createElement("div"); wrap.style.display="grid"; wrap.style.gap="4px";
      const b=document.createElement("button");
      b.type="button"; b.dataset.page=k; b.textContent=PAGE_DEFS[k].label;
      b.style.width="100%";
      b.addEventListener("click", ()=>{ if(previewActive) cancelPreview(); activePage=k; render(); });
      const openBtn=document.createElement("button");
      openBtn.type="button"; openBtn.textContent="↗ فتح الصفحة";
      openBtn.className="btn btn-sm btn-ghost"; openBtn.style.fontSize="11px"; openBtn.style.padding="4px 6px";
      openBtn.addEventListener("click", ()=>{
        // visual editor removed — just navigate to page normally (no ?cine_edit)
        if(previewActive) cancelPreview();
        location.href=(k==="home"?"index.html":k==="watch"?"watch.html":k==="content"?"content.html":k==="market"?"market.html":k==="dashboard"?"dashboard.html":"profile.html");
      });
      wrap.append(b, openBtn);
      nav.appendChild(wrap);
    });
    overlay.querySelectorAll("[data-tab]").forEach(btn=>{
      btn.addEventListener("click",()=>{ activeTab=btn.dataset.tab; render(); });
    });
    overlay.querySelector("#lz-apply").addEventListener("click", applyCurrent);
    overlay.querySelector("#lz-save").addEventListener("click", saveAll);
    overlay.querySelector("#lz-preview").addEventListener("click", togglePreview);
    overlay.querySelector("#lz-preview-foot").addEventListener("click", togglePreview);
    overlay.querySelector("#lz-preset-save").addEventListener("click", saveAsTemplateFile);
    overlay.querySelector("#lz-reset-default").addEventListener("click", ()=>{
      const L=window.CineAuraLayouts; if(!L) return; const cfg=L.resetToDefault(); startPreviewWith(cfg, "معاينة الوضع الافتراضي");
    });
    overlay.querySelector("#lz-reset-preset").addEventListener("click", ()=>{
      const st=getStyle(); const L=window.CineAuraLayouts; if(!L) return; const cfg=L.resetToPreset(st); startPreviewWith(cfg, `معاينة تنسيق ${st}`);
    });
    // presets mini (style-based layout presets)
    const mini=overlay.querySelector("#lz-presets-mini");
    const styles=["default","facebook","youtube","instagram","netflix","prime","appletv","win7","win8","win10","win11","macos","android","ios"];
    styles.forEach(s=>{
      const L=window.CineAuraLayouts; const preset=L&&L.PRESETS[s];
      const b=document.createElement("button");
      b.type="button"; b.className="lz-preset"; b.style.padding="8px";
      b.innerHTML=`<b>${preset?preset.label:s}</b><small style="display:block;opacity:.7">${s}</small>`;
      // preview-first: apply temp, user must confirm via preview bar
      b.addEventListener("click",()=>{ const tempCfg=(()=>{
        const c=JSON.parse(JSON.stringify(getConfig())); const L2=window.CineAuraLayouts; const preset2=L2&&L2.PRESETS[s];
        if(preset2){ Object.keys(preset2).forEach(pk=>{ if(pk==="label"||pk==="desc") return; c.pages[pk]=preset2[pk].slice(); }); c.preset=s; }
        return c; })();
        startPreviewWith(tempCfg, `معاينة مظهر ${s}`);
      });
      mini.appendChild(b);
    });
    return overlay;
  }

  function getStyle(){ try{ return localStorage.getItem("cineaura_style")||"default"; }catch{return "default"} }
  function getConfig(){ return window.CineAuraLayouts? window.CineAuraLayouts.loadConfig() : {pages:{},pins:[],shortcuts:{}}; }

  function render(){
    buildOverlay();
    // active states — only page buttons with dataset.page
    overlay.querySelectorAll("#lz-pages button[data-page]").forEach(b=> b.classList.toggle("active", b.dataset.page===activePage));
    overlay.querySelectorAll("[data-tab]").forEach(b=> b.classList.toggle("active", b.dataset.tab===activeTab));
    const panels=overlay.querySelector("#lz-panels");
    panels.innerHTML="";
    if(activeTab==="templates") renderTemplates(panels);
    else if(activeTab==="styles") renderStyles(panels);
    else if(activeTab==="icons") renderIcons(panels);
    else if(activeTab==="pins") renderPins(panels);
  }

  function renderTemplates(root){
    const cfg=getConfig();
    const page=activePage;
    const defIds=PAGE_DEFS[page]? PAGE_DEFS[page].ids() : [];
    const L=window.CineAuraLayouts;
    const raw=(cfg.pages&&cfg.pages[page])? cfg.pages[page].slice() : defIds.slice();
    // new sections land next to their neighbours, never dumped at the end
    const order=L&&L.normalizeOrder? L.normalizeOrder(page, raw) : raw;
    defIds.forEach(id=>{ if(!order.includes(id)) order.push(id); });
    const banner=document.createElement("div"); banner.className="lz-panel"; banner.style.borderColor="var(--cyan)"; banner.style.background="color-mix(in srgb, var(--cyan) 8%, var(--surface))";
    banner.innerHTML=`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span>📄</span><b>${PAGE_DEFS[page].label}</b><span class="lz-hint" style="flex:1">رتّب هنا ثم اضغط <b>👁 معاينة</b> لترى النتيجة قبل الحفظ. المحرّر المرئي المباشر أُزيل — استخدم المعاينة ثم تطبيق.</span><button class="btn btn-sm btn-ghost" type="button" id="lz-open-live">↗ فتح الصفحة</button></div>`;
    root.appendChild(banner);
    banner.querySelector("#lz-open-live").onclick=()=>{
      if(previewActive) cancelPreview();
      location.href=(page==="home"?"index.html":page==="watch"?"watch.html":page==="content"?"content.html":page==="market"?"market.html":page==="dashboard"?"dashboard.html":"profile.html");
    };
    const panel=document.createElement("div"); panel.className="lz-panel";
    const grouped = page==="dashboard" && !!(L && Array.isArray(L.DASH_GROUPS));
    panel.innerHTML=`<h4>ترتيب أقسام — ${PAGE_DEFS[page].label}</h4><p class="lz-hint">${
      grouped
        ? "الأقسام موزّعة على مجموعات: اسحب القسم داخل مجموعته، واستخدم ↑ ↓ لنقل المجموعة كاملة (العنوان مع ما تحته)."
        : "اسحب لإعادة الترتيب"
    } ثم اضغط <b>معاينة قبل التطبيق</b> لمشاهدة التغيير مباشرة دون حفظ.</p>`;
    const list=document.createElement("div"); list.className="lz-list"; list.id="lz-order-list";

    const makeRow=(id)=>{
      const row=document.createElement("div"); row.className="lz-item"; row.draggable=true; row.dataset.id=id;
      row.innerHTML=`<span class="lz-handle">↕</span><span class="lz-name">${labelFor(page, id)}</span><label class="lz-toggle"><input type="checkbox" checked /> ظاهر</label>`;
      row.addEventListener("dragstart", (e)=>{ row.classList.add("dragging"); e.dataTransfer.effectAllowed="move"; e.dataTransfer.setData("text/plain", id); });
      row.addEventListener("dragend", ()=> row.classList.remove("dragging"));
      return row;
    };

    if(grouped){
      const gOrder=L.groupOrder? L.groupOrder(cfg) : L.DASH_GROUPS.map((g)=>g.key);
      gOrder.forEach((key)=>{
        const def=L.DASH_GROUPS.find((g)=>g.key===key);
        if(!def) return;
        const block=document.createElement("div"); block.className="lz-grp"; block.dataset.grp=key;
        const head=document.createElement("div"); head.className="lz-grp-head";
        head.innerHTML=`<span class="lz-grp-name">${t("dash.grp."+key, key)}</span>
          <span class="lz-grp-btns">
            <button class="btn btn-sm btn-ghost" type="button" data-gup aria-label="${t("dash.cust.grpUp")}" title="${t("dash.cust.grpUp")}">↑</button>
            <button class="btn btn-sm btn-ghost" type="button" data-gdown aria-label="${t("dash.cust.grpDown")}" title="${t("dash.cust.grpDown")}">↓</button>
          </span>`;
        block.appendChild(head);
        const inner=document.createElement("div"); inner.className="lz-list lz-grp-list";
        const wanted=order.filter((id)=> def.ids.includes(id));
        def.ids.forEach((id)=>{ if(!wanted.includes(id)) wanted.push(id); });
        wanted.forEach((id)=> inner.appendChild(makeRow(id)));
        // a drop is accepted inside the group only: a section keeps its group
        inner.addEventListener("dragover", (e)=>{
          e.preventDefault();
          const dragging=list.querySelector(".lz-item.dragging");
          if(!dragging || !inner.contains(dragging)) return;
          const after=getDragAfter(inner, e.clientY);
          if(after==null) inner.appendChild(dragging); else inner.insertBefore(dragging, after);
        });
        block.appendChild(inner);
        list.appendChild(block);
      });
      const syncGroupBtns=()=>{
        const blocks=[...list.querySelectorAll(".lz-grp")];
        blocks.forEach((b, i)=>{
          const up=b.querySelector("[data-gup]"), down=b.querySelector("[data-gdown]");
          if(up) up.disabled = i===0;
          if(down) down.disabled = i===blocks.length-1;
        });
      };
      list.addEventListener("click", (e)=>{
        const up=e.target.closest("[data-gup]"), down=e.target.closest("[data-gdown]");
        if(!up && !down) return;
        const block=(up||down).closest(".lz-grp");
        if(!block) return;
        if(up && block.previousElementSibling) list.insertBefore(block, block.previousElementSibling);
        if(down && block.nextElementSibling) list.insertBefore(block.nextElementSibling, block);
        syncGroupBtns();
      });
      syncGroupBtns();
    } else {
      order.forEach((id)=> list.appendChild(makeRow(id)));
      list.addEventListener("dragover", (e)=>{ e.preventDefault(); const dragging=list.querySelector(".dragging"); const after=getDragAfter(list, e.clientY); if(!dragging) return; if(after==null) list.appendChild(dragging); else list.insertBefore(dragging, after); });
    }
    panel.appendChild(list);

    // what the two buttons below read from the DOM
    const readOrder=()=> grouped
      ? [...list.querySelectorAll(".lz-grp")].flatMap((b)=> [...b.querySelectorAll(".lz-item")].map((el)=> el.dataset.id))
      : [...list.querySelectorAll(".lz-item")].map((el)=> el.dataset.id);
    const readGroups=()=> [...list.querySelectorAll(".lz-grp")].map((b)=> b.dataset.grp);
    const putInConfig=(c)=>{
      c.pages[page]=readOrder();
      if(grouped){ c.groups=c.groups||{}; c.groups[page]=readGroups(); }
      return c;
    };
    const acts=document.createElement("div"); acts.style.display="flex"; acts.style.gap="8px"; acts.style.flexWrap="wrap";
    const btnPreview=document.createElement("button"); btnPreview.className="btn btn-sm"; btnPreview.style.border="1px solid var(--cyan)"; btnPreview.style.color="var(--cyan)"; btnPreview.textContent="👁 معاينة الترتيب"; btnPreview.onclick=()=>{
      const c=putInConfig(collectPendingConfig()); c.customized=true;
      startPreviewWith(c, "معاينة ترتيب "+PAGE_DEFS[page].label);
    };
    const btnSave=document.createElement("button"); btnSave.className="btn btn-sm btn-primary"; btnSave.textContent="حفظ الترتيب"; btnSave.onclick=()=>{
      const c=putInConfig(collectPendingConfig()); c.customized=true;
      if(previewActive) { previewTemp=c; confirmPreview(); }
      else { window.CineAuraLayouts.saveConfig(c); window.CineAuraLayouts.applyAll(c); applyToast("تم حفظ الترتيب"); }
    };
    acts.append(btnPreview, btnSave);
    panel.appendChild(acts);
    root.appendChild(panel);

    // quick presets for this page
    const pre=document.createElement("div"); pre.className="lz-panel";
    pre.innerHTML=`<h4>قوالب جاهزة لهذه الصفحة</h4><p class="lz-hint">اختر قالبًا مستوحى من كل منصة/نظام ثم عدّل إن شئت.</p>`;
    const grid=document.createElement("div"); grid.className="lz-presets";
    Object.entries(window.CineAuraLayouts.PRESETS).forEach(([k,p])=>{
      const b=document.createElement("button"); b.type="button"; b.className="lz-preset";
      const arr=p[page]; if(!arr) return;
      b.innerHTML=`<div class="lz-mini">${k}</div><b>${p.label}</b><p>${p.desc}</p>`;
      b.onclick=()=>{
        const c=collectPendingConfig(); c.pages[page]=arr.slice(); c.preset=k;
        startPreviewWith(c, `معاينة ${k} — ${page}`);
      };
      grid.appendChild(b);
    });
    pre.appendChild(grid);
    root.appendChild(pre);
  }

  function getDragAfter(container, y){
    const els=[...container.querySelectorAll(".lz-item:not(.dragging)")];
    return els.reduce((closest, child)=>{
      const box=child.getBoundingClientRect(); const offset=y - box.top - box.height/2;
      if(offset<0 && offset>closest.offset) return {offset, element:child};
      else return closest;
    }, {offset:Number.NEGATIVE_INFINITY}).element;
  }

  function renderStyles(root){
    const cfg=getConfig();
    const custom = cfg.customStyle || { primary:"#01b4e4", accent:"#90cea1", bg:"#0d253f", text:"#f4fbff", muted:"#9bb0c2" };
    const panel=document.createElement("div"); panel.className="lz-panel";
    panel.innerHTML=`<h4>أنشئ تنسيق ألوان مخصص</h4><p class="lz-hint">اختر ألوانك ثم احفظها كملف CSS في <code>Themes/Style</code>. يمكنك تطبيقها فورًا.</p>`;
    const grid=document.createElement("div"); grid.className="lz-grid2";
    const fields=[["primary","الأساسي"],["accent","المميز"],["bg","الخلفية"],["text","النص"],["muted","الرمادي"],["surface","البطاقة"]];
    fields.forEach(([key,label])=>{
      const wrap=document.createElement("div"); wrap.className="lz-color-row";
      wrap.innerHTML=`<label>${label}</label><input type="color" data-key="${key}" value="${custom[key]||"#01b4e4"}"><input type="text" data-key-txt="${key}" value="${custom[key]||""}" placeholder="#hex" style="flex:1;min-height:34px;border:1px solid var(--line);border-radius:8px;padding:6px 8px">`;
      grid.appendChild(wrap);
    });
    panel.appendChild(grid);
    // sync
    panel.querySelectorAll('input[type="color"]').forEach(inp=>{
      inp.addEventListener("input", e=>{
        const k=inp.dataset.key; const v=inp.value;
        panel.querySelector(`[data-key-txt="${k}"]`).value=v;
        previewCustomStyle({...collectColors(panel), [k]:v});
      });
    });
    panel.querySelectorAll('[data-key-txt]').forEach(inp=>{
      inp.addEventListener("change", e=>{
        const k=inp.dataset.keyTxt; const v=inp.value;
        if(/^#([0-9a-fA-F]{3,8})$/.test(v)){
          panel.querySelector(`input[data-key="${k}"]`).value=v;
          previewCustomStyle({...collectColors(panel), [k]:v});
        }
      });
    });
    const acts=document.createElement("div"); acts.style.display="flex"; acts.style.gap="8px"; acts.style.flexWrap="wrap";
    const btnPreview=document.createElement("button"); btnPreview.className="btn btn-sm"; btnPreview.style.border="1px solid var(--cyan)"; btnPreview.style.color="var(--cyan)"; btnPreview.textContent="👁 معاينة قبل التطبيق";
    btnPreview.onclick=()=> startStylePreviewWith(collectColors(panel), "معاينة ألوان مخصصة");
    const btnSave=document.createElement("button"); btnSave.className="btn btn-sm btn-primary"; btnSave.textContent="حفظ كملف Style";
    btnSave.onclick=()=> saveStyleFile(collectColors(panel));
    const btnApply=document.createElement("button"); btnApply.className="btn btn-sm btn-ghost"; btnApply.textContent="تطبيق وحفظ محلي";
    btnApply.onclick=()=>{
      const c=collectPendingConfig(); c.customStyle=collectColors(panel);
      if(previewActive && previewTemp && previewTemp.customStyle) confirmPreview();
      else { window.CineAuraLayouts.saveConfig(c); previewCustomStyle(c.customStyle); applyToast("تم تطبيق الألوان وحفظها"); }
    };
    acts.append(btnPreview, btnApply, btnSave);
    panel.appendChild(acts);
    // presets for styles (reuse theme colors)
    const pre=document.createElement("div"); pre.className="lz-panel";
    pre.innerHTML=`<h4>تنسيقات مقترحة حسب المظهر</h4>`;
    const grid2=document.createElement("div"); grid2.className="lz-presets";
    ["default","facebook","youtube","netflix","prime","appletv","win11","macos","android","ios"].forEach(k=>{
      const b=document.createElement("button"); b.className="lz-preset";
      b.innerHTML=`<div class="lz-mini" style="background:var(--surface);border:1px solid var(--line)">${k}</div><b>${k}</b>`;
      b.onclick=()=>{
        // load preset colors from themes.css computed? For demo use known values
        const map={
          default:{primary:"#01b4e4",accent:"#90cea1",bg:"#0d253f",text:"#f4fbff",muted:"#9bb0c2",surface:"rgba(9,22,36,0.52)"},
          facebook:{primary:"#1877f2",accent:"#42b72a",bg:"#18191a",text:"#e4e6eb",muted:"#b0b3b8",surface:"#242526"},
          youtube:{primary:"#ff0000",accent:"#cc0000",bg:"#0f0f0f",text:"#f1f1f1",muted:"#aaa",surface:"#212121"},
          netflix:{primary:"#e50914",accent:"#b81d24",bg:"#000000",text:"#ffffff",muted:"#999",surface:"#181818"},
          prime:{primary:"#00a8e1",accent:"#ff9900",bg:"#0a1628",text:"#ffffff",muted:"#a0aec0",surface:"#12233f"},
          appletv:{primary:"#2997ff",accent:"#0071e3",bg:"#000000",text:"#f5f5f7",muted:"#86868b",surface:"#1c1c1e"},
          win11:{primary:"#0067c0",accent:"#60a8ff",bg:"#202020",text:"#ffffff",muted:"#9d9d9d",surface:"#2c2c2c"},
          macos:{primary:"#007aff",accent:"#34c759",bg:"#ececef",text:"#1d1d1f",muted:"#4e4e52",surface:"#ffffff"},
          android:{primary:"#3ddc84",accent:"#d0bcff",bg:"#141218",text:"#e6e0e9",muted:"#cac4d0",surface:"#1d1b20"},
          ios:{primary:"#007aff",accent:"#34c759",bg:"#000000",text:"#ffffff",muted:"#59595f",surface:"#1c1c1e"},
        };
        const col=map[k]||map.default;
        startStylePreviewWith(col, `معاينة ${k}`);
        // update inputs
        Object.entries(col).forEach(([kk,v])=>{
          const inp=panel.querySelector(`input[data-key="${kk}"]`); if(inp && v.startsWith("#")) inp.value=v;
          const txt=panel.querySelector(`[data-key-txt="${kk}"]`); if(txt) txt.value=v;
        });
      };
      grid2.appendChild(b);
    });
    pre.appendChild(grid2);
    root.append(panel, pre);
  }
  function collectColors(panel){
    const out={};
    panel.querySelectorAll("input[data-key]").forEach(inp=> out[inp.dataset.key]=inp.value);
    panel.querySelectorAll("[data-key-txt]").forEach(inp=> { if(inp.value) out[inp.dataset.keyTxt]=inp.value; });
    return out;
  }
  function previewCustomStyle(colors){
    let css = ":root{";
    if(colors.primary) css+=` --cyan:${colors.primary}; --cyan-2:${colors.primary};`;
    if(colors.accent) css+=` --green:${colors.accent};`;
    if(colors.bg) css+=` --ink:${colors.bg};`;
    if(colors.text) css+=` --text:${colors.text};`;
    if(colors.muted) css+=` --muted:${colors.muted};`;
    if(colors.surface) css+=` --surface:${colors.surface};`;
    css+="}";
    let tag=document.getElementById("lz-custom-preview");
    if(!tag){ tag=document.createElement("style"); tag.id="lz-custom-preview"; document.head.appendChild(tag); }
    tag.textContent=css;
  }

  async function saveStyleFile(colors){
    const name=prompt("اسم تنسيق الألوان (بدون امتداد):", "my-style");
    if(!name) return;
    const css = `/* ${name} — custom style */\n:root{ --cyan:${colors.primary}; --green:${colors.accent}; --ink:${colors.bg}; --text:${colors.text}; --muted:${colors.muted}; --surface:${colors.surface}; }\n`;
    const ok=await uploadToBucket(`${PREFIX_STYLE}/${memberId()}/${name}.css`, css, "text/css");
    if(ok) applyToast(`حُفظ Style → ${PREFIX_STYLE}/${memberId()}/${name}.css`);
    else applyToast("حُفظ محليًا (التخزين غير متاح)");
    // also save meta in DB table member_styles
    try{
      const C=window.CineAura; if(C&&C.supabaseRequest){
        await C.supabaseRequest("/rest/v1/member_styles",{method:"POST", body:JSON.stringify({ member_id:memberId(), name, colors, css_text:css, file_url:`${BUCKET}/${PREFIX_STYLE}/${memberId()}/${name}.css` })});
      }
    }catch{}
    // cache locally
    const cfg=getConfig(); cfg.customStyle=colors; window.CineAuraLayouts.saveConfig(cfg);
  }

  function renderIcons(root){
    const panel=document.createElement("div"); panel.className="lz-panel";
    panel.innerHTML=`<h4>أيقونات مخصصة</h4><p class="lz-hint">ارفع SVG/PNG ليُحفظ في <code>Themes/Icons/{معرّفك}/</code>. المجلد يُنشأ تلقائيًا باسم الـ ID الخاص بك.</p>`;
    const drop=document.createElement("div"); drop.className="lz-drop";
    drop.innerHTML=`<p>اسحب وأفلت أو</p><label class="btn btn-sm btn-primary" style="cursor:pointer">اختر ملفات <input type="file" id="lz-icon-files" accept=".svg,.png,.jpg,.jpeg,.webp" multiple hidden></label><p class="lz-hint">يدعم SVG/PNG — سيتم حفظه باسم الملف الأصلي</p>`;
    const grid=document.createElement("div"); grid.className="lz-icon-grid"; grid.id="lz-icon-grid";
    panel.append(drop, grid);
    root.appendChild(panel);
    // file input
    const input=drop.querySelector("#lz-icon-files");
    drop.addEventListener("click",()=> input.click());
    drop.addEventListener("dragover", e=>{ e.preventDefault(); drop.classList.add("drag"); });
    drop.addEventListener("dragleave", ()=> drop.classList.remove("drag"));
    drop.addEventListener("drop", e=>{ e.preventDefault(); drop.classList.remove("drag"); handleIconFiles(e.dataTransfer.files); });
    input.addEventListener("change",()=> handleIconFiles(input.files));
    loadIconGrid();

    // custom icon key mapping
    const mapPanel=document.createElement("div"); mapPanel.className="lz-panel";
    mapPanel.innerHTML=`<h4>ربط الأيقونة بالقسم</h4><p class="lz-hint">اختر أيقونة رفعتها واربطها بعنصر واجهة (شعار، تبويب، زر)</p><div class="lz-color-row"><select id="lz-icon-key"><option value="logo">الشعار</option>${["overview","level","points","upload","articles","documents","links","codes","playlists","iptv","views","analytics","reports","history","withdraw","prizes","settings"].map(id=>`<option value="nav.${id}">${labelFor("dashboard", id)}</option>`).join("")}${["home","market","community","create","content","posts","messages","search","following","blocked"].map(id=>`<option value="nav.${id}">${labelFor("profile", id)}</option>`).join("")}</select><select id="lz-icon-file-sel"></select><button class="btn btn-sm btn-primary" id="lz-icon-bind">ربط</button></div><div id="lz-icon-bindings" class="lz-list" style="margin-top:8px"></div>`;
    root.appendChild(mapPanel);
    const sel=mapPanel.querySelector("#lz-icon-file-sel");
    // populate from existing icons (local)
    const icons=getStoredIcons();
    icons.forEach(ic=>{ const o=document.createElement("option"); o.value=ic.url; o.textContent=ic.name; sel.appendChild(o); });
    mapPanel.querySelector("#lz-icon-bind").onclick=()=>{
      const key=mapPanel.querySelector("#lz-icon-key").value;
      const url=sel.value; if(!url) return applyToast("اختر ملفًا أولاً");
      bindIcon(key, url);
    };
    renderIconBindings(mapPanel.querySelector("#lz-icon-bindings"));
  }

  function getStoredIcons(){ try{ const r=localStorage.getItem("cineaura_icons"); return r?JSON.parse(r):[] }catch{return []} }
  function setStoredIcons(arr){ try{ localStorage.setItem("cineaura_icons", JSON.stringify(arr)); }catch{} }

  async function handleIconFiles(files){
    if(!files||!files.length) return;
    const arr=getStoredIcons();
    for(const f of files){
      const name=f.name;
      const url=URL.createObjectURL(f);
      // preview locally
      arr.push({name, url, fileName:name, key:""});
      // upload to bucket
      const buf=await f.arrayBuffer();
      const ok=await uploadToBucket(`${PREFIX_ICONS}/${memberId()}/${name}`, buf, f.type);
      if(ok) applyToast(`رُفع ${name} → ${PREFIX_ICONS}/${memberId()}/`);
      else applyToast(`حُفظ محليًا: ${name}`);
      // also insert into member_icons table
      try{
        const C=window.CineAura; if(C&&C.supabaseRequest){
          await C.supabaseRequest("/rest/v1/member_icons",{method:"POST", body:JSON.stringify({ member_id:memberId(), name, icon_key:"", file_url:`${BUCKET}/${PREFIX_ICONS}/${memberId()}/${name}`, mime:f.type })});
        }
      }catch{}
    }
    setStoredIcons(arr);
    loadIconGrid();
  }
  function loadIconGrid(){
    const grid=document.getElementById("lz-icon-grid");
    if(!grid) return;
    const arr=getStoredIcons();
    grid.innerHTML=arr.map(ic=>`<div class="lz-icon-card"><img src="${ic.url}" alt=""><small>${ic.name}</small></div>`).join("")||`<p class="lz-hint">لا توجد أيقونات بعد.</p>`;
    // update select
    const sel=document.getElementById("lz-icon-file-sel");
    if(sel){ sel.innerHTML=arr.map(ic=>`<option value="${ic.url}">${ic.name}</option>`).join(""); }
  }
  function bindIcon(key, url){
    const bindings=getBindings();
    bindings[key]=url;
    setBindings(bindings);
    applyIconBindings();
    applyToast(`تم ربط ${key}`);
    renderIconBindings(document.getElementById("lz-icon-bindings"));
  }
  function getBindings(){ try{ return JSON.parse(localStorage.getItem("cineaura_icon_bindings")||"{}"); }catch{return {}} }
  function setBindings(o){ localStorage.setItem("cineaura_icon_bindings", JSON.stringify(o)); }
  // Applies the icons the member bound: the logo, and one icon per section of
  // the dashboard / profile sidebars (data-section / data-sec).
  function applyIconBindings(){
    const map=getBindings();
    Object.entries(map).forEach(([key,url])=>{
      if(!url) return;
      if(key==="logo"){
        const mark=document.querySelector(".logo-mark");
        if(mark && !mark.querySelector(`img[data-icon-bound]`)) mark.innerHTML=`<img src="${url}" data-icon-bound="logo" style="width:100%;height:100%;object-fit:contain" alt="">`;
        return;
      }
      const sec=key.replace(/^nav\./, "").replace(/^section\./, "");
      const els=document.querySelectorAll(`#dash-root .side-nav [data-section="${sec}"], #prof-root nav [data-sec="${sec}"]`);
      els.forEach(el=>{
        const svg=el.querySelector("svg.nav-ico");
        if(!svg) return;
        if(el.querySelector(`img[data-icon-bound="${sec}"]`)) return;
        const img=document.createElement("img");
        img.src=url; img.alt=""; img.width=18; img.height=18;
        img.setAttribute("data-icon-bound", sec);
        img.style.cssText="width:18px;height:18px;object-fit:contain";
        svg.replaceWith(img);
      });
    });
  }
  // the sidebars re-render on every section change: keep the icons on them
  function watchNavIcons(){
    if(watchNavIcons.on) return; watchNavIcons.on=true;
    let timer=0;
    const obs=new MutationObserver(()=>{
      clearTimeout(timer);
      timer=setTimeout(()=>{ try{ applyIconBindings(); }catch{} }, 120);
    });
    obs.observe(document.body,{childList:true,subtree:true});
    document.addEventListener("cineaura:layout-applied", ()=> setTimeout(applyIconBindings, 60));
  }
  function renderIconBindings(cont){
    if(!cont) return;
    const map=getBindings();
    cont.innerHTML=Object.entries(map).map(([k,v])=>`<div class="lz-item"><span class="lz-name">${k}</span><small style="opacity:.7;overflow:hidden;text-overflow:ellipsis">${v.slice(0,40)}</small><button class="btn btn-sm btn-ghost" data-rm="${k}">حذف</button></div>`).join("")||`<p class="lz-hint">لا روابط بعد</p>`;
    cont.querySelectorAll("[data-rm]").forEach(b=> b.onclick=()=>{
      const m=getBindings(); delete m[b.dataset.rm]; setBindings(m); renderIconBindings(cont);
    });
  }

  function renderPins(root){
    const cfg=getConfig();
    const panel=document.createElement("div"); panel.className="lz-panel";
    panel.innerHTML=`<h4>تثبيت أفلام في الرئيسية واختصارات</h4><p class="lz-hint">أضف أفلامًا بالبحث عن TMDB ID لتظهر في سكشن خاص. وأضف اختصارات الداشبورد لقائمة البروفايل.</p>`;
    const search=document.createElement("div"); search.className="lz-color-row";
    search.innerHTML=`<input id="lz-pin-q" placeholder="ابحث عن فيلم (اكتب اسمًا أو TMDB ID)" style="flex:1;min-height:38px;border:1px solid var(--line);border-radius:8px;padding:6px 10px"><button class="btn btn-sm btn-primary" id="lz-pin-search">بحث TMDB</button><button class="btn btn-sm btn-ghost" id="lz-pin-add">إضافة بالـ ID</button>`;
    panel.appendChild(search);
    const results=document.createElement("div"); results.id="lz-pin-results"; results.className="lz-list";
    panel.appendChild(results);
    const pins=document.createElement("div"); pins.id="lz-pin-list"; pins.className="lz-home-pins";
    panel.appendChild(pins);

    // shortcuts
    const short=document.createElement("div"); short.className="lz-panel";
    short.innerHTML=`<h4>اختصارات</h4><p class="lz-hint">اختر أقسام الداشبورد لتظهر كاختصارات في البروفايل، والعكس.</p><div class="lz-grid2"><div><label>اختصارات الداشبورد في البروفايل</label><div id="lz-short-dash" class="lz-list"></div></div><div><label>اختصارات البروفايل في الداشبورد</label><div id="lz-short-prof" class="lz-list"></div></div></div>`;
    root.append(panel, short);

    // wire
    setTimeout(()=>{
      const inp=panel.querySelector("#lz-pin-q");
      panel.querySelector("#lz-pin-search").onclick=async()=>{
        const q=inp.value.trim(); if(!q) return;
        results.innerHTML=`<p class="lz-hint">جاري البحث...</p>`;
        try{
          const C=window.CineAura; const r=await C.tmdb(`/search/movie?query=${encodeURIComponent(q)}`);
          const list=(r.data&&r.data.results)||[];
          results.innerHTML=list.slice(0,6).map(m=>`<div class="lz-item"><img src="${m.poster_path?`https://image.tmdb.org/t/p/w92${m.poster_path}`:""}" style="width:36px;height:54px;object-fit:cover;border-radius:6px"><span class="lz-name">${m.title} (${(m.release_date||"").slice(0,4)})</span><button class="btn btn-sm btn-primary" data-add="${m.id}">تثبيت</button></div>`).join("");
          results.querySelectorAll("[data-add]").forEach(b=> b.onclick=()=>{ window.CineAuraLayouts.addPin(Number(b.dataset.add)); renderPinsList(); applyToast("تم التثبيت"); });
        }catch{ results.innerHTML=`<p class="lz-hint">فشل البحث</p>`; }
      };
      panel.querySelector("#lz-pin-add").onclick=()=>{
        const v=Number(inp.value.trim()); if(!v) return applyToast("أدخل TMDB ID رقمي"); window.CineAuraLayouts.addPin(v); renderPinsList(); applyToast("تمت الإضافة");
      };
      renderPinsList();
      renderShortcuts();
    },50);

    function renderPinsList(){
      const L=window.CineAuraLayouts; const pins=L?L.getPins():[];
      const cont=document.getElementById("lz-pin-list");
      if(!cont) return;
      if(!pins.length) cont.innerHTML=`<p class="lz-hint">لا أفلام مثبتة بعد.</p>`;
      else cont.innerHTML=pins.map(id=>`<div class="lz-pin"><span class="lz-name">#${id}</span><button class="btn btn-sm btn-ghost" data-rm="${id}">إزالة</button></div>`).join("");
      cont.querySelectorAll("[data-rm]").forEach(b=> b.onclick=()=>{ L.removePin(Number(b.dataset.rm)); renderPinsList(); });
    }
    function renderShortcuts(){
      const cfg2=getConfig();
      const dashIds=PAGE_DEFS.dashboard.ids();
      const profIds=PAGE_DEFS.profile.ids();
      const dashCont=short.querySelector("#lz-short-dash");
      const profCont=short.querySelector("#lz-short-prof");
      const selDash=new Set(cfg2.shortcuts?.dashboard_in_profile||[]);
      const selProf=new Set(cfg2.shortcuts?.profile_in_dashboard||[]);
      dashCont.innerHTML=dashIds.map(id=>`<label class="lz-item" style="cursor:pointer"><input type="checkbox" data-sd="${id}" ${selDash.has(id)?"checked":""}> ${labelFor("dashboard", id)}</label>`).join("");
      profCont.innerHTML=profIds.map(id=>`<label class="lz-item" style="cursor:pointer"><input type="checkbox" data-sp="${id}" ${selProf.has(id)?"checked":""}> ${labelFor("profile", id)}</label>`).join("");
      dashCont.querySelectorAll("[data-sd]").forEach(cb=> cb.onchange=()=>{
        const c=getConfig(); c.shortcuts=c.shortcuts||{}; c.shortcuts.dashboard_in_profile=[...dashCont.querySelectorAll("[data-sd]:checked")].map(x=>x.dataset.sd);
        window.CineAuraLayouts.saveConfig(c); applyToast("تم حفظ الاختصارات");
      });
      profCont.querySelectorAll("[data-sp]").forEach(cb=> cb.onchange=()=>{
        const c=getConfig(); c.shortcuts=c.shortcuts||{}; c.shortcuts.profile_in_dashboard=[...profCont.querySelectorAll("[data-sp]:checked")].map(x=>x.dataset.sp);
        window.CineAuraLayouts.saveConfig(c); applyToast("تم حفظ الاختصارات");
      });
    }
  }

  function memberId(){
    try{ const C=window.CineAura; const s=C&&C.getSession&&C.getSession(); if(s&&s.member_id) return s.member_id; }catch{}
    try{ const raw=localStorage.getItem("cineaura_session"); if(raw){ const j=JSON.parse(raw); return j.member_id||j.memberId||"anon"; } }catch{}
    return "anon";
  }
  async function uploadToBucket(path, data, contentType){
    try{
      const url=`https://samazxadqggoeilaqfdp.supabase.co/storage/v1/object/${BUCKET}/${path}`;
      const headers={ "apikey":"sb_publishable_UZ74c-sHOywW9lOfErwXuA_GtMtvYYY", "Authorization":"Bearer sb_publishable_UZ74c-sHOywW9lOfErwXuA_GtMtvYYY" };
      if(typeof data==="string") headers["Content-Type"]=contentType||"text/plain";
      else if(contentType) headers["Content-Type"]=contentType;
      const body = typeof data==="string" ? data : data;
      const res=await fetch(url,{method:"POST", headers, body});
      if(res.ok) return true;
      // try PUT if exists
      const res2=await fetch(url,{method:"PUT", headers, body});
      return res2.ok;
    }catch{ return false; }
  }
  async function saveAsTemplateFile(){
    const name=prompt("اسم القالب (سيُحفظ في Themes/Template):","my-template");
    if(!name) return;
    const cfg=getConfig();
    const json=JSON.stringify(cfg, null, 2);
    const ok=await uploadToBucket(`${PREFIX_TMPL}/${memberId()}/${name}.json`, json, "application/json");
    if(ok) applyToast(`حُفظ القالب → ${PREFIX_TMPL}/${memberId()}/${name}.json`);
    else applyToast("حُفظ محليًا (التخزين غير متاح)");
    try{
      const C=window.CineAura; if(C&&C.supabaseRequest){
        await C.supabaseRequest("/rest/v1/member_layouts",{method:"POST", body:JSON.stringify({ member_id:memberId(), name, pages:cfg.pages, shortcuts:cfg.shortcuts, pins:cfg.pins, preset:cfg.preset, file_url:`${BUCKET}/${PREFIX_TMPL}/${memberId()}/${name}.json` })});
      }
    }catch{}
  }
  // ----- preview-before-apply in blob (طلب المستخدم 2026-10-19) -----
  let previewActive=false, previewOriginal=null, previewTemp=null, previewBar=null, previewStyleBackup=null, previewStyleOriginal=null, blobModal=null, blobUrl=null, blobFrame=null;
  const PAGE_URL_MAP={ home:'index.html', watch:'watch.html?tmdb=530', content:'content.html', market:'market.html', dashboard:'dashboard.html', profile:'profile.html' };
  function collectPendingConfig(){
    const base=getConfig();
    try{ return JSON.parse(JSON.stringify(base)); }catch{ return base; }
  }
  function ensurePreviewBar(){
    if(previewBar) return previewBar;
    previewBar=document.createElement("div");
    previewBar.id="lz-preview-bar";
    previewBar.style.cssText="position:fixed;top:0;left:0;right:0;z-index:99999;display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;padding:8px 12px;background:color-mix(in srgb, var(--cyan, #00d4ff) 14%, #0b0f14);border-bottom:2px solid var(--cyan, #00d4ff);backdrop-filter:blur(8px);font-size:13px";
    previewBar.innerHTML=`<span id="lz-preview-label" style="font-weight:700">👁 وضع المعاينة — التغييرات غير محفوظة بعد</span>
      <button class="btn btn-sm btn-primary" id="lz-preview-confirm" type="button">✓ تطبيق وحفظ</button>
      <button class="btn btn-sm btn-ghost" id="lz-preview-cancel" type="button" style="border:1px solid rgba(255,255,255,.35)">✕ إلغاء المعاينة</button>`;
    document.body.appendChild(previewBar);
    const pad=document.createElement("style"); pad.id="lz-preview-pad";
    pad.textContent="html.lz-preview{padding-top:48px !important} html.lz-preview .lz-overlay{top:48px}";
    document.head.appendChild(pad);
    previewBar.querySelector("#lz-preview-confirm").onclick=confirmPreview;
    previewBar.querySelector("#lz-preview-cancel").onclick=cancelPreview;
    return previewBar;
  }
  function ensureBlobModal(){
    if(blobModal) return blobModal;
    blobModal=document.createElement('div');
    blobModal.id='lz-blob-modal';
    blobModal.hidden=true;
    blobModal.style.cssText='position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;background:rgba(0,0,0,.82);backdrop-filter:blur(6px)';
    blobModal.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;background:#0b0f14;border-bottom:2px solid var(--cyan,#00d4ff);color:#fff;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span id="lz-blob-title" style="font-weight:800">👁 معاينة</span>
          <small id="lz-blob-sub" style="opacity:.7">صفحة معزولة — لن يُحفظ شيء حتى تضغط تطبيق</small>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-ghost" id="lz-blob-close" type="button" style="color:#fff;border-color:rgba(255,255,255,.3)">✕ إغلاق</button>
          <button class="btn btn-sm btn-ghost" id="lz-blob-cancel" type="button" style="color:#fff;border-color:rgba(255,255,255,.3)">↩ إلغاء</button>
          <button class="btn btn-sm btn-primary" id="lz-blob-confirm" type="button">✓ تطبيق وحفظ</button>
        </div>
      </div>
      <div style="flex:1;position:relative;background:#fff">
        <iframe id="lz-blob-frame" title="معاينة" style="width:100%;height:100%;border:0;background:#fff"></iframe>
        <div id="lz-blob-loader" style="position:absolute;inset:0;display:grid;place-items:center;background:rgba(255,255,255,.9);font-weight:700;color:#032541">جاري تحميل المعاينة…</div>
      </div>`;
    document.body.appendChild(blobModal);
    blobModal.querySelector('#lz-blob-close').onclick=closeBlobPreview;
    blobModal.querySelector('#lz-blob-cancel').onclick=cancelPreview;
    blobModal.querySelector('#lz-blob-confirm').onclick=confirmPreview;
    blobModal.addEventListener('mousedown', e=>{ if(e.target===blobModal) closeBlobPreview(); });
    return blobModal;
  }
  function showBlobModal(url, label, cfg){
    ensureBlobModal();
    blobModal.hidden=false;
    document.documentElement.classList.add('lz-blob-open');
    document.body.style.overflow='hidden';
    const title=blobModal.querySelector('#lz-blob-title');
    const sub=blobModal.querySelector('#lz-blob-sub');
    if(label) title.textContent='👁 '+label;
    if(cfg&&cfg.preset) sub.textContent=`نمط ${cfg.preset} — معاينة معزولة في blob`;
    // preserve for confirm
    previewActive=true; previewTemp=cfg;
    try{ previewOriginal=collectPendingConfig(); }catch{}
    blobFrame=blobModal.querySelector('#lz-blob-frame');
    const loader=blobModal.querySelector('#lz-blob-loader');
    loader.hidden=false;
    blobFrame.onload=()=>{ loader.hidden=true; };
    blobFrame.src=url;
    // also show top bar for consistency
    ensurePreviewBar();
    previewBar.hidden=false;
    document.documentElement.classList.add('lz-preview');
    updatePreviewBtns();
    applyToast('🔍 معاينة في blob — صفحة معزولة، اضغط تطبيق للحفظ');
  }
  function closeBlobPreview(){
    if(blobModal) blobModal.hidden=true;
    document.documentElement.classList.remove('lz-blob-open');
    document.body.style.overflow='';
    if(blobFrame) blobFrame.src='about:blank';
    if(blobUrl){ try{ URL.revokeObjectURL(blobUrl); }catch{} blobUrl=null; }
    // keep previewActive so confirm still works until cancelled, but hide bar only on cancel/confirm
  }
  async function openBlobPreview(page, cfg, label){
    const target=PAGE_URL_MAP[page]||'index.html';
    const baseUrl=target.split('?')[0];
    try{
      const res=await fetch(baseUrl, {cache:'no-store'});
      if(!res.ok) throw new Error('fetch failed '+res.status);
      let html=await res.text();
      // ensure base href so blob resolves relative css/js
      const origin=location.origin;
      const baseHref=origin+'/'+baseUrl.replace(/^\.?\//,'').split('/').slice(0,-1).join('/')+(baseUrl.includes('/')?'/':'');
      const baseTag=`<base href="${origin}/">`;
      if(!/<base\s/i.test(html)){
        html=html.replace(/<head[^>]*>/i, m=> m+baseTag);
      }
      // inject preview config before layouts.js
      const cfgJson=JSON.stringify(cfg).replace(/</g,'\\u003c');
      const styleJson=cfg.customStyle? JSON.stringify(cfg.customStyle).replace(/</g,'\\u003c') : 'null';
      const targetForHistory=target.replace(/'/g,"\\'");
      const inject=`<script>window.__CINEAURA_PREVIEW__=${cfgJson};window.__CINEAURA_PREVIEW_STYLE__=${styleJson};try{sessionStorage.setItem('cineaura_preview', JSON.stringify(window.__CINEAURA_PREVIEW__)); if(window.__CINEAURA_PREVIEW_STYLE__) sessionStorage.setItem('cineaura_preview_style', JSON.stringify(window.__CINEAURA_PREVIEW_STYLE__));}catch{} try{ history.replaceState(null,'','${targetForHistory}'); }catch{}
(function(){var c=window.__CINEAURA_PREVIEW_STYLE__; if(!c) return; try{var css=":root{"; if(c.primary) css+=" --cyan:"+c.primary+"; --cyan-2:"+c.primary+";"; if(c.accent) css+=" --green:"+c.accent+";"; if(c.bg) css+=" --ink:"+c.bg+";"; if(c.text) css+=" --text:"+c.text+";"; if(c.muted) css+=" --muted:"+c.muted+";"; if(c.surface) css+=" --surface:"+c.surface+";"; css+="}"; var t=document.createElement("style"); t.id="lz-custom-preview"; t.textContent=css; (document.head||document.documentElement).appendChild(t);}catch(e){} })();
<\/script>`;
      html=html.replace(/<head[^>]*>/i, m=> m+inject);
      // inject small banner inside blob to indicate preview mode
      const bannerInject=`<style>html::before{content:"👁 معاينة — ${label?label.replace(/"/g,''):'blob'} — لن يُحفظ حتى تضغط تطبيق";position:fixed;top:0;left:0;right:0;z-index:9999;background:color-mix(in srgb, #00d4ff 16%, #0b0f14);color:#fff;padding:6px 12px;font:700 12px system-ui;border-bottom:2px solid #00d4ff;text-align:center} body{padding-top:28px !important}<\/style>`;
      html=html.replace(/<head[^>]*>/i, m=> m+bannerInject);
      const blob=new Blob([html], {type:'text/html'});
      blobUrl=URL.createObjectURL(blob);
      showBlobModal(blobUrl, label||('معاينة '+page), cfg);
      return;
    }catch(e){
      console.warn('blob preview fallback', e);
      // fallback: open target with cine_preview param and sessionStorage
      try{
        sessionStorage.setItem('cineaura_preview', JSON.stringify(cfg));
        if(cfg.customStyle) sessionStorage.setItem('cineaura_preview_style', JSON.stringify(cfg.customStyle));
        const sep=target.includes('?')?'&':'?';
        showBlobModal(target+sep+'cine_preview=1', label||('معاينة '+page), cfg);
      }catch{
        // ultimate fallback: direct apply on current page (old behavior)
        const L=window.CineAuraLayouts; if(L&&L.applyAll){ previewOriginal=collectPendingConfig(); previewTemp=cfg; L.applyAll(cfg); if(cfg.customStyle) previewCustomStyle(cfg.customStyle); ensurePreviewBar(); previewBar.hidden=false; document.documentElement.classList.add('lz-preview'); previewActive=true; updatePreviewBtns(); applyToast('🔍 معاينة — لم يُحفظ بعد'); }
      }
    }
  }
  function startPreviewWith(tempCfg, label){
    // blob-first: open isolated preview instead of mutating current page
    openBlobPreview(activePage, tempCfg, label);
  }
  function startStylePreviewWith(colors, label){
    try{
      // build preview config that merges current layout + new colors
      const cfg=collectPendingConfig(); cfg.customStyle=colors;
      openBlobPreview(activePage, cfg, label||'معاينة ألوان');
    }catch(e){ console.warn(e); }
  }
  function togglePreview(){
    if(previewActive) return cancelPreview();
    const cfg=collectPendingConfig();
    const list=document.getElementById("lz-order-list");
    if(list && activeTab==="templates"){
      const page=activePage; const newOrder=[...list.querySelectorAll(".lz-item")].map(el=>el.dataset.id);
      if(newOrder.length){ cfg.pages[page]=newOrder; cfg.customized=true; }
    }
    startPreviewWith(cfg, "معاينة التعديلات");
  }
  function updatePreviewBtns(){
    if(!overlay) return;
    const h=overlay.querySelector("#lz-preview"); const f=overlay.querySelector("#lz-preview-foot");
    const txt=previewActive ? "✕ إلغاء المعاينة" : "👁 معاينة قبل التطبيق";
    if(h) h.textContent=txt; if(f) f.textContent=txt.replace(" قبل التطبيق","");
  }
  function confirmPreview(){
    try{
      if(previewTemp){
        const L=window.CineAuraLayouts; L.saveConfig(previewTemp); L.applyAll(previewTemp);
        if(previewTemp.customStyle) previewCustomStyle(previewTemp.customStyle);
        // also sync style to localStorage helper if present
        try{ if(previewTemp.customStyle) localStorage.setItem('cineaura_custom_style', JSON.stringify(previewTemp.customStyle)); }catch{}
        applyToast("✓ تم التطبيق والحفظ");
      } else if(previewStyleBackup!==null){
        const cfg=collectPendingConfig(); cfg.customStyle=JSON.parse(JSON.stringify(previewTemp && previewTemp.customStyle ? previewTemp.customStyle : {}));
        const curTag=document.getElementById("lz-custom-preview");
        if(curTag){
          const L=window.CineAuraLayouts; const c=collectPendingConfig();
          if(previewTemp && previewTemp.customStyle){ c.customStyle=previewTemp.customStyle; L.saveConfig(c); }
        }
        applyToast("✓ تم التطبيق");
      }
      teardownPreview();
      render();
    }catch(e){ console.warn(e); teardownPreview(); }
  }
  function cancelPreview(){
    try{
      if(previewOriginal){ const L=window.CineAuraLayouts; if(L) L.applyAll(previewOriginal); }
      if(previewStyleBackup!==null){
        const tag=document.getElementById("lz-custom-preview");
        if(tag) tag.textContent=previewStyleBackup;
        else if(previewStyleBackup===""){ const t=document.getElementById("lz-custom-preview"); if(t) t.remove(); }
      } else if(previewStyleOriginal){
        previewCustomStyle(previewStyleOriginal);
      }
      if(previewOriginal || previewStyleBackup!==null) applyToast("↩ أُلغيت المعاينة");
      teardownPreview();
    }catch(e){ teardownPreview(); }
  }
  function teardownPreview(){
    previewActive=false; previewOriginal=null; previewTemp=null; previewStyleBackup=null; previewStyleOriginal=null;
    if(previewBar) previewBar.hidden=true;
    document.documentElement.classList.remove("lz-preview");
    updatePreviewBtns();
    closeBlobPreview();
    try{ sessionStorage.removeItem('cineaura_preview'); sessionStorage.removeItem('cineaura_preview_style'); }catch{}
  }
  function applyCurrent(){
    const cfg=collectPendingConfig();
    // if preview active, confirm via preview path to keep UX consistent
    if(previewActive){ previewTemp=cfg; return confirmPreview(); }
    window.CineAuraLayouts.applyAll(cfg); applyToast("تم التطبيق (مؤقت) — اضغط معاينة ثم حفظ للتثبيت");
  }
  function saveAll(){
    const cfg=collectPendingConfig();
    if(previewActive){ previewTemp=cfg; return confirmPreview(); }
    window.CineAuraLayouts.saveConfig(cfg); window.CineAuraLayouts.applyAll(cfg); applyToast("تم حفظ التخصيص");
  }
  function applyToast(msg){
    const C=window.CineAura; if(C&&C.toast) C.toast(msg); else console.log(msg);
  }
  // the colours a member saved must survive a reload, not just the preview
  function applySavedStyle(){
    try{
      const cfg=getConfig();
      if(cfg && cfg.customStyle) previewCustomStyle(cfg.customStyle);
    }catch{}
  }
  function getActiveStyle(){ return getStyle(); }

  function open(opts){
    buildOverlay();
    if(opts && PAGE_DEFS[opts.page]) activePage=opts.page;
    if(opts && opts.tab) activeTab=opts.tab;
    render(); overlay.hidden=false; document.documentElement.classList.add("lz-lock");
    updatePreviewBtns();
  }
  function close(){
    if(!overlay||overlay.hidden) return; if(previewActive) { /* keep preview alive after closing customizer so user can see page */ }
    overlay.hidden=true; document.documentElement.classList.remove("lz-lock");
  }
  // global expose
  window.CineAuraCustomizer={ open, close, render, applyIconBindings, applySavedStyle, getActiveStyle, PAGE_DEFS };

  // the dashboard now has its own "تخصيص الموقع" section; the old observer that
  // injected a button into Settings is gone (one entry point per surface).
  function init(){
    try{ applySavedStyle(); }catch{}
    try{ applyIconBindings(); watchNavIcons(); }catch{}
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  // also listen for dashboard navigation
  document.addEventListener("cineaura:layout-applied", ()=>{ /* maybe refresh */ });

})();
