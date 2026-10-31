// The game needs a physical keyboard: desktop Discord clients and the local dev page only.
export function isDesktopClient(context) {
  return context?.mode === "local" || context?.sdk?.platform === "desktop";
}
