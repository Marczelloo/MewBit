const { createHash } = require("node:crypto");

// Small, fast seeded PRNG. Used only for tie-breaks, never for anything the
// clock or Math.random could influence.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// First 8 hex chars of sha1(audioKey) as a 32-bit seed.
function seedFromKey(audioKey) {
  return parseInt(createHash("sha1").update(String(audioKey)).digest("hex").slice(0, 8), 16);
}

module.exports = { mulberry32, seedFromKey };
