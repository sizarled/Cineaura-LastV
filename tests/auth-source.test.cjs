"use strict";
// Local source checks only. Browser behavior and actual PostgreSQL authorization
// are exercised separately; these assertions do not substitute for either.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const htmlFiles = fs.readdirSync(ROOT).filter((file) => file.endsWith(".html"));
function filesIn(directory, extension) {
  return fs.readdirSync(path.join(ROOT, directory), { recursive: true })
    .filter((file) => file.endsWith(extension)).map((file) => path.join(directory, file));
}
function scripts(html) {
  return [...html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .map((match) => ({ attrs: match[1], code: match[2], src: /\bsrc\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1] || "" }));
}
function language(file) {
  const context = { window: {} };
  vm.runInNewContext(read(file), context, { filename: file });
  return context.window;
}

test("all JavaScript, inline scripts and Edge TypeScript parse", (t) => {
  let count = 0;
  for (const file of [...filesIn("js", ".js"), ...filesIn("lang", ".js")]) {
    assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), file);
    count += 1;
  }
  for (const file of htmlFiles) {
    for (const script of scripts(read(file))) {
      if (script.src || /\btype\s*=\s*["']application\//i.test(script.attrs) || !script.code.trim()) continue;
      new vm.Script(script.code, { filename: file + " inline" });
      count += 1;
    }
  }
  for (const file of filesIn("supabase/functions", ".ts")) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    assert.equal(source.parseDiagnostics.length, 0, `${file}: ${source.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("; ")}`);
    count += 1;
  }
  assert.ok(count > 0);
  t.diagnostic(`Parsed ${count} scripts, including all root HTML inline JavaScript and Edge TypeScript.`);
});

test("every page using common.js loads auth.js before it with compatible ordering", (t) => {
  let checked = 0;
  for (const file of htmlFiles) {
    const list = scripts(read(file));
    const common = list.findIndex(script => /(?:^|\/)common\.js(?:\?|$)/.test(script.src));
    if (common < 0) continue;
    const auth = list.findIndex(script => /(?:^|\/)auth\.js(?:\?|$)/.test(script.src));
    assert.ok(auth >= 0 && auth < common, file);
    assert.equal(/\basync\b/i.test(list[auth].attrs), false, file + " must not race an async auth dependency");
    assert.equal(/\bdefer\b/i.test(list[auth].attrs), /\bdefer\b/i.test(list[common].attrs), file + " defer ordering");
    checked += 1;
  }
  assert.ok(checked > 0);
  t.diagnostic(`Checked all ${checked} pages using common.js; remaining root HTML files are legacy redirect wrappers.`);
});

test("member login/signup/recovery contain no legacy credential or RPC fallback", () => {
  for (const file of ["js/login.js", "js/register.js", "js/rest.js"]) {
    assert.doesNotMatch(read(file), /\b(?:sha256|login_member|register_member|reset_password_with_recovery|recovery_code)\b/, file);
  }
  for (const file of ["js/main.js", "js/themes.js", "js/layouts.js"]) {
    assert.doesNotMatch(read(file), /(?:localStorage|sessionStorage)\.getItem\(["']cineaura_session["']\)/, file + " must use native-bound display metadata");
  }
});

test("first-party Supabase credential transport is shared; only an explicit no-credential probe is exempt", () => {
  for (const file of filesIn("js", ".js").filter(file => !file.startsWith("js/vendor/"))) {
    const source = read(file);
    assert.doesNotMatch(source, /Authorization[^\n]{0,90}Bearer[^\n]{0,90}(?:SUPABASE_KEY|SB_KEY)/, file);
    for (const match of source.matchAll(/\bfetch\([^\n]*(?:SUPABASE_URL|SUPABASE_KEY)[^\n]*/g)) {
      // watch.js deliberately asks only whether the host is reachable. It reads
      // no response or rows and sends no credentials; authenticating it is wrong.
      assert.equal(file, "js/watch.js", file);
      assert.match(match[0], /\/rest\/v1\/.*mode: "no-cors"/);
      assert.doesNotMatch(match[0], /headers|apikey|Authorization|SUPABASE_KEY/);
    }
  }
});

test("SQL/TXT deployment mirrors match, including all three Auth migration phases", () => {
  let checked = 0;
  for (const file of filesIn("sql", ".sql")) {
    const mirror = file.replace(/\.sql$/, ".txt");
    assert.ok(fs.existsSync(path.join(ROOT, mirror)), mirror);
    assert.equal(read(file), read(mirror), file);
    checked += 1;
  }
  assert.ok(checked >= 70);
  assert.ok(fs.existsSync(path.join(ROOT, "docs/security-auth-rollout-ar.md")), "operator rollout guide is mandatory");
});

test("new verified-Auth messages have English and Arabic JS/LNG entries", () => {
  const keys = language("js/i18n.js").CineAuraKeys;
  for (const [code, name] of [["en", "english"], ["ar", "arabic"]]) {
    const pack = language(`lang/${name}.js`).CineAuraPacks[code];
    const mirror = read(`lang/${name}.lng`);
    for (const [key, text] of Object.entries(keys).filter(([key]) => key.startsWith("auth.secure."))) {
      assert.ok(pack[text], `${key} missing from ${name}.js`);
      assert.ok(mirror.split(/\r?\n/).some(line => line === `${text} = ${pack[text]}`), `${key} JS/LNG mismatch for ${name}`);
    }
  }
});
