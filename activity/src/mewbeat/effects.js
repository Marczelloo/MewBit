// The effects level the screen actually uses. prefers-reduced-motion forces at most
// "reduced"; "off" always wins. Pure, so the Node tests can import it.
export function effectiveEffects(setting, prefersReducedMotion) {
  if (setting === "off") return "off";
  if (setting === "reduced") return "reduced";
  return prefersReducedMotion ? "reduced" : "full";
}
