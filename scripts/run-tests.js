#!/usr/bin/env node

// Runs every tests/**/*.test.js file. Shells expand the glob differently
// (POSIX sh has no globstar, so CI only ever saw the top-level files), and
// node --test only understands globs itself from Node 21 on.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function collectTestFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectTestFiles(fullPath);
      return entry.isFile() && entry.name.endsWith(".test.js") ? [fullPath] : [];
    })
    .sort();
}

const files = collectTestFiles(path.join(__dirname, "..", "tests"));
if (!files.length) {
  console.error("No test files found under tests/");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
