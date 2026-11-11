// Takes the screenshots in docs/images/ (the mewbeat guide and the README gallery) from the Activity's mock pages.
//
// What it needs:
//   - Node 20+ and the Activity's dependencies installed (activity/node_modules, so `vite` resolves).
//   - puppeteer-core. It is NOT a dependency of this repo; install it anywhere outside the checkout
//     (npm install puppeteer-core in an empty folder) and point PUPPETEER_DIR at that folder.
//   - Microsoft Edge (or any Chromium). EDGE_PATH overrides the default Windows location.
//   - Network access, for the cover art the mock pages load (picsum.photos). Without it the covers stay blank.
//
// How to run (from the repository root):
//   PUPPETEER_DIR=/path/to/folder node scripts/mewbeat-docs/screenshots.mjs [shot ...]
//   PUPPETEER_DIR=... OUT_DIR=/some/folder node scripts/mewbeat-docs/screenshots.mjs song-select
//
// With no shot names it takes all of them. OUT_DIR defaults to docs/images; the shots land in OUT_DIR/mewbeat/, except
// activity-player, which lands in OUT_DIR itself. Shots are WebP files.
//
// It starts the Activity's Vite dev server itself, as a child on port 5177 (PORT overrides; the port is strict, so a
// busy one fails instead of moving), waits for it, and stops that child by its PID when done or on any failure.
// The pages are the dev-only mock pages (?mock=1 and friends, see activity/src/mewbeat/mockLink.js and MockLobby.jsx):
// fake songs, fake players, no bot, no Discord. Nothing here talks to a real server.
//
// Names in the mock data are replaced in the page before each shot (see ALIASES), so no real names end up in an image.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ACTIVITY = path.join(ROOT, "activity");
const PORT = Number(process.env.PORT) || 5177;
const OUT_DIR = path.resolve(process.env.OUT_DIR || path.join(ROOT, "docs", "images"));
const EDGE = process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const QUALITY = 85;
const WIDTH = 1280;
const HEIGHT = 720;

if (!process.env.PUPPETEER_DIR) {
  console.error("Set PUPPETEER_DIR to a folder that has puppeteer-core installed (see the header of this file).");
  process.exit(2);
}
const puppeteer = createRequire(path.join(path.resolve(process.env.PUPPETEER_DIR), "x.js"))("puppeteer-core");

// Stand-ins for the names the mock data carries. The mock profile and room players are made-up, but they are replaced anyway.
const ALIASES = { Meowczelloo: "Mika", kuba: "Alex", neko: "Sam", ola: "Robin", dawid: "Jamie", shiro: "Noor", vex: "Ivo", luna: "Lena", tomek: "Theo" };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Replaces the aliased names in every text node and attribute that shows one, and the one-letter avatar initials with them.
async function scrub(page) {
  await page.evaluate((aliases) => {
    const lower = Object.fromEntries(Object.entries(aliases).map(([from, to]) => [from.toLowerCase(), to]));
    const pattern = new RegExp(`\\b(${Object.keys(aliases).join("|")})\\b`, "gi");
    const swap = (text) => text.replace(pattern, (m) => lower[m.toLowerCase()]);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (pattern.test(node.nodeValue)) { pattern.lastIndex = 0; node.nodeValue = swap(node.nodeValue); }
      pattern.lastIndex = 0;
    }
    for (const el of document.querySelectorAll("[title],[aria-label],[alt]")) {
      for (const attr of ["title", "aria-label", "alt"]) {
        const value = el.getAttribute(attr);
        if (value && pattern.test(value)) el.setAttribute(attr, swap(value));
        pattern.lastIndex = 0;
      }
    }
    // Avatars with no picture show the first letters of the original name: redo them from the name next to them.
    const names = Object.values(aliases);
    for (const av of document.querySelectorAll(".mb-ss-av, .mb-res-av-text")) {
      const initials = av.textContent.trim();
      if (!initials || initials.length > 2) continue;
      let row = av.parentElement;
      for (let depth = 0; row && depth < 4; depth++, row = row.parentElement) {
        const name = names.find((n) => new RegExp(`\\b${n}\\b`).test(row.innerText));
        if (name) { av.textContent = name.slice(0, initials.length).toUpperCase(); break; }
      }
    }
  }, ALIASES);
}

