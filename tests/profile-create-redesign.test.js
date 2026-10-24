"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

test("profile Create contains only the create flow and requested list types", () => {
  const profile = read("js/profile.js");
  assert.match(profile, /const STUDIO_KINDS = \["post", "playlist", "readlist", "buylist", "recommendation", "reclist", "review"\]/);
  assert.match(profile, /async function viewCreate\(main\)[\s\S]*?studioCreate\(main\.querySelector\("#studio-body"\)\)/);
  assert.doesNotMatch(profile.slice(profile.indexOf("async function viewCreate"), profile.indexOf("// ── Studio › Create content")), /data-st=|studioManage\(|studioStats\(/);
  assert.match(profile, /M\?\.openListForm\(/);
  assert.match(profile, /insertPost\("readlist"/);
  assert.doesNotMatch(profile.match(/const NAV_SECTIONS = \[[^\]]+\]/)?.[0] || "", /"content"/);
});

test("Your content lives in Dashboard with the five requested content categories", () => {
  const dashboard = read("js/dashboard.js");
  assert.match(dashboard, /\["dash\.grp\.userContent", \["videos", "articles", "documents", "questions", "answers"\]\]/);
  assert.match(dashboard, /videos: viewOwnVideos/);
  assert.match(dashboard, /questions: \(main\) => viewCommunityContributions/);
  assert.match(dashboard, /answers: \(main\) => viewCommunityContributions/);
  assert.match(read("dashboard.html"), /src="js\/community\.js"/);
});

test("Readlist is an allowed post type after its migration is applied", () => {
  assert.match(read("sql/profile_create_types.sql"), /'readlist'/);
  assert.match(read("sql/plain_posts.sql"), /'readlist'/);
  assert.match(read("js/profile.js"), /if \(kind === "readlist"\) return drawReadlistComposer\(host\)/);
  assert.match(read("js/profile.js"), /source_type: type, source_id: "", href: url\.href/);
});

test("post interactions separate agreement, recommendations, and comment sentiment", () => {
  const profile = read("js/profile.js");
  const migration = read("sql/post_interactions.sql");
  assert.match(profile, /data-agree="agree"/);
  assert.match(profile, /data-agree="disagree"/);
  assert.match(profile, /data-vote="up"/);
  assert.match(profile, /data-vote="down"/);
  assert.match(profile, /data-cmt-sentiment=/);
  assert.match(profile, /data-comment-filter=/);
  assert.match(profile, /agreement: value/);
  assert.match(migration, /agreement in \('agree', 'disagree'\)/);
  assert.match(migration, /sentiment in \('positive', 'negative', 'neutral'\)/);
});

test("recommendations and lists can reference non-TMDB content", () => {
  const profile = read("js/profile.js");
  const migration = read("sql/post_linked_items.sql");
  assert.match(profile, /t\("prof\.attachOther"\)/);
  assert.match(profile, /source_type: it\.source_type/);
  assert.match(profile, /postItemHtml\(it\)/);
  assert.match(migration, /alter column tmdb_id drop not null/);
  assert.match(migration, /'article', 'document', 'answer', 'product'/);
});
