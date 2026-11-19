const { randomBytes } = require("node:crypto");
const { version: packageVersion } = require("../../package.json");
const { getCurrentVersion } = require("../announcements/announcer");
const { describeChangelog } = require("../announcements/releaseNotes");
const { CATEGORIES, DEFAULT_CATEGORY } = require("../help/categories");
const Log = require("../logs/log");
const health = require("../monitoring/health");
const { consumeRateLimit } = require("../security/rateLimit");
const statsStore = require("../stats/store");
const accessStore = require("./access");
const { describeEmbedOptions, sendDashboardEmbed } = require("./embed");
const {
  getDashboardConfig,
  buildAuthorizeUrl,
  exchangeCode,
  fetchOauthUser,
  fetchOauthGuilds,
} = require("./oauth");
const { listManageableGuilds, assertGuildAccess, assertGuildOwner } = require("./permissions");
const { listServerPlaylists, editServerPlaylist, deleteServerPlaylist } = require("./playlists");
const {
  createSession,
  getSession,
  destroySession,
  parseCookies,
  serializeSessionCookie,
  serializeStateCookie,
  serializeClearCookie,
  SESSION_COOKIE,
  STATE_COOKIE,
} = require("./sessions");
const { readGuildSettings, applyGuildSettings } = require("./settings");

const MAX_BODY_SIZE = 32 * 1024;
const PREFIX = "/api/dashboard";
const SETTINGS_PATTERN = /^\/api\/dashboard\/guilds\/(\d{5,25})\/settings$/;
const ACCESS_PATTERN = /^\/api\/dashboard\/guilds\/(\d{5,25})\/access$/;
const EMBED_PATTERN = /^\/api\/dashboard\/guilds\/(\d{5,25})\/embed$/;
const PLAYLISTS_PATTERN = /^\/api\/dashboard\/guilds\/(\d{5,25})\/playlists(?:\/([A-Za-z0-9_-]{1,64}))?$/;
const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The command reference, as the bot itself knows it.
 *
 * `/help` and the website answer from this one array, because a second copy of
 * seventy-eight commands would start drifting the day after it was written.
 * The shape is passed through almost unchanged; only the category key is added,
 * so a page can link to a category without matching on its label.
 */
function describeCommands() {
  return Object.entries(CATEGORIES).map(([key, category]) => ({
    key,
    label: category.label,
    emoji: category.emoji || null,
    description: category.description || "",
    /* Kept structured. These are the guide sections — "Music Source Selection"
       and the like — carrying titles, bullet lists and inline markup. Flattened
       to a string they render as [object Object], which is exactly what the
       first draft of the website did. */
    notes: Array.isArray(category.notes)
      ? category.notes
          .map((note) => ({ name: String(note?.name || "").trim(), value: String(note?.value || "").trim() }))
          .filter((note) => note.value)
      : [],
    /* Trimmed on the way out. Six of these carry a multi-line usage block and
       two of those open with a newline, which a page would render as a blank
       first line. */
    commands: (category.commands || []).map((command) => ({
      name: command.name,
      description: String(command.description || "").trim(),
      usage: String(command.usage || "").trim() || `/${command.name}`,
      notes: command.notes ? String(command.notes).trim() : null,
    })),
  }));
}


function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function redirect(response, location, extraHeaders = {}) {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store", ...extraHeaders });
  response.end("");
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("Request body must be JSON."), { statusCode: 400 }));
      }
    });

    request.on("error", reject);
  });
}

/**
 * The client address the rate limiter buckets on.
 *
 * `socket.remoteAddress` is the *peer*, which behind a reverse proxy is the
 * proxy — so in production every visitor collapsed into one bucket and any
 * single person could lock out everyone else. The old `||` fallback to
 * X-Forwarded-For was dead code: the socket address is always truthy.
 *
 * X-Forwarded-For is attacker-controlled unless something trusted rewrote it,
 * so it is read only when the deployment declares how many proxies sit in
 * front. With N trusted hops the client is N from the right-hand end: one
 * proxy appends only the client, two appends the client and the first proxy.
 */
