# Mewbit art sources

Working material behind the Mewbit frames and backdrops in `activity/src/mewbeat`. The game doesn't load anything from this folder; it is kept so the art can be changed without starting over.

| Folder | What it holds |
|---|---|
| `mewbit-rig/` | The rig that draws the animations: Python scripts, body plates, limb keys and masks, face and eye swaps. `kneel/` holds the source drawings for the `crushed` fall. |
| `mewbit-gallery/` | The review page for the animations and the scripts that build it and copy approved frames. |
| `mewbit-backdrops/` | `layers.py` cuts a scene into its five layers. `upscaled/` holds the eight chosen paintings, `mocks/` every generated variant and `gen.ps1`, the script and prompts that made them. |
| `mewbit-anime/` | Style tests, reference sheets and the first generated poses. `ref-style.png` and `style5-lift/bp-30.png` are the identity reference for the character. |
| `mewbit-svg/` | Hand-built vector versions of the avatar and the script that builds them. |

The scripts were run from a temporary folder and some have absolute local paths, for example `SOURCE` in `mewbit-rig/segment.py`. Point those at your own checkout before running them. Image generation uses a local ComfyUI, which isn't part of this repository.

## Licenses

These files came from several image models, and their licenses restrict use:

- **FLUX 3 Klein** (the backdrops): FLUX Kommunity License. Commercial use only for qualifying users under US$5M annual revenue, and outputs may not be used to improve similar AI models.
- **FLUX Base 9**: FLUX Non-Commercial License.
- **Qwen Base**: Qwen Research license, for non-commercial research and evaluation only.

The mix isn't recorded file by file, so treat everything here as non-commercial. Check the license again before using any of it in something commercial.
