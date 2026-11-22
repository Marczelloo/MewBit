const http = require("node:http");

/**
 * The mewbeat map debugger (scripts/mewbeat-debug) behind the dashboard sign-in.
 *
 * The debugger serves whole songs, people's maps and the generator's insides for every server at once, so it is not a
 * per-guild thing: a guild owner can be anyone who made a server and invited the bot. Access is a list of Discord user
 * ids in MEWBEAT_DEBUG_USERS. With no list the route does not exist.
 *
 * The debugger itself keeps listening on 127.0.0.1 (MEWBEAT_DEBUG_TARGET, default http://127.0.0.1:5180); this only
 * forwards GET and HEAD, streams bodies (audio seeks with Range) and never passes the visitor's cookies on.
 */

const DEBUG_PREFIX = "/api/dashboard/debug";
const SNOWFLAKE = /^\d{17,20}$/;
const UP_HEADERS = ["range", "if-range", "if-none-match", "if-modified-since", "accept"];
const DOWN_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");
const SAFETY_HEADERS = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

function allowedUsers(env = process.env) {
  return new Set(String(env.MEWBEAT_DEBUG_USERS || "").split(/[\s,]+/).filter((id) => SNOWFLAKE.test(id)));
}

function debugTarget(env = process.env) {
  const url = new URL(env.MEWBEAT_DEBUG_TARGET || "http://127.0.0.1:5180");
  if (url.protocol !== "http:") throw new Error("MEWBEAT_DEBUG_TARGET must be an http:// address");
  return { hostname: url.hostname, port: Number(url.port) || 80 };
}

function wantsPage(request) {
  return String(request.headers.accept || "").includes("text/html");
}

function page(title, body) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050608;color:#f4f6f9;`
    + `font:16px/1.5 "Hanken Grotesk","Segoe UI",sans-serif}main{max-width:420px;padding:24px}h1{font-size:20px;margin:0 0 8px}`
    + `p{color:#c3cbd7;margin:0 0 16px}a{color:#67e3f4}</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
}

function send(response, status, { html, text, headers = {} }) {
  const asHtml = html != null;
  response.writeHead(status, {
    "Content-Type": asHtml ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...SAFETY_HEADERS,
    ...headers,
  });
  response.end(asHtml ? html : JSON.stringify({ ok: false, error: text }));
}

function reply(request, response, status, title, body, text) {
  if (wantsPage(request) && request.method === "GET") return send(response, status, { html: page(title, body) });
  return send(response, status, { text });
}

/**
 * `getSession(request)` returns the dashboard session or null. `env` and `request` (the outgoing http.request) are
 * there for tests.
 */
function createDebugProxy({ getSession, env = process.env, request: httpRequest = http.request } = {}) {
  function allows(userId) {
    return allowedUsers(env).has(String(userId || ""));
  }

  function handle(request, response, url) {
    if (url.pathname !== DEBUG_PREFIX && !url.pathname.startsWith(`${DEBUG_PREFIX}/`)) return false;

    // No list: as if the route were not there.
    if (allowedUsers(env).size === 0) {
      send(response, 404, { text: "Not found" });
      return true;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, { text: "Method not allowed.", headers: { Allow: "GET, HEAD" } });
      return true;
    }

    const session = getSession(request);
    if (!session) {
      reply(request, response, 401, "Zaloguj się",
        `<p>Debugger map jest dostępny po zalogowaniu w dashboardzie. Po zalogowaniu otwórz link jeszcze raz.</p>`
          + `<p><a href="/api/dashboard/login">Zaloguj przez Discorda</a></p>`,
        "Sign in with Discord to continue.");
      return true;
    }
    if (!allows(session.userId)) {
      send(response, 404, { text: "Not found" });
      return true;
    }

    // Relative paths in the debugger resolve only under a trailing slash.
    if (url.pathname === DEBUG_PREFIX) {
      response.writeHead(301, { Location: `${DEBUG_PREFIX}/${url.search}`, "Cache-Control": "no-store" });
      response.end();
      return true;
    }

    forward(request, response);
    return true;
  }

  function forward(request, response) {
    // The raw rest of the path, still percent-encoded: song ids carry "played:" and "preview:".
    const raw = String(request.url || "");
    const path = raw.startsWith(DEBUG_PREFIX) ? raw.slice(DEBUG_PREFIX.length) : "/";
    let target;
    try {
      target = debugTarget(env);
    } catch (error) {
      reply(request, response, 500, "Zły adres debuggera", `<p>${error.message}</p>`, error.message);
      return;
    }

    const headers = { host: `${target.hostname}:${target.port}` };
    for (const name of UP_HEADERS) if (request.headers[name]) headers[name] = request.headers[name];

    const upstream = httpRequest({ hostname: target.hostname, port: target.port, path: path.startsWith("/") ? path : `/${path}`, method: request.method, headers });

    upstream.on("response", (answer) => {
      const out = { ...SAFETY_HEADERS, "Cache-Control": "private, no-cache" };
      for (const name of DOWN_HEADERS) if (answer.headers[name] != null) out[name] = answer.headers[name];
      response.writeHead(answer.statusCode || 502, out);
      answer.pipe(response);
    });

    upstream.on("error", (error) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const down = error.code === "ECONNREFUSED" || error.code === "ECONNRESET" || error.code === "EHOSTUNREACH";
      reply(request, response, 502, "Debugger nie działa",
        `<p>Debugger map nie odpowiada${down ? "" : ` (${error.code || "błąd"})`}. Uruchom go na maszynie z botem:</p>`
          + `<p><code>node scripts/mewbeat-debug/server.mjs</code></p>`,
        "The map debugger is not running.");
    });

    // Audio seeking aborts requests all the time; do not leave the upstream one hanging.
    response.on("close", () => {
      if (!response.writableFinished) upstream.destroy();
    });

    upstream.end();
  }

  return { handle, allows };
}

module.exports = { DEBUG_PREFIX, allowedUsers, createDebugProxy };
