"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("creator workspace provides channel, blog, space, library and subscriber navigation", () => {
  const html = read("creator-dashboard.html");
  const js = read("js/creator-dashboard.js");
  for (const key of ["channel", "blog", "space", "library"]) assert.match(js, new RegExp(`${key}: \\{ label:`));
  assert.match(js, /data-tab="discover"/);
  assert.match(js, /data-tab="subscribers"/);
  assert.match(html, /js\/creator-dashboard\.js/);
  assert.match(html, /css\/creator-dashboard\.css/);
});

test("creator workspace migration stores metadata, team, subscribers, categories and content links", () => {
  const sql = read("sql/creator_workspace.sql");
  for (const table of ["creator_hubs", "creator_hub_staff", "creator_hub_subscribers", "creator_hub_categories", "creator_hub_items", "creator_hub_passes"])
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(sql, /check \(depth between 1 and 3\)/);
  assert.match(sql, /interval '30 days'/);
  assert.match(sql, /creator_hub_can_view\(p_hub bigint/);
});

test("dashboard Videos uses the content_mine RPC and avoids the misleading community setup error", () => {
  const js = read("js/dashboard.js");
  const start = js.indexOf("async function viewOwnVideos(main)");
  const end = js.indexOf("async function viewCommunityContributions", start);
  const fn = js.slice(start, end);
  assert.match(fn, /C\.rpc\("content_mine"/);
  assert.doesNotMatch(fn, /com\.loadFail/);
});
