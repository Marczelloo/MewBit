// Pasted links in the song select's search bar. Only providers the bot can load a single song from are taken;
// any other address is refused before it reaches Lavalink (the bot would otherwise fetch whatever host was typed).

const MAX_LINK_LENGTH = 500;

const PROVIDER_HOSTS = [
  { provider: "youtube", hosts: ["youtube.com", "youtu.be", "youtube-nocookie.com"] },
  { provider: "spotify", hosts: ["spotify.com", "spotify.link"] },
  { provider: "soundcloud", hosts: ["soundcloud.com", "snd.sc"] },
  { provider: "deezer", hosts: ["deezer.com", "deezer.page.link"] },
];

const YOUTUBE_ID = /^[\w-]{11}$/;

function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function providerOf(hostname) {
  return PROVIDER_HOSTS.find(({ hosts }) => hosts.some((domain) => hostMatches(hostname, domain)))?.provider || null;
}

// A watch link with a playlist behind it ("?v=...&list=...") means the video; the list, index and radio
// parameters are dropped so Lavalink loads that one song and not the whole list.
function youtubeVideoUrl(url, hostname) {
  const segments = url.pathname.split("/").filter(Boolean);
  let id = null;
  if (hostname === "youtu.be") id = segments[0];
  else if (["shorts", "live", "embed", "v"].includes(segments[0])) id = segments[1];
  else if (segments[0] === "watch" || segments.length === 0) id = url.searchParams.get("v");
  return id && YOUTUBE_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

// "track" (or unknown: Lavalink decides), "list" (a playlist or an album) or "profile" (a person's or channel's page).
function pageKindOf(provider, url) {
  const segments = url.pathname.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
  if (provider === "youtube") {
    if (segments[0] === "playlist") return "list";
    return ["channel", "c", "user"].includes(segments[0]) || segments[0]?.startsWith("@") ? "profile" : "track";
  }
  if (provider === "spotify" || provider === "deezer") {
    // "open.spotify.com/intl-pl/track/..." and "deezer.com/en/track/..." carry a locale first.
    const kind = segments.find((segment) => ["track", "episode", "album", "playlist", "artist", "show", "user", "profile"].includes(segment));
    if (kind === "album" || kind === "playlist") return "list";
    return kind === "artist" || kind === "show" || kind === "user" || kind === "profile" ? "profile" : "track";
  }
  if (provider === "soundcloud") {
    if (segments.length === 1) return "profile";
    if (segments[1] === "sets" || segments[1] === "albums") return "list";
    return ["tracks", "likes", "reposts", "following", "followers"].includes(segments[1]) ? "profile" : "track";
  }
  return "track";
}

/**
 * What a search-bar text is when it is a link: null for plain text, else
 * { url, provider, supported, pageKind }. `url` is what to load; `provider` is null and `supported` false for
 * an address that is not one of the providers above.
 */
function parseSongLink(text) {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > MAX_LINK_LENGTH || /\s/.test(raw)) return null;
  const hasScheme = /^https?:\/\//i.test(raw);
  // "youtube.com/watch?v=..." typed without the scheme.
  if (!hasScheme && !/^(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S+/i.test(raw)) return null;

  let url;
  try {
    url = new URL(hasScheme ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const provider = providerOf(hostname);
  // Plain text with a dot and a slash in it is not a link unless a known provider owns the host.
  if (!hasScheme && !provider) return null;
  if (!provider) return { url: url.toString(), provider: null, supported: false, pageKind: "track" };

  if (provider === "youtube") {
    const video = youtubeVideoUrl(url, hostname);
    if (video) return { url: video, provider, supported: true, pageKind: "track" };
    // A playlist link: Lavalink lists its tracks.
    return { url: url.toString(), provider, supported: true, pageKind: pageKindOf(provider, url) };
  }
  return { url: url.toString(), provider, supported: true, pageKind: pageKindOf(provider, url) };
}

module.exports = { MAX_LINK_LENGTH, parseSongLink };
