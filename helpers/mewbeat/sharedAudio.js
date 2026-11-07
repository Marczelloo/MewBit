const path = require("node:path");

const { createAudioStore } = require("./audioStore");

// The audio store of the running bot: the activity serves its files and the melody decoder (melodyDecoder.js) reads them, so
// there is one store and one eviction, not two that remove each other's files.
const audioStore = createAudioStore({ dir: path.join(__dirname, "..", "data", "mewbeat", "audio") });

module.exports = { audioStore };
