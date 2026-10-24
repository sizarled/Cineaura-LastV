/* Social platforms registry — one source for the home strip (js/home-platforms.js)
   and the Panel (js/panel-platforms.js). Colors & glyphs live here; credentials
   and profile URLs live in the database (sql/platforms.sql). */
(function () {
  // key, display name, badge letters / glyph, brand color, what the Panel asks for
  const PLATFORMS = [
    { key: "youtube",   name: "YouTube",   glyph: "▶",  color: "#ff0000", api: true  },
    { key: "facebook",  name: "Facebook",  glyph: "f",  color: "#1877f2", api: true  },
    { key: "instagram", name: "Instagram", glyph: "📷", color: "#e1306c", api: true  },
    { key: "tiktok",    name: "TikTok",    glyph: "♪",  color: "#010101", api: true  },
    { key: "telegram",  name: "Telegram",  glyph: "✈",  color: "#229ed9", api: true  },
    { key: "reddit",    name: "Reddit",    glyph: "r/", color: "#ff4500", api: true  },
    { key: "pinterest", name: "Pinterest", glyph: "✥",  color: "#bd081c", api: true  },
    { key: "quora",     name: "Quora",     glyph: "Q",  color: "#a82400", api: false },
    { key: "tumblr",    name: "Tumblr",    glyph: "t",  color: "#35465c", api: true  },
    { key: "rumble",    name: "Rumble",    glyph: "R",  color: "#85c742", api: false },
    { key: "odysee",    name: "Odysee",    glyph: "O",  color: "#ef1970", api: false },
    { key: "vimeo",     name: "Vimeo",     glyph: "v",  color: "#17b3e8", api: true  },
    { key: "bilibili",  name: "bilibili",  glyph: "b",  color: "#00a1d6", api: false },
    { key: "x",         name: "X",         glyph: "𝕏",  color: "#000000", api: true  },
    { key: "snapchat",  name: "Snapchat",  glyph: "👻", color: "#fffc00", api: false },
    { key: "threads",   name: "Threads",   glyph: "@",  color: "#000000", api: true  },
  ];
  const byKey = {};
  PLATFORMS.forEach((p) => (byKey[p.key] = p));
  const known = (k) => Object.prototype.hasOwnProperty.call(byKey, k);
  const info = (k) => byKey[k] || { key: k, name: k, glyph: k.slice(0, 1).toUpperCase() || "•", color: "#556", api: false, svg: false };
  // every listed network ships an SVG file (icons/platforms/<key>.svg)
  PLATFORMS.forEach((p) => (p.svg = true));

  /* A little rounded brand badge on the brand color, with the real SVG glyph
     (icons/platforms/<key>.svg). size: px. Unknown keys keep a letter tile. */
  function badge(k, size = 34) {
    const p = info(k);
    const light = ["#fffc00"].includes(p.color);
    const inner = p.svg
      ? `<img class="pf-badge-img" src="icons/platforms/${p.key}.svg" alt="" width="${Math.round(size * 0.62)}" height="${Math.round(size * 0.62)}" />`
      : `<span style="font-size:${Math.max(11, size * 0.44)}px">${p.glyph}</span>`;
    return `<span class="pf-badge" style="width:${size}px;height:${size}px;background:${p.color};color:${light ? "#111" : "#fff"}" aria-hidden="true">${inner}</span>`;
  }

  window.CineAuraPlatforms = {
    list: PLATFORMS.slice(),
    byKey,
    known,
    info,
    badge,
    /* Credential fields each network needs on the link page (platform.html)
       and its Panel summary. Write-only: typed values are stored; an empty
       field keeps the stored one. webhook_url — the edge function POSTs the
       payload there (Zapier / Make / n8n / any receiver) when native
       credentials are missing; the only path for api:false networks. */
    CRED_FIELDS: {
      youtube: ["client_id", "client_secret", "refresh_token", "channel_id"],
      facebook: ["page_id", "page_access_token", "group_id"],
      instagram: ["ig_user_id", "access_token"],
      tiktok: ["client_key", "client_secret", "access_token", "open_id"],
      telegram: ["bot_token", "chat_id"],
      reddit: ["client_id", "client_secret", "refresh_token", "subreddit"],
      pinterest: ["access_token", "board_id"],
      tumblr: ["api_key", "access_token", "blog_identifier"],
      vimeo: ["access_token"],
      x: ["api_key", "api_secret", "access_token", "access_secret"],
      threads: ["access_token", "user_id"],
      quora: [], rumble: [], odysee: [], bilibili: [], snapchat: [],
    },
    // the support mail the site lists with its accounts (Platforms.txt)
    EMAIL: "youneselradi95@gmail.com",
  };
})();
