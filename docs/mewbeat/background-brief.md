# mewbeat: background art brief

The stage is three columns: Mewbit on the left, the note highway in the middle
(at most 400 px wide, about 21% of a 1920 px screen), and the score cards on the right.
The backdrop fills the whole stage behind them and is cropped with `cover`, so the
edges can be lost on narrow windows.

The game animates the art itself, so **the images should be still and evenly lit**:
- the beat pulse (`--mb-pulse`) flashes windows and neon on every beat;
- the combo "vibe" (`--mb-vibe`) brightens the scene;
- fever turns it gold and pink;
- a miss streak drains the colour.

Glow, bloom and flicker come from the code, not the picture.

## Shared style (paste into every prompt)

> Anime cel-shaded illustration, flat colour fills with 2–3 hard-edged shade tones,
> thick clean black ink outlines (uniform line weight, like a sticker or a mascot
> illustration), no painterly texture, no gradients inside shapes except the sky.
> Night palette: near-black violet (#0d0818, #150d22), deep magenta (#ff6ec7),
> cyan (#67e3f4), soft violet (#a78bfa); highlights only in magenta and cyan.
> No people, no characters, no text, letters, logos or signs with writing.
> Calm, readable composition with large simple shapes: it sits behind a rhythm game.

**Composition (paste into every prompt):**
> 16:9, 2560×1440. The middle 30% of the width is quiet and dark, with no bright
> details and no strong lines (a vertical note highway covers it). The left third has
> open space at the bottom for a character standing on the roof. The important
> details sit in the left and right thirds and in the upper half.

## Layers

All layers use the **same canvas size and camera** so they line up when stacked.
Generate layer 1 first, then pass it as a reference image for the others, with the
prompt "same scene, same camera, same framing".

| # | File | What it shows | Background |
|---|------|---------------|------------|
| 1 | `sky.png` | Night sky only: a violet-to-black gradient, a large pale-lavender moon in the upper-left quarter, a few flat cel-shaded clouds, sparse stars. No buildings. | opaque |
| 2 | `skyline.png` | A city skyline silhouette across the lower half (the roofline at about 45–60% height): tall flat towers with black outlines, the **windows dark/unlit**, a few rooftop antennas and water tanks. | transparent above the roofline |
| 3 | `skyline-lit.png` | The same skyline with **all windows lit** in warm magenta and cyan. Nothing else changes. | transparent |
| 4 | `neon.png` | 3–5 abstract neon shapes on the buildings (no letters): a heart, a music note, a cat-ear outline, stripes or arrows, in magenta and cyan tube style, on the left and right thirds only. | transparent |
| 5 | `roof.png` | The rooftop the characters stand on, in the foreground at the bottom 25–30%: concrete tiles in perspective, a low railing, two speaker stacks at the far left and right edges, cables. The middle stays plain and dark. | transparent above the roof |

**Optional:** `sky-fever.png`, the same sky in gold (#ffd479) and hot pink, for fever.
If it doesn't line up, skip it: the code can recolour the normal sky.

## If a lit version doesn't line up

Image models rarely redraw the same buildings twice. If `skyline-lit.png` drifts from
`skyline.png`, give me a **mask** instead: same size, white where the windows are and
black elsewhere. Colour-select the window shapes in an editor and fill them, for
example. Do the same for the neon tubes if you want them to flicker separately. I can
light the windows from the mask.

## A prompt for the model to write its own prompts

> I'm making layered background art for a cute neon rhythm game. The mascot is a
> cat-like character drawn in anime cel style with thick black outlines and a
> black/magenta/cyan palette. Using the style and composition rules below, write one
> image prompt per layer (sky, unlit skyline, lit skyline, neon shapes, rooftop
> foreground). The prompts must keep the same camera and framing, keep the middle 30%
> of the width calm and dark, and contain no text or characters. [paste the two
> "paste into every prompt" blocks above]

## What to send back

PNG files with the names above. Webp is fine as well. The sky can be JPEG.
