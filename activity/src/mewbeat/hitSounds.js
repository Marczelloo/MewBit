// The sounds a key press can make; values as HIT_SOUND_CHOICES in helpers/mewbeat/userSettings.js (the activity
// cannot import that CJS file). level evens them out, since the samples differ a lot in how loud they sit.
export const HIT_SOUNDS = [
  { value: "kick", label: "Kick", name: "hit-kick", level: 1 },
  { value: "taiko", label: "Taiko", name: "hit-taiko", level: 1 },
  { value: "drum", label: "Drum", name: "hit-drum", level: 1.5 },
  { value: "tight", label: "Tight", name: "hit-tight", level: 1.25 },
];

export function hitSoundOf(choice) {
  return HIT_SOUNDS.find(({ value }) => value === choice) ?? HIT_SOUNDS[0];
}
