const assert = require("node:assert/strict");
const test = require("node:test");

const { MAX_LINK_LENGTH, parseSongLink } = require("../../../helpers/mewbeat/songLink");

const WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

test("plain text is not a link", () => {
  for (const text of ["", "   ", null, undefined, "camellia", "toby fox finale", "mix do sprzątania", "sanah - szampan", "what is this.. right/now", "a.b/c d"]) {
    assert.equal(parseSongLink(text), null, String(text));
  }
});

test("every YouTube form of one video becomes the same watch address", () => {
  const forms = [
    WATCH,
    "http://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=43s",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=xyz",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "youtube.com/watch?v=dQw4w9WgXcQ",
  ];
  for (const text of forms) {
    const link = parseSongLink(text);
    assert.deepEqual(link, { url: WATCH, provider: "youtube", supported: true, pageKind: "track" }, text);
  }
});

test("a watch link that sits in a playlist means the video, not the list", () => {
  const link = parseSongLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI&index=3&start_radio=1");
  assert.equal(link.url, WATCH);
  assert.equal(link.pageKind, "track");
});

test("a YouTube playlist page is a list, and channel pages are profiles", () => {
  const list = parseSongLink("https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI");
  assert.equal(list.pageKind, "list");
  assert.equal(list.supported, true);
  for (const text of ["https://www.youtube.com/@camellia", "https://www.youtube.com/channel/UC123", "https://www.youtube.com/c/camellia", "https://www.youtube.com/user/x"]) {
    assert.equal(parseSongLink(text).pageKind, "profile", text);
  }
});

test("Spotify links: a track, with or without a locale, an album, a playlist and an artist", () => {
  const track = parseSongLink("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc");
  assert.equal(track.provider, "spotify");
  assert.equal(track.pageKind, "track");
  assert.equal(parseSongLink("https://open.spotify.com/intl-pl/track/4cOdK2wGLETKBW3PvgPWqT").pageKind, "track");
  assert.equal(parseSongLink("https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy").pageKind, "list");
  assert.equal(parseSongLink("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M").pageKind, "list");
  assert.equal(parseSongLink("https://open.spotify.com/artist/4cOdK2wGLETKBW3PvgPWqT").pageKind, "profile");
  assert.equal(parseSongLink("https://spotify.link/abc123").provider, "spotify");
});

test("SoundCloud links: a track, a set and a profile", () => {
  const track = parseSongLink("https://soundcloud.com/forss/flickermood");
  assert.equal(track.provider, "soundcloud");
  assert.equal(track.pageKind, "track");
  assert.equal(parseSongLink("https://soundcloud.com/forss/sets/soulhack").pageKind, "list");
  assert.equal(parseSongLink("https://soundcloud.com/forss").pageKind, "profile");
  assert.equal(parseSongLink("https://soundcloud.com/forss/tracks").pageKind, "profile");
});

test("Deezer links are recognised, with lists apart from tracks", () => {
  assert.equal(parseSongLink("https://www.deezer.com/en/track/3135556").pageKind, "track");
  assert.equal(parseSongLink("https://www.deezer.com/en/album/302127").pageKind, "list");
  assert.equal(parseSongLink("https://www.deezer.com/en/artist/27").pageKind, "profile");
});

test("an address of any other host is a link that is not supported", () => {
  const link = parseSongLink("https://example.com/watch?v=dQw4w9WgXcQ");
  assert.equal(link.supported, false);
  assert.equal(link.provider, null);
  // a lookalike host is not YouTube
  assert.equal(parseSongLink("https://notyoutube.com/watch?v=dQw4w9WgXcQ").supported, false);
  assert.equal(parseSongLink("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ").supported, false);
  // and only http(s) is a link at all
  assert.equal(parseSongLink("file:///etc/passwd"), null);
  assert.equal(parseSongLink("javascript:alert(1)"), null);
});

test("a host typed without a scheme is a link only for a known provider", () => {
  assert.equal(parseSongLink("soundcloud.com/forss/flickermood").provider, "soundcloud");
  assert.equal(parseSongLink("example.com/some/page"), null);
});

test("a very long text is not treated as a link", () => {
  assert.equal(parseSongLink(`${WATCH}&x=${"a".repeat(MAX_LINK_LENGTH)}`), null);
});
