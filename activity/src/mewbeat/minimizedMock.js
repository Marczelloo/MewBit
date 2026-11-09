// Sample data for the minimized tiles in the dev preview (?mock=1&pip=1&pipState=select|paused|live|lobby).
export const PIP_STATES = ["select", "paused", "live", "lobby"];

export const PIP_MOCK = {
  select: { kind: "select", title: "Hopes and Dreams", artist: "Toby Fox", artworkUrl: null },
  paused: { kind: "paused", title: "Hopes and Dreams", artworkUrl: null, score: 1284560, combo: 126 },
  live: { kind: "live", title: "Hopes and Dreams", artworkUrl: null, score: 874210, combo: 58, place: { place: 2, total: 5 }, progress: 0.46 },
  lobby: { kind: "lobby", room: "Neon Listening Room", ready: { ready: 3, total: 5 }, next: { title: "MEGALOVANIA", artworkUrl: null } },
};
