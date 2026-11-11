const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const { dirname, join } = require("node:path");

const root = join(__dirname, "..", "..");
const loadSource = () => import(pathToFileURL(join(root, "scripts", "mewbeat-plugin-source.mjs")).href);

test("the tracked mewbeat plugin jar was built from the current plugin source", async (t) => {
  const { pluginSourceHash, stampPath } = await loadSource();
  const current = pluginSourceHash(root);
  if (!current) {
    t.skip("not a git checkout (or no git): the plugin source cannot be hashed");
    return;
  }
  const stamp = JSON.parse(fs.readFileSync(join(root, stampPath), "utf8"));
  assert.equal(
    current.sha256,
    stamp.sourceSha256,
    "lavalink-plugins/mewbeat changed since the jar in helpers/lavalink/plugins was built: run `pnpm lavalink:mewbeat:build` and commit the jar and mewbeat-plugin.source.json",
  );
  assert.ok(
    fs.existsSync(join(root, "helpers", "lavalink", "plugins", stamp.jar)),
    `the stamp names ${stamp.jar}, which is not in helpers/lavalink/plugins`,
  );
});

test("the plugin source hash follows the main sources and build files, not the tests or the notes", async (t) => {
  const { pluginDir, pluginSourceHash } = await loadSource();
  const dir = fs.mkdtempSync(join(os.tmpdir(), "mewbeat-plugin-hash-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    try {
      git("init", "-q");
    } catch {
      t.skip("no git: the plugin source cannot be hashed");
      return;
    }
    const write = (file, text) => {
      fs.mkdirSync(dirname(join(dir, pluginDir, file)), { recursive: true });
      fs.writeFileSync(join(dir, pluginDir, file), text);
    };
    write("src/main/java/A.java", "class A {}");
    write("src/test/java/ATest.java", "class ATest {}");
    write("build.gradle.kts", 'version = "1"');
    write("SPIKE.md", "notes");
    git("add", "-A");
    const before = pluginSourceHash(dir);
    assert.equal(before.files, 2);
    write("src/test/java/ATest.java", "class ATest { int x; }");
    write("SPIKE.md", "other notes");
    git("add", "-A");
    assert.equal(pluginSourceHash(dir).sha256, before.sha256);
    write("src/main/java/A.java", "class A { int x; }");
    git("add", "-A");
    assert.notEqual(pluginSourceHash(dir).sha256, before.sha256);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the plugin source hash is null outside a git checkout", async () => {
  const { pluginSourceHash } = await loadSource();
  const dir = fs.mkdtempSync(join(os.tmpdir(), "mewbeat-plugin-nogit-"));
  try {
    assert.equal(pluginSourceHash(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
