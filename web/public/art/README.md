# Artwork

| File | Use | Notes |
|---|---|---|
| `hero-figure.webp` | Landing hero plate, ≥861px | Cat-eared figure from behind, cyan rim right, magenta rim left, on black. 1774x887 (2:1), WebP q82, 36 KB. |
| `operator.webp` | Landing close section | Cat-ear silhouette at a console, single cyan rim light. |
| `mewbit-og-1200x600.jpg` | Link preview (`og:image`, `twitter:image` in `index.html`) | Mewbit on the night rooftop pointing at a star; same scene as the Discord banner. 1200x600 (2:1), JPEG q88, 108 KB. JPEG, not WebP, because some link unfurlers skip WebP. |

Generated artwork. No third-party rights attach to these.

## Measured luminance

Measured in true RGB, not `ffmpeg signalstats` — that filter reports
limited-range luma where 16 is black, which reads as a lifted black level on an
image that does not have one.

| Region | Peak luma | White text on it |
|---|---|---|
| `hero-figure` left half (behind the lede at ≥861px) | **1 / 255** | ~20:1 |
| `hero-figure` lede band at the 375px crop | **196 / 255** | **1.6:1** |

The first number is why the figure works on desktop: the left half of the frame
is empty by construction, so the headline sits on effectively pure black. The
second is why it is dropped below 860px — see the media query in `landing.css`.
Every horizontal crop measures 173-196 in that band, because the headphone band
runs the full width of the subject at exactly the height the lede occupies.

## Why the plate is half drawn

The hero is two layers. The figure is this image, anchored to the right edge.
The waveform over it is `src/landing/HeroField.jsx`, drawn as deterministic SVG
and masked to die at 58% so the two never cross — a photographic subject and a
drawn motif overlapping in the one region where both carry detail is how a
composition turns to noise. `src/landing/SectionRule.jsx` carries the same
waveform down the page.

`operator.webp` is the only other image on the landing. The original PNGs and
unused variants live in `docs/art-source/`, outside `public/`, because Vite
copies everything under `public/` into the build.
