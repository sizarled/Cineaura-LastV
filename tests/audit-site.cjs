// CineAura — whole-site audit. Informational: prints findings, never fails.
// Run: node tests/audit-site.cjs
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const list = (d, re) => fs.readdirSync(path.join(ROOT, d)).filter((f) => re.test(f)).map((f) => path.join(d, f));

const S = [];
const section = (t) => S.push(`\n=== ${t} ===`);
const line = (t) => S.push(t);

// ---------------- 1. HTML pages: referenced assets & internal links exist
section("1. Pages: assets & links");
const pages = list(".", /\.html$/i);
const allFiles = new Set();
(function walk(d) { for (const f of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const rel = path.join(d, f.name); if (f.isDirectory()) { if (["node_modules", ".git", "tests"].includes(f.name)) continue; walk(rel); } else allFiles.add(rel.replace(/\\/g, "/").replace(/^\.\//, "")); } })( ".");
let missAssets = 0, missLinks = 0;
for (const page of pages) {
  const html = read(page);
  const assets = [...html.matchAll(/<(?:script[^>]+src|link[^>]+href)=["']([^"']+)["']/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u) && !u.startsWith("//") && !u.startsWith("data:"));
  for (const a of assets) {
    const rel = a.split("?")[0].replace(/^\.\//, "");
    if (!allFiles.has(rel)) { line(`  MISSING asset in ${page}: ${a}`); missAssets++; }
  }
  const links = [...html.matchAll(/href=["']([^"']+\.html)(?:\?[^"']*)?["']/gi)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));
  for (const l of links) {
    const rel = l.split("?")[0].replace(/^\.\//, "");
    if (!allFiles.has(rel)) { line(`  MISSING page link in ${page}: ${l}`); missLinks++; }
  }
}
line(`  pages: ${pages.length} · missing assets: ${missAssets} · missing page links: ${missLinks}`);

// ---------------- 2. JS syntax + CSS balance
section("2. JS syntax / CSS balance");
let jsBad = 0;
for (const f of list("js", /\.js$/i)) {
  const { execSync } = require("child_process");
  try { execSync(`node --check "${path.join(ROOT, f)}"`, { stdio: "pipe" }); } catch (e) { line(`  SYNTAX ERROR ${f}: ${String(e.stderr).split("\n")[0]}`); jsBad++; }
}
let cssBad = 0;
for (const f of list("css", /\.css$/i)) {
  const css = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
  if ((css.match(/{/g) || []).length !== (css.match(/}/g) || []).length) { line(`  BRACE IMBALANCE ${f}`); cssBad++; }
}
line(`  js files: ${list("js", /\.js$/i).length} (${jsBad} bad) · css files: ${list("css", /\.css$/i).length} (${cssBad} bad)`);

// ---------------- 3. i18n coverage
section("3. i18n coverage");
const enSrc = read("js/i18n.js");
// The KEYS dictionary closes with "};" on its own line — values may contain ";}".
const kbStart = enSrc.indexOf("const KEYS = {");
const kbEnd = enSrc.search(/\n  \};[\s\n]/);
const keyBlock = enSrc.slice(kbStart, kbEnd > kbStart ? kbEnd : undefined);
const engineKeys = new Map([...keyBlock.matchAll(/"([a-z0-9._-]+)":\s*"((?:[^"\\]|\\.)*)"/gi)].map((m) => [m[1], m[2]]));
const usedKeys = new Set();
for (const f of [...list("js", /\.js$/i)]) {
  const src = read(f);
  for (const m of src.matchAll(/\bt\(\s*"([a-z0-9._-]+)"/gi)) usedKeys.add(m[1]);
  for (const m of src.matchAll(/\bt\(\s*`([a-z0-9._$]+)`/gi)) {
    const mm = m[1].match(/^([a-z0-9.]+)\.\$\{/i);
    if (mm) usedKeys.add(`${mm[1]}.*`);
  }
}
const engDotted = new Set([...read("lang/english.js").matchAll(/"([a-z][a-zA-Z0-9._-]*\.[a-zA-Z0-9._-]+)":/g)].map((m) => m[1]));
const missingEngine = [...usedKeys].filter((k) => !k.endsWith(".*") && !engineKeys.has(k)).sort();
const missingAll = missingEngine.filter((k) => !engDotted.has(k));
if (missingAll.length) line(`  t() keys missing from ENGINE + packs — render raw (${missingAll.length}):\n    ${missingAll.join("\n    ")}`);
line(`  used t() keys: ${usedKeys.size} · engine keys: ${engineKeys.size} · dotted fallback entries in lang/english.js: ${engDotted.size}`);
line(`  missing from engine but carried by the pack fallback: ${missingEngine.length - missingAll.length} · nowhere at all: ${missingAll.length}`);
// every engine value (English sentence) should exist in every language pack, both files
const langs = ["english", "arabic", "french", "german", "italian", "spanish", "dutch"];
const packs = Object.fromEntries(langs.map((lg) => [lg, { js: read(`lang/${lg}.js`), lng: read(`lang/${lg}.lng`) }]));
const uniqVals = [...new Set(engineKeys.values())].filter((v) => /[A-Za-z]/.test(v));
let missingTr = 0;
for (const v of uniqVals) {
  for (const lg of langs) {
    if (!packs[lg].js.includes(`"${v}":`)) { if (missingTr++ < 40) line(`  lang/${lg}.js missing: "${v.slice(0, 60)}"`); }
    // .lng files are legacy mirrors the site never reads (js/lang.js only loads lang/*.js);
    // the project rule keeps lang/arabic.lng in sync with arabic.js, so audit that one only.
    // sentences containing " = " can never be .lng keys (that would break the file's own " = " separator)
    if (lg === "arabic" && !v.includes(" = ") && !packs[lg].lng.includes(`${v} = `)) { if (missingTr < 80) line(`  lang/${lg}.lng missing: "${v.slice(0, 60)}"`); missingTr++; }
  }
}
line(`  distinct sentences: ${uniqVals.length} · missing pack entries: ${missingTr}`);

// ---------------- 4. SQL <-> JS contracts
section("4. SQL ↔ JS contract");
const sqlFiles = list("sql", /\.sql$/i);
const sqlAll = sqlFiles.map((f) => read(f)).join("\n");
const sqlFns = new Set([...sqlAll.matchAll(/create or replace function public\.([_a-z0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase()));
const sqlTables = new Set([...sqlAll.matchAll(/create table if not exists public\.([_a-z0-9]+)/gi)].map((m) => m[1].toLowerCase()));
const jsAll = list("js", /\.js$/i).map((f) => read(f)).join("\n");
const rpcUsed = new Set([...jsAll.matchAll(/\/rest\/v1\/rpc\/([_a-z0-9]+)/gi)].map((m) => m[1].toLowerCase()));
const tblUsed = new Set([...jsAll.matchAll(/\/rest\/v1\/([_a-z0-9]+)(?=[?\s/"`])/gi)].map((m) => m[1].toLowerCase()).filter((t2) => t2 !== "rpc"));
const rpcMissing = [...rpcUsed].filter((r) => !sqlFns.has(r)).sort();
const tblMissing = [...tblUsed].filter((t2) => !sqlTables.has(t2)).sort();
if (rpcMissing.length) line(`  RPC used by JS but not defined in sql/*.sql (${rpcMissing.length}): ${rpcMissing.join(", ")}`);
if (tblMissing.length) line(`  tables used by JS but not created in sql/*.sql (${tblMissing.length}): ${tblMissing.join(", ")}`);
line(`  rpc used: ${rpcUsed.size} (defined: ${sqlFns.size}) · tables used: ${tblUsed.size} (defined: ${sqlTables.size})`);

// duplicates: same function defined in two files (last-run wins — fine) — just count
const fnFiles = {};
for (const f of sqlFiles) for (const m of read(f).matchAll(/create or replace function public\.([_a-z0-9]+)\s*\(/gi)) (fnFiles[m[1]] = fnFiles[m[1]] || []).push(f);
const dups = Object.entries(fnFiles).filter(([, ls]) => ls.length > 1);
if (dups.length) line(`  functions defined in several files (${dups.length}): ${dups.map(([f2, ls]) => `${f2} [${ls.join(", ")}]`).slice(0, 12).join("; ")}${dups.length > 12 ? " …" : ""}`);

// ---------------- 5. Table columns the JS writes
section("5. Task migrations present");
for (const obj of ["sql/post_reports.sql", "sql/post_reach.sql", "sql/plain_posts.sql", "sql/market_review_votes.sql", "sql/help_upload.sql"]) {
  line(`  ${fs.existsSync(path.join(ROOT, obj)) ? "OK " : "MISSING "} ${obj}`);
}

console.log(S.join("\n"));
