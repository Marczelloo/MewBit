// Where the Activity was opened: a guild id or, for a DM or group DM, which have no guild, "dm:" and the Activity
// instance id. A private place only names a room; it stands for no server's data.
const PRIVATE_PREFIX = "dm:";
const PRIVATE_PLACE = /^dm:[\w-]{1,76}$/;

const isPrivatePlace = (place) => typeof place === "string" && place.startsWith(PRIVATE_PREFIX);
const isValidPrivatePlace = (place) => typeof place === "string" && PRIVATE_PLACE.test(place);

module.exports = { isPrivatePlace, isValidPrivatePlace };
