// Which painted scene a song gets. Pure, so Stage.jsx and the tests share it.
// A song always gets the same scene, from a hash of its title and artist. A track with neither
// (a bare source) still gets a fixed one, so the choice never depends on what was on stage before.
// With no track at all there is no choice: the stage keeps the scene it has.
export function pickScene(scenes, track) {
  if (!track || !scenes.length) return null;
  const text = `${track.title ?? ""}|${track.artist ?? ""}`;
  if (text === "|") return scenes[0];
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return scenes[hash % scenes.length];
}
