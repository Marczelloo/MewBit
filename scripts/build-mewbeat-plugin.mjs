import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

// Builds lavalink-plugins/mewbeat inside the gradle Docker image and installs
// the jar into helpers/lavalink/plugins, which Lavalink mounts as its plugin
// directory. Pass --test to run the plugin's unit tests before building, and
// --bench with it to also run the analysis time-budget test.
const runTests = process.argv.includes("--test");
const runBench = process.argv.includes("--bench");

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
  ...(runTests
    ? ["test", "build", ...(runBench ? ["-Dmewbeat.bench=true"] : [])]
    : ["build", "-x", "test"]),
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
