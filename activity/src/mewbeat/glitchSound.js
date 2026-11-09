import { SOUND_URLS } from "./sfx/index.js";
import { createSounds } from "./sounds.js";

// The glitch into the game plays before the game exists, so it has its own small player. Silent until a glitch file
// sits in sfx/.
const url = SOUND_URLS.glitch;
const sounds = url ? createSounds({ urls: { glitch: url } }) : null;

export const prepareGlitchSound = () => sounds?.unlock();

// A game that opened by itself has had no click yet: the sample would wait for the first one and play out of place.
export function playGlitchSound(volume) {
  if (navigator.userActivation?.hasBeenActive === false) return;
  sounds?.play("glitch", volume);
}
