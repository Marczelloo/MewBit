// Stage scenery behind the game: an inked night sky with a moon behind Mewbit, spotlights, skyline,
// floor and a speaker on the cards' side (Mewbit stands where the other one was). Pure decoration, so
// everything is aria-hidden and ignores the pointer. The look is driven by CSS variables set on
// .mb-stage (--mb-vibe, --mb-pulse), see mewbeat.css.

// A fixed skyline: the same seeded sequence the v3 mockup used, computed once at load so the
// buildings never change between renders.
function buildSkyline() {
  const buildings = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  let x = 0;
  while (x < 104) {
    const width = 3 + rnd() * 6;
    const height = 30 + rnd() * 70;
    buildings.push({ left: Number(x.toFixed(2)), width: Number(width.toFixed(2)), height: Number(height.toFixed(2)) });
    x += width + 0.4;
  }
  return buildings;
}

const SKYLINE = buildSkyline();

export default function Stage() {
  return (
    <div className="mb-backdrop" aria-hidden="true">
      <div className="mb-sky" />
      <div className="mb-moon" />
      <div className="mb-spot mb-spot-l" />
      <div className="mb-spot mb-spot-r" />
      <div className="mb-skyline">
        {SKYLINE.map((b) => (
          <div key={b.left} className="mb-building" style={{ left: `${b.left}%`, width: `${b.width}%`, height: `${b.height}%` }} />
        ))}
      </div>
      <div className="mb-floor-edge" />
      <div className="mb-floor" />
      <div className="mb-speaker mb-speaker-r"><i /><i /></div>
    </div>
  );
}
