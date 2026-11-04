// The story of one chart, for the debugger (scripts/mewbeat-debug): where each note came from, what moved it and what
// threw the others out. Built only by traceChart; without a trace the generator runs as it always does.
//
// Every note carries an id (`tid`) from the moment it exists. The generator's stages spread their notes, so the id
// travels with the note through all of them, and a stage is reported by what it took in and what it gave back:
// an id gone is a note that stage dropped, a note without an id is one it created, a changed field is one it moved.
function createTrace() {
  const records = [];
  const phrases = [];
  let current = null; // the index of the phrase being charted

  function create(kind, note, extra = {}) {
    const record = {
      id: records.length,
      kind,
      phrase: current,
      from: { t: note.t, lane: note.lane, level: note.level, len: note.len },
      now: { t: note.t, lane: note.lane, level: note.level, len: note.len },
      source: note.source,
      reason: note.reason, // why the moment was chosen (selection.js)
      s: note.s,
      support: note.support,
      sustainMs: note.sustainMs,
      hand: note.hand,
      accent: note.accent,
      history: [],
      rejected: null,
      final: false,
      ...extra,
    };
    records.push(record);
    return record;
  }

  function noteChanges(record, stage, note) {
    const change = {};
    for (const field of ["t", "lane", "level", "len"]) {
      if (note[field] !== undefined && note[field] !== record.now[field]) change[field] = note[field];
    }
    // A hold taken back is the one change that clears a field.
    if (note.len === undefined && record.now.len > 0) change.len = 0;
    if (Object.keys(change).length === 0) return;
    Object.assign(record.now, change);
    record.history.push({ stage, ...change });
  }

  return {
    // The phrase the next notes belong to, and how it was charted.
    enter(index, info) {
      current = index;
      phrases[index] = { index, ...info };
    },

    tagged(events) {
      return events.map((e) => ({ ...e, tid: create("event", e).id }));
    },

    // Notes of a repeat: each is a new note that remembers the one it copies.
    copied(notes) {
      return notes.map((n) => {
        const source = records[n.tid];
        return { ...n, tid: create("copy", n, { copyOf: source?.id ?? null, copyOfT: source?.now.t ?? null }).id };
      });
    },

    reject(note, stage, why) {
      const record = records[note.tid];
      if (record && !record.rejected) record.rejected = { stage, t: note.t, lane: note.lane, why };
    },

    // Reports a stage that took `before` and returned `after`; returns `after` so a call can wrap the stage.
    step(stage, before, after) {
      const alive = new Set();
      for (const note of after) {
        if (note.tid === undefined) note.tid = create(stage, note).id;
        else noteChanges(records[note.tid], stage, note);
        alive.add(note.tid);
      }
      for (const note of before) if (!alive.has(note.tid)) this.reject(note, stage);
      return after;
    },

    // The final notes, in chart order; what no stage reports as dropped and no note carries is lost by a hole in the trace.
    report(notes) {
      for (const n of notes) {
        const record = records[n.tid];
        record.final = true;
        record.rejected = null;
      }
      return {
        notes: notes.map(({ tid, ...n }) => ({ ...n, id: tid })),
        records: records.map(({ now, ...record }) => record),
        phrases,
      };
    },
  };
}

module.exports = { createTrace };
