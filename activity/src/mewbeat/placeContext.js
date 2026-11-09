import { createContext, useContext } from "react";

// True in a DM or group DM: there is no server, so its boards are not offered.
const PrivatePlaceContext = createContext(false);

export const PrivatePlace = PrivatePlaceContext.Provider;
export const usePrivatePlace = () => useContext(PrivatePlaceContext);
export const scopesFor = (scopes, isPrivate) => (isPrivate ? scopes.filter(({ id }) => id !== "server") : scopes);
