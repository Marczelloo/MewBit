const path = require("node:path");

const { createAudioOffset } = require("./audioOffset");
const { createAudioStore } = require("./audioStore");

const DATA_DIR = path.join(__dirname, "..", "data", "mewbeat");

// The audio store of the running bot: the activity serves its files and the melody decoder (melodyDecoder.js) reads them, so
// there is one store and one eviction, not two that remove each other's files.
const audioStore = createAudioStore({ dir: path.join(DATA_DIR, "audio") });

// The audio-offset measurement (audioOffset.js) reads the same audio files and the analysis's features files. Without
// MEWBEAT_DECODER_URL (the Pi today) it is switched off and every offset is null.
const audioOffset = createAudioOffset({ dir: DATA_DIR });

module.exports = { audioOffset, audioStore };
