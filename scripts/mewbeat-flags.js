#!/usr/bin/env node

// Switches the experimental chart generator flags (helpers/mewbeat/charts/flags.js) while the bot runs: the chart
// store reads generator-flags.json on every request, so no restart is needed.
//
//   node scripts/mewbeat-flags.js              show what is on
//   node scripts/mewbeat-flags.js +holds -lead turn holds on, lead off
//   node scripts/mewbeat-flags.js none         everything off

const fs = require("node:fs");
const path = require("node:path");

const { writeJsonAtomicSync } = require("../helpers/data/atomicJson");
const { FLAGS, FLAGS_FILE_NAME, flagsKey, normalFlags } = require("../helpers/mewbeat/charts/flags");

// The directory chartStore.js is given for the bot (its charts/ lives beside it).
const FILE = path.join(__dirname, "..", "helpers", "data", "mewbeat", FLAGS_FILE_NAME);

function readFlags() {
  let text;
  try {
    text = fs.readFileSync(FILE, "utf8");
  } catch {
    return {};
  }
  try {
    return normalFlags(JSON.parse(text)?.flags);
  } catch {
    console.error(`Plik ${FILE} jest uszkodzony, traktuję go jako brak flag.`);
    return {};
  }
}

function report(flags) {
  const key = flagsKey(flags);
  console.log(key ? `Włączone flagi: ${key.split("-").join(", ")}` : "Żadna flaga nie jest włączona.");
}

function main(args) {
  const flags = readFlags();
  if (args.length === 0) {
    report(flags);
    for (const [name, { label }] of Object.entries(FLAGS)) console.log(`  ${flags[name] ? "[x]" : "[ ]"} ${name} - ${label}`);
    return 0;
  }

  const next = { ...flags };
  for (const arg of args) {
    if (arg === "none") {
      for (const name of Object.keys(next)) delete next[name];
      continue;
    }
    const name = arg.replace(/^[+-]/, "");
    if (!/^[+-]/.test(arg) || !Object.hasOwn(FLAGS, name)) {
      console.error(`Nieznany argument: ${arg}. Użycie: +nazwa, -nazwa albo none. Znane flagi:`);
      for (const [known, { label }] of Object.entries(FLAGS)) console.error(`  ${known} - ${label}`);
      return 1;
    }
    if (arg.startsWith("+")) next[name] = true;
    else delete next[name];
  }

  writeJsonAtomicSync(FILE, { flags: Object.keys(normalFlags(next)).sort() });
  report(normalFlags(next));
  return 0;
}

process.exitCode = main(process.argv.slice(2));
