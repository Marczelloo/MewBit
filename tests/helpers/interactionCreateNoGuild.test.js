const assert = require("node:assert/strict");
const test = require("node:test");

const event = require("../../events/interactionCreate");

// A command run with no server in reach (a DM, or a server not in the cache) has a null guild.
function slashCommand(commandName, commands) {
  return {
    commandName,
    guild: null,
    client: { commands: new Map(Object.entries(commands)) },
    isAutocomplete: () => false,
    isStringSelectMenu: () => false,
    isButton: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => true,
  };
}

test("a failing command with no guild is logged, not thrown out of the handler", async () => {
  const failing = { execute: async () => { throw new Error("command failed"); } };
  await assert.doesNotReject(event.execute(slashCommand("failing", { failing })));
});

test("an unknown command with no guild is logged, not thrown out of the handler", async () => {
  await assert.doesNotReject(event.execute(slashCommand("missing", {})));
});
