const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, describe, it } = require("node:test");

const { recordAutoplayDecision } = require("../../../helpers/lavalink/autoplayDecisionLog");

const savedFile = process.env.AUTOPLAY_DECISION_LOG_FILE;
const savedSwitch = process.env.AUTOPLAY_DECISION_LOG;
const tempDirs = [];

function tempLogFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autoplay-decisions-"));
  tempDirs.push(dir);
  return path.join(dir, "nested", "autoplay-decisions.jsonl");
}

afterEach(() => {
  if (savedFile === undefined) delete process.env.AUTOPLAY_DECISION_LOG_FILE;
  else process.env.AUTOPLAY_DECISION_LOG_FILE = savedFile;
  if (savedSwitch === undefined) delete process.env.AUTOPLAY_DECISION_LOG;
  else process.env.AUTOPLAY_DECISION_LOG = savedSwitch;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("autoplay decision log", () => {
  it("appends one timestamped JSON line per decision, in order", async () => {
    const file = tempLogFile();
    process.env.AUTOPLAY_DECISION_LOG_FILE = file;

    recordAutoplayDecision({ guildId: "g", winner: { artist: "K/DA", title: "POP/STARS" } });
    await recordAutoplayDecision({ guildId: "g", winner: { artist: "Kenshi Yonezu", title: "KICK BACK" } });

    const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((line) => line.winner.title), ["POP/STARS", "KICK BACK"]);
    assert.ok(lines.every((line) => !Number.isNaN(Date.parse(line.ts))));
  });

  it("stays silent when disabled and never throws on bad input", async () => {
    const file = tempLogFile();
    process.env.AUTOPLAY_DECISION_LOG_FILE = file;
    process.env.AUTOPLAY_DECISION_LOG = "0";
    await recordAutoplayDecision({ guildId: "g" });
    assert.equal(fs.existsSync(file), false);

    delete process.env.AUTOPLAY_DECISION_LOG;
    const circular = {};
    circular.self = circular;
    await recordAutoplayDecision(circular);
    await recordAutoplayDecision(null);
    assert.equal(fs.existsSync(file), false);
  });

  it("rotates the file once it would pass the size cap", async () => {
    const file = tempLogFile();
    process.env.AUTOPLAY_DECISION_LOG_FILE = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x".repeat(5 * 1024 * 1024));

    await recordAutoplayDecision({ guildId: "g", winner: null });

    assert.equal(fs.statSync(`${file}.1`).size, 5 * 1024 * 1024);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).guildId, "g");
  });
});
