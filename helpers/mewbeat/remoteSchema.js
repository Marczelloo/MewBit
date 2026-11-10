// The AtlasHub tables of the mewbeat stores. `key` is the primary key column, which also names a row
// (the outbox upserts by it). Each store owns the mapping between its entries and these rows.
const text = (name, extra = {}) => ({ name, type: "text", ...extra });

const TABLES = {
  scores: {
    name: "mewbeat_scores",
    key: "id",
    columns: [
      text("id", { primaryKey: true }), // `${chartKey}|${userId}`
      text("chart_key", { nullable: false }),
      text("audio_key"),
      text("difficulty"),
      text("chart_version"),
      text("user_id", { nullable: false }),
      text("username"),
      text("avatar_url"),
      { name: "score", type: "bigint" },
      { name: "accuracy", type: "double precision" },
      text("grade"),
      { name: "max_combo", type: "integer" },
      { name: "completion", type: "double precision" },
      text("title"),
      text("artist"),
      text("artwork_url"),
      { name: "guild_ids", type: "jsonb" },
      { name: "modifiers", type: "jsonb" }, // ids from modifiers.js; [] for a plain run
      { name: "at", type: "bigint" },
    ],
    indexes: [
      { name: "mewbeat_scores_chart_key", columns: ["chart_key"] },
      { name: "mewbeat_scores_user_id", columns: ["user_id"] },
    ],
  },
  history: {
    name: "mewbeat_history",
    key: "id",
    columns: [
      text("id", { primaryKey: true }), // `${userId}|${at}|${audioKey}|${difficulty}`
      text("user_id", { nullable: false }),
      text("audio_key"),
      text("uri"),
      text("source"),
      text("title"),
      text("artist"),
      text("artwork_url"),
      { name: "duration_ms", type: "bigint" },
      text("difficulty"),
      { name: "score", type: "bigint" },
      { name: "accuracy", type: "double precision" },
      text("grade"),
      { name: "ranked", type: "boolean" },
      text("mode"),
      text("guild_id"),
      text("chart_version"),
      { name: "failed", type: "boolean" },
      { name: "modifiers", type: "jsonb" },
      { name: "at", type: "bigint" },
    ],
    indexes: [{ name: "mewbeat_history_user_id", columns: ["user_id"] }],
  },
  stats: {
    name: "mewbeat_stats",
    key: "user_id",
    columns: [
      text("user_id", { primaryKey: true }),
      text("username"),
      text("avatar_url"),
      { name: "first_at", type: "bigint" },
      { name: "plays", type: "integer" },
      { name: "play_ms", type: "bigint" },
      { name: "data", type: "jsonb" }, // the other totals, see statsStore.js
      { name: "at", type: "bigint" }, // when the row was last written
    ],
    indexes: [],
  },
};

module.exports = { TABLES };
