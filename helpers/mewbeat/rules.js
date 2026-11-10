const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MODIFIERS_FILE = path.join(__dirname, "../../activity/src/mewbeat/modifiers.js");

let modifiersModule = null;

// The client's own modifiers module (ESM, shipped in the image), like scoring.js: the server accepts exactly
// the list the Activity offers.
function loadClientModifiers() {
  modifiersModule ??= import(pathToFileURL(MODIFIERS_FILE).href);
  return modifiersModule;
}

// A board key is built in sync code (board and song list replies), where the ESM module can't be awaited,
// so the version is read out of the file's text, once. A file that no longer says it fails loudly here rather
// than putting scores under a wrong key.
function readRulesVersion() {
  const match = /export const RULES_VERSION = (\d+);/.exec(fs.readFileSync(MODIFIERS_FILE, "utf8"));
  if (!match) throw new Error("modifiers.js does not declare RULES_VERSION as a plain integer");
  return Number(match[1]);
}

const RULES_VERSION = readRulesVersion();

// The scores key of a chart: the song, the level, the chart version and the scoring rules version. Runs scored
// by other rules are on other boards; their rows stay in the store and just never match this key.
function boardKeyOf(audioKey, difficulty, version) {
  return `${audioKey}|${difficulty}|${version}|r${RULES_VERSION}`;
}

module.exports = { RULES_VERSION, boardKeyOf, loadClientModifiers };
