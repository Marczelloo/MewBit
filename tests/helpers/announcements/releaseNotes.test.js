const assert = require("node:assert/strict");
const test = require("node:test");
const { init, getAllVersions, getCurrentVersion, getPatchNotes } = require("../../../helpers/announcements/announcer");
const { describeChangelog, describeRelease, unseenRelease } = require("../../../helpers/announcements/releaseNotes");

const rank = (version) => version.split(".").map(Number);
const newer = (a, b) => { const [x, y] = [rank(a), rank(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

test("notes written ahead of a release stay hidden until package.json reaches them", async () => {
  await init();
  const current = getCurrentVersion();
  for (const version of getAllVersions()) assert.ok(newer(version, current) <= 0, `${version} is above the running ${current}`);
  assert.equal(describeChangelog()[0].version, current);
});

test("every shown release has a short summary, its own or its first lines", async () => {
  await init();
  for (const release of describeChangelog()) {
    assert.ok(release.summary.length > 0, `${release.version} has no summary`);
    assert.ok(release.summary.length <= 4, `${release.version} summary is too long for the window`);
    const own = getPatchNotes(release.version).summary;
    if (!own) assert.deepEqual(release.summary, [...release.features, ...release.changes, ...release.fixes].slice(0, 3));
  }
});

test("a release written with its own summary keeps it", async () => {
  await init();
  const drafted = Object.keys(require("../../../helpers/data/patchNotes.json")).find((version) => getPatchNotes(version).summary);
  if (!drafted) return;
  assert.deepEqual(describeRelease(drafted).summary, getPatchNotes(drafted).summary);
});

test("the What's new window shows the running release once per account", async () => {
  await init();
  const current = getCurrentVersion();
  const unseen = unseenRelease(undefined);
  assert.equal(unseen.version, current);
  assert.ok(unseen.summary.length > 0);
  assert.deepEqual(Object.keys(unseen).sort(), ["date", "summary", "title", "version"]);
  assert.equal(unseenRelease("1.0.0")?.version, current, "a skipped release shows the latest");
  assert.equal(unseenRelease(current), null);
});