function requestAddress(request) {
  const hops = Math.max(0, Math.trunc(Number(process.env.DASHBOARD_TRUST_PROXY) || 0));
  if (hops > 0) {
    const chain = String(request.headers["x-forwarded-for"] || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const candidate = chain[chain.length - hops];
    if (candidate) return candidate;
  }
  return request.socket?.remoteAddress || "unknown";
}

function enforceRateLimit(request, bucket, limit, windowMs) {
  const result = consumeRateLimit(`dash:${bucket}:${requestAddress(request)}`, { limit, windowMs });
  if (!result.allowed) {
    throw Object.assign(new Error("Too many requests. Try again shortly."), { statusCode: 429 });
  }
}

function requireSession(request) {
  const cookies = parseCookies(request.headers.cookie);
  const session = getSession(cookies[SESSION_COOKIE]);
  if (!session) throw Object.assign(new Error("Sign in with Discord to continue."), { statusCode: 401 });
  return session;
}

function assertSameOrigin(request, config) {
  const origin = request.headers.origin;
  if (!origin) return;
  if (origin !== config.publicUrl) {
    throw Object.assign(new Error("Request origin is not allowed."), { statusCode: 403 });
  }
}

/* Rendered for the trail, not for replay. A boolean reads as on/off, and an
   id is shown as the name it refers to where the guild still knows one. */
function renderValue(guild, value) {
  if (value === null || value === undefined || value === "") return "not set";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (Array.isArray(value)) return value.length ? `${value.length} selected` : "none";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 120);

  const text = String(value);
  if (/^\d{5,25}$/.test(text)) {
    const channel = guild?.channels?.cache?.get(text);
    if (channel) return `#${channel.name}`;
    const role = guild?.roles?.cache?.get(text);
    if (role) return `@${role.name}`;
  }
  return text.slice(0, 120);
}

/**
 * Records one entry per field the patch actually moved.
 *
 * Diffing before against after, rather than trusting the patch, means a value
 * the server clamped or refused is never written down as though it applied —
 * the equalizer clamps gains, and turning the last log category off also turns
 * logging off.
 */
function recordSettingsChanges(guild, guildId, session, before, after, patch) {
  for (const section of Object.keys(patch || {})) {
    const from = before?.[section];
    const to = after?.[section];
    if (!from || !to || typeof from !== "object") continue;

    for (const field of Object.keys(to)) {
      // Derived and read-only members of a section are not changes anyone made.
      if (["presets", "frequencies", "minGain", "maxGain", "configured", "openCount", "totalCount"].includes(field)) {
        continue;
      }
      const wasValue = from[field];
      const isValue = to[field];
      if (JSON.stringify(wasValue) === JSON.stringify(isValue)) continue;

      accessStore.recordChange(guildId, {
        userId: session.userId,
        username: session.username,
        section,
        field,
        from: renderValue(guild, wasValue),
        to: renderValue(guild, isValue),
      });
    }
  }
}

function recordAccessChange(guildId, session, previous, operators) {
  const added = operators.filter((id) => !previous.includes(id));
  const removed = previous.filter((id) => !operators.includes(id));
  for (const [ids, verb] of [[added, "granted"], [removed, "revoked"]]) {
    for (const id of ids) {
      accessStore.recordChange(guildId, {
        userId: session.userId,
        username: session.username,
        section: "access",
        field: "operator",
        from: verb === "granted" ? "no access" : "dashboard access",
        to: verb === "granted" ? `dashboard access for ${id}` : `no access for ${id}`,
      });
    }
  }
}

/** The operator list, resolved to names the owner will recognise. */
async function describeAccess(client, guildId, viewerId) {
  const guild = client?.guilds?.cache?.get(guildId);
  const operatorIds = accessStore.getOperators(guildId);
  const operators = [];

  for (const id of operatorIds) {
    const member = await guild?.members?.fetch(id).catch(() => null);
    operators.push({
      id,
      name: member?.user?.globalName || member?.user?.username || "Unknown member",
      // A named operator who has left keeps the entry but not the access, so
      // the owner can see why someone stopped being able to sign in.
      present: Boolean(member),
    });
  }

  const owner = await guild?.members?.fetch(guild.ownerId).catch(() => null);

  return {
    ownerId: guild?.ownerId ?? null,
    ownerName: owner?.user?.globalName || owner?.user?.username || "the server owner",
    viewerIsOwner: guild?.ownerId === viewerId,
    operators,
    maxOperators: accessStore.MAX_OPERATORS,
  };
}

