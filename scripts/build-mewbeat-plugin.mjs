import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pluginSourceDirty,
  pluginSourceHash,
  stampFile,
  stampPath,
} from "./mewbeat-plugin-source.mjs";

// Builds lavalink-plugins/mewbeat inside the gradle Docker image and installs
// the jar into helpers/lavalink/plugins, which Lavalink mounts as its plugin
// directory. The plugin's unit tests run as part of the build and a failing
// test stops it; --skip-tests leaves them out, --bench also runs the analysis
// time-budget test.
//
// Next to the jar goes a stamp (mewbeat-plugin.source.json) holding a hash of
// the plugin source the jar was built from. tests/scripts/mewbeatPluginJar.test.js
// compares it with the source as git sees it, so a source change without a new
// jar fails the tests. Run `pnpm lavalink:mewbeat:build` after every change in
// lavalink-plugins/mewbeat/src/main or its build files, and commit the jar and
// the stamp together with it.
const runBench = process.argv.includes("--bench");
const skipTests = process.argv.includes("--skip-tests") && !runBench;

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const projectDir = join(repositoryRoot, "lavalink-plugins", "mewbeat");
const pluginsDir = join(repositoryRoot, "helpers", "lavalink", "plugins");
const gradleCacheVolume = "mewbit-gradle-cache";

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

const versionMatch = readFileSync(
  join(projectDir, "build.gradle.kts"),
  "utf8",
).match(/^version\s*=\s*"([^"]+)"/m);
if (!versionMatch) {
  throw new Error("Could not read the plugin version from build.gradle.kts.");
}
const version = versionMatch[1];

const dockerProjectDir =
  process.platform === "win32" ? projectDir.replaceAll("\\", "/") : projectDir;
run("docker", [
  "run",
  "--rm",
  "-v",
  `${dockerProjectDir}:/src`,
  // Keeps the Gradle distribution and dependency downloads between builds.
  "-v",
  `${gradleCacheVolume}:/home/gradle/.gradle`,
  "-w",
  "/src",
  "gradle:8.10-jdk21",
  "bash",
  "./gradlew",
  ...(skipTests
    ? ["build", "-x", "test"]
    : ["test", "build", ...(runBench ? ["-Dmewbeat.bench=true"] : [])]),
  "--no-daemon",
]);

// build/libs is a bind mount that is never cleaned, so older versions may
// still be there. Take exactly the jar of the version that was just built.
const outputDir = join(projectDir, "build", "libs");
const builtJar = `mewbeat-${version}.jar`;
if (!existsSync(join(outputDir, builtJar))) {
  throw new Error(
    `The mewbeat build did not produce ${builtJar} in ${outputDir}.`,
  );
}

mkdirSync(pluginsDir, { recursive: true });
for (const file of readdirSync(pluginsDir)) {
  if (/^mewbeat-plugin-.*\.jar$/.test(file)) {
    rmSync(join(pluginsDir, file));
  }
}
const target = join(pluginsDir, `mewbeat-plugin-${version}.jar`);
copyFileSync(join(outputDir, builtJar), target);
console.log(`Installed ${basename(target)} into ${pluginsDir}.`);

const source = pluginSourceHash(repositoryRoot);
if (!source) {
  console.warn(`Not a git checkout: ${stampPath} was not written.`);
} else {
  writeFileSync(
    stampFile(repositoryRoot),
    `${JSON.stringify({ jar: basename(target), sourceSha256: source.sha256, sourceFiles: source.files }, null, 2)}\n`,
  );
  console.log(`Wrote ${stampPath} (${source.files} source files).`);
  if (pluginSourceDirty(repositoryRoot)) {
    console.warn(
      "The plugin source has changes that are not staged: the stamp describes the staged files. Stage them and run this again.",
    );
  }
}
