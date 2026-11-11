import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// What the tracked mewbeat plugin jar was built from. scripts/build-mewbeat-plugin.mjs writes the hash next to the jar; a test
// recomputes it, so a plugin source that changed without a new jar does not go unnoticed.
//
// The hash is over `git ls-files -s`: the git blob ids, so line endings (autocrlf) do not matter. Only what ends up in the jar is
// listed: the main sources, the resources and the build files. Tests and SPIKE.md do not change the jar and are left out.
export const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
export const pluginDir = "lavalink-plugins/mewbeat";
export const stampPath = "helpers/lavalink/plugins/mewbeat-plugin.source.json";
const sourcePaths = [
  `${pluginDir}/src/main`,
  `${pluginDir}/build.gradle.kts`,
  `${pluginDir}/settings.gradle.kts`,
  `${pluginDir}/gradle/libs.versions.toml`,
];

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

// Null when git is missing or `cwd` is not a git checkout (a copy of the sources without .git, a Docker build context).
export function pluginSourceHash(cwd = repositoryRoot) {
  let listing;
  try {
    git(["rev-parse", "--is-inside-work-tree"], cwd);
    listing = git(["ls-files", "-s", "--", ...sourcePaths], cwd);
  } catch {
    return null;
  }
  const files = listing.split("\n").filter(Boolean).length;
  if (!files) return null;
  return { sha256: createHash("sha256").update(listing).digest("hex"), files };
}

// True when the listed sources differ from the index, so a stamp made now would describe the staged files, not the built ones.
export function pluginSourceDirty(cwd = repositoryRoot) {
  try {
    return git(["status", "--porcelain", "--", ...sourcePaths], cwd).trim().length > 0;
  } catch {
    return false;
  }
}

export function stampFile(cwd = repositoryRoot) {
  return join(cwd, stampPath);
}
