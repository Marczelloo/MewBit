// How two listings of one song are told apart across sources (the play history, the bot's stats, a Last.fm neighbour).

const plain = (value) => String(value ?? "")
  .toLowerCase()
  .normalize("NFKD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[([{].*?[)\]}]/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

// "title|first word of the artist", or null without a title.
const identityOf = (title, artist = "") => {
  const name = plain(title);
  return name ? `${name}|${plain(artist).split(" ")[0] ?? ""}` : null;
};

// The artist alone, whole: a YouTube "Artist - Topic" channel and a Vevo channel are the artist.
const artistKeyOf = (artist) => plain(String(artist ?? "").replace(/\s*-\s*topic\s*$/i, "").replace(/vevo$/i, ""));

module.exports = { artistKeyOf, identityOf };
