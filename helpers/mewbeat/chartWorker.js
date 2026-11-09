// The worker thread that makes charts (chartRunner.js). Generation is a pure function of what the message carries, the
// flags included, so it reads nothing from disk or the environment and gives what generateAll gives on the main thread.
const { parentPort } = require("node:worker_threads");

const { generateAll } = require("./charts/generate");

parentPort.on("message", ({ id, features, audioKey, flags }) => {
  try {
    parentPort.postMessage({ id, charts: generateAll(features, audioKey, flags) });
  } catch (error) {
    parentPort.postMessage({ id, error: { message: String(error?.message ?? error), stack: error?.stack } });
  }
});
