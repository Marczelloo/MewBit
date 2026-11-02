// Stage scenery behind the game: stacked painted layers on one 2560x1440 canvas, plus spotlights.
// Pure decoration, so everything is aria-hidden and ignores the pointer. The look is driven by CSS
// variables set on .mb-stage (--mb-vibe, --mb-pulse), see mewbeat.css.
import sky from "./backdrop/sky.webp";
import skyFever from "./backdrop/sky-fever.webp";
import skyline from "./backdrop/skyline.webp";
import skylineLit from "./backdrop/skyline-lit.webp";
import neon from "./backdrop/neon.webp";
import neonGlow from "./backdrop/neon-glow.webp";
import roof from "./backdrop/roof.webp";

function Layer({ src, name = "" }) {
  return <img className={`mb-layer ${name}`.trim()} src={src} alt="" draggable={false} />;
}

export default function Stage() {
  return (
    <div className="mb-backdrop" aria-hidden="true">
      <Layer src={sky} />
      <Layer src={skyFever} name="mb-layer-fever" />
      <Layer src={skyline} />
      <Layer src={skylineLit} name="mb-layer-lit" />
      <div className="mb-spot mb-spot-l" />
      <div className="mb-spot mb-spot-r" />
      <Layer src={neonGlow} name="mb-layer-glow" />
      <Layer src={neon} name="mb-layer-neon" />
      <Layer src={roof} />
      <div className="mb-backdrop-wash" />
      <div className="mb-backdrop-dim" />
    </div>
  );
}
