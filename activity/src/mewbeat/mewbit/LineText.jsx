import { lineParts } from "./lines.js";

// A bubble line with its picked-out words. The tones are the glitch tag's own: <b> is cyan and <em> is pink
// (.mb-tag-body in mewbeat.css).
export default function LineText({ line }) {
  return lineParts(line).map((part, index) => {
    if (part.tone === "cyan") return <b key={index}>{part.text}</b>;
    if (part.tone === "pink") return <em key={index}>{part.text}</em>;
    return part.text;
  });
}
