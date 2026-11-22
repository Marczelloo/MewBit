process.env.DASHBOARD_PUBLIC_URL = "https://mewbit.test";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createDashboardRouter } = require("../../../helpers/dashboard/routes");
const { allowedUsers } = require("../../../helpers/dashboard/debugProxy");
const { createSession, resetSessions, SESSION_COOKIE } = require("../../../helpers/dashboard/sessions");

const OWNER = "111111111111111111";
const STRANGER = "222222222222222222";

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

let upstream;
let front;
let seen = [];
let base;

test.before(async () => {
  upstream = await listen((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    if (req.url.startsWith("/audio/")) {
      res.writeHead(206, { "Content-Type": "audio/mpeg", "Content-Range": "bytes 0-3/10", "Accept-Ranges": "bytes", "Content-Length": "4", "Set-Cookie": "x=1" });
      return res.end("abcd");
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<p>${req.url}</p>`);
  });
  process.env.MEWBEAT_DEBUG_TARGET = `http://127.0.0.1:${upstream.address().port}`;
  const router = createDashboardRouter({ guilds: { cache: new Map() } });
  front = await listen(async (req, res) => {
    const url = new URL(req.url, "http://mewbit.test");
    if (!(await router.handle(req, res, url))) {
      res.writeHead(418);
      res.end();
    }
  });
  base = `http://127.0.0.1:${front.address().port}`;
});

test.after(() => {
  upstream.close();
  front.close();
  delete process.env.MEWBEAT_DEBUG_USERS;
  delete process.env.MEWBEAT_DEBUG_TARGET;
});

test.beforeEach(() => {
  seen = [];
  resetSessions();
  process.env.MEWBEAT_DEBUG_USERS = `${OWNER}, not-an-id`;
});

function cookieFor(userId) {
  return `${SESSION_COOKIE}=${createSession({ userId, username: "x", guilds: [] })}`;
}

test("the user list keeps Discord ids only", () => {
  assert.deepEqual([...allowedUsers({ MEWBEAT_DEBUG_USERS: `${OWNER},abc  ${STRANGER};1` })], [OWNER]);
  assert.equal(allowedUsers({}).size, 0);
});

test("with no user list the debugger route does not exist", async () => {
  delete process.env.MEWBEAT_DEBUG_USERS;
  const res = await fetch(`${base}/api/dashboard/debug/`, { headers: { cookie: cookieFor(OWNER) } });
  assert.equal(res.status, 404);
  assert.equal(seen.length, 0);
});

test("a visitor with no session gets a sign-in page, a script gets 401", async () => {
  const pageRes = await fetch(`${base}/api/dashboard/debug/`, { headers: { accept: "text/html" } });
  assert.equal(pageRes.status, 401);
  assert.match(await pageRes.text(), /api\/dashboard\/login/);
  const apiRes = await fetch(`${base}/api/dashboard/debug/api/songs`);
  assert.equal(apiRes.status, 401);
  assert.equal(seen.length, 0);
});

test("a signed-in user who is not on the list gets 404", async () => {
  const res = await fetch(`${base}/api/dashboard/debug/`, { headers: { cookie: cookieFor(STRANGER) } });
  assert.equal(res.status, 404);
  assert.equal(seen.length, 0);
});

test("only GET and HEAD are forwarded", async () => {
  const res = await fetch(`${base}/api/dashboard/debug/api/songs`, { method: "POST", headers: { cookie: cookieFor(OWNER) } });
  assert.equal(res.status, 405);
  assert.equal(seen.length, 0);
});

test("the prefix without a slash redirects to the slash", async () => {
  const res = await fetch(`${base}/api/dashboard/debug?x=1`, { headers: { cookie: cookieFor(OWNER) }, redirect: "manual" });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "/api/dashboard/debug/?x=1");
});

test("the owner reaches the debugger with the encoded path intact and no cookies passed on", async () => {
  const res = await fetch(`${base}/api/dashboard/debug/api/song/played%3Aabc?x=1`, { headers: { cookie: cookieFor(OWNER) } });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "<p>/api/song/played%3Aabc?x=1</p>");
  assert.equal(seen[0].url, "/api/song/played%3Aabc?x=1");
  assert.equal(seen[0].headers.cookie, undefined);
  assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

test("audio ranges pass both ways and upstream cookies are dropped", async () => {
  const res = await fetch(`${base}/api/dashboard/debug/audio/abc`, { headers: { cookie: cookieFor(OWNER), range: "bytes=0-3" } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 0-3/10");
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(await res.text(), "abcd");
  assert.equal(seen[0].headers.range, "bytes=0-3");
});

test("a debugger that is not running answers 502", async () => {
  const saved = process.env.MEWBEAT_DEBUG_TARGET;
  const dead = await listen(() => {});
  const port = dead.address().port;
  await new Promise((resolve) => dead.close(resolve));
  process.env.MEWBEAT_DEBUG_TARGET = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${base}/api/dashboard/debug/`, { headers: { cookie: cookieFor(OWNER), accept: "text/html" } });
    assert.equal(res.status, 502);
    assert.match(await res.text(), /Debugger nie działa/);
  } finally {
    process.env.MEWBEAT_DEBUG_TARGET = saved;
  }
});

test("/me names the debugger only for listed users", async () => {
  const mine = await (await fetch(`${base}/api/dashboard/me`, { headers: { cookie: cookieFor(OWNER) } })).json();
  assert.equal(mine.debugger, "/api/dashboard/debug/");
  const theirs = await (await fetch(`${base}/api/dashboard/me`, { headers: { cookie: cookieFor(STRANGER) } })).json();
  assert.equal(theirs.debugger, null);
});
