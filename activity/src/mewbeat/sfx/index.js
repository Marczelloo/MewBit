// The sample files by name (hit, tick, go...), so sounds.js stays free of bundler imports. Never inlined:
// Discord's sandbox may refuse to fetch a data: URL.
const FILES = import.meta.glob("./*.{mp3,wav}", { eager: true, query: "?url&no-inline", import: "default" });

export const SOUND_URLS = Object.fromEntries(
  Object.entries(FILES).map(([file, url]) => [file.replace(/^\.\/|\.\w+$/g, ""), url]),
);
