// visual editor removed per user request 2026-10-19 — stub keeps old ?cine_edit links harmless and prevents handle injection
(() => {
  // expose no-op API so customizer/dashboard links that call CineAuraPageEditor.openPage don't throw
  if (!window.CineAuraPageEditor) {
    window.CineAuraPageEditor = {
      openPage: (k) => {
        const map = { home: 'index.html', watch: 'watch.html', content: 'content.html', market: 'market.html', dashboard: 'dashboard.html', profile: 'profile.html' };
        try { localStorage.removeItem('cineaura_edit_page'); } catch {}
        location.href = map[k] || 'index.html';
      },
      close: () => {}
    };
  }
  // clean stale ?cine_edit param and localStorage that previously auto-activated the editor
  try {
    const u = new URL(location.href);
    let changed = false;
    if (u.searchParams.has('cine_edit')) { u.searchParams.delete('cine_edit'); changed = true; }
    if (changed) history.replaceState(null, '', u.pathname + u.search + (u.hash || ''));
    localStorage.removeItem('cineaura_edit_page');
  } catch {}
  console.info('[Cineaura] visual page-editor disabled — use تخصيص الموقع → معاينة قبل التطبيق');
})();
