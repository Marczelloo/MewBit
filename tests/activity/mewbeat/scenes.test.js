const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const BACKDROP = path.resolve(__dirname, "../../../activity/src/mewbeat/backdrop");
const SCENES = fs.readdirSync(BACKDROP, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
let pickScene;

test.before(async () => {
  ({ pickScene } = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/scenes.js")).href));
});

test("every scene folder has the five layers Stage.jsx asks for", () => {
  assert.ok(SCENES.length > 0);
  for (const scene of SCENES) {
    for (const layer of ["base", "fever", "lit", "glow", "neon"]) {
      assert.ok(fs.existsSync(path.join(BACKDROP, scene, `${layer}.webp`)), `${scene}/${layer}.webp`);
    }
  }
});

test("a song always gets the same scene", () => {
  const track = { title: "Hopes and Dreams", artist: "Toby Fox" };
  assert.equal(pickScene(SCENES, track), pickScene(SCENES, { ...track }));
  assert.ok(SCENES.includes(pickScene(SCENES, track)));
});

test("songs spread over the scenes", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(pickScene(SCENES, { title: `Song ${i}`, artist: `Artist ${i % 7}` }));
  assert.equal(seen.size, SCENES.length);
});

test("a track without a title still gets a fixed scene", () => {
  assert.equal(pickScene(SCENES, { title: null, artist: null }), SCENES[0]);
  assert.equal(pickScene(SCENES, {}), SCENES[0]);
  const byArtist = pickScene(SCENES, { title: null, artist: "Some Band" });
  assert.equal(byArtist, pickScene(SCENES, { title: undefined, artist: "Some Band" }));
});

test("no track means no choice", () => {
  assert.equal(pickScene(SCENES, null), null);
  assert.equal(pickScene([], { title: "x" }), null);
});