async function waitText(page, text, timeout = 30000) {
  await page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout }, text);
}

async function clickText(page, selector, text) {
  const ok = await page.evaluate((sel, t) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.innerText.trim().toLowerCase().startsWith(t.toLowerCase()));
    if (!el) return false;
    el.click();
    return true;
  }, selector, text);
  if (!ok) throw new Error(`no ${selector} starting with "${text}"`);
}

async function openMock(page, query) {
  await page.goto(`http://127.0.0.1:${PORT}/?mock=1${query}`, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(5000); // the loader screen comes first
}

// The mock Activity shows a loader for a few seconds, then the music player.
async function openPlayer(page, query = "") {
  await openMock(page, query);
  await page.waitForSelector('button[aria-label="mewbeat"]', { timeout: 30000 });
  await sleep(800);
}

// Opens the game from the player's mewbeat button; the query picks which mock screen it shows.
async function openGame(page, query = "", readyText = "COMBO") {
  await openPlayer(page, query);
  await page.click('button[aria-label="mewbeat"]');
  await waitText(page, readyText);
  await sleep(1200);
}

// Plays the mock chart (a note on every 500 ms from 2 s, lanes 0 1 2 3 2 1, extra mirrored notes and four holds, see
// mockLink.js) with synthetic key events, so the shot has a combo and a score. It syncs on the HUD clock turning over a
// second and then runs a timer in the page. Returns when `untilSongMs` of the song has been played.
async function autoplay(page, untilSongMs) {
  await page.evaluate((untilSongMs) => new Promise((resolve) => {
    const KEYS = ["KeyD", "KeyF", "KeyJ", "KeyK"];
    const HOLDS = { 10: 2, 12: 1, 21: 1, 25: 2 };
    const LANES = [0, 1, 2, 3, 2, 1];
    const clockText = () => document.body.innerText.match(/(\d+):(\d\d) \/ \d+:\d\d/);
    const press = (lane, down) => {
      const ev = new KeyboardEvent(down ? "keydown" : "keyup", { code: KEYS[lane], key: "dfjk"[lane], bubbles: true, cancelable: true });
      window.dispatchEvent(ev);
    };
    let last = null;
    const sync = setInterval(() => {
      const m = clockText();
      if (!m) return;
      const seconds = Number(m[1]) * 60 + Number(m[2]);
      if (last === null) { last = seconds; return; }
      if (seconds === last) return;
      clearInterval(sync);
      const origin = performance.now() - seconds * 1000; // perf time of song time 0
      const events = [];
      for (let beat = 0; ; beat++) {
        const t = 2000 + beat * 500;
        if (t > untilSongMs) break;
        if (t < seconds * 1000 + 200) continue;
        const lane = LANES[beat % 6];
        const len = HOLDS[beat] ? HOLDS[beat] * 500 - 100 : 0;
        const lanes = (beat + 1) % 8 === 0 ? [lane, 3 - lane] : [lane];
        for (const l of lanes) {
          events.push({ at: t, lane: l, down: true });
          events.push({ at: t + (len || 60), lane: l, down: false });
        }
      }
      events.sort((a, b) => a.at - b.at);
      let i = 0;
      const timer = setInterval(() => {
        const now = performance.now() - origin;
        while (i < events.length && events[i].at <= now) { press(events[i].lane, events[i].down); i++; }
        if (i >= events.length) { clearInterval(timer); resolve(); }
      }, 4);
    }, 8);
  }), untilSongMs);
}

const SHOTS = {
  // The music player in the Activity, with the mewbeat button in its header.
  async "activity-player"(page) {
    await openPlayer(page);
    await sleep(1500);
  },

  // The solo song select with a song picked: its four levels, modifiers and board on the left, the list on the right.
  async "song-select"(page) {
    await openGame(page, "&select=1", "This server");
    await sleep(1500);
    await page.mouse.click(950, 220); // the first row of the list
    await sleep(2500);
  },

  // The song select's left pane before any song is picked: the player's profile.
  async "profile"(page) {
    await openGame(page, "&select=1", "This server");
    await sleep(2500);
  },

  // A run in progress in Live mode on the mock chart, with a combo.
  async "run"(page) {
    await openGame(page);
    await autoplay(page, 26000);
    await sleep(150);
  },

  // The first-run tour: Mewbit pointing at the level tiles (step five of ten).
  async "tour"(page) {
    await openGame(page, "&firstrun", "Show me around");
    await clickText(page, ".mb-tour button", "Show me around");
    for (let step = 0; step < 3; step++) {
      await sleep(1800);
      await clickText(page, ".mb-tour button", "Next");
    }
    await sleep(6000); // Mewbit types the line out letter by letter
  },

  // The settings panel (Sync group is the one worth showing: offsets, calibration, per-song alignment).
  async "settings"(page) {
    // Live cannot be paused and the mock song fails an idle player after a few seconds (a FAILED banner), so this is quick.
    await openPlayer(page);
    await page.click('button[aria-label="mewbeat"]');
    await waitText(page, "COMBO");
    await page.keyboard.press("Escape");
    await sleep(300);
    await clickText(page, "button", "Settings");
    await sleep(300);
    await clickText(page, "button", "Sync");
    await sleep(500);
  },

  // A room lobby where the picked song is still being charted (the wait line).
  async "room-charting"(page) {
    await openGame(page, "&lobby=1&charting=1", "Ready");
    await sleep(3000);
  },

  // The end-of-run screen of a room round, with the standings and the vote for the next map.
  async "results"(page) {
    await openGame(page, "&lobby=1&results=1", "Accuracy");
    await sleep(4500);
  },

  // The room lobby: players, queue, levels, Ready.
  async "room-lobby"(page) {
    await openGame(page, "&lobby=1", "Ready");
    await sleep(3000);
  },
};

async function startVite() {
  const vite = spawn(process.execPath, [path.join(ACTIVITY, "node_modules", "vite", "bin", "vite.js"), "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], {
    cwd: ACTIVITY,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`vite did not start in 60 s:\n${out}`)), 60000);
    const onData = (chunk) => {
      out += chunk;
      if (/Local:|ready in/.test(out)) { clearTimeout(timer); resolve(); }
    };
    vite.stdout.on("data", onData);
    vite.stderr.on("data", onData);
    vite.on("exit", (code) => { clearTimeout(timer); reject(new Error(`vite exited with ${code}:\n${out}`)); });
  });
  return vite;
}

async function main() {
  const wanted = process.argv.slice(2);
  const names = wanted.length ? wanted : Object.keys(SHOTS);
  for (const name of names) if (!SHOTS[name]) throw new Error(`unknown shot "${name}"; known: ${Object.keys(SHOTS).join(", ")}`);
  mkdirSync(OUT_DIR, { recursive: true });

  const vite = await startVite();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"] });
    for (const name of names) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
        page.on("pageerror", (e) => console.log(`[${name}] page error: ${String(e).slice(0, 200)}`));
        await SHOTS[name](page);
        await scrub(page);
        const file = path.join(OUT_DIR, name === "activity-player" ? "" : "mewbeat", `${name}.webp`);
        mkdirSync(path.dirname(file), { recursive: true });
        await page.screenshot({ path: file, type: "webp", quality: QUALITY });
        console.log(`${name}: ${file} (${Math.round(statSync(file).size / 1024)} KB)`);
      } catch (error) {
        console.error(`${name}: failed: ${error.message}`);
        process.exitCode = 1;
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser?.close().catch(() => {});
    vite.kill();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
