"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboard = fs.readFileSync(path.join(__dirname, "..", "js", "dashboard.js"), "utf8");
const start = dashboard.indexOf("async function viewOwnVideos(main)");
const end = dashboard.indexOf("async function viewCommunityContributions", start);
const videosView = dashboard.slice(start, end);

test("Dashboard Videos loads through content_mine RPC, not direct table access", () => {
  assert.notEqual(start, -1);
  assert.match(videosView, /C\.rpc\("content_mine", \{ p_member: id \}\)/);
  assert.doesNotMatch(videosView, /\/rest\/v1\/content\?/);
  assert.match(videosView, /r\.id/);
  assert.match(videosView, /r\.thumb/);
  assert.doesNotMatch(videosView, /com\.loadFail/);
});
