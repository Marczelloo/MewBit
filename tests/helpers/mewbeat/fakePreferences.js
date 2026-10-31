const userPreferences = require("../../../helpers/users/preferences");

/* The real preferences module saves to helpers/data/userPreferences.json on a
   debounce, and that file is the developer's own data. A test that touched it
   would overwrite it, so tests swap the two accessors for an in-memory map. */
function installFakePreferences() {
  const original = {
    getUserPreferences: userPreferences.getUserPreferences,
    setUserPreference: userPreferences.setUserPreference,
  };
  const store = new Map();

  userPreferences.getUserPreferences = (userId) => {
    if (!store.has(userId)) store.set(userId, { defaultSource: null });
    return store.get(userId);
  };
  userPreferences.setUserPreference = (userId, key, value) => {
    const entry = userPreferences.getUserPreferences(userId);
    entry[key] = value;
    return entry;
  };

  return {
    store,
    restore() {
      userPreferences.getUserPreferences = original.getUserPreferences;
      userPreferences.setUserPreference = original.setUserPreference;
    },
  };
}

module.exports = { installFakePreferences };
