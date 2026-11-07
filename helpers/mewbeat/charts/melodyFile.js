// features with a decoded melody file (melody/<audio key file>.json, scripts/mewbeat-melody) laid on them: the Normal lays
// its lanes on it and leans its choice of moments on it (generate.js). Read by chartStore.js and the debugger
// (scripts/mewbeat-debug).
function withMelodyFile(features, melody) {
  if (!Array.isArray(melody?.notes)) return features;
  // `tuned`: the same decoder's line drawn denser and smoother (scripts/mewbeat-melody), which Normal reads;
  // `onsetShiftMs`: the line's shift to our onsets, which flag melodyOnsetShift puts in place of `shiftMs`
  const shift = Number.isFinite(melody.onsetShiftMs) && Number.isFinite(melody.shiftMs) ? { decodedMelodyShift: melody.onsetShiftMs - melody.shiftMs } : {};
  // `all`: every decoded note as [t, len, pitch, velocity], which sustain.js reads for long notes
  // `short`: the short notes of a run at a lower onset threshold, which sustain.js reads for a quiet line
  const asNotes = (rows) => rows.map(([t, len, pitch, vel]) => ({ t, len, pitch, vel }));
  const all = Array.isArray(melody.all) ? { decodedNotes: asNotes(melody.all) } : {};
  if (Array.isArray(melody.short)) all.decodedShortNotes = asNotes(melody.short);
  // `lead`: a transcription with an instrument per note (MuScriptor, scripts/mewbeat-melody/lead.js), which sustain.js
  // reads for the line a passage plays
  if (Array.isArray(melody.lead)) all.leadNotes = melody.lead.map(([t, len, pitch, instrument]) => ({ t, len, pitch, instrument }));
  return { ...features, decodedMelody: melody.notes, ...(Array.isArray(melody.tuned) ? { decodedMelodyTuned: melody.tuned } : {}), ...shift, ...all };
}

module.exports = { withMelodyFile };
