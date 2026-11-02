// Request/reply over the Activity socket: request() sends { type, id, ...body } and resolves with the
// message that comes back with the same type and id. handle() is fed every incoming mewbeat message
// first and says whether it consumed one. A reply the server answers with { type: "error" } carries no
// id, so it can't be matched; that request ends by timing out. send() is the same socket for messages that
// get no reply (the live score updates); it says whether the message went out.
export function createMewbeatRequests(sendRaw, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const pending = new Map(); // id -> { type, resolve, reject, timer }
  let counter = 0;

  function send(message) {
    try {
      return sendRaw(message) !== false;
    } catch {
      return false;
    }
  }

  function request(type, body = {}, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const id = `r${++counter}`;
      const timer = setTimer(() => {
        pending.delete(id);
        reject(new Error(`Request ${type} timed out.`));
      }, timeoutMs);
      pending.set(id, { type, resolve, reject, timer });
      if (!send({ ...body, type, id })) {
        clearTimer(timer);
        pending.delete(id);
        reject(new Error("Not connected to the bot."));
      }
    });
  }

  function handle(message) {
    if (!message || typeof message.id !== "string") return false;
    const entry = pending.get(message.id);
    if (!entry || entry.type !== message.type) return false;
    pending.delete(message.id);
    clearTimer(entry.timer);
    entry.resolve(message);
    return true;
  }

  return { request, handle, send };
}
