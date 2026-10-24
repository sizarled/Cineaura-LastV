/* Cineaura theme appearances — data-style layer
   Orthogonal to prefs.js light/dark (data-theme).
   Persisted: localStorage cineaura_style + profiles.style column.
*/
(function(){
  "use strict";

  const STYLE_KEY = "cineaura_style";
  const VALID = ["default","facebook","youtube","instagram","netflix","prime","appletv","win7","win8","win10","win11","macos","android","ios"];

  /** Metadata for picker UI */
  const THEMES = [
    { id:"default",  label:"Cineaura",     sub:"Default look",   icon:"✨", bar:"#01b4e4", body:"#0d253f" },
    { id:"facebook", label:"Facebook",     sub:"Social blue",    icon:"f",  bar:"#1877f2", body:"#f0f2f5" },
    { id:"youtube",  label:"YouTube",      sub:"Red / dark",     icon:"▶", bar:"#ff0000", body:"#0f0f0f" },
    { id:"instagram",label:"Instagram",    sub:"Gradient",       icon:"◎", bar:"#d62976", body:"#000000" },
    { id:"netflix",  label:"Netflix",      sub:"Cinema red",     icon:"N",  bar:"#e50914", body:"#000000" },
    { id:"prime",    label:"Prime Video",  sub:"Amazon blue",    icon:"P",  bar:"#00a8e1", body:"#0a1628" },
    { id:"appletv",  label:"Apple TV+",    sub:"tvOS black",     icon:"", bar:"#000000", body:"#1c1c1e" },
    { id:"win7",     label:"Windows 7",    sub:"Aero glass",     icon:"▭", bar:"#2a7bd8", body:"#a9d0f0" },
    { id:"win8",     label:"Windows 8",    sub:"Metro flat",     icon:"⊞", bar:"#0078d7", body:"#0078d7" },
    { id:"win10",    label:"Windows 10",   sub:"Fluent",         icon:"⊞", bar:"#0078d4", body:"#f3f3f3" },
    { id:"win11",    label:"Windows 11",   sub:"Mica rounded",   icon:"⊞", bar:"#0067c0", body:"#f3f3f3" },
    { id:"macos",    label:"macOS",        sub:"Tahoe blur",     icon:"●", bar:"#007aff", body:"#ececef" },
    { id:"android",  label:"Android",      sub:"Material 3",     icon:"🤖", bar:"#3ddc84", body:"#141218" },
    { id:"ios",      label:"iOS",          sub:"iPhone blur",    icon:"◐", bar:"#007aff", body:"#f2f2f7" },
  ];

  function validOrDefault(v){
    return VALID.includes(v) ? v : "default";
  }

  function getStyle(){
    try{ const v = localStorage.getItem(STYLE_KEY); if(v && VALID.includes(v)) return v; }catch{}
    // fallback from profile cached in localStorage? prefs.js syncs profile theme but not style yet
    return "default";
  }

  function applyStyle(style){
    style = validOrDefault(style);
    const html = document.documentElement;
    if(style === "default"){
      html.setAttribute("data-style","default");
    } else {
      html.setAttribute("data-style", style);
    }
    // update meta theme-color for mobile browser chrome matching palette (optional)
    try{
      let meta = document.querySelector('meta[name="theme-color"]');
      if(!meta){ meta=document.createElement("meta"); meta.name="theme-color"; document.head.appendChild(meta); }
      const t = THEMES.find(x=>x.id===style);
      if(t) meta.content = t.body;
    }catch{}
  }

  async function persistStyle(style){
    style = validOrDefault(style);
    try{ localStorage.setItem(STYLE_KEY, style); }catch{}
    // sync to profile if logged in (non-blocking, best-effort)
    try{
      const sb = window.supabaseRequest;
      const rs = window.restValue;
      // we need member_id/profile sync — defer to existing session logic
      // Try to get session from localStorage supabase? Instead call generic PATCH via common helpers if available
      // Use profiles table if column exists; swallow errors (column may not exist yet)
      const sessRaw = localStorage.getItem("cineaura_session");
      let memberId = null;
      if(sessRaw){ try{ const s=JSON.parse(sessRaw); memberId = s.member_id || s.memberId || null; }catch{} }
      // also check sb session storage used elsewhere
      if(!memberId){
        // try reading from dashboard state? fallback: attempt PATCH without id will fail safely
      }
      if(memberId && sb && rs){
        sb(`/rest/v1/profiles?member_id=eq.${rs(memberId)}`, { method:"PATCH", body: JSON.stringify({ style }) }).catch(()=>{});
      }
    }catch{}
  }

  function setStyle(style, opts){
    style = validOrDefault(style);
    applyStyle(style);
    const persist = !opts || opts.persist !== false;
    if(persist) persistStyle(style);
    // dispatch event for listeners
    try{ window.dispatchEvent(new CustomEvent("cineaura:style", { detail:{ style }})); }catch{}
    // toast if helper available
    try{ if(window.toast && opts && opts.toast) window.toast(opts.toast); }catch{}
  }

  function ensureCss(){
    ["css/themes.css","css/help-look.css"].forEach(href=>{
      if(document.querySelector(`link[href="${href}"]`)) return;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    });
  }

  function renderPicker(container, current){
    current = validOrDefault(current || getStyle());
    container.innerHTML = "";
    container.className = "sset-themes-grid";
    THEMES.forEach(t=>{
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sset-theme-card" + (t.id===current ? " active" : "");
      btn.setAttribute("data-style-pick", t.id);
      btn.setAttribute("aria-label", t.label);
      btn.setAttribute("aria-pressed", t.id===current ? "true" : "false");
      // preview
      const prev = document.createElement("div");
      prev.className = "sset-theme-prev";
      prev.style.background = t.body;
      prev.innerHTML = `<div class="sset-theme-prev__bar" style="background:${t.bar}"><span class="sset-theme-prev__dot" style="background:rgba(255,255,255,.95)"></span><span class="sset-theme-prev__dot" style="background:rgba(255,255,255,.75)"></span><span class="sset-theme-prev__dot" style="background:rgba(255,255,255,.55)"></span></div><div class="sset-theme-prev__body" style="color:${t.id==='facebook'&&current!==t.id?'#1877f2': (t.body==='#ffffff'||t.body==='#f0f2f5'||t.body==='#f3f3f3'||t.body==='#ececef'||t.body==='#fffbfe'||t.body==='#f2f2f7'||t.body==='#fafafa'?'#222':'#fff')}">${t.icon}</div>`;
      const name = document.createElement("div");
      name.className = "sset-theme-name";
      name.textContent = t.label;
      const sub = document.createElement("div");
      sub.className = "sset-theme-sub";
      sub.textContent = t.sub;
      btn.append(prev, name, sub);
      btn.addEventListener("click", ()=>{
        setStyle(t.id);
        // update active state in this picker
        container.querySelectorAll(".sset-theme-card").forEach(el=>{
          const is = el.getAttribute("data-style-pick")===t.id;
          el.classList.toggle("active", is);
          el.setAttribute("aria-pressed", is ? "true":"false");
        });
        // also update any other picker on page (dashboard select sync)
        const sel = document.getElementById("s-style");
        if(sel) sel.value = t.id;
      });
      container.appendChild(btn);
    });
  }

  // Early boot: apply before first paint if possible
  try{
    const early = (()=>{ try{ return localStorage.getItem(STYLE_KEY); }catch{return null;} })();
    if(early && VALID.includes(early)){
      document.documentElement.setAttribute("data-style", early);
    } else {
      // default explicit to allow CSS scoping
      document.documentElement.setAttribute("data-style","default");
    }
  }catch{ try{ document.documentElement.setAttribute("data-style","default"); }catch{} }

  // ensure CSS link
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", ensureCss);
  } else {
    ensureCss();
  }
  // also do it now for early paint
  ensureCss();

  // expose API
  window.CineauraTheme = { THEMES, VALID, getStyle, setStyle, applyStyle, renderPicker, STYLE_KEY };

  // Listen for profile-loaded event to hydrate style from server if newer (optional)
  window.addEventListener("cineaura:profile", (e)=>{
    const p = e.detail && e.detail.profile;
    if(p && p.style && VALID.includes(p.style)){
      const local = getStyle();
      if(local === "default" && p.style !== "default"){
        setStyle(p.style, { persist:true });
      }
    }
  });

})();