function createDashboardRouter(client) {
  async function route(request, response, url) {
    const config = getDashboardConfig();
    if (!config.enabled) throw Object.assign(new Error("The dashboard is disabled."), { statusCode: 503 });

    if (request.method === "GET" && url.pathname === `${PREFIX}/login`) {
      enforceRateLimit(request, "login", 20, 60_000);
      if (!config.clientId || !config.clientSecret) {
        throw Object.assign(new Error("The dashboard OAuth credentials are not configured."), { statusCode: 503 });
      }
      const state = randomBytes(16).toString("hex");
      return redirect(response, buildAuthorizeUrl(state, config), {
        "Set-Cookie": serializeStateCookie(state, { secure: config.secure, maxAgeMs: STATE_TTL_MS }),
      });
    }

    if (request.method === "GET" && url.pathname === `${PREFIX}/callback`) {
      enforceRateLimit(request, "callback", 20, 60_000);
      const cookies = parseCookies(request.headers.cookie);
      const state = url.searchParams.get("state");
      if (!state || state !== cookies[STATE_COOKIE]) {
        throw Object.assign(new Error("Sign-in could not be verified. Start again."), { statusCode: 400 });
      }

      const code = url.searchParams.get("code");
      if (!code) throw Object.assign(new Error("Discord did not return an authorization code."), { statusCode: 400 });

      const token = await exchangeCode(code, config);
      const user = await fetchOauthUser(token.access_token);
      const guilds = await fetchOauthGuilds(token.access_token);

      const sessionId = createSession({
        userId: user.id,
        username: user.global_name || user.username || "Discord user",
        avatar: user.avatar || null,
        accessToken: token.access_token,
        // Every guild the visitor is in, unfiltered. An operator needs no
        // Discord permission to qualify, so filtering by Administrator here
        // would hide exactly the servers they were named for. This list only
        // establishes membership; access is decided per request.
        guilds: guilds.map((guild) => ({ id: guild.id, name: guild.name })),
      });

      return redirect(response, `${config.publicUrl}/dashboard`, {
        "Set-Cookie": [
          serializeSessionCookie(sessionId, { secure: config.secure, maxAgeMs: SESSION_COOKIE_MAX_AGE_MS }),
          serializeClearCookie({ secure: config.secure, name: STATE_COOKIE }),
        ],
      });
    }

    if (request.method === "POST" && url.pathname === `${PREFIX}/logout`) {
      const cookies = parseCookies(request.headers.cookie);
      destroySession(cookies[SESSION_COOKIE]);
      return sendJson(response, 200, { ok: true }, { "Set-Cookie": serializeClearCookie({ secure: config.secure }) });
    }

    if (request.method === "GET" && url.pathname === `${PREFIX}/me`) {
      enforceRateLimit(request, "read", 240, 60_000);
      const session = requireSession(request);
      return sendJson(response, 200, {
        ok: true,
        user: { id: session.userId, username: session.username, avatar: session.avatar },
        guilds: listManageableGuilds(client, session.guilds, session.userId),
      });
    }

    if (request.method === "GET" && url.pathname === `${PREFIX}/public/stats`) {
      enforceRateLimit(request, "stats", 120, 60_000);

      let global = null;
      let topSources = [];
      try {
        global = statsStore.getGlobalStats();
        topSources = statsStore.getTopSources(null, 4) || [];
      } catch {
        global = null;
        topSources = [];
      }

      const num = (value) => Number(value) || 0;

      return sendJson(response, 200, {
        ok: true,
        instance: {
          servers: client?.guilds?.cache?.size ?? 0,
          songsPlayed: num(global?.songsPlayed),
          msPlayed: num(global?.msPlayed),
          songsSkipped: num(global?.songsSkipped),
          playlistsAdded: num(global?.playlistsAdded),
          totalSessions: num(global?.totalSessions),
          peakListeners: num(global?.peakListeners),
          uniqueListeners: num(global?.uniqueUserCount),
          averageSessionMs: num(global?.averageSessionLength),
          firstPlayedAt: global?.firstPlayedAt ?? null,
          topSources,
          uptimeMs: Math.floor(process.uptime() * 1000),
          version: packageVersion,
        },
      });
    }

    /* Both of these are already public: every Discord user can read them with
       /help and /changelog. They are served here so the website shows what this
       instance actually runs rather than what its build once assumed, and they
       share the public bucket so an unauthenticated crawler cannot use them to
       exhaust anything. */
    if (request.method === "GET" && url.pathname === `${PREFIX}/public/commands`) {
      enforceRateLimit(request, "stats", 120, 60_000);
      return sendJson(response, 200, {
        ok: true,
        defaultCategory: DEFAULT_CATEGORY,
        categories: describeCommands(),
      });
    }

    if (request.method === "GET" && url.pathname === `${PREFIX}/public/changelog`) {
      enforceRateLimit(request, "stats", 120, 60_000);
      const releases = describeChangelog();
      return sendJson(response, 200, {
        ok: true,
        current: getCurrentVersion(),
        releases,
      });
    }

    const settingsMatch = SETTINGS_PATTERN.exec(url.pathname);
    if (settingsMatch) {
      const guildId = settingsMatch[1];
      const session = requireSession(request);

      if (!session.guilds.some((guild) => guild.id === guildId)) {
        throw Object.assign(new Error("You are not a member of this server."), { statusCode: 403 });
      }
      const { role } = await assertGuildAccess(client, guildId, session.userId);

      if (request.method === "GET") {
        // Authenticated, but not free: this reads five stores and enumerates
        // the guild's channels and roles on every call.
        enforceRateLimit(request, "read", 240, 60_000);
        return sendJson(response, 200, { ok: true, settings: readGuildSettings(client, guildId) });
      }

      if (request.method === "PATCH") {
        assertSameOrigin(request, config);
        enforceRateLimit(request, "write", 60, 60_000);
        const patch = await readJsonBody(request);
        const before = readGuildSettings(client, guildId);
        // A patch can partly succeed: a log access role Discord refused does
        // not invalidate the settings saved alongside it. Warnings carry that
        // back so the UI can say what did not land instead of implying all did.
        const { settings, warnings } = await applyGuildSettings(guildId, patch, client);
        recordSettingsChanges(client?.guilds?.cache?.get(guildId), guildId, session, before, settings, patch);
        return sendJson(response, 200, { ok: true, settings, warnings, role });
      }

      throw Object.assign(new Error("Method not allowed."), { statusCode: 405 });
    }

    const accessMatch = ACCESS_PATTERN.exec(url.pathname);
    if (accessMatch) {
      const guildId = accessMatch[1];
      const session = requireSession(request);

      if (!session.guilds.some((guild) => guild.id === guildId)) {
        throw Object.assign(new Error("You are not a member of this server."), { statusCode: 403 });
      }
      // Reading the list needs access; changing it needs ownership. An operator
      // must not be able to promote anyone, including themselves.
      await assertGuildAccess(client, guildId, session.userId);

      if (request.method === "GET") {
        enforceRateLimit(request, "read", 240, 60_000);
        return sendJson(response, 200, {
          ok: true,
          access: await describeAccess(client, guildId, session.userId),
          log: accessStore.getChangeLog(guildId, 50),
        });
      }

      if (request.method === "PUT") {
        assertSameOrigin(request, config);
        enforceRateLimit(request, "write", 60, 60_000);
        assertGuildOwner(client, guildId, session.userId);

        const body = await readJsonBody(request);
        if (!Array.isArray(body.operators)) {
          throw Object.assign(new Error("Operators must be a list of user ids."), { statusCode: 400 });
        }
        if (body.operators.length > accessStore.MAX_OPERATORS) {
          throw Object.assign(
            new Error(`At most ${accessStore.MAX_OPERATORS} people can be named.`),
            { statusCode: 400 }
          );
        }

        const guild = client?.guilds?.cache?.get(guildId);
        const wanted = [];
        for (const raw of body.operators) {
          if (typeof raw !== "string" || !/^\d{5,25}$/.test(raw)) {
            throw Object.assign(new Error("Every operator must be a user id."), { statusCode: 400 });
          }
          if (raw === guild?.ownerId) continue; // The owner is implicit, never listed.
          // Naming someone who is not in the server would grant access that
          // silently activates if they ever join.
          const member = await guild?.members?.fetch(raw).catch(() => null);
          if (!member) {
            throw Object.assign(new Error("That person is not a member of this server."), { statusCode: 400 });
          }
          wanted.push(raw);
        }

        const previous = accessStore.getOperators(guildId);
        const operators = accessStore.setOperators(guildId, wanted);
        recordAccessChange(guildId, session, previous, operators);

        return sendJson(response, 200, {
          ok: true,
          access: await describeAccess(client, guildId, session.userId),
          log: accessStore.getChangeLog(guildId, 50),
        });
      }

      throw Object.assign(new Error("Method not allowed."), { statusCode: 405 });
    }

    if (request.method === "GET" && url.pathname === `${PREFIX}/instance`) {
      enforceRateLimit(request, "read", 240, 60_000);
      const session = requireSession(request);
      // Instance-wide, so it is deliberately available to anyone who can reach
      // any server's dashboard — but it carries no error *text*. Messages can
      // quote content from other servers, and an operator here was trusted with
      // one server, not with all of them.
      if (!listManageableGuilds(client, session.guilds, session.userId).length) {
        throw Object.assign(new Error("You do not manage any server MewBit is in."), { statusCode: 403 });
      }

      const metrics = health.getMetrics();
      const status = health.getHealthStatus();

      return sendJson(response, 200, {
        ok: true,
        instance: {
          healthy: status.healthy,
          issues: status.issues,
          version: packageVersion,
          uptime: metrics.uptime,
          uptimeMs: metrics.uptimeMs,
          servers: client?.guilds?.cache?.size ?? 0,
          lavalink: metrics.lavalink,
          performance: metrics.performance,
          commands: metrics.commands,
          tracks: metrics.tracks,
          // Counts only, for the reason above.
          errorCount: (metrics.errors || []).length,
          warningCount: (metrics.warnings || []).length,
        },
      });
    }

    const playlistMatch = PLAYLISTS_PATTERN.exec(url.pathname);
    if (playlistMatch) {
      const guildId = playlistMatch[1];
      const playlistId = playlistMatch[2] || null;
      const session = requireSession(request);

      if (!session.guilds.some((guild) => guild.id === guildId)) {
        throw Object.assign(new Error("You are not a member of this server."), { statusCode: 403 });
      }
      await assertGuildAccess(client, guildId, session.userId);

      if (request.method === "GET" && !playlistId) {
        enforceRateLimit(request, "read", 240, 60_000);
        return sendJson(response, 200, { ok: true, playlists: await listServerPlaylists(client, guildId) });
      }

      if (request.method === "PATCH" && playlistId) {
        assertSameOrigin(request, config);
        enforceRateLimit(request, "write", 60, 60_000);
        const patch = await readJsonBody(request);
        const playlist = editServerPlaylist(guildId, playlistId, patch);
        accessStore.recordChange(guildId, {
          userId: session.userId,
          username: session.username,
          section: "playlists",
          field: "playlist",
          from: "edited",
          to: playlist.name,
        });
        return sendJson(response, 200, { ok: true, playlists: await listServerPlaylists(client, guildId) });
      }

      if (request.method === "DELETE" && playlistId) {
        assertSameOrigin(request, config);
        enforceRateLimit(request, "write", 60, 60_000);
        const removed = deleteServerPlaylist(guildId, playlistId);
        accessStore.recordChange(guildId, {
          userId: session.userId,
          username: session.username,
          section: "playlists",
          field: "playlist",
          from: `${removed.name} (${removed.trackCount} tracks)`,
          to: "deleted",
        });
        return sendJson(response, 200, { ok: true, playlists: await listServerPlaylists(client, guildId) });
      }

      throw Object.assign(new Error("Method not allowed."), { statusCode: 405 });
    }

    const embedMatch = EMBED_PATTERN.exec(url.pathname);
    if (embedMatch) {
      const guildId = embedMatch[1];
      const session = requireSession(request);

      if (!session.guilds.some((guild) => guild.id === guildId)) {
        throw Object.assign(new Error("You are not a member of this server."), { statusCode: 403 });
      }
      await assertGuildAccess(client, guildId, session.userId);

      if (request.method === "GET") {
        enforceRateLimit(request, "read", 240, 60_000);
        return sendJson(response, 200, { ok: true, options: describeEmbedOptions(client, guildId) });
      }

      if (request.method === "POST") {
        assertSameOrigin(request, config);
        // Far tighter than a settings write: this posts a visible message into
        // a channel, so a mistake or an abused session is loud and permanent.
        enforceRateLimit(request, "embed", 10, 60_000);

        const body = await readJsonBody(request);
        const sent = await sendDashboardEmbed(client, guildId, body);

        accessStore.recordChange(guildId, {
          userId: session.userId,
          username: session.username,
          section: "embed",
          field: "message",
          from: "not sent",
          to: `posted in #${sent.channelName}`,
        });

        return sendJson(response, 200, { ok: true, sent });
      }

      throw Object.assign(new Error("Method not allowed."), { statusCode: 405 });
    }

    throw Object.assign(new Error("Not found"), { statusCode: 404 });
  }

  return {
    async handle(request, response, url) {
      if (!url.pathname.startsWith(`${PREFIX}/`)) return false;

      try {
        await route(request, response, url);
      } catch (error) {
        const status = Number(error.statusCode) || 500;
        if (status >= 500) Log.error("Dashboard request failed", error, `path=${url.pathname}`);
        sendJson(response, status, { ok: false, error: error.message || "Dashboard error" });
      }
      return true;
    },
  };
}

module.exports = { createDashboardRouter };
