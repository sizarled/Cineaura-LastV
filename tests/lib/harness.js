// Shared test harness helpers for CineAura static checks.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function make() {
  let pass = 0, fail = 0;
  const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error("FAIL:", name); } };
  const has = (name, hay, needle) => ok(name, hay.includes(needle));
  const count = (name, hay, needle, n) => ok(name, hay.split(needle).length - 1 === n);
  const done = () => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); };
  return { ok, has, count, done };
}

module.exports = { ROOT, read, make, fs, path };
